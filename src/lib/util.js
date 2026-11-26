'use strict';
const crypto = require('crypto');

class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true; }
}
exports.AppError = AppError;

exports.rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
exports.BULAN = BULAN;
exports.isPeriode = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p || '');
exports.periodeLabel = (p) => { if (!p) return ''; const [y, m] = p.split('-'); return `${BULAN[Number(m) - 1]} ${y}`; };
exports.periodeNow = (d = new Date()) => {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).format(d);
  return s.slice(0, 7);
};
exports.addPeriode = (p, n) => {
  let [y, m] = p.split('-').map(Number); m += n;
  while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
};
exports.tanggal = (d) => d ? new Date(d).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric' }) : '-';
exports.waktu = (d) => d ? new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) : '-';
exports.randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
exports.sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
exports.normWa = (s) => {
  if (!s) return null;
  let d = String(s).replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  if (d.startsWith('8')) d = '62' + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
};

/** Nomor dokumen berurutan per prefix+tahun, aman di dalam transaksi. */
exports.nextNomor = async (tx, prefix) => {
  const year = new Date().getFullYear();
  const key = `${prefix}-${year}`;
  const rows = await tx.$queryRaw`
    INSERT INTO "Counter"(key, value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET value = "Counter".value + 1
    RETURNING value`;
  return `${prefix}/${year}/${String(rows[0].value).padStart(5, '0')}`;
};
