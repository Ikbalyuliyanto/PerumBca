'use strict';
// Rumah, penghuni, status, pengajuan perubahan, impor data.
const fs = require('fs');
const express = require('express');
const { z } = require('zod');
const prisma = require('../../lib/prisma');
const settings = require('../../lib/settings');
const { AppError, normWa, isPeriode, periodeNow } = require('../../lib/util');
const { audit } = require('../../lib/audit');
const { requirePerm, requireSuperAdmin } = require('../../middleware/auth');
const { uploadCsv } = require('../../middleware/upload');
const { verifyCsrf } = require('../../middleware/csrf');
const iuran = require('../../modules/iuran/service');
const impor = require('../../modules/impor/service');
const link = require('../../modules/warga/link');

const r = express.Router();
const id = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new AppError('ID tidak valid', 404); return n; };

r.get('/rumah', requirePerm('rumah.lihat'), async (req, res) => {
  const { blok, kondisi, q, verifikasi } = req.query;
  const periode = periodeNow();
  const rumah = await prisma.rumah.findMany({
    where: {
      ...(blok ? { blok: { kode: blok } } : {}),
      ...(verifikasi ? { verifikasi } : {}),
      ...(q ? { OR: [{ kode: { contains: q, mode: 'insensitive' } }, { penghunian: { some: { selesai: null, nama: { contains: q, mode: 'insensitive' } } } }] } : {}),
    },
    include: { blok: true, penghunian: { where: { selesai: null }, take: 1, orderBy: { mulai: 'desc' } }, status: { where: { berlakuMulai: { lte: periode } }, orderBy: { berlakuMulai: 'desc' }, take: 1 } },
  });
  rumah.sort((a, b) => a.blok.urutan - b.blok.urutan || a.blok.kode.localeCompare(b.blok.kode) || a.nomor.localeCompare(b.nomor, 'id', { numeric: true }));
  const tung = await iuran.tunggakanSemua();
  let list = rumah.map((x) => ({ ...x, kondisi: x.status[0]?.kondisi || 'AKTIF', tunggakan: tung.get(x.id) || { sisa: 0, bulan: 0 } }));
  if (kondisi) list = list.filter((x) => x.kondisi === kondisi);
  res.render('admin/rumah-list', { title: 'Data rumah', list, bloks: await prisma.blok.findMany({ orderBy: [{ urutan: 'asc' }, { kode: 'asc' }] }) });
});

r.get('/rumah/baru', requireSuperAdmin, async (req, res) => {
  res.render('admin/rumah-baru', { title: 'Tambah rumah', bloks: await prisma.blok.findMany({ orderBy: { kode: 'asc' } }) });
});

r.post('/rumah/baru', requireSuperAdmin, async (req, res) => {
  const b = z.object({ blok: z.string().trim().min(1).max(10), nomor: z.string().trim().min(1).max(10), kondisi: z.enum(['AKTIF', 'KOSONG', 'TIDAK_DITEMPATI', 'PIHAK_KEDUA']), berlakuMulai: z.string().refine(isPeriode, 'Periode YYYY-MM') }).parse(req.body);
  const blokKode = b.blok.toUpperCase(), nomor = b.nomor.toUpperCase();
  const rumah = await prisma.$transaction(async (tx) => {
    const blok = await tx.blok.upsert({ where: { kode: blokKode }, update: {}, create: { kode: blokKode, urutan: blokKode.charCodeAt(0) } });
    const rm = await tx.rumah.create({ data: { blokId: blok.id, nomor, kode: blokKode + nomor } });
    await tx.statusRumah.create({ data: { rumahId: rm.id, kondisi: b.kondisi, berlakuMulai: b.berlakuMulai, komponenWajib: [], createdById: req.user.id } });
    return rm;
  });
  await audit(req, 'RUMAH_BARU', 'Rumah', rumah.id, b);
  res.redirect(`/admin/rumah/${rumah.id}`);
});

r.get('/rumah/:id', requirePerm('rumah.lihat'), async (req, res) => {
  const rumah = await prisma.rumah.findUnique({
    where: { id: id(req.params.id) },
    include: { blok: true, penghunian: { orderBy: { mulai: 'desc' } }, status: { orderBy: { berlakuMulai: 'desc' } }, users: { include: { user: true } } },
  });
  if (!rumah) throw new AppError('Rumah tidak ditemukan', 404);
  const [tagihan, pembayaran, riwayat, kebijakan, pengajuan] = await Promise.all([
    prisma.tagihan.findMany({ where: { rumahId: rumah.id }, orderBy: { periode: 'desc' }, include: { items: true }, take: 36 }),
    prisma.pembayaran.findMany({ where: { rumahId: rumah.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.riwayatImpor.findMany({ where: { rumahId: rumah.id }, orderBy: { periode: 'asc' } }),
    iuran.kebijakanBerlaku(periodeNow()),
    prisma.pengajuanPerubahan.findMany({ where: { rumahId: rumah.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  const statusKini = await iuran.statusBerlaku(rumah.id, periodeNow());
  res.render('admin/rumah-detail', { title: `Rumah ${rumah.kode}`, rumah, tagihan, pembayaran, riwayat, kebijakan, pengajuan, statusKini, linkWarga: req.can('rumah.kelola') || req.can('pembayaran.input') ? link.urlFor(rumah) : null });
});

r.post('/rumah/:id/penghuni', requirePerm('rumah.kelola'), async (req, res) => {
  const rumahId = id(req.params.id);
  const b = z.object({ nama: z.string().trim().min(1, 'Nama wajib').max(100), noWa: z.string().trim().max(20).optional(), mulai: z.string().optional(), catatan: z.string().max(300).optional() }).parse(req.body);
  const noWa = b.noWa ? normWa(b.noWa) : null;
  if (b.noWa && !noWa) throw new AppError('Nomor WhatsApp tidak valid.');
  const mulai = b.mulai ? new Date(b.mulai) : new Date();
  await prisma.$transaction(async (tx) => {
    await tx.penghunian.updateMany({ where: { rumahId, selesai: null }, data: { selesai: mulai } });
    await tx.penghunian.create({ data: { rumahId, nama: b.nama, noWa, mulai, catatan: b.catatan || null } });
  });
  await audit(req, 'GANTI_PENGHUNI', 'Rumah', rumahId, b);
  req.flash('success', 'Penghuni baru dicatat. Riwayat penghuni lama tetap tersimpan.');
  res.redirect(`/admin/rumah/${rumahId}`);
});

// Koreksi data penghuni aktif (salah ketik / verifikasi hasil impor), bukan ganti penghuni.
r.post('/rumah/:id/penghuni/:pid', requirePerm('rumah.kelola'), async (req, res) => {
  const rumahId = id(req.params.id), pid = id(req.params.pid);
  const b = z.object({ nama: z.string().trim().min(1).max(100), noWa: z.string().trim().max(20).optional(), verifikasi: z.enum(['OK', 'PERLU_VERIFIKASI']) }).parse(req.body);
  const noWa = b.noWa ? normWa(b.noWa) : null;
  if (b.noWa && !noWa) throw new AppError('Nomor WhatsApp tidak valid.');
  const lama = await prisma.penghunian.findFirst({ where: { id: pid, rumahId } });
  if (!lama) throw new AppError('Data penghuni tidak ditemukan', 404);
  await prisma.penghunian.update({ where: { id: pid }, data: { nama: b.nama, noWa, verifikasi: b.verifikasi } });
  await audit(req, 'KOREKSI_PENGHUNI', 'Penghunian', pid, { sebelum: { nama: lama.nama, noWa: lama.noWa }, sesudah: { nama: b.nama, noWa } });
  req.flash('success', 'Data penghuni dikoreksi.');
  res.redirect(`/admin/rumah/${rumahId}`);
});

r.post('/rumah/:id/status', requirePerm('rumah.kelola'), async (req, res) => {
  const rumahId = id(req.params.id);
  const b = z.object({ kondisi: z.enum(['AKTIF', 'KOSONG', 'TIDAK_DITEMPATI', 'PIHAK_KEDUA']), berlakuMulai: z.string().refine(isPeriode, 'Periode YYYY-MM'), catatan: z.string().max(300).optional() }).parse(req.body);
  const komponenWajib = b.kondisi === 'AKTIF' ? [] : [].concat(req.body.komponenWajib || []).map(String).slice(0, 20);
  await prisma.statusRumah.upsert({
    where: { rumahId_berlakuMulai: { rumahId, berlakuMulai: b.berlakuMulai } },
    update: { kondisi: b.kondisi, komponenWajib, catatan: b.catatan || null, createdById: req.user.id },
    create: { rumahId, kondisi: b.kondisi, berlakuMulai: b.berlakuMulai, komponenWajib, catatan: b.catatan || null, createdById: req.user.id },
  });
  await audit(req, 'STATUS_RUMAH', 'Rumah', rumahId, { ...b, komponenWajib });
  req.flash('success', `Status rumah berlaku mulai ${b.berlakuMulai}. Tagihan yang sudah dibuat tidak berubah.`);
  res.redirect(`/admin/rumah/${rumahId}`);
});

r.post('/rumah/:id/verifikasi', requirePerm('rumah.kelola', 'impor.kelola'), async (req, res) => {
  const rumahId = id(req.params.id);
  const v = req.body.verifikasi === 'PERLU_VERIFIKASI' ? 'PERLU_VERIFIKASI' : 'OK';
  await prisma.rumah.update({ where: { id: rumahId }, data: { verifikasi: v, catatan: String(req.body.catatan ?? '').slice(0, 500) || null } });
  await audit(req, 'VERIFIKASI_RUMAH', 'Rumah', rumahId, { verifikasi: v });
  res.redirect(`/admin/rumah/${rumahId}`);
});

r.post('/rumah/:id/cabut-link', requirePerm('rumah.kelola'), async (req, res) => {
  const rumahId = id(req.params.id);
  await prisma.rumah.update({ where: { id: rumahId }, data: { tokenVersi: { increment: 1 } } });
  await audit(req, 'CABUT_LINK', 'Rumah', rumahId);
  req.flash('success', 'Link lama dicabut. Link baru sudah dibuat.');
  res.redirect(`/admin/rumah/${rumahId}`);
});

// Identitas rumah (blok/nomor) hanya Super Admin.
r.post('/rumah/:id/identitas', requireSuperAdmin, async (req, res) => {
  const rumahId = id(req.params.id);
  const b = z.object({ blok: z.string().trim().min(1).max(10), nomor: z.string().trim().min(1).max(10), aktif: z.string().optional() }).parse(req.body);
  const lama = await prisma.rumah.findUnique({ where: { id: rumahId }, include: { blok: true } });
  const blokKode = b.blok.toUpperCase(), nomor = b.nomor.toUpperCase();
  const blok = await prisma.blok.upsert({ where: { kode: blokKode }, update: {}, create: { kode: blokKode, urutan: blokKode.charCodeAt(0) } });
  await prisma.rumah.update({ where: { id: rumahId }, data: { blokId: blok.id, nomor, kode: blokKode + nomor, aktif: b.aktif === 'on' } });
  await audit(req, 'UBAH_IDENTITAS_RUMAH', 'Rumah', rumahId, { sebelum: lama.kode, sesudah: blokKode + nomor, aktif: b.aktif === 'on' });
  req.flash('success', 'Identitas rumah diperbarui.');
  res.redirect(`/admin/rumah/${rumahId}`);
});

// ── Pengajuan perubahan dari warga ──
r.get('/pengajuan', requirePerm('pengajuan.putuskan', 'rumah.lihat'), async (req, res) => {
  const list = await prisma.pengajuanPerubahan.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 100, include: { rumah: { include: { penghunian: { where: { selesai: null }, take: 1 } } } } });
  res.render('admin/pengajuan', { title: 'Pengajuan perubahan', list });
});

r.post('/pengajuan/:id', requirePerm('pengajuan.putuskan'), async (req, res) => {
  const pid = id(req.params.id);
  const setuju = req.body.aksi === 'setuju';
  await prisma.$transaction(async (tx) => {
    const p = await tx.pengajuanPerubahan.findUnique({ where: { id: pid } });
    if (!p || p.status !== 'PENDING') throw new AppError('Pengajuan sudah diputuskan.');
    if (setuju) {
      const aktif = await tx.penghunian.findFirst({ where: { rumahId: p.rumahId, selesai: null } });
      if (p.namaBaru && (!aktif || aktif.nama !== p.namaBaru)) {
        // Nama berubah → riwayat penghuni lama ditutup, data baru dibuat.
        if (aktif) await tx.penghunian.update({ where: { id: aktif.id }, data: { selesai: new Date() } });
        await tx.penghunian.create({ data: { rumahId: p.rumahId, nama: p.namaBaru, noWa: p.noWaBaru || aktif?.noWa || null, catatan: `Pengajuan warga #${p.id}` } });
      } else if (p.noWaBaru && aktif) {
        await tx.penghunian.update({ where: { id: aktif.id }, data: { noWa: p.noWaBaru } });
      }
    }
    await tx.pengajuanPerubahan.update({ where: { id: pid }, data: { status: setuju ? 'DISETUJUI' : 'DITOLAK', diputuskanOlehId: req.user.id, diputuskanAt: new Date() } });
  });
  await audit(req, setuju ? 'PENGAJUAN_SETUJU' : 'PENGAJUAN_TOLAK', 'PengajuanPerubahan', pid);
  req.flash('success', setuju ? 'Pengajuan disetujui.' : 'Pengajuan ditolak.');
  res.redirect('/admin/pengajuan');
});

// ── Impor data sumber ──
r.get('/impor', requirePerm('impor.kelola'), async (req, res) => {
  const [perlu, calon, sumber] = await Promise.all([
    prisma.rumah.findMany({ where: { verifikasi: 'PERLU_VERIFIKASI' }, include: { penghunian: { where: { selesai: null }, take: 1 } }, orderBy: { noUrutSumber: 'asc' } }),
    prisma.$queryRaw`
      SELECT ri.id, ri.periode, ri."kodeKomponen", ri.verifikasi, r.kode, r.id AS "rumahId"
      FROM "RiwayatImpor" ri JOIN "Rumah" r ON r.id = ri."rumahId"
      LEFT JOIN LATERAL (SELECT kondisi FROM "StatusRumah" WHERE "rumahId" = r.id AND "berlakuMulai" <= ri.periode ORDER BY "berlakuMulai" DESC LIMIT 1) s ON true
      WHERE ri.terbayar = false AND ri.keputusan IS NULL AND COALESCE(s.kondisi,'AKTIF') = 'AKTIF' AND ri.periode <= ${periodeNow()}
      ORDER BY r."noUrutSumber" NULLS LAST, ri.periode`,
    prisma.riwayatImpor.groupBy({ by: ['sumber'], _count: true }),
  ]);
  res.render('admin/impor', { title: 'Impor & verifikasi data', perlu, calon, sumber, komponenDefault: await settings.get('komponen_impor') });
});

r.post('/impor', requirePerm('impor.kelola'), uploadCsv.single('csv'), verifyCsrf, async (req, res) => {
  if (!req.file) throw new AppError('Pilih file CSV.');
  const text = fs.readFileSync(req.file.path, 'utf8');
  fs.unlinkSync(req.file.path);
  const tahun = Number(req.body.tahun);
  if (!(tahun >= 2000 && tahun <= 2100)) throw new AppError('Tahun tidak valid.');
  const komponen = String(req.body.komponen || 'SAMPAH').toUpperCase();
  const sumber = String(req.body.sumber || `sheet-${tahun}`).slice(0, 50);
  const hasil = await impor.imporCsv(text, { tahun, komponen, sumber, userId: req.user.id });
  await audit(req, 'IMPOR_CSV', 'Rumah', null, { sumber, ...hasil });
  req.flash(hasil.error.length ? 'warning' : 'success', `Impor selesai: ${hasil.rumahBaru} rumah baru, ${hasil.rumahAda} sudah ada, ${hasil.penghuni} penghuni, ${hasil.riwayat} riwayat bulan, ${hasil.perluVerifikasi} perlu verifikasi.${hasil.error.length ? ' Error: ' + hasil.error.join('; ') : ''}`);
  res.redirect('/admin/impor');
});

r.post('/impor/keputusan', requirePerm('impor.kelola'), async (req, res) => {
  const ids = [].concat(req.body.ids || []).map(Number).filter(Boolean);
  const aksi = req.body.aksi;
  if (!ids.length) throw new AppError('Pilih minimal satu baris.');
  if (!['tunggakan', 'abaikan', 'lunas'].includes(aksi)) throw new AppError('Aksi tidak valid.');
  let n = 0;
  for (const rid of ids) {
    await prisma.$transaction(async (tx) => {
      const ri = await tx.riwayatImpor.findUnique({ where: { id: rid } });
      if (!ri || ri.keputusan) return;
      if (aksi === 'tunggakan') await iuran.buatTagihanKomponen(ri.rumahId, ri.periode, [ri.kodeKomponen], tx);
      await tx.riwayatImpor.update({ where: { id: rid }, data: aksi === 'lunas' ? { terbayar: true, keputusan: 'DIKOREKSI_LUNAS' } : { keputusan: aksi === 'tunggakan' ? 'DIJADIKAN_TUNGGAKAN' : 'DIABAIKAN' } });
      n++;
    });
  }
  await audit(req, 'KEPUTUSAN_IMPOR', 'RiwayatImpor', null, { ids, aksi });
  req.flash('success', `${n} baris diproses (${aksi}).`);
  res.redirect('/admin/impor');
});

module.exports = r;
