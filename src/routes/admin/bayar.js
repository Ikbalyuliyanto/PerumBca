'use strict';
// Alur sederhana: Bayar Iuran (semua / pilih) dan master Jenis Iuran.
const express = require('express');
const prisma = require('../../lib/prisma');
const { AppError, isPeriode, periodeNow, addPeriode, rupiah } = require('../../lib/util');
const { audit } = require('../../lib/audit');
const { requirePerm } = require('../../middleware/auth');
const iuran = require('../../modules/iuran/service');
const cepat = require('../../modules/keuangan/bayarCepat');
const wa = require('../../modules/wa/service');

const r = express.Router();
const tgl = (v) => (v ? new Date(`${v}T12:00:00+07:00`) : undefined);

// ── Daftar bayar per bulan ──
r.get('/bayar', requirePerm('pembayaran.input', 'tagihan.lihat'), async (req, res) => {
  const periode = isPeriode(req.query.periode) ? req.query.periode : periodeNow();
  const q = String(req.query.q || '').trim().toLowerCase();
  const filter = req.query.f || '';
  const data = await cepat.ringkasanBulan(periode);
  let list = data.rumah;
  if (q) list = list.filter((x) => x.kode.toLowerCase().includes(q) || x.nama.toLowerCase().includes(q));
  if (filter === 'belum') list = list.filter((x) => !x.bebas && x.sisa > 0);
  if (filter === 'lunas') list = list.filter((x) => !x.bebas && x.sisa === 0);
  const ring = {
    total: data.rumah.filter((x) => !x.bebas).length,
    lunas: data.rumah.filter((x) => !x.bebas && x.sisa === 0).length,
    sisa: data.rumah.reduce((s, x) => s + (x.bebas ? 0 : x.sisa), 0),
  };
  res.render('admin/bayar', { title: 'Bayar Iuran', periode, jenis: data.jenis, list, ring, prev: addPeriode(periode, -1), next: addPeriode(periode, 1) });
});

// Bayar semua jenis iuran untuk satu atau banyak rumah sekaligus.
r.post('/bayar/semua', requirePerm('pembayaran.input'), async (req, res) => {
  const periode = String(req.body.periode || '');
  const ids = [].concat(req.body.rumah || []).map(Number).filter(Boolean);
  if (!ids.length) throw new AppError('Pilih minimal satu rumah.');
  let n = 0, total = 0;
  for (const id of ids) {
    const out = await cepat.bayarPilihan(id, [{ periode, kode: null }], { userId: req.user.id, tanggal: tgl(req.body.tanggal) });
    if (out) { n++; total += out.pembayaran.nominal; await wa.antreKonfirmasi(out.pembayaran.id); }
  }
  await audit(req, 'BAYAR_SEMUA', 'Pembayaran', periode, { rumah: ids, n, total });
  req.flash('success', n ? `${n} rumah lunas untuk ${periode}, total ${rupiah(total)}.` : 'Semua yang dipilih sudah lunas.');
  res.redirect(`/admin/bayar?periode=${periode}`);
});

// ── Bayar pilihan per rumah (centang bulan × jenis) ──
r.get('/bayar/:id', requirePerm('pembayaran.input', 'tagihan.lihat'), async (req, res) => {
  const rumah = await prisma.rumah.findUnique({ where: { id: Number(req.params.id) || 0 }, include: { penghunian: { where: { selesai: null }, take: 1 } } });
  if (!rumah) throw new AppError('Rumah tidak ditemukan', 404);
  const tahun = Number(req.query.tahun) || Number(periodeNow().slice(0, 4));
  const bulan = Array.from({ length: 12 }, (_, i) => `${tahun}-${String(i + 1).padStart(2, '0')}`);
  const [tagihan, sheet, jenisAll] = await Promise.all([
    prisma.tagihan.findMany({ where: { rumahId: rumah.id, periode: { in: bulan } }, include: { items: true } }),
    prisma.riwayatImpor.findMany({ where: { rumahId: rumah.id, periode: { in: bulan }, terbayar: true } }),
    iuran.kebijakanBerlaku(periodeNow()),
  ]);
  const jenis = jenisAll ? jenisAll.komponen : [];
  const grid = [];
  for (const p of bulan) {
    const keb = await iuran.kebijakanBerlaku(p);
    const status = await iuran.statusBerlaku(rumah.id, p);
    const wajib = keb ? iuran.komponenWajib(status, keb.komponen) : [];
    const t = tagihan.find((x) => x.periode === p);
    const sel = {};
    for (const j of jenis) {
      const it = t?.items.find((i) => i.kodeKomponen === j.kode);
      const w = wajib.find((x) => x.kode === j.kode);
      if (it) sel[j.kode] = { st: it.terbayar >= it.nominal ? 'LUNAS' : 'BELUM', nominal: it.nominal - it.terbayar };
      else if (sheet.some((s) => s.periode === p && s.kodeKomponen === j.kode)) sel[j.kode] = { st: 'SHEET' };
      else if (w) sel[j.kode] = { st: 'BELUM', nominal: w.nominal };
      else sel[j.kode] = { st: 'BEBAS' };
    }
    grid.push({ periode: p, sel });
  }
  res.render('admin/bayar-rumah', { title: `Bayar ${rumah.kode}`, rumah, tahun, jenis, grid });
});

r.post('/bayar/:id', requirePerm('pembayaran.input'), async (req, res) => {
  const rumahId = Number(req.params.id);
  const picks = [].concat(req.body.p || []).map((v) => { const [periode, kode] = String(v).split('|'); return { periode, kode }; });
  const out = await cepat.bayarPilihan(rumahId, picks, { userId: req.user.id, tanggal: tgl(req.body.tanggal), catatan: String(req.body.catatan || '').slice(0, 300) || null });
  if (!out) { req.flash('info', 'Iuran yang dipilih sudah lunas.'); return res.redirect(req.get('referer') || '/admin/bayar'); }
  await audit(req, 'BAYAR_PILIHAN', 'Pembayaran', out.pembayaran.id, { picks });
  await wa.antreKonfirmasi(out.pembayaran.id);
  req.flash('success', `Tersimpan ${out.pembayaran.nomor}: ${rupiah(out.pembayaran.nominal)}.`);
  res.redirect(`/admin/bayar/${rumahId}?tahun=${req.body.tahun || ''}`);
});

// ── Master jenis iuran ──
r.get('/jenis-iuran', requirePerm('kebijakan.lihat'), async (req, res) => {
  const [keb, dana] = await Promise.all([
    prisma.kebijakan.findFirst({ orderBy: { berlakuMulai: 'desc' }, include: { komponen: { orderBy: { urutan: 'asc' }, include: { dana: true } } } }),
    prisma.dana.findMany({ where: { aktif: true }, orderBy: { id: 'asc' } }),
  ]);
  res.render('admin/jenis-iuran', { title: 'Jenis Iuran', keb, dana });
});

// Simpan master → versi kebijakan baru berlaku mulai bulan yang dipilih (tagihan lama tidak berubah).
r.post('/jenis-iuran', requirePerm('kebijakan.kelola'), async (req, res) => {
  const mulai = isPeriode(req.body.mulai) ? req.body.mulai : periodeNow();
  const nama = [].concat(req.body.nama || []), nominal = [].concat(req.body.nominal || []), danaId = [].concat(req.body.dana || []), kodeLama = [].concat(req.body.kode || []), aktif = new Set([].concat(req.body.aktif || []).map(String));
  const komponen = [];
  nama.forEach((n, i) => {
    n = String(n || '').trim();
    if (!n) return;
    const kode = (String(kodeLama[i] || '').trim() || n.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')).slice(0, 20) || `IURAN_${i + 1}`;
    const nom = Number(String(nominal[i] || '').replace(/\D/g, ''));
    if (!Number.isInteger(nom) || nom < 0) throw new AppError(`Nominal ${n} tidak valid.`);
    komponen.push({ kode, nama: n.slice(0, 60), nominal: nom, danaId: Number(danaId[i]), aktif: aktif.has(String(i)), urutan: i });
  });
  if (!komponen.length) throw new AppError('Minimal satu jenis iuran.');
  if (new Set(komponen.map((k) => k.kode)).size !== komponen.length) throw new AppError('Nama jenis iuran tidak boleh sama.');
  const ada = await prisma.kebijakan.findUnique({ where: { berlakuMulai: mulai }, include: { _count: { select: { tagihan: true } } } });
  if (ada && ada._count.tagihan > 0) throw new AppError(`Tagihan ${mulai} sudah dibuat dengan nominal lama. Pilih "berlaku mulai" bulan berikutnya.`);
  await prisma.$transaction(async (tx) => {
    if (ada) await tx.kebijakan.delete({ where: { id: ada.id } });
    await tx.kebijakan.create({ data: { nama: `Jenis iuran ${mulai}`, berlakuMulai: mulai, createdById: req.user.id, komponen: { create: komponen } } });
  });
  await audit(req, 'JENIS_IURAN', 'Kebijakan', mulai, { komponen });
  req.flash('success', `Jenis iuran disimpan, berlaku mulai ${mulai}.`);
  res.redirect('/admin/jenis-iuran');
});

module.exports = r;
