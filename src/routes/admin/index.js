'use strict';
const express = require('express');
const prisma = require('../../lib/prisma');
const { periodeNow } = require('../../lib/util');
const { requireLogin, requirePerm, isStaff } = require('../../middleware/auth');
const { AppError } = require('../../lib/util');
const ledger = require('../../modules/keuangan/ledger');

const r = express.Router();
r.use(requireLogin, (req, res, next) => (isStaff(req.user) ? next() : next(new AppError('Khusus pengurus.', 403))));

r.get('/', requirePerm('dashboard.lihat'), async (req, res) => {
  const periode = periodeNow();
  const awalBulan = new Date(`${periode}-01T00:00:00+07:00`);
  const kondisiRows = await prisma.$queryRaw`
    SELECT s.kondisi, COUNT(*)::int AS n FROM "Rumah" r
    LEFT JOIN LATERAL (SELECT kondisi FROM "StatusRumah" WHERE "rumahId" = r.id AND "berlakuMulai" <= ${periode} ORDER BY "berlakuMulai" DESC LIMIT 1) s ON true
    WHERE r.aktif GROUP BY s.kondisi`;
  const kondisi = { AKTIF: 0, KOSONG: 0, TIDAK_DITEMPATI: 0, PIHAK_KEDUA: 0 };
  let totalRumah = 0;
  for (const k of kondisiRows) { kondisi[k.kondisi || 'AKTIF'] += k.n; totalRumah += k.n; }
  const [tagBulan, tunggakan, bayarBulan, arus, pending, menunggu, verifikasi] = await Promise.all([
    prisma.tagihan.aggregate({ where: { periode, status: { not: 'DIBATALKAN' } }, _sum: { total: true, terbayar: true }, _count: true }),
    prisma.$queryRaw`SELECT COALESCE(SUM(total - terbayar),0)::int AS n, COUNT(DISTINCT "rumahId")::int AS rumah FROM "Tagihan" WHERE status IN ('BELUM','SEBAGIAN')`,
    prisma.pembayaran.aggregate({ where: { status: 'DIPOSTING', tanggal: { gte: awalBulan } }, _sum: { nominal: true }, _count: true }),
    prisma.$queryRaw`SELECT arah, COALESCE(SUM(nominal),0)::int AS n FROM "LedgerEntry" WHERE tanggal >= ${awalBulan} AND jenis <> 'SALDO_AWAL' GROUP BY arah`,
    prisma.pengeluaran.count({ where: { status: 'PENDING' } }),
    prisma.pembayaran.count({ where: { status: 'MENUNGGU' } }),
    prisma.rumah.count({ where: { verifikasi: 'PERLU_VERIFIKASI' } }),
  ]);
  const masuk = arus.find((a) => a.arah === 'MASUK')?.n || 0;
  const keluar = arus.find((a) => a.arah === 'KELUAR')?.n || 0;
  res.render('admin/dashboard', {
    title: 'Dashboard', periode, totalRumah, kondisi, tagBulan, tunggakan: tunggakan[0], bayarBulan, masuk, keluar, pending, menunggu, verifikasi,
    saldo: await ledger.saldoDana(),
  });
});

r.use(require('./bayar'));
r.use(require('./rumah'));
r.use(require('./iuran'));
r.use(require('./keuangan'));
r.use(require('./sistem'));

module.exports = r;
