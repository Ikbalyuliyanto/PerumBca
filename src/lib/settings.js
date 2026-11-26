'use strict';
const prisma = require('./prisma');
// Pengaturan dinamis yang bisa diubah Super Admin dari UI.
const DEFAULTS = {
  nama_perumahan: 'Perumahan Bumi Cikarang Asri',
  rekening_info: 'Belum diatur — hubungi bendahara.',
  tagihan_otomatis: 'true',
  tanggal_tagihan: '1',
  hari_pengingat: '10,20',
  jatuh_tempo_hari: '10',
  template_tagihan: 'Assalamualaikum {nama}, tagihan iuran {rumah} periode {periode}: {nominal}. Total tunggakan: {tunggakan}. Bayar / unggah bukti di: {link}',
  template_pengingat: 'Pengingat iuran {rumah}: masih ada tunggakan {tunggakan}. Detail & pembayaran: {link}',
  template_konfirmasi: 'Terima kasih {nama}, pembayaran {nomor} sebesar {nominal} untuk {rumah} sudah kami terima. Sisa tunggakan: {tunggakan}.',
  ringkasan_publik: 'true',
  midtrans_fee_dana: 'KAS',
  midtrans_fee_flat: '0',
  midtrans_fee_persen: '0',
  komponen_impor: 'SAMPAH',
};
exports.DEFAULTS = DEFAULTS;
exports.all = async () => {
  const rows = await prisma.pengaturan.findMany();
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
};
exports.get = async (key) => (await prisma.pengaturan.findUnique({ where: { key } }))?.value ?? DEFAULTS[key];
exports.set = (key, value) => prisma.pengaturan.upsert({ where: { key }, update: { value }, create: { key, value } });
exports.render = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
