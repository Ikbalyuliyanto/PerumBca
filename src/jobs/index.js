'use strict';
// Job terjadwal (zona Asia/Jakarta). Jadwal dibaca dari Pengaturan tiap hari.
const cron = require('node-cron');
const prisma = require('../lib/prisma');
const settings = require('../lib/settings');
const { periodeNow } = require('../lib/util');
const iuran = require('../modules/iuran/service');
const wa = require('../modules/wa/service');

async function harian() {
  const s = await settings.all();
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const hari = now.getDate();
  const periode = periodeNow();
  if (s.tagihan_otomatis !== 'false' && hari === Number(s.tanggal_tagihan || 1)) {
    try {
      const r = await iuran.generateTagihan(periode);
      for (const t of r.dibuat) await wa.antreTagihan(t.rumahId, periode, t.total);
      await prisma.auditLog.create({ data: { aksi: 'TAGIHAN_OTOMATIS', entitas: 'Tagihan', entitasId: periode, data: { dibuat: r.dibuat.length, dilewati: r.dilewati, bebas: r.bebas } } });
      console.log(`[job] tagihan ${periode}: ${r.dibuat.length} dibuat`);
    } catch (e) { console.error('[job] tagihan gagal:', e.message); }
  }
  const hariPengingat = String(s.hari_pengingat || '').split(',').map((x) => Number(x.trim())).filter(Boolean);
  if (hariPengingat.includes(hari)) await kirimPengingat(`${periode}-${hari}`);
}

async function kirimPengingat(kunci) {
  const rows = await prisma.tagihan.groupBy({ by: ['rumahId'], where: { status: { in: ['BELUM', 'SEBAGIAN'] } } });
  let n = 0;
  for (const r of rows) if (await wa.antrePengingat(r.rumahId, kunci)) n++;
  console.log(`[job] pengingat ${kunci}: ${n} diantrekan`);
  return n;
}

function start() {
  cron.schedule('0 8 * * *', () => harian().catch((e) => console.error('[job] harian', e)), { timezone: 'Asia/Jakarta' });
  cron.schedule('* * * * *', () => wa.prosesAntrean().catch((e) => console.error('[job] wa', e)), { timezone: 'Asia/Jakarta' });
  console.log('[job] terjadwal: harian 08:00 WIB, antrean WA tiap menit');
}

module.exports = { start, harian, kirimPengingat };
