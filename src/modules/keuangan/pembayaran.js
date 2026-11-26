'use strict';
// Inti pembayaran: posting FIFO, alokasi manual, ledger, dan pembatalan (pembalik).
// Semua perubahan saldo/tagihan terjadi di dalam satu transaksi database.
const prisma = require('../../lib/prisma');
const { AppError, nextNomor } = require('../../lib/util');

const TX_OPTS = { timeout: 20000, maxWait: 10000 };

/** Item tagihan terbuka milik rumah, dikunci untuk update, urut FIFO. */
async function lockOpenItems(tx, rumahId) {
  return tx.$queryRaw`
    SELECT ti.id, ti."tagihanId", ti.nominal, ti.terbayar, ti."danaId", ti.nama, t.periode
    FROM "TagihanItem" ti JOIN "Tagihan" t ON t.id = ti."tagihanId"
    WHERE t."rumahId" = ${rumahId} AND t.status IN ('BELUM','SEBAGIAN') AND ti.terbayar < ti.nominal
    ORDER BY t.periode ASC, ti.urutan ASC, ti.id ASC
    FOR UPDATE OF ti, t`;
}

/**
 * Hitung alokasi. Otomatis = FIFO: tagihan tertua dulu, komponen dilunasi penuh berurutan.
 * Manual = daftar {tagihanItemId, nominal} dari bendahara.
 */
function hitungAlokasi(items, nominal, manual) {
  if (manual && manual.length) {
    const byId = new Map(items.map((i) => [i.id, i]));
    let sum = 0;
    const out = [];
    for (const m of manual) {
      const it = byId.get(Number(m.tagihanItemId));
      const n = Number(m.nominal);
      if (!it) throw new AppError('Alokasi ke tagihan yang tidak valid / sudah lunas.');
      if (!Number.isInteger(n) || n <= 0) continue;
      if (n > it.nominal - it.terbayar) throw new AppError(`Alokasi ${it.nama} ${it.periode} melebihi sisa tagihan.`);
      sum += n;
      out.push({ item: it, nominal: n });
    }
    if (sum !== nominal) throw new AppError(`Jumlah alokasi (${sum}) harus sama dengan nominal pembayaran (${nominal}).`);
    return out;
  }
  let sisa = nominal;
  const out = [];
  for (const it of items) {
    if (sisa <= 0) break;
    const ambil = Math.min(sisa, it.nominal - it.terbayar);
    if (ambil > 0) { out.push({ item: it, nominal: ambil }); sisa -= ambil; }
  }
  if (sisa > 0) throw new AppError(`Nominal melebihi total tunggakan (lebih Rp${sisa.toLocaleString('id-ID')}). Buat tagihan bulan berikutnya dulu atau kurangi nominal.`);
  return out;
}

/** Posting pembayaran (status → DIPOSTING): alokasi, update tagihan, ledger MASUK. */
async function posting(tx, pembayaranId, { alokasiManual = null, userId = null } = {}) {
  const [p] = await tx.$queryRaw`SELECT * FROM "Pembayaran" WHERE id = ${pembayaranId} FOR UPDATE`;
  if (!p) throw new AppError('Pembayaran tidak ditemukan.', 404);
  if (p.status === 'DIPOSTING') return { already: true };
  if (p.status !== 'MENUNGGU') throw new AppError(`Pembayaran berstatus ${p.status} tidak bisa diposting.`);

  const items = await lockOpenItems(tx, p.rumahId);
  const alokasi = hitungAlokasi(items, p.nominal, alokasiManual);

  const perTagihan = new Map();
  const perDana = new Map();
  for (const a of alokasi) {
    await tx.tagihanItem.update({ where: { id: a.item.id }, data: { terbayar: { increment: a.nominal } } });
    await tx.alokasiPembayaran.create({ data: { pembayaranId: p.id, tagihanItemId: a.item.id, nominal: a.nominal } });
    perTagihan.set(a.item.tagihanId, (perTagihan.get(a.item.tagihanId) || 0) + a.nominal);
    perDana.set(a.item.danaId, (perDana.get(a.item.danaId) || 0) + a.nominal);
  }
  for (const [tagihanId, n] of perTagihan) await refreshTagihan(tx, tagihanId, n);
  for (const [danaId, n] of perDana) {
    await tx.ledgerEntry.create({
      data: { tanggal: p.tanggal, danaId, arah: 'MASUK', nominal: n, jenis: 'IURAN', sumberTipe: 'PEMBAYARAN', sumberId: p.id, keterangan: `Iuran ${p.nomor} (${p.metode})`, dibuatOlehId: userId },
    });
  }
  await tx.pembayaran.update({ where: { id: p.id }, data: { status: 'DIPOSTING', diverifikasiOlehId: userId, diverifikasiAt: new Date() } });
  return { alokasi: alokasi.map((a) => ({ tagihanItemId: a.item.id, periode: a.item.periode, nama: a.item.nama, nominal: a.nominal })) };
}

async function refreshTagihan(tx, tagihanId, delta) {
  const t = await tx.tagihan.update({ where: { id: tagihanId }, data: { terbayar: { increment: delta } } });
  const status = t.terbayar <= 0 ? 'BELUM' : t.terbayar >= t.total ? 'LUNAS' : 'SEBAGIAN';
  if (status !== t.status) await tx.tagihan.update({ where: { id: tagihanId }, data: { status } });
}

function validNominal(n) {
  n = Number(n);
  if (!Number.isInteger(n) || n <= 0 || n > 100_000_000) throw new AppError('Nominal tidak valid.');
  return n;
}

/** Bendahara mencatat pembayaran tunai → langsung diposting. */
async function bayarTunai({ rumahId, nominal, tanggal, catatan, alokasiManual, userId }) {
  nominal = validNominal(nominal);
  return prisma.$transaction(async (tx) => {
    const nomor = await nextNomor(tx, 'KWT');
    const p = await tx.pembayaran.create({
      data: { nomor, rumahId, metode: 'TUNAI', nominal, tanggal: tanggal || new Date(), catatan, dibuatOlehId: userId },
    });
    const r = await posting(tx, p.id, { alokasiManual, userId });
    return { pembayaran: p, ...r };
  }, TX_OPTS);
}

/** Warga/petugas mengunggah bukti transfer → MENUNGGU verifikasi. */
async function ajukanTransfer({ rumahId, nominal, tanggal, catatan, buktiFileId, userId = null }) {
  nominal = validNominal(nominal);
  if (!buktiFileId) throw new AppError('Bukti transfer wajib diunggah.');
  return prisma.$transaction(async (tx) => {
    const nomor = await nextNomor(tx, 'TRF');
    return tx.pembayaran.create({
      data: { nomor, rumahId, metode: 'TRANSFER', nominal, tanggal: tanggal || new Date(), catatan, buktiFileId, dibuatOlehId: userId },
    });
  }, TX_OPTS);
}

/** Bendahara menyetujui transfer (bisa dengan nominal sesuai mutasi & alokasi manual). */
async function setujuiTransfer(pembayaranId, { userId, nominal = null, alokasiManual = null }) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.pembayaran.findUnique({ where: { id: pembayaranId } });
    if (!p || p.metode !== 'TRANSFER') throw new AppError('Pembayaran transfer tidak ditemukan.', 404);
    if (nominal != null && Number(nominal) !== p.nominal) {
      await tx.pembayaran.update({ where: { id: p.id }, data: { nominal: validNominal(nominal), catatan: `${p.catatan || ''} [nominal dikoreksi dari ${p.nominal}]`.trim() } });
    }
    return posting(tx, p.id, { alokasiManual, userId });
  }, TX_OPTS);
}

async function tolakTransfer(pembayaranId, { userId, alasan }) {
  const p = await prisma.pembayaran.findUnique({ where: { id: pembayaranId } });
  if (!p || p.status !== 'MENUNGGU') throw new AppError('Hanya pembayaran MENUNGGU yang bisa ditolak.');
  return prisma.pembayaran.update({ where: { id: p.id }, data: { status: 'DITOLAK', alasanTolak: alasan || '-', diverifikasiOlehId: userId, diverifikasiAt: new Date() } });
}

/** Batalkan pembayaran terposting dengan transaksi pembalik (tidak menghapus apa pun). */
async function batalkan(pembayaranId, { userId, alasan }) {
  if (!alasan) throw new AppError('Alasan pembatalan wajib diisi.');
  return prisma.$transaction(async (tx) => {
    const [p] = await tx.$queryRaw`SELECT * FROM "Pembayaran" WHERE id = ${pembayaranId} FOR UPDATE`;
    if (!p) throw new AppError('Pembayaran tidak ditemukan.', 404);
    if (p.status !== 'DIPOSTING') throw new AppError('Hanya pembayaran terposting yang bisa dibatalkan.');
    const alok = await tx.alokasiPembayaran.findMany({ where: { pembayaranId: p.id }, include: { tagihanItem: true } });
    const perTagihan = new Map();
    for (const a of alok) {
      await tx.tagihanItem.update({ where: { id: a.tagihanItemId }, data: { terbayar: { decrement: a.nominal } } });
      perTagihan.set(a.tagihanItem.tagihanId, (perTagihan.get(a.tagihanItem.tagihanId) || 0) - a.nominal);
    }
    for (const [tid, n] of perTagihan) await refreshTagihan(tx, tid, n);
    const entries = await tx.ledgerEntry.findMany({ where: { sumberTipe: 'PEMBAYARAN', sumberId: p.id, membalikId: null, jenis: { not: 'PEMBALIK' } } });
    for (const e of entries) await buatPembalik(tx, e, { userId, alasan });
    await tx.pembayaran.update({ where: { id: p.id }, data: { status: 'DIBATALKAN', alasanTolak: alasan } });
    return { dibalik: entries.length };
  }, TX_OPTS);
}

async function buatPembalik(tx, entry, { userId, alasan }) {
  const sudah = await tx.ledgerEntry.findUnique({ where: { membalikId: entry.id } });
  if (sudah) throw new AppError(`Entri #${entry.id} sudah pernah dibalik.`);
  return tx.ledgerEntry.create({
    data: {
      danaId: entry.danaId, arah: entry.arah === 'MASUK' ? 'KELUAR' : 'MASUK', nominal: entry.nominal, jenis: 'PEMBALIK',
      sumberTipe: entry.sumberTipe, sumberId: entry.sumberId, membalikId: entry.id,
      keterangan: `Pembalik #${entry.id}: ${alasan}`, dibuatOlehId: userId,
    },
  });
}

module.exports = { posting, hitungAlokasi, bayarTunai, ajukanTransfer, setujuiTransfer, tolakTransfer, batalkan, buatPembalik, TX_OPTS };
