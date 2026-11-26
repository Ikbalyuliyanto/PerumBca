'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma, seedDasar, saldo } = require('./helpers');
const cepat = require('../src/modules/keuangan/bayarCepat');

let D;
before(async () => { D = await seedDasar(); });
after(() => prisma.$disconnect());

test('bayar semua: tagihan dibuat otomatis dan semua jenis iuran lunas', async () => {
  const out = await cepat.bayarPilihan(D.a1.id, [{ periode: '2026-12', kode: null }], { userId: D.bendahara.id });
  assert.equal(out.pembayaran.nominal, 50000);
  const t = await prisma.tagihan.findUnique({ where: { rumahId_periode: { rumahId: D.a1.id, periode: '2026-12' } } });
  assert.equal(t.status, 'LUNAS');
  assert.deepEqual(await saldo(), { PEMBANGUNAN: 20000, KAS: 10000, SAMPAH: 20000 });
  // bayar lagi → sudah lunas, tidak ada pembayaran baru
  assert.equal(await cepat.bayarPilihan(D.a1.id, [{ periode: '2026-12', kode: null }], { userId: D.bendahara.id }), null);
});

test('bayar pilihan: hanya iuran yang dicentang, lintas bulan', async () => {
  const out = await cepat.bayarPilihan(D.a2.id, [{ periode: '2026-11', kode: 'SAMPAH' }, { periode: '2026-12', kode: 'SAMPAH' }, { periode: '2026-12', kode: 'KAS' }], { userId: D.bendahara.id });
  assert.equal(out.pembayaran.nominal, 50000);
  const nov = await prisma.tagihan.findUnique({ where: { rumahId_periode: { rumahId: D.a2.id, periode: '2026-11' } }, include: { items: true } });
  assert.equal(nov.status, 'SEBAGIAN');
  assert.equal(nov.items.find((i) => i.kodeKomponen === 'SAMPAH').terbayar, 20000);
  assert.equal(nov.items.find((i) => i.kodeKomponen === 'PEMBANGUNAN').terbayar, 0);
});

test('ringkasan bulan menampilkan status per jenis iuran', async () => {
  const r = await cepat.ringkasanBulan('2026-11');
  const a2 = r.rumah.find((x) => x.kode === 'A2');
  assert.equal(a2.per.SAMPAH, 'LUNAS');
  assert.equal(a2.per.PEMBANGUNAN, 'BELUM');
  assert.equal(a2.sisa, 30000);
});
