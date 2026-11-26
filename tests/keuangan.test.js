'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma, seedDasar, saldo } = require('./helpers');
const iuran = require('../src/modules/iuran/service');
const bayar = require('../src/modules/keuangan/pembayaran');
const ledger = require('../src/modules/keuangan/ledger');
const pengeluaran = require('../src/modules/keuangan/pengeluaran');

let D;
before(async () => { D = await seedDasar(); });
after(() => prisma.$disconnect());

test('generate tagihan idempoten & menyimpan snapshot komponen', async () => {
  const r1 = await iuran.generateTagihan('2026-01');
  assert.equal(r1.dibuat.length, 2);
  const r2 = await iuran.generateTagihan('2026-01');
  assert.equal(r2.dibuat.length, 0);
  assert.equal(r2.dilewati, 2);
  const t = await prisma.tagihan.findFirst({ where: { rumahId: D.a1.id, periode: '2026-01' }, include: { items: true } });
  assert.equal(t.total, 50000);
  assert.deepEqual(t.items.map((i) => i.kodeKomponen).sort(), ['KAS', 'PEMBANGUNAN', 'SAMPAH']);
});

test('rumah KOSONG: bebas tagihan, atau hanya komponen wajib dengan nominal kebijakan umum', async () => {
  await prisma.statusRumah.create({ data: { rumahId: D.a2.id, kondisi: 'KOSONG', berlakuMulai: '2026-02', komponenWajib: [] } });
  await prisma.statusRumah.create({ data: { rumahId: D.a2.id, kondisi: 'KOSONG', berlakuMulai: '2026-03', komponenWajib: ['SAMPAH'] } });
  const feb = await iuran.generateTagihan('2026-02');
  assert.equal(feb.bebas, 1);
  assert.equal(await prisma.tagihan.count({ where: { rumahId: D.a2.id, periode: '2026-02' } }), 0);
  await iuran.generateTagihan('2026-03');
  const mar = await prisma.tagihan.findFirst({ where: { rumahId: D.a2.id, periode: '2026-03' }, include: { items: true } });
  assert.equal(mar.total, 20000);
  assert.deepEqual(mar.items.map((i) => i.kodeKomponen), ['SAMPAH']);
});

test('perubahan kebijakan tidak mengubah tagihan lama', async () => {
  const k = await prisma.kebijakan.findFirst({ include: { komponen: true } });
  await prisma.kebijakan.create({ data: { nama: 'K2', berlakuMulai: '2026-04', komponen: { create: k.komponen.map((c) => ({ kode: c.kode, nama: c.nama, nominal: c.nominal + 5000, danaId: c.danaId, urutan: c.urutan })) } } });
  await iuran.generateTagihan('2026-04');
  const jan = await prisma.tagihan.findFirst({ where: { rumahId: D.a1.id, periode: '2026-01' } });
  const apr = await prisma.tagihan.findFirst({ where: { rumahId: D.a1.id, periode: '2026-04' } });
  assert.equal(jan.total, 50000);
  assert.equal(apr.total, 65000);
});

test('pembayaran tunai dialokasikan FIFO (tertua dulu) dan masuk buku kas per dana', async () => {
  // A1 punya tagihan Jan, Feb, Mar (50rb) dan Apr (65rb).
  const out = await bayar.bayarTunai({ rumahId: D.a1.id, nominal: 75000, userId: D.bendahara.id });
  assert.equal(out.alokasi[0].periode, '2026-01');
  const jan = await prisma.tagihan.findFirst({ where: { rumahId: D.a1.id, periode: '2026-01' } });
  const feb = await prisma.tagihan.findFirst({ where: { rumahId: D.a1.id, periode: '2026-02' }, include: { items: true } });
  assert.equal(jan.status, 'LUNAS');
  assert.equal(feb.status, 'SEBAGIAN');
  assert.equal(feb.terbayar, 25000);
  const byKode = Object.fromEntries(feb.items.map((i) => [i.kodeKomponen, i.terbayar]));
  assert.deepEqual(byKode, { PEMBANGUNAN: 20000, KAS: 5000, SAMPAH: 0 });
  assert.deepEqual(await saldo(), { PEMBANGUNAN: 40000, KAS: 15000, SAMPAH: 20000 });
  const sumAlok = (await prisma.alokasiPembayaran.aggregate({ where: { pembayaranId: out.pembayaran.id }, _sum: { nominal: true } }))._sum.nominal;
  assert.equal(sumAlok, 75000);
});

test('kelebihan bayar ditolak tanpa mengubah data apa pun', async () => {
  const before = await saldo();
  const tg = await iuran.tunggakanRumah(D.a1.id);
  await assert.rejects(bayar.bayarTunai({ rumahId: D.a1.id, nominal: tg.total + 1, userId: D.bendahara.id }), /melebihi/);
  assert.deepEqual(await saldo(), before);
  assert.equal((await iuran.tunggakanRumah(D.a1.id)).total, tg.total);
});

test('alokasi manual oleh bendahara (mis. bayar sampah dulu) & validasi jumlah', async () => {
  const mar = await prisma.tagihan.findFirst({ where: { rumahId: D.a1.id, periode: '2026-03' }, include: { items: true } });
  const sampah = mar.items.find((i) => i.kodeKomponen === 'SAMPAH');
  await assert.rejects(bayar.bayarTunai({ rumahId: D.a1.id, nominal: 20000, alokasiManual: [{ tagihanItemId: sampah.id, nominal: 15000 }], userId: D.bendahara.id }), /harus sama/);
  await bayar.bayarTunai({ rumahId: D.a1.id, nominal: 20000, alokasiManual: [{ tagihanItemId: sampah.id, nominal: 20000 }], userId: D.bendahara.id });
  const after = await prisma.tagihanItem.findUnique({ where: { id: sampah.id } });
  assert.equal(after.terbayar, 20000);
  // Feb masih SEBAGIAN (FIFO tidak dipakai di mode manual)
  assert.equal((await prisma.tagihan.findFirst({ where: { rumahId: D.a1.id, periode: '2026-02' } })).terbayar, 25000);
});

test('pembatalan membuat entri pembalik, tagihan kembali, buku kas tidak bisa diedit/hapus', async () => {
  const before = await saldo();
  const entriSebelum = await prisma.ledgerEntry.count();
  const out = await bayar.bayarTunai({ rumahId: D.a1.id, nominal: 25000, userId: D.bendahara.id }); // melunasi Feb
  assert.equal((await prisma.tagihan.findFirst({ where: { rumahId: D.a1.id, periode: '2026-02' } })).status, 'LUNAS');
  await bayar.batalkan(out.pembayaran.id, { userId: D.bendahara.id, alasan: 'salah input' });
  assert.deepEqual(await saldo(), before);
  assert.equal((await prisma.tagihan.findFirst({ where: { rumahId: D.a1.id, periode: '2026-02' } })).status, 'SEBAGIAN');
  assert.ok((await prisma.ledgerEntry.count()) > entriSebelum + 1, 'entri asli + pembalik tetap ada');
  await assert.rejects(bayar.batalkan(out.pembayaran.id, { userId: D.bendahara.id, alasan: 'lagi' }), /terposting/);
  const e = await prisma.ledgerEntry.findFirst();
  await assert.rejects(prisma.ledgerEntry.update({ where: { id: e.id }, data: { nominal: 1 } }), /append-only/);
  await assert.rejects(prisma.ledgerEntry.delete({ where: { id: e.id } }), /append-only/);
});

test('dua pembayaran bersamaan atas tunggakan yang sama: hanya satu yang berhasil', async () => {
  await iuran.generateTagihan('2026-05', { rumahIds: [D.a2.id] }); // A2 Mei: KOSONG → hanya SAMPAH 25rb (K2)
  const tg = await iuran.tunggakanRumah(D.a2.id);
  const total = tg.total;
  const res = await Promise.allSettled([
    bayar.bayarTunai({ rumahId: D.a2.id, nominal: total, userId: D.bendahara.id }),
    bayar.bayarTunai({ rumahId: D.a2.id, nominal: total, userId: D.bendahara.id }),
  ]);
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await iuran.tunggakanRumah(D.a2.id)).total, 0);
});

test('transfer: menunggu verifikasi tidak mengubah saldo; disetujui → diposting sekali', async () => {
  await iuran.generateTagihan('2026-06', { rumahIds: [D.a2.id] });
  const before = await saldo();
  const f = await prisma.fileUpload.create({ data: { path: 'x.jpg', namaAsli: 'x.jpg', mime: 'image/jpeg', ukuran: 1, sha256: 'x', rumahId: D.a2.id } });
  const p = await bayar.ajukanTransfer({ rumahId: D.a2.id, nominal: 25000, buktiFileId: f.id });
  assert.equal(p.status, 'MENUNGGU');
  assert.deepEqual(await saldo(), before);
  await bayar.setujuiTransfer(p.id, { userId: D.bendahara.id });
  const again = await bayar.setujuiTransfer(p.id, { userId: D.bendahara.id });
  assert.equal(again.already, true);
  assert.equal((await saldo()).SAMPAH, before.SAMPAH + 25000);
  await assert.rejects(bayar.tolakTransfer(p.id, { userId: D.bendahara.id, alasan: 'x' }), /MENUNGGU/);
});

test('saldo awal hanya sekali per dana; saldo akhir = awal + masuk − keluar', async () => {
  const before = await saldo();
  await ledger.setSaldoAwal({ danaId: D.dana.kas.id, nominal: 2000000, userId: D.bendahara.id });
  await assert.rejects(ledger.setSaldoAwal({ danaId: D.dana.kas.id, nominal: 1, userId: D.bendahara.id }), /sudah pernah/);
  assert.equal((await saldo()).KAS, before.KAS + 2000000);
});

test('pengeluaran: tidak bisa setujui sendiri, approve belum mengurangi saldo, PAID mengurangi, saldo kurang ditolak', async () => {
  const before = await saldo();
  const p = await pengeluaran.buat({ danaId: D.dana.kas.id, kategori: 'Kebersihan', nominal: 300000, alasan: 'Sapu', ajukan: true, userId: D.bendahara.id });
  assert.equal(p.status, 'PENDING');
  await assert.rejects(pengeluaran.putuskan(p.id, { userId: D.bendahara.id, setuju: true }), /sendiri/);
  await pengeluaran.putuskan(p.id, { userId: D.ketua.id, setuju: true });
  assert.deepEqual(await saldo(), before);
  await assert.rejects(pengeluaran.bayar(p.id, { userId: D.bendahara.id }), /Bukti/);
  const f = await prisma.fileUpload.create({ data: { path: 'b.jpg', namaAsli: 'b.jpg', mime: 'image/jpeg', ukuran: 1, sha256: 'x' } });
  await pengeluaran.bayar(p.id, { userId: D.bendahara.id, buktiFileId: f.id });
  assert.equal((await saldo()).KAS, before.KAS - 300000);
  await assert.rejects(pengeluaran.bayar(p.id, { userId: D.bendahara.id, buktiFileId: f.id }), /APPROVED/);

  const besar = await pengeluaran.buat({ danaId: D.dana.sampah.id, kategori: 'X', nominal: 99_000_000, alasan: 'terlalu besar', ajukan: true, userId: D.bendahara.id });
  await pengeluaran.putuskan(besar.id, { userId: D.ketua.id, setuju: true });
  await assert.rejects(pengeluaran.bayar(besar.id, { userId: D.bendahara.id, buktiFileId: f.id }), /tidak cukup/);
  await assert.rejects(pengeluaran.putuskan(besar.id, { userId: D.ketua.id, setuju: false, alasan: 'x' }), /PENDING/);
});
