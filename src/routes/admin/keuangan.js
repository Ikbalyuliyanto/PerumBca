'use strict';
// Pembayaran, kuitansi, buku kas, pengeluaran, laporan.
const express = require('express');
const { z } = require('zod');
const prisma = require('../../lib/prisma');
const settings = require('../../lib/settings');
const { AppError, isPeriode, periodeNow, addPeriode } = require('../../lib/util');
const { audit } = require('../../lib/audit');
const { requirePerm, requireSuperAdmin } = require('../../middleware/auth');
const { upload, saveFile } = require('../../middleware/upload');
const { verifyCsrf } = require('../../middleware/csrf');
const iuran = require('../../modules/iuran/service');
const bayar = require('../../modules/keuangan/pembayaran');
const ledger = require('../../modules/keuangan/ledger');
const pengeluaran = require('../../modules/keuangan/pengeluaran');
const wa = require('../../modules/wa/service');

const r = express.Router();
const num = (v) => Number(String(v ?? '').replace(/\D/g, ''));
const tgl = (v) => (v ? new Date(`${v}T12:00:00+07:00`) : undefined);

/** Alokasi manual dari form: alok[<tagihanItemId>] = nominal. */
function alokasiDariForm(body) {
  if (body.mode !== 'manual' || !body.alok) return null;
  return Object.entries(body.alok).map(([k, v]) => ({ tagihanItemId: Number(k), nominal: num(v) })).filter((a) => a.nominal > 0);
}

// ── Pembayaran ──
r.get('/pembayaran', requirePerm('pembayaran.lihat'), async (req, res) => {
  const { status, metode } = req.query;
  const list = await prisma.pembayaran.findMany({
    where: { ...(status ? { status } : {}), ...(metode ? { metode } : {}) },
    include: { rumah: true }, orderBy: { createdAt: 'desc' }, take: 300,
  });
  res.render('admin/pembayaran-list', { title: 'Pembayaran', list });
});

r.get('/pembayaran/baru', requirePerm('pembayaran.input'), async (req, res) => {
  const rumahList = await prisma.rumah.findMany({ where: { aktif: true }, orderBy: { kode: 'asc' }, include: { penghunian: { where: { selesai: null }, take: 1 } } });
  const rumahId = Number(req.query.rumah) || null;
  const tg = rumahId ? await iuran.tunggakanRumah(rumahId) : null;
  res.render('admin/pembayaran-form', { title: 'Input pembayaran tunai', rumahList, rumahId, tg, periodeDepan: addPeriode(periodeNow(), 1) });
});

r.post('/pembayaran', requirePerm('pembayaran.input'), async (req, res) => {
  const rumahId = Number(req.body.rumahId);
  if (!rumahId) throw new AppError('Pilih rumah.');
  const out = await bayar.bayarTunai({ rumahId, nominal: num(req.body.nominal), tanggal: tgl(req.body.tanggal), catatan: String(req.body.catatan || '').slice(0, 300) || null, alokasiManual: alokasiDariForm(req.body), userId: req.user.id });
  await audit(req, 'BAYAR_TUNAI', 'Pembayaran', out.pembayaran.id, { rumahId, nominal: out.pembayaran.nominal, alokasi: out.alokasi });
  await wa.antreKonfirmasi(out.pembayaran.id);
  req.flash('success', `Pembayaran ${out.pembayaran.nomor} tercatat.`);
  res.redirect(`/admin/pembayaran/${out.pembayaran.id}`);
});

r.get('/pembayaran/:id', requirePerm('pembayaran.lihat'), async (req, res) => {
  const p = await prisma.pembayaran.findUnique({ where: { id: Number(req.params.id) || 0 }, include: { rumah: true, bukti: true, midtrans: true, alokasi: { include: { tagihanItem: { include: { tagihan: true } } } } } });
  if (!p) throw new AppError('Pembayaran tidak ditemukan', 404);
  const tg = p.status === 'MENUNGGU' ? await iuran.tunggakanRumah(p.rumahId) : null;
  const users = await prisma.user.findMany({ where: { id: { in: [p.dibuatOlehId, p.diverifikasiOlehId].filter(Boolean) } }, select: { id: true, nama: true } });
  res.render('admin/pembayaran-detail', { title: `Pembayaran ${p.nomor}`, p, tg, users: Object.fromEntries(users.map((x) => [x.id, x.nama])) });
});

r.post('/pembayaran/:id/setujui', requirePerm('pembayaran.verifikasi'), async (req, res) => {
  const pid = Number(req.params.id);
  const p = await prisma.pembayaran.findUnique({ where: { id: pid } });
  if (!p) throw new AppError('Tidak ditemukan', 404);
  if (p.metode === 'TRANSFER') await bayar.setujuiTransfer(pid, { userId: req.user.id, nominal: req.body.nominal ? num(req.body.nominal) : null, alokasiManual: alokasiDariForm(req.body) });
  else await prisma.$transaction((tx) => bayar.posting(tx, pid, { userId: req.user.id, alokasiManual: alokasiDariForm(req.body) }), bayar.TX_OPTS);
  await audit(req, 'VERIFIKASI_PEMBAYARAN', 'Pembayaran', pid, { setuju: true });
  await wa.antreKonfirmasi(pid);
  req.flash('success', 'Pembayaran disetujui dan diposting.');
  res.redirect(`/admin/pembayaran/${pid}`);
});

r.post('/pembayaran/:id/tolak', requirePerm('pembayaran.verifikasi'), async (req, res) => {
  const pid = Number(req.params.id);
  await bayar.tolakTransfer(pid, { userId: req.user.id, alasan: String(req.body.alasan || '').slice(0, 300) });
  await audit(req, 'VERIFIKASI_PEMBAYARAN', 'Pembayaran', pid, { setuju: false, alasan: req.body.alasan });
  req.flash('success', 'Pembayaran ditolak.');
  res.redirect(`/admin/pembayaran/${pid}`);
});

r.post('/pembayaran/:id/batal', requirePerm('pembayaran.koreksi'), async (req, res) => {
  const pid = Number(req.params.id);
  const out = await bayar.batalkan(pid, { userId: req.user.id, alasan: String(req.body.alasan || '').trim().slice(0, 300) });
  await audit(req, 'BATAL_PEMBAYARAN', 'Pembayaran', pid, { alasan: req.body.alasan, ...out });
  req.flash('success', 'Pembayaran dibatalkan dengan transaksi pembalik.');
  res.redirect(`/admin/pembayaran/${pid}`);
});

r.get('/kuitansi/:id', requirePerm('pembayaran.lihat'), async (req, res) => {
  const p = await prisma.pembayaran.findUnique({ where: { id: Number(req.params.id) || 0 }, include: { rumah: true, alokasi: { include: { tagihanItem: { include: { tagihan: true } } } } } });
  if (!p || p.status !== 'DIPOSTING') throw new AppError('Kuitansi hanya untuk pembayaran terposting.', 404);
  res.render('kuitansi', { title: `Kuitansi ${p.nomor}`, p, s: await settings.all() });
});

// ── Buku kas ──
function ledgerWhere(q) {
  const where = {};
  if (q.dana) where.danaId = Number(q.dana);
  if (q.jenis) where.jenis = q.jenis;
  if (q.arah) where.arah = q.arah;
  const dari = isPeriode(q.dari) ? new Date(`${q.dari}-01T00:00:00+07:00`) : null;
  const sampai = isPeriode(q.sampai) ? new Date(`${addPeriode(q.sampai, 1)}-01T00:00:00+07:00`) : null;
  if (dari || sampai) where.tanggal = { ...(dari ? { gte: dari } : {}), ...(sampai ? { lt: sampai } : {}) };
  return { where, dari, sampai };
}

r.get('/ledger', requirePerm('ledger.lihat'), async (req, res) => {
  const { where } = ledgerWhere(req.query);
  const [saldo, entries, dana, adaSaldoAwal] = await Promise.all([
    ledger.saldoDana(),
    prisma.ledgerEntry.findMany({ where, include: { dana: true }, orderBy: [{ tanggal: 'desc' }, { id: 'desc' }], take: 500 }),
    prisma.dana.findMany({ orderBy: { id: 'asc' } }),
    prisma.ledgerEntry.findMany({ where: { jenis: 'SALDO_AWAL' }, select: { danaId: true } }),
  ]);
  res.render('admin/ledger', { title: 'Buku kas', saldo, entries, dana, sudahSaldoAwal: new Set(adaSaldoAwal.map((x) => x.danaId)) });
});

r.post('/ledger/saldo-awal', requirePerm('ledger.saldo_awal'), async (req, res) => {
  const e = await ledger.setSaldoAwal({ danaId: Number(req.body.danaId), nominal: num(req.body.nominal), tanggal: tgl(req.body.tanggal), userId: req.user.id, keterangan: req.body.keterangan });
  await audit(req, 'SALDO_AWAL', 'LedgerEntry', e.id, { danaId: e.danaId, nominal: e.nominal });
  req.flash('success', 'Saldo awal dicatat.');
  res.redirect('/admin/ledger');
});

r.post('/ledger/manual', requirePerm('ledger.saldo_awal'), async (req, res) => {
  const e = await ledger.entriManual({ danaId: Number(req.body.danaId), arah: req.body.arah, nominal: num(req.body.nominal), tanggal: tgl(req.body.tanggal), keterangan: String(req.body.keterangan || '').trim().slice(0, 300), userId: req.user.id });
  await audit(req, 'ENTRI_MANUAL', 'LedgerEntry', e.id, { arah: e.arah, nominal: e.nominal, keterangan: e.keterangan });
  req.flash('success', 'Entri buku kas dicatat.');
  res.redirect('/admin/ledger');
});

r.post('/ledger/:id/koreksi', requireSuperAdmin, async (req, res) => {
  const e = await ledger.koreksi(Number(req.params.id), { userId: req.user.id, alasan: String(req.body.alasan || '').trim().slice(0, 300) });
  await audit(req, 'KOREKSI_LEDGER', 'LedgerEntry', req.params.id, { pembalik: e.id, alasan: req.body.alasan });
  req.flash('success', `Entri pembalik #${e.id} dibuat.`);
  res.redirect('/admin/ledger');
});

// ── Pengeluaran ──
r.get('/pengeluaran', requirePerm('pengeluaran.lihat'), async (req, res) => {
  const [list, dana, saldo] = await Promise.all([
    prisma.pengeluaran.findMany({ where: req.query.status ? { status: req.query.status } : {}, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.dana.findMany({ where: { aktif: true } }),
    ledger.saldoDana(),
  ]);
  const users = await prisma.user.findMany({ select: { id: true, nama: true } });
  res.render('admin/pengeluaran', { title: 'Pengeluaran', list, dana, saldo, danaMap: Object.fromEntries(saldo.map((d) => [d.id, d])), userMap: Object.fromEntries(users.map((x) => [x.id, x.nama])) });
});

r.post('/pengeluaran', requirePerm('pengeluaran.ajukan'), upload.single('lampiran'), verifyCsrf, async (req, res) => {
  const b = z.object({ danaId: z.coerce.number().int().positive(), kategori: z.string().trim().min(2).max(60), alasan: z.string().trim().min(3).max(500) }).parse(req.body);
  const f = await saveFile(req.file, { userId: req.user.id });
  const p = await pengeluaran.buat({ ...b, nominal: num(req.body.nominal), lampiranFileId: f?.id || null, ajukan: req.body.ajukan === '1', userId: req.user.id });
  await audit(req, 'PENGELUARAN_BARU', 'Pengeluaran', p.id, { ...b, nominal: p.nominal, status: p.status });
  req.flash('success', `Pengeluaran ${p.nomor} disimpan (${p.status}).`);
  res.redirect('/admin/pengeluaran');
});

r.post('/pengeluaran/:id/ajukan', requirePerm('pengeluaran.ajukan'), async (req, res) => {
  await pengeluaran.ajukan(Number(req.params.id), req.user.id);
  await audit(req, 'PENGELUARAN_AJUKAN', 'Pengeluaran', req.params.id);
  res.redirect('/admin/pengeluaran');
});

r.post('/pengeluaran/:id/putuskan', requirePerm('pengeluaran.setujui'), async (req, res) => {
  const setuju = req.body.aksi === 'setuju';
  await pengeluaran.putuskan(Number(req.params.id), { userId: req.user.id, setuju, alasan: String(req.body.alasan || '').slice(0, 300) });
  await audit(req, setuju ? 'PENGELUARAN_SETUJU' : 'PENGELUARAN_TOLAK', 'Pengeluaran', req.params.id, { alasan: req.body.alasan });
  req.flash('success', setuju ? 'Pengeluaran disetujui.' : 'Pengeluaran ditolak.');
  res.redirect('/admin/pengeluaran');
});

r.post('/pengeluaran/:id/bayar', requirePerm('pengeluaran.bayar'), upload.single('bukti'), verifyCsrf, async (req, res) => {
  const f = await saveFile(req.file, { userId: req.user.id });
  await pengeluaran.bayar(Number(req.params.id), { userId: req.user.id, buktiFileId: f?.id, tanggal: tgl(req.body.tanggal) });
  await audit(req, 'PENGELUARAN_BAYAR', 'Pengeluaran', req.params.id, { bukti: f?.id });
  req.flash('success', 'Pengeluaran dibayar & tercatat di buku kas.');
  res.redirect('/admin/pengeluaran');
});

r.post('/pengeluaran/:id/batal', requirePerm('pengeluaran.ajukan'), async (req, res) => {
  await pengeluaran.batal(Number(req.params.id));
  await audit(req, 'PENGELUARAN_BATAL', 'Pengeluaran', req.params.id);
  res.redirect('/admin/pengeluaran');
});

// ── Laporan ──
r.get('/laporan', requirePerm('laporan.lihat'), async (req, res) => {
  const q = req.query;
  const dariP = isPeriode(q.dari) ? q.dari : `${periodeNow().slice(0, 4)}-01`;
  const sampaiP = isPeriode(q.sampai) ? q.sampai : periodeNow();
  const { where } = ledgerWhere({ ...q, dari: dariP, sampai: sampaiP });
  const awal = new Date(`${dariP}-01T00:00:00+07:00`);
  const [dana, saldoAwal, entries, tagihanRekap, bloks] = await Promise.all([
    prisma.dana.findMany({ orderBy: { id: 'asc' } }),
    ledger.saldoDana(prisma, { sampai: awal }),
    prisma.ledgerEntry.findMany({ where, include: { dana: true }, orderBy: [{ tanggal: 'asc' }, { id: 'asc' }] }),
    prisma.tagihan.findMany({
      where: { periode: { gte: dariP, lte: sampaiP }, status: { not: 'DIBATALKAN' }, ...(q.blok ? { rumah: { blok: { kode: q.blok } } } : {}), ...(q.rumah ? { rumah: { kode: q.rumah.toUpperCase() } } : {}) },
      include: { rumah: true }, orderBy: [{ rumah: { kode: 'asc' } }, { periode: 'asc' }],
    }),
    prisma.blok.findMany({ orderBy: { kode: 'asc' } }),
  ]);
  // Rekap per dana untuk periode
  const rekap = dana.map((d) => {
    const e = entries.filter((x) => x.danaId === d.id);
    const masuk = e.filter((x) => x.arah === 'MASUK').reduce((s, x) => s + x.nominal, 0);
    const keluar = e.filter((x) => x.arah === 'KELUAR').reduce((s, x) => s + x.nominal, 0);
    const sa = saldoAwal.find((x) => x.id === d.id)?.saldo || 0;
    return { ...d, saldoAwal: sa, masuk, keluar, saldoAkhir: sa + masuk - keluar };
  });
  // Rekap tagihan per rumah
  const perRumah = new Map();
  for (const t of tagihanRekap) {
    const x = perRumah.get(t.rumahId) || { kode: t.rumah.kode, total: 0, terbayar: 0, bulan: 0, belum: 0 };
    x.total += t.total; x.terbayar += t.terbayar; x.bulan++; if (t.status !== 'LUNAS') x.belum++;
    perRumah.set(t.rumahId, x);
  }
  const rumahRekap = [...perRumah.values()];

  if (q.format === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['tanggal', 'dana', 'arah', 'nominal', 'jenis', 'keterangan'].join(',')];
    for (const e of entries) lines.push([e.tanggal.toISOString().slice(0, 10), e.dana.kode, e.arah, e.nominal, e.jenis, e.keterangan].map(esc).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="buku-kas-${dariP}-${sampaiP}.csv"`);
    return res.send('﻿' + lines.join('\n'));
  }
  res.render('admin/laporan', { title: 'Laporan keuangan', dariP, sampaiP, rekap, entries, rumahRekap, dana, bloks });
});

module.exports = r;
