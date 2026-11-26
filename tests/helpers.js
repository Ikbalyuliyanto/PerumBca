'use strict';
// Tes memakai database terpisah (DATABASE_URL harus mengarah ke DB tes!).
process.env.MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || 'SB-test-server-key';
process.env.MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || 'SB-test-client-key';
if (!/test/.test(process.env.DATABASE_URL || '')) throw new Error('DATABASE_URL tes harus berisi kata "test" (pengaman agar DB produksi tidak terhapus).');

const prisma = require('../src/lib/prisma');

async function reset() {
  const rows = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations')`;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/** Data dasar: 3 dana, kebijakan 50rb (20/10/20) mulai 2026-01, user bendahara & ketua. */
async function seedDasar() {
  await reset();
  const [pemb, kas, sampah] = await Promise.all([
    prisma.dana.create({ data: { kode: 'PEMBANGUNAN', nama: 'Pembangunan' } }),
    prisma.dana.create({ data: { kode: 'KAS', nama: 'Kas' } }),
    prisma.dana.create({ data: { kode: 'SAMPAH', nama: 'Sampah' } }),
  ]);
  await prisma.kebijakan.create({ data: { nama: 'K1', berlakuMulai: '2026-01', komponen: { create: [
    { kode: 'PEMBANGUNAN', nama: 'Pembangunan', nominal: 20000, danaId: pemb.id, urutan: 1 },
    { kode: 'KAS', nama: 'Kas', nominal: 10000, danaId: kas.id, urutan: 2 },
    { kode: 'SAMPAH', nama: 'Sampah', nominal: 20000, danaId: sampah.id, urutan: 3 },
  ] } } });
  const blok = await prisma.blok.create({ data: { kode: 'A' } });
  const a1 = await prisma.rumah.create({ data: { blokId: blok.id, nomor: '1', kode: 'A1' } });
  const a2 = await prisma.rumah.create({ data: { blokId: blok.id, nomor: '2', kode: 'A2' } });
  const bendahara = await prisma.user.create({ data: { username: 'bendahara', nama: 'Bendahara', passwordHash: 'x' } });
  const ketua = await prisma.user.create({ data: { username: 'ketua', nama: 'Ketua', passwordHash: 'x' } });
  return { dana: { pemb, kas, sampah }, a1, a2, bendahara, ketua };
}

async function saldo() {
  const { saldoDana } = require('../src/modules/keuangan/ledger');
  return Object.fromEntries((await saldoDana()).map((d) => [d.kode, d.saldo]));
}

module.exports = { prisma, reset, seedDasar, saldo };
