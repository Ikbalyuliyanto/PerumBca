'use strict';
// Antrean WhatsApp dengan retry. Provider: "none" (pesan tetap antre & bisa dikirim
// manual via tautan wa.me) atau "baileys" (otomatis).
const prisma = require('../../lib/prisma');
const config = require('../../config');
const settings = require('../../lib/settings');
const { rupiah, periodeLabel, normWa } = require('../../lib/util');
const link = require('../warga/link');
const { tunggakanRumah } = require('../iuran/service');

const MAX_TRY = 5;
let provider = null;

async function initProvider() {
  if (config.WA_PROVIDER === 'baileys') {
    provider = require('./baileys');
    await provider.start();
  }
}

function status() {
  if (!provider) return { provider: config.WA_PROVIDER, connected: false, info: config.WA_PROVIDER === 'none' ? 'Mode manual: kirim lewat tautan wa.me' : 'Belum aktif' };
  return { provider: config.WA_PROVIDER, ...provider.status() };
}

/** Masukkan pesan ke antrean. refKey mencegah pesan ganda (mis. "tagihan:12:2026-12"). */
async function enqueue({ tujuan, jenis, isi, rumahId = null, refKey = null }) {
  const no = normWa(tujuan);
  if (!no) return null;
  try {
    return await prisma.waPesan.create({ data: { tujuan: no, jenis, isi, rumahId, refKey } });
  } catch (e) {
    if (e.code === 'P2002') return null; // sudah pernah diantrekan
    throw e;
  }
}

async function penghuniAktif(rumahId) {
  return prisma.penghunian.findFirst({ where: { rumahId, selesai: null }, orderBy: { mulai: 'desc' } });
}

async function varsRumah(rumahId) {
  const rumah = await prisma.rumah.findUnique({ where: { id: rumahId } });
  const ph = await penghuniAktif(rumahId);
  const tg = await tunggakanRumah(rumahId);
  return { rumah, ph, vars: { nama: ph?.nama || 'Bapak/Ibu', rumah: rumah.kode, tunggakan: rupiah(tg.total), link: link.urlFor(rumah) } };
}

async function antreTagihan(rumahId, periode, total) {
  const s = await settings.all();
  const { ph, vars } = await varsRumah(rumahId);
  if (!ph?.noWa) return null;
  const isi = settings.render(s.template_tagihan, { ...vars, periode: periodeLabel(periode), nominal: rupiah(total) });
  return enqueue({ tujuan: ph.noWa, jenis: 'TAGIHAN', isi, rumahId, refKey: `tagihan:${rumahId}:${periode}` });
}

async function antrePengingat(rumahId, kunci) {
  const s = await settings.all();
  const { ph, vars } = await varsRumah(rumahId);
  if (!ph?.noWa) return null;
  const isi = settings.render(s.template_pengingat, vars);
  return enqueue({ tujuan: ph.noWa, jenis: 'PENGINGAT', isi, rumahId, refKey: `pengingat:${rumahId}:${kunci}` });
}

async function antreKonfirmasi(pembayaranId) {
  const p = await prisma.pembayaran.findUnique({ where: { id: pembayaranId } });
  if (!p) return null;
  const s = await settings.all();
  const { ph, vars } = await varsRumah(p.rumahId);
  if (!ph?.noWa) return null;
  const isi = settings.render(s.template_konfirmasi, { ...vars, nomor: p.nomor, nominal: rupiah(p.nominal) });
  return enqueue({ tujuan: ph.noWa, jenis: 'KONFIRMASI', isi, rumahId: p.rumahId, refKey: `konfirmasi:${p.id}` });
}

/** Proses antrean (dipanggil job tiap menit). */
async function prosesAntrean(limit = 10) {
  if (!provider || !provider.status().connected) return { sent: 0, skipped: true };
  const list = await prisma.waPesan.findMany({ where: { status: 'ANTRI', nextRetryAt: { lte: new Date() } }, orderBy: { id: 'asc' }, take: limit });
  let sent = 0;
  for (const m of list) {
    try {
      await provider.send(m.tujuan, m.isi);
      await prisma.waPesan.update({ where: { id: m.id }, data: { status: 'TERKIRIM', sentAt: new Date(), percobaan: { increment: 1 }, error: null } });
      sent++;
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500)); // jeda anti-spam
    } catch (e) {
      const n = m.percobaan + 1;
      await prisma.waPesan.update({
        where: { id: m.id },
        data: { percobaan: n, error: String(e.message || e).slice(0, 500), status: n >= MAX_TRY ? 'GAGAL' : 'ANTRI', nextRetryAt: new Date(Date.now() + 2 ** n * 60_000) },
      });
    }
  }
  return { sent };
}

const waMeUrl = (m) => `https://wa.me/${m.tujuan}?text=${encodeURIComponent(m.isi)}`;

module.exports = { initProvider, status, enqueue, antreTagihan, antrePengingat, antreKonfirmasi, prosesAntrean, waMeUrl };
