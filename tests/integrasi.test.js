'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { prisma, seedDasar, saldo } = require('./helpers');
const iuran = require('../src/modules/iuran/service');
const midtrans = require('../src/modules/midtrans/service');
const link = require('../src/modules/warga/link');
const impor = require('../src/modules/impor/service');

let D;
before(async () => { D = await seedDasar(); await iuran.generateTagihan('2026-01'); });
after(() => prisma.$disconnect());

function notif(orderId, gross, status = 'settlement') {
  const n = { order_id: orderId, status_code: '200', gross_amount: `${gross}.00`, transaction_status: status };
  n.signature_key = crypto.createHash('sha512').update(`${n.order_id}${n.status_code}${n.gross_amount}${process.env.MIDTRANS_SERVER_KEY}`).digest('hex');
  return n;
}
const stub = (orderId, gross, status = 'settlement') => async () => ({ order_id: orderId, gross_amount: `${gross}.00`, transaction_status: status, transaction_id: 'trx-1', payment_type: 'qris', settlement_time: '2026-01-05 10:00:00' });

test('webhook Midtrans: signature salah ditolak', async () => {
  const n = notif('BCA-X', 50000); n.signature_key = 'a'.repeat(128);
  await assert.rejects(midtrans.handleNotification(n, { fetchStatusFn: stub('BCA-X', 50000) }), /Signature/);
});

test('webhook Midtrans: settlement diposting sekali (idempoten), pending tidak diposting', async () => {
  const orderId = 'BCA-A1-T1';
  await prisma.midtransTransaksi.create({ data: { orderId, rumahId: D.a1.id, grossAmount: 50000 } });
  const pend = await midtrans.handleNotification(notif(orderId, 50000, 'pending'), { fetchStatusFn: stub(orderId, 50000, 'pending') });
  assert.equal(pend.posted, false);
  const s0 = await saldo();
  const r1 = await midtrans.handleNotification(notif(orderId, 50000), { fetchStatusFn: stub(orderId, 50000) });
  const r2 = await midtrans.handleNotification(notif(orderId, 50000), { fetchStatusFn: stub(orderId, 50000) });
  assert.equal(r1.posted, true);
  assert.equal(r2.posted, false);
  assert.equal(await prisma.pembayaran.count({ where: { metode: 'MIDTRANS' } }), 1);
  const s1 = await saldo();
  assert.equal(s1.PEMBANGUNAN + s1.KAS + s1.SAMPAH - (s0.PEMBANGUNAN + s0.KAS + s0.SAMPAH), 50000);
  const t = await prisma.midtransTransaksi.findUnique({ where: { orderId } });
  assert.equal(t.transactionId, 'trx-1');
  assert.ok(t.settlementAt);
});

test('webhook Midtrans: nominal dari API status tidak cocok → ditolak', async () => {
  const orderId = 'BCA-A2-T2';
  await prisma.midtransTransaksi.create({ data: { orderId, rumahId: D.a2.id, grossAmount: 50000 } });
  await assert.rejects(midtrans.handleNotification(notif(orderId, 50000), { fetchStatusFn: stub(orderId, 10000) }), /tidak cocok/);
});

test('webhook Midtrans: tunggakan sudah lunas lewat jalur lain → pembayaran MENUNGGU alokasi manual', async () => {
  const orderId = 'BCA-A1-T3';
  await prisma.midtransTransaksi.create({ data: { orderId, rumahId: D.a1.id, grossAmount: 50000 } });
  const r = await midtrans.handleNotification(notif(orderId, 50000), { fetchStatusFn: stub(orderId, 50000) });
  assert.equal(r.perluManual, true);
  const p = await prisma.pembayaran.findUnique({ where: { id: r.pembayaranId } });
  assert.equal(p.status, 'MENUNGGU');
  assert.match(p.catatan, /PERLU ALOKASI MANUAL/);
});

test('link warga: valid, dipalsukan ditolak, dicabut ditolak', async () => {
  const tok = link.tokenFor(D.a1);
  assert.equal((await link.resolve(tok)).id, D.a1.id);
  const [payload, mac] = tok.split('.');
  const lain = Buffer.from(`${D.a2.id}:1`).toString('base64url');
  assert.equal(await link.resolve(`${lain}.${mac}`), null);
  assert.equal(await link.resolve(`${payload}.${'x'.repeat(mac.length)}`), null);
  await prisma.rumah.update({ where: { id: D.a1.id }, data: { tokenVersi: { increment: 1 } } });
  assert.equal(await link.resolve(tok), null);
});

test('impor CSV: rumah, penghuni, status, riwayat; nama kosong tidak diisi; aman diulang', async () => {
  const csv = 'no_urut,nama,blok,nomor,warna,status,jan,feb,keterangan,verifikasi,catatan\n'
    + '1,Budi,C,12A,cokelat,ADA_PENGHUNI,1,0,,OK,\n'
    + '2,,C,14,merah,KOSONG,0,0,Kosong,PERLU_VERIFIKASI,nama tidak terbaca\n';
  const h = await impor.imporCsv(csv, { tahun: 2026, komponen: 'SAMPAH', sumber: 'tes', userId: null });
  assert.equal(h.rumahBaru, 2);
  assert.equal(h.penghuni, 1);
  assert.equal(h.perluVerifikasi, 1);
  const c14 = await prisma.rumah.findUnique({ where: { kode: 'C14' }, include: { penghunian: true, status: true } });
  assert.equal(c14.penghunian.length, 0);
  assert.equal(c14.verifikasi, 'PERLU_VERIFIKASI');
  assert.equal(c14.status[0].kondisi, 'KOSONG');
  const ri = await prisma.riwayatImpor.findMany({ where: { rumah: { kode: 'C12A' } }, orderBy: { periode: 'asc' } });
  assert.deepEqual(ri.map((r) => r.terbayar), [true, false]);
  const h2 = await impor.imporCsv(csv, { tahun: 2026, komponen: 'SAMPAH', sumber: 'tes', userId: null });
  assert.equal(h2.rumahBaru, 0);
  assert.equal(await prisma.penghunian.count({ where: { rumah: { kode: 'C12A' } } }), 1);
  // Riwayat impor tidak masuk buku kas
  assert.equal(await prisma.ledgerEntry.count({ where: { keterangan: { contains: 'tes' } } }), 0);
});

test('calon tunggakan impor → tagihan komponen sesuai kebijakan periode', async () => {
  const r = await prisma.rumah.findUnique({ where: { kode: 'C12A' } });
  await iuran.buatTagihanKomponen(r.id, '2026-02', ['SAMPAH']);
  const t = await prisma.tagihan.findUnique({ where: { rumahId_periode: { rumahId: r.id, periode: '2026-02' } }, include: { items: true } });
  assert.equal(t.total, 20000);
  assert.equal(t.sumber, 'IMPOR');
  // menambah komponen ke tagihan yang sama, tidak ganda
  await iuran.buatTagihanKomponen(r.id, '2026-02', ['SAMPAH', 'KAS']);
  const t2 = await prisma.tagihan.findUnique({ where: { id: t.id }, include: { items: true } });
  assert.equal(t2.total, 30000);
  assert.equal(t2.items.length, 2);
});
