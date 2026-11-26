'use strict';
// Buku kas: saldo per dana, saldo awal (sekali), koreksi pembalik.
const prisma = require('../../lib/prisma');
const { AppError } = require('../../lib/util');
const { buatPembalik, TX_OPTS } = require('./pembayaran');

/** Saldo setiap dana = Σ MASUK − Σ KELUAR (termasuk saldo awal). */
async function saldoDana(db = prisma, { sampai = null } = {}) {
  const dana = await db.dana.findMany({ orderBy: { id: 'asc' } });
  const rows = sampai
    ? await db.$queryRaw`SELECT "danaId", arah, SUM(nominal)::bigint AS n FROM "LedgerEntry" WHERE tanggal < ${sampai} GROUP BY "danaId", arah`
    : await db.$queryRaw`SELECT "danaId", arah, SUM(nominal)::bigint AS n FROM "LedgerEntry" GROUP BY "danaId", arah`;
  const m = new Map();
  for (const r of rows) {
    const cur = m.get(r.danaId) || 0;
    m.set(r.danaId, cur + (r.arah === 'MASUK' ? Number(r.n) : -Number(r.n)));
  }
  return dana.map((d) => ({ ...d, saldo: m.get(d.id) || 0 }));
}

async function saldoSatuDana(tx, danaId) {
  const rows = await tx.$queryRaw`
    SELECT COALESCE(SUM(CASE WHEN arah = 'MASUK' THEN nominal ELSE -nominal END), 0)::bigint AS s
    FROM "LedgerEntry" WHERE "danaId" = ${danaId}`;
  return Number(rows[0].s);
}

/** Saldo awal hanya boleh sekali per dana. */
async function setSaldoAwal({ danaId, nominal, tanggal, userId, keterangan }) {
  nominal = Number(nominal);
  if (!Number.isInteger(nominal) || nominal < 0) throw new AppError('Nominal saldo awal tidak valid.');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(42001, ${danaId}::int)`;
    const ada = await tx.ledgerEntry.findFirst({ where: { danaId, jenis: 'SALDO_AWAL' } });
    if (ada) throw new AppError('Saldo awal dana ini sudah pernah diinput. Gunakan koreksi pembalik bila salah.');
    return tx.ledgerEntry.create({
      data: { danaId, arah: 'MASUK', nominal, jenis: 'SALDO_AWAL', sumberTipe: 'MANUAL', tanggal: tanggal || new Date(), keterangan: keterangan || 'Saldo awal pembukuan', dibuatOlehId: userId },
    });
  }, TX_OPTS);
}

/** Pemasukan/pengeluaran lain-lain (di luar iuran), mis. donasi. */
async function entriManual({ danaId, arah, nominal, tanggal, keterangan, userId }) {
  nominal = Number(nominal);
  if (!Number.isInteger(nominal) || nominal <= 0) throw new AppError('Nominal tidak valid.');
  if (!['MASUK', 'KELUAR'].includes(arah)) throw new AppError('Arah tidak valid.');
  if (!keterangan) throw new AppError('Keterangan wajib diisi.');
  return prisma.ledgerEntry.create({ data: { danaId, arah, nominal, jenis: 'LAINNYA', sumberTipe: 'MANUAL', tanggal: tanggal || new Date(), keterangan, dibuatOlehId: userId } });
}

async function koreksi(entryId, { userId, alasan }) {
  if (!alasan) throw new AppError('Alasan koreksi wajib diisi.');
  return prisma.$transaction(async (tx) => {
    const e = await tx.ledgerEntry.findUnique({ where: { id: entryId } });
    if (!e) throw new AppError('Entri tidak ditemukan.', 404);
    if (e.jenis === 'PEMBALIK') throw new AppError('Entri pembalik tidak bisa dibalik lagi.');
    if (e.sumberTipe === 'PEMBAYARAN') throw new AppError('Entri dari pembayaran: batalkan lewat menu pembayaran agar tagihan ikut terkoreksi.');
    return buatPembalik(tx, e, { userId, alasan });
  }, TX_OPTS);
}

module.exports = { saldoDana, saldoSatuDana, setSaldoAwal, entriManual, koreksi };
