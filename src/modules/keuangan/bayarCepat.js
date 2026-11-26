'use strict';
// Alur bayar sederhana: pilih rumah + bulan + jenis iuran → langsung lunas.
// Tagihan dibuat otomatis bila belum ada; uang dicatat sebagai pembayaran tunai
// dengan alokasi tepat ke item yang dipilih (memakai inti posting yang sama).
const prisma = require('../../lib/prisma');
const { AppError, isPeriode } = require('../../lib/util');
const iuran = require('../iuran/service');
const bayar = require('./pembayaran');

/** Pastikan tagihan rumah untuk periode-periode ini ada. */
async function pastikanTagihan(rumahId, periodeList) {
  for (const p of new Set(periodeList)) {
    if (!isPeriode(p)) throw new AppError(`Periode ${p} tidak valid.`);
    await iuran.generateTagihan(p, { rumahIds: [rumahId] });
  }
}

/**
 * Bayar item terpilih. picks = [{ periode, kode }] ; kode null = semua jenis bulan itu.
 * Mengembalikan pembayaran, atau null bila semuanya sudah lunas.
 */
async function bayarPilihan(rumahId, picks, { userId, tanggal, catatan } = {}) {
  if (!picks.length) throw new AppError('Pilih minimal satu iuran.');
  await pastikanTagihan(rumahId, picks.map((x) => x.periode));
  const tagihan = await prisma.tagihan.findMany({
    where: { rumahId, periode: { in: [...new Set(picks.map((x) => x.periode))] }, status: { in: ['BELUM', 'SEBAGIAN'] } },
    include: { items: true },
  });
  const alokasi = [];
  for (const t of tagihan) {
    for (const it of t.items) {
      const dipilih = picks.some((x) => x.periode === t.periode && (!x.kode || x.kode === it.kodeKomponen));
      const sisa = it.nominal - it.terbayar;
      if (dipilih && sisa > 0) alokasi.push({ tagihanItemId: it.id, nominal: sisa });
    }
  }
  if (!alokasi.length) return null;
  const nominal = alokasi.reduce((s, a) => s + a.nominal, 0);
  return bayar.bayarTunai({ rumahId, nominal, alokasiManual: alokasi, userId, tanggal, catatan });
}

/** Ringkasan satu bulan untuk semua rumah: status per jenis iuran. */
async function ringkasanBulan(periode) {
  const kebijakan = await iuran.kebijakanBerlaku(periode);
  const jenis = kebijakan ? kebijakan.komponen : [];
  const rumah = await prisma.rumah.findMany({
    where: { aktif: true },
    include: { blok: true, penghunian: { where: { selesai: null }, take: 1, orderBy: { mulai: 'desc' } }, tagihan: { where: { periode }, include: { items: true } } },
  });
  rumah.sort((a, b) => a.blok.kode.localeCompare(b.blok.kode) || a.nomor.localeCompare(b.nomor, 'id', { numeric: true }));
  const out = [];
  for (const r of rumah) {
    const status = await iuran.statusBerlaku(r.id, periode);
    const wajib = iuran.komponenWajib(status, jenis);
    const t = r.tagihan[0];
    const per = {};
    for (const j of jenis) {
      const it = t?.items.find((i) => i.kodeKomponen === j.kode);
      if (it) per[j.kode] = it.terbayar >= it.nominal ? 'LUNAS' : it.terbayar > 0 ? 'SEBAGIAN' : 'BELUM';
      else per[j.kode] = wajib.some((w) => w.kode === j.kode) ? 'BELUM' : 'BEBAS';
    }
    const sisa = t ? t.total - t.terbayar : wajib.reduce((s, w) => s + w.nominal, 0);
    out.push({ id: r.id, kode: r.kode, nama: r.penghunian[0]?.nama || '', kondisi: status.kondisi, per, sisa, bebas: wajib.length === 0 && !t });
  }
  return { jenis, rumah: out };
}

module.exports = { bayarPilihan, ringkasanBulan, pastikanTagihan };
