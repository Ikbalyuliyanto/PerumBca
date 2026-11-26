'use strict';
// Portal warga lewat link rahasia /r/<token> (tanpa login) dan akun warga (/warga).
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const settings = require('../lib/settings');
const config = require('../config');
const { AppError, normWa } = require('../lib/util');
const { audit } = require('../lib/audit');
const link = require('../modules/warga/link');
const iuran = require('../modules/iuran/service');
const bayar = require('../modules/keuangan/pembayaran');
const ledger = require('../modules/keuangan/ledger');
const midtrans = require('../modules/midtrans/service');
const { upload, saveFile } = require('../middleware/upload');
const { verifyCsrf } = require('../middleware/csrf');
const { requireLogin } = require('../middleware/auth');
const { kirim } = require('./files');

const r = express.Router();

r.get('/r/selesai', (req, res) => res.render('warga/selesai', { title: 'Pembayaran diproses' }));

async function resolve(req, res, next) {
  const rumah = await link.resolve(req.params.token);
  if (!rumah) return res.status(404).render('errors/error', { title: 'Link tidak valid', status: 404, message: 'Link tidak valid atau sudah dicabut. Minta link baru ke pengurus.' });
  req.rumah = rumah;
  res.locals.token = req.params.token;
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex');
  next();
}

async function ringkasanPublik() {
  if ((await settings.get('ringkasan_publik')) !== 'true') return null;
  const dana = (await ledger.saldoDana()).filter((d) => d.publik && d.aktif);
  return { dana, total: dana.reduce((s, d) => s + d.saldo, 0) };
}

r.get('/r/:token', resolve, async (req, res) => {
  const rumah = req.rumah;
  const [tg, penghuni, riwayat, pengajuan, s, publik] = await Promise.all([
    iuran.tunggakanRumah(rumah.id),
    prisma.penghunian.findFirst({ where: { rumahId: rumah.id, selesai: null }, orderBy: { mulai: 'desc' } }),
    prisma.pembayaran.findMany({ where: { rumahId: rumah.id }, orderBy: { createdAt: 'desc' }, take: 24 }),
    prisma.pengajuanPerubahan.findFirst({ where: { rumahId: rumah.id, status: 'PENDING' } }),
    settings.all(),
    ringkasanPublik(),
  ]);
  const lunas = await prisma.tagihan.findMany({ where: { rumahId: rumah.id, status: 'LUNAS' }, orderBy: { periode: 'desc' }, take: 12 });
  res.render('warga/rumah', { title: `Iuran ${rumah.kode}`, rumah, tg, penghuni, riwayat, lunas, pengajuan, s, publik, midtransOn: config.midtransEnabled });
});

r.post('/r/:token/transfer', resolve, upload.single('bukti'), verifyCsrf, async (req, res) => {
  const nominal = Number(String(req.body.nominal || '').replace(/\D/g, ''));
  const file = await saveFile(req.file, { rumahId: req.rumah.id });
  const p = await bayar.ajukanTransfer({ rumahId: req.rumah.id, nominal, buktiFileId: file?.id, catatan: String(req.body.catatan || '').slice(0, 300) || null, tanggal: req.body.tanggal ? new Date(req.body.tanggal) : undefined });
  await audit(req, 'UPLOAD_BUKTI_TRANSFER', 'Pembayaran', p.id, { rumah: req.rumah.kode, nominal });
  req.flash('success', `Bukti transfer terkirim (${p.nomor}). Menunggu verifikasi bendahara.`);
  res.redirect(`/r/${req.params.token}`);
});

r.post('/r/:token/midtrans', resolve, async (req, res) => {
  const nominal = req.body.nominal ? Number(String(req.body.nominal).replace(/\D/g, '')) : null;
  const out = await midtrans.buatSnap(req.rumah, nominal);
  res.json(out);
});

r.post('/r/:token/pengajuan', resolve, async (req, res) => {
  const body = z.object({ nama: z.string().trim().max(100).optional(), noWa: z.string().trim().max(20).optional(), alasan: z.string().trim().max(300).optional() }).parse(req.body);
  const noWa = body.noWa ? normWa(body.noWa) : null;
  if (body.noWa && !noWa) throw new AppError('Nomor WhatsApp tidak valid.');
  if (!body.nama && !noWa) throw new AppError('Isi nama atau nomor WhatsApp baru.');
  const ada = await prisma.pengajuanPerubahan.findFirst({ where: { rumahId: req.rumah.id, status: 'PENDING' } });
  if (ada) throw new AppError('Masih ada pengajuan yang menunggu keputusan pengurus.');
  const p = await prisma.pengajuanPerubahan.create({ data: { rumahId: req.rumah.id, namaBaru: body.nama || null, noWaBaru: noWa, alasan: body.alasan || null } });
  await audit(req, 'PENGAJUAN_PERUBAHAN', 'PengajuanPerubahan', p.id, { rumah: req.rumah.kode });
  req.flash('success', 'Pengajuan terkirim. Menunggu persetujuan pengurus.');
  res.redirect(`/r/${req.params.token}`);
});

r.get('/r/:token/kuitansi/:id', resolve, async (req, res) => {
  const p = await prisma.pembayaran.findFirst({ where: { id: Number(req.params.id) || 0, rumahId: req.rumah.id }, include: { rumah: true, alokasi: { include: { tagihanItem: { include: { tagihan: true } } } } } });
  if (!p || p.status !== 'DIPOSTING') throw new AppError('Kuitansi tidak ditemukan.', 404);
  res.render('kuitansi', { title: `Kuitansi ${p.nomor}`, p, s: await settings.all() });
});

r.get('/r/:token/file/:id', resolve, async (req, res) => {
  const f = await prisma.fileUpload.findFirst({ where: { id: Number(req.params.id) || 0, rumahId: req.rumah.id } });
  if (!f) throw new AppError('File tidak ditemukan.', 404);
  await kirim(res, f);
});

// Akun warga (opsional): daftar rumah yang terhubung ke akun.
r.get('/warga', requireLogin, async (req, res) => {
  const rumah = await prisma.rumah.findMany({ where: { id: { in: req.user.rumahIds } } });
  if (rumah.length === 1) return res.redirect(`/r/${link.tokenFor(rumah[0])}`);
  res.render('warga/akun', { title: 'Rumah saya', rumah: rumah.map((x) => ({ ...x, token: link.tokenFor(x) })) });
});

module.exports = r;
