'use strict';
// Dana, kebijakan iuran (berversi), dan tagihan.
const express = require('express');
const { z } = require('zod');
const prisma = require('../../lib/prisma');
const { AppError, isPeriode, periodeNow } = require('../../lib/util');
const { audit } = require('../../lib/audit');
const { requirePerm, requireSuperAdmin } = require('../../middleware/auth');
const iuran = require('../../modules/iuran/service');
const wa = require('../../modules/wa/service');

const r = express.Router();

r.get('/kebijakan', requirePerm('kebijakan.lihat'), async (req, res) => {
  const [dana, list] = await Promise.all([
    prisma.dana.findMany({ orderBy: { id: 'asc' } }),
    prisma.kebijakan.findMany({ orderBy: { berlakuMulai: 'desc' }, include: { komponen: { orderBy: { urutan: 'asc' }, include: { dana: true } }, _count: { select: { tagihan: true } } } }),
  ]);
  const berlaku = await iuran.kebijakanBerlaku(periodeNow());
  res.render('admin/kebijakan', { title: 'Kebijakan iuran', dana, list, berlakuId: berlaku?.id });
});

r.post('/dana', requirePerm('kebijakan.kelola'), async (req, res) => {
  const b = z.object({ kode: z.string().trim().regex(/^[A-Z0-9_]{2,20}$/i, 'Kode 2-20 huruf/angka'), nama: z.string().trim().min(2).max(60) }).parse(req.body);
  const d = await prisma.dana.create({ data: { kode: b.kode.toUpperCase(), nama: b.nama } });
  await audit(req, 'DANA_BARU', 'Dana', d.id, b);
  res.redirect('/admin/kebijakan');
});

r.post('/dana/:id', requirePerm('kebijakan.kelola'), async (req, res) => {
  const b = z.object({ nama: z.string().trim().min(2).max(60) }).parse(req.body);
  const d = await prisma.dana.update({ where: { id: Number(req.params.id) }, data: { nama: b.nama, aktif: req.body.aktif === 'on', publik: req.body.publik === 'on' } });
  await audit(req, 'DANA_UBAH', 'Dana', d.id, { nama: b.nama, aktif: d.aktif, publik: d.publik });
  res.redirect('/admin/kebijakan');
});

r.get('/kebijakan/baru', requirePerm('kebijakan.kelola'), async (req, res) => {
  const dasar = await prisma.kebijakan.findFirst({ orderBy: { berlakuMulai: 'desc' }, include: { komponen: { orderBy: { urutan: 'asc' } } } });
  res.render('admin/kebijakan-form', { title: 'Kebijakan iuran baru', dasar, dana: await prisma.dana.findMany({ where: { aktif: true } }) });
});

// Kebijakan baru = versi baru dengan tanggal efektif. Versi lama tetap utuh,
// tagihan lama tetap memakai snapshot nominalnya.
r.post('/kebijakan', requirePerm('kebijakan.kelola'), async (req, res) => {
  const b = z.object({ nama: z.string().trim().min(2).max(80), berlakuMulai: z.string().refine(isPeriode, 'Periode YYYY-MM'), catatan: z.string().max(500).optional() }).parse(req.body);
  const kode = [].concat(req.body.k_kode || []), nama = [].concat(req.body.k_nama || []), nominal = [].concat(req.body.k_nominal || []), danaId = [].concat(req.body.k_dana || []), aktif = [].concat(req.body.k_aktif || []);
  const komponen = [];
  kode.forEach((k, i) => {
    k = String(k || '').trim().toUpperCase();
    if (!k) return;
    if (!/^[A-Z0-9_]{2,20}$/.test(k)) throw new AppError(`Kode komponen "${k}" tidak valid.`);
    const n = Number(String(nominal[i]).replace(/\D/g, ''));
    if (!Number.isInteger(n) || n < 0) throw new AppError(`Nominal ${k} tidak valid.`);
    komponen.push({ kode: k, nama: String(nama[i] || k).trim().slice(0, 60), nominal: n, danaId: Number(danaId[i]), aktif: aktif.includes(k), urutan: i });
  });
  if (!komponen.length) throw new AppError('Minimal satu komponen.');
  if (new Set(komponen.map((k) => k.kode)).size !== komponen.length) throw new AppError('Kode komponen tidak boleh ganda.');
  const ada = await prisma.kebijakan.findUnique({ where: { berlakuMulai: b.berlakuMulai }, include: { _count: { select: { tagihan: true } } } });
  if (ada && ada._count.tagihan > 0) throw new AppError('Kebijakan periode itu sudah dipakai tagihan. Pilih periode berlaku lain.');
  const k = await prisma.$transaction(async (tx) => {
    if (ada) await tx.kebijakan.delete({ where: { id: ada.id } });
    return tx.kebijakan.create({ data: { ...b, createdById: req.user.id, komponen: { create: komponen } } });
  });
  await audit(req, 'KEBIJAKAN_BARU', 'Kebijakan', k.id, { ...b, komponen });
  req.flash('success', `Kebijakan berlaku mulai ${b.berlakuMulai} disimpan.`);
  res.redirect('/admin/kebijakan');
});

// ── Tagihan ──
r.get('/tagihan', requirePerm('tagihan.lihat'), async (req, res) => {
  const periode = isPeriode(req.query.periode) ? req.query.periode : periodeNow();
  const status = req.query.status || '';
  const blok = req.query.blok || '';
  const where = { ...(req.query.tunggakan ? { status: { in: ['BELUM', 'SEBAGIAN'] } } : { periode }), ...(status ? { status } : {}), ...(blok ? { rumah: { blok: { kode: blok } } } : {}) };
  const list = await prisma.tagihan.findMany({ where, include: { rumah: { include: { penghunian: { where: { selesai: null }, take: 1 } } } }, orderBy: [{ periode: 'asc' }, { rumah: { kode: 'asc' } }], take: 1000 });
  const sum = list.reduce((a, t) => ({ total: a.total + t.total, terbayar: a.terbayar + t.terbayar }), { total: 0, terbayar: 0 });
  res.render('admin/tagihan', { title: 'Tagihan', list, periode, sum, bloks: await prisma.blok.findMany({ orderBy: { kode: 'asc' } }) });
});

r.post('/tagihan/generate', requirePerm('tagihan.generate'), async (req, res) => {
  const periode = String(req.body.periode || '');
  const hasil = await iuran.generateTagihan(periode);
  let antre = 0;
  if (req.body.kirimWa === 'on') for (const t of hasil.dibuat) if (await wa.antreTagihan(t.rumahId, periode, t.total)) antre++;
  await audit(req, 'GENERATE_TAGIHAN', 'Tagihan', periode, { dibuat: hasil.dibuat.length, dilewati: hasil.dilewati, bebas: hasil.bebas, antreWa: antre });
  req.flash('success', `Tagihan ${periode}: ${hasil.dibuat.length} dibuat, ${hasil.dilewati} sudah ada, ${hasil.bebas} rumah tidak wajib bayar. ${antre} pesan WA diantrekan.`);
  res.redirect(`/admin/tagihan?periode=${periode}`);
});

r.post('/tagihan/:id/batal', requireSuperAdmin, async (req, res) => {
  const t = await prisma.tagihan.findUnique({ where: { id: Number(req.params.id) } });
  if (!t) throw new AppError('Tagihan tidak ditemukan', 404);
  if (t.terbayar > 0) throw new AppError('Tagihan sudah ada pembayaran; batalkan pembayarannya dulu.');
  if (!req.body.alasan) throw new AppError('Alasan wajib diisi.');
  await prisma.tagihan.update({ where: { id: t.id }, data: { status: 'DIBATALKAN' } });
  await audit(req, 'BATAL_TAGIHAN', 'Tagihan', t.id, { alasan: req.body.alasan });
  req.flash('success', 'Tagihan dibatalkan.');
  res.redirect(`/admin/rumah/${t.rumahId}`);
});

module.exports = r;
