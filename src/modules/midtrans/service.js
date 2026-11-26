'use strict';
// Midtrans Snap + webhook. Pembayaran hanya diposting dari notifikasi server
// yang lolos verifikasi signature DAN dikonfirmasi ulang ke API status Midtrans.
const crypto = require('crypto');
const config = require('../../config');
const prisma = require('../../lib/prisma');
const settings = require('../../lib/settings');
const { AppError, nextNomor } = require('../../lib/util');
const { posting, TX_OPTS } = require('../keuangan/pembayaran');
const { tunggakanRumah } = require('../iuran/service');

const base = () => (config.MIDTRANS_PRODUCTION ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com');
const api = () => (config.MIDTRANS_PRODUCTION ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com');
const auth = () => 'Basic ' + Buffer.from(config.MIDTRANS_SERVER_KEY + ':').toString('base64');
const snapJs = () => `${base()}/snap/snap.js`;

/** Buat transaksi Snap untuk seluruh tunggakan rumah (atau nominal tertentu ≤ tunggakan). */
async function buatSnap(rumah, nominal = null) {
  if (!config.midtransEnabled) throw new AppError('Pembayaran online belum diaktifkan.');
  const tg = await tunggakanRumah(rumah.id);
  if (tg.total <= 0) throw new AppError('Tidak ada tagihan yang perlu dibayar.');
  const gross = nominal ? Math.min(Number(nominal), tg.total) : tg.total;
  if (!Number.isInteger(gross) || gross < 1000) throw new AppError('Nominal minimal Rp1.000.');
  const orderId = `BCA-${rumah.kode}-${Date.now().toString(36).toUpperCase()}`;
  const body = {
    transaction_details: { order_id: orderId, gross_amount: gross },
    item_details: [{ id: 'IURAN', price: gross, quantity: 1, name: `Iuran ${rumah.kode}`.slice(0, 50) }],
    callbacks: { finish: `${config.APP_URL.replace(/\/$/, '')}/r/selesai` },
  };
  const res = await fetch(`${base()}/snap/v1/transactions`, {
    method: 'POST', headers: { Authorization: auth(), 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.token) throw new AppError('Gagal membuat transaksi Midtrans: ' + (json.error_messages?.join(', ') || res.status), 502);
  await prisma.midtransTransaksi.create({ data: { orderId, rumahId: rumah.id, grossAmount: gross, snapToken: json.token } });
  return { token: json.token, orderId, gross, clientKey: config.MIDTRANS_CLIENT_KEY, snapJs: snapJs() };
}

function verifySignature(n) {
  const expect = crypto.createHash('sha512').update(`${n.order_id}${n.status_code}${n.gross_amount}${config.MIDTRANS_SERVER_KEY}`).digest('hex');
  const got = String(n.signature_key || '');
  return got.length === expect.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expect));
}

async function fetchStatus(orderId) {
  const res = await fetch(`${api()}/v2/${encodeURIComponent(orderId)}/status`, { headers: { Authorization: auth(), Accept: 'application/json' } });
  if (!res.ok) throw new AppError('Gagal cek status Midtrans', 502);
  return res.json();
}

function isPaid(s) {
  return s.transaction_status === 'settlement' || (s.transaction_status === 'capture' && s.fraud_status === 'accept');
}

/** Hitung biaya Midtrans dari pengaturan (flat + persen). */
async function hitungFee(gross) {
  const s = await settings.all();
  const flat = Number(s.midtrans_fee_flat || 0);
  const persen = Number(s.midtrans_fee_persen || 0);
  return Math.round(flat + (gross * persen) / 100);
}

/**
 * Proses notifikasi Midtrans secara idempoten.
 * Kembalikan { posted, pembayaranId } — pemanggil boleh mengantre konfirmasi WA.
 */
async function handleNotification(n, { fetchStatusFn = fetchStatus } = {}) {
  if (!verifySignature(n)) throw new AppError('Signature tidak valid', 401);
  const status = await fetchStatusFn(n.order_id); // jangan percaya isi notifikasi mentah
  const gross = Math.round(Number(status.gross_amount));

  return prisma.$transaction(async (tx) => {
    const [trx] = await tx.$queryRaw`SELECT * FROM "MidtransTransaksi" WHERE "orderId" = ${status.order_id} FOR UPDATE`;
    if (!trx) throw new AppError('Order tidak dikenal', 404);
    if (gross !== trx.grossAmount) throw new AppError('Nominal tidak cocok', 400);
    await tx.midtransTransaksi.update({
      where: { id: trx.id },
      data: {
        status: status.transaction_status, transactionId: status.transaction_id, paymentType: status.payment_type, raw: status,
        settlementAt: status.settlement_time ? new Date(status.settlement_time.replace(' ', 'T') + '+07:00') : undefined,
      },
    });
    if (!isPaid(status) || trx.pembayaranId) return { posted: false, pembayaranId: trx.pembayaranId };

    const nomor = await nextNomor(tx, 'MDT');
    const p = await tx.pembayaran.create({
      data: { nomor, rumahId: trx.rumahId, metode: 'MIDTRANS', nominal: gross, catatan: `Midtrans ${status.order_id} (${status.payment_type})` },
    });
    await tx.midtransTransaksi.update({ where: { id: trx.id }, data: { pembayaranId: p.id } });
    try {
      await tx.$executeRaw`SAVEPOINT sp_post`;
      await posting(tx, p.id, {});
      await tx.$executeRaw`RELEASE SAVEPOINT sp_post`;
    } catch (e) {
      // Uang sudah masuk tetapi tunggakan berubah (mis. sudah dibayar tunai) → biarkan
      // MENUNGGU agar bendahara menyelesaikan alokasinya secara manual.
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT sp_post`;
      await tx.pembayaran.update({ where: { id: p.id }, data: { catatan: `${p.catatan} — PERLU ALOKASI MANUAL: ${e.message}`.slice(0, 500) } });
      return { posted: false, pembayaranId: p.id, perluManual: true };
    }
    const fee = await hitungFee(gross);
    if (fee > 0) {
      const kodeDana = await settings.get('midtrans_fee_dana');
      const dana = await tx.dana.findUnique({ where: { kode: kodeDana } });
      if (dana) {
        await tx.ledgerEntry.create({ data: { danaId: dana.id, arah: 'KELUAR', nominal: fee, jenis: 'BIAYA_MIDTRANS', sumberTipe: 'MIDTRANS', sumberId: trx.id, keterangan: `Biaya Midtrans ${status.order_id}` } });
        await tx.midtransTransaksi.update({ where: { id: trx.id }, data: { fee } });
      }
    }
    return { posted: true, pembayaranId: p.id };
  }, TX_OPTS);
}

module.exports = { buatSnap, handleNotification, verifySignature, isPaid, snapJs };
