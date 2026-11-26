'use strict';
// Alur pengeluaran: DRAFT → PENDING → APPROVED/REJECTED → PAID; CANCELLED.
// Saldo hanya berkurang saat PAID.
const prisma = require('../../lib/prisma');
const { AppError, nextNomor } = require('../../lib/util');
const { saldoSatuDana } = require('./ledger');
const { TX_OPTS } = require('./pembayaran');

async function buat({ danaId, kategori, nominal, alasan, lampiranFileId, ajukan, userId }) {
  nominal = Number(nominal);
  if (!Number.isInteger(nominal) || nominal <= 0) throw new AppError('Nominal tidak valid.');
  if (!alasan || !kategori) throw new AppError('Kategori dan alasan wajib diisi.');
  return prisma.$transaction(async (tx) => {
    const nomor = await nextNomor(tx, 'PGL');
    return tx.pengeluaran.create({
      data: { nomor, danaId, kategori, nominal, alasan, lampiranFileId, dibuatOlehId: userId, status: ajukan ? 'PENDING' : 'DRAFT' },
    });
  }, TX_OPTS);
}

async function transisi(id, dari, ke, data = {}) {
  const r = await prisma.pengeluaran.updateMany({ where: { id, status: { in: dari } }, data: { status: ke, ...data } });
  if (r.count === 0) throw new AppError(`Pengeluaran tidak dalam status ${dari.join('/')}.`);
  return prisma.pengeluaran.findUnique({ where: { id } });
}

const ajukan = (id, userId) => transisi(id, ['DRAFT'], 'PENDING');

async function putuskan(id, { userId, setuju, alasan }) {
  const p = await prisma.pengeluaran.findUnique({ where: { id } });
  if (!p) throw new AppError('Pengeluaran tidak ditemukan.', 404);
  if (p.dibuatOlehId === userId) throw new AppError('Anda tidak boleh menyetujui/menolak pengajuan sendiri.', 403);
  if (!setuju && !alasan) throw new AppError('Alasan penolakan wajib diisi.');
  return transisi(id, ['PENDING'], setuju ? 'APPROVED' : 'REJECTED', { disetujuiOlehId: userId, disetujuiAt: new Date(), alasanTolak: setuju ? null : alasan });
}

/** Catat pembayaran pengeluaran → PAID + ledger KELUAR. */
async function bayar(id, { userId, buktiFileId, tanggal }) {
  if (!buktiFileId) throw new AppError('Bukti pembayaran wajib diunggah.');
  return prisma.$transaction(async (tx) => {
    const [p] = await tx.$queryRaw`SELECT * FROM "Pengeluaran" WHERE id = ${id} FOR UPDATE`;
    if (!p) throw new AppError('Pengeluaran tidak ditemukan.', 404);
    if (p.status !== 'APPROVED') throw new AppError('Hanya pengeluaran APPROVED yang bisa dibayar.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(42001, ${p.danaId}::int)`;
    const saldo = await saldoSatuDana(tx, p.danaId);
    if (saldo < p.nominal) throw new AppError(`Saldo dana tidak cukup (saldo Rp${saldo.toLocaleString('id-ID')}).`);
    const when = tanggal || new Date();
    await tx.ledgerEntry.create({
      data: { tanggal: when, danaId: p.danaId, arah: 'KELUAR', nominal: p.nominal, jenis: 'PENGELUARAN', sumberTipe: 'PENGELUARAN', sumberId: p.id, keterangan: `${p.nomor} ${p.kategori}: ${p.alasan}`.slice(0, 500), dibuatOlehId: userId },
    });
    return tx.pengeluaran.update({ where: { id }, data: { status: 'PAID', buktiFileId, dibayarAt: when } });
  }, TX_OPTS);
}

const batal = (id) => transisi(id, ['DRAFT', 'PENDING', 'APPROVED'], 'CANCELLED');

module.exports = { buat, ajukan, putuskan, bayar, batal };
