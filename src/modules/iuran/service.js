'use strict';
// Kebijakan iuran, status rumah, dan pembuatan tagihan.
const prisma = require('../../lib/prisma');
const { AppError, isPeriode } = require('../../lib/util');

/** Kebijakan yang berlaku pada periode (versi terbaru dengan berlakuMulai <= periode). */
async function kebijakanBerlaku(periode, db = prisma) {
  return db.kebijakan.findFirst({
    where: { berlakuMulai: { lte: periode } },
    orderBy: { berlakuMulai: 'desc' },
    include: { komponen: { where: { aktif: true }, orderBy: { urutan: 'asc' }, include: { dana: true } } },
  });
}

/** Status rumah yang berlaku pada periode. Tanpa catatan status → dianggap AKTIF. */
async function statusBerlaku(rumahId, periode, db = prisma) {
  const s = await db.statusRumah.findFirst({
    where: { rumahId, berlakuMulai: { lte: periode } },
    orderBy: { berlakuMulai: 'desc' },
  });
  return s || { kondisi: 'AKTIF', komponenWajib: [], berlakuMulai: null, implisit: true };
}

/** Komponen yang wajib dibayar rumah berdasarkan status & kebijakan. */
function komponenWajib(status, komponen) {
  if (status.kondisi === 'AKTIF') return komponen;
  const wajib = new Set(status.komponenWajib || []);
  return komponen.filter((k) => wajib.has(k.kode));
}

/**
 * Buat tagihan periode untuk semua rumah aktif (atau rumahIds tertentu).
 * Idempoten: rumah yang sudah punya tagihan periode itu dilewati.
 */
async function generateTagihan(periode, { rumahIds = null } = {}) {
  if (!isPeriode(periode)) throw new AppError('Periode tidak valid (format YYYY-MM).');
  const kebijakan = await kebijakanBerlaku(periode);
  if (!kebijakan) throw new AppError(`Belum ada kebijakan iuran yang berlaku untuk ${periode}.`);
  const rumahList = await prisma.rumah.findMany({
    where: { aktif: true, ...(rumahIds ? { id: { in: rumahIds } } : {}) },
    select: { id: true, kode: true },
  });
  const hasil = { dibuat: [], dilewati: 0, bebas: 0 };
  for (const r of rumahList) {
    const status = await statusBerlaku(r.id, periode);
    const komp = komponenWajib(status, kebijakan.komponen);
    if (komp.length === 0) { hasil.bebas++; continue; }
    const total = komp.reduce((s, k) => s + k.nominal, 0);
    try {
      const t = await prisma.tagihan.create({
        data: {
          rumahId: r.id, periode, kebijakanId: kebijakan.id, total,
          items: { create: komp.map((k, i) => ({ kodeKomponen: k.kode, nama: k.nama, nominal: k.nominal, danaId: k.danaId, urutan: i })) },
        },
      });
      hasil.dibuat.push({ tagihanId: t.id, rumahId: r.id, kode: r.kode, total });
    } catch (e) {
      if (e.code === 'P2002') { hasil.dilewati++; continue; } // sudah ada (unik rumah+periode)
      throw e;
    }
  }
  return hasil;
}

/** Buat tagihan khusus komponen tertentu (mis. tunggakan hasil impor). */
async function buatTagihanKomponen(rumahId, periode, kodeList, db = prisma, sumber = 'IMPOR') {
  const kebijakan = await kebijakanBerlaku(periode, db);
  if (!kebijakan) throw new AppError(`Belum ada kebijakan iuran untuk ${periode}.`);
  const komp = kebijakan.komponen.filter((k) => kodeList.includes(k.kode));
  if (!komp.length) throw new AppError('Komponen tidak ditemukan pada kebijakan periode itu.');
  const ada = await db.tagihan.findUnique({ where: { rumahId_periode: { rumahId, periode } }, include: { items: true } });
  if (ada) {
    const baru = komp.filter((k) => !ada.items.some((i) => i.kodeKomponen === k.kode));
    if (!baru.length) return ada;
    if (ada.status === 'DIBATALKAN') throw new AppError('Tagihan periode itu sudah dibatalkan.');
    const tambah = baru.reduce((s, k) => s + k.nominal, 0);
    await db.tagihanItem.createMany({ data: baru.map((k, i) => ({ tagihanId: ada.id, kodeKomponen: k.kode, nama: k.nama, nominal: k.nominal, danaId: k.danaId, urutan: ada.items.length + i })) });
    return db.tagihan.update({ where: { id: ada.id }, data: { total: { increment: tambah }, status: ada.terbayar > 0 ? 'SEBAGIAN' : 'BELUM' } });
  }
  return db.tagihan.create({
    data: {
      rumahId, periode, kebijakanId: kebijakan.id, sumber, total: komp.reduce((s, k) => s + k.nominal, 0),
      items: { create: komp.map((k, i) => ({ kodeKomponen: k.kode, nama: k.nama, nominal: k.nominal, danaId: k.danaId, urutan: i })) },
    },
  });
}

/** Tunggakan (sisa belum dibayar) per rumah. */
async function tunggakanRumah(rumahId, db = prisma) {
  const list = await db.tagihan.findMany({
    where: { rumahId, status: { in: ['BELUM', 'SEBAGIAN'] } },
    orderBy: { periode: 'asc' },
    include: { items: { orderBy: { urutan: 'asc' } } },
  });
  const total = list.reduce((s, t) => s + (t.total - t.terbayar), 0);
  return { list, total };
}

/** Total tunggakan semua rumah: Map rumahId → sisa. */
async function tunggakanSemua() {
  const rows = await prisma.$queryRaw`
    SELECT "rumahId", SUM(total - terbayar)::int AS sisa, COUNT(*)::int AS bulan
    FROM "Tagihan" WHERE status IN ('BELUM','SEBAGIAN') GROUP BY "rumahId"`;
  return new Map(rows.map((r) => [r.rumahId, { sisa: r.sisa, bulan: r.bulan }]));
}

module.exports = { kebijakanBerlaku, statusBerlaku, komponenWajib, generateTagihan, buatTagihanKomponen, tunggakanRumah, tunggakanSemua };
