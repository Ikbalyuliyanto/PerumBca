'use strict';
// Seed idempoten: permission, role, dana & kebijakan awal (contoh dari brief, bisa diubah),
// dan akun Super Admin dari ENV (hanya bila belum ada Super Admin).
require('dotenv').config({ quiet: true });
const prisma = require('../src/lib/prisma');
const password = require('../src/lib/password');
const { PERMISSIONS, ROLES } = require('../src/config/permissions');

async function main() {
  for (const [kode, nama, grup] of PERMISSIONS) {
    await prisma.permission.upsert({ where: { kode }, update: { nama, grup }, create: { kode, nama, grup } });
  }
  for (const [kode, def] of Object.entries(ROLES)) {
    const existing = await prisma.role.findUnique({ where: { kode } });
    if (existing) continue; // jangan timpa pemetaan yang sudah diubah Super Admin
    await prisma.role.create({ data: { kode, nama: def.nama, sistem: true, permissions: { create: def.perms.map((p) => ({ permissionKode: p })) } } });
  }

  if ((await prisma.dana.count()) === 0) {
    await prisma.dana.createMany({ data: [
      { kode: 'PEMBANGUNAN', nama: 'Dana Pembangunan' },
      { kode: 'KAS', nama: 'Kas Umum' },
      { kode: 'SAMPAH', nama: 'Dana Kebersihan/Sampah' },
    ] });
  }
  if ((await prisma.kebijakan.count()) === 0) {
    const dana = Object.fromEntries((await prisma.dana.findMany()).map((d) => [d.kode, d.id]));
    await prisma.kebijakan.create({ data: {
      nama: 'Kebijakan awal', berlakuMulai: process.env.KEBIJAKAN_AWAL_MULAI || '2026-01', catatan: 'Dibuat otomatis oleh seed — sesuaikan di menu Kebijakan.',
      komponen: { create: [
        { kode: 'PEMBANGUNAN', nama: 'Pembangunan', nominal: 20000, danaId: dana.PEMBANGUNAN, urutan: 1 },
        { kode: 'KAS', nama: 'Kas umum', nominal: 10000, danaId: dana.KAS, urutan: 2 },
        { kode: 'SAMPAH', nama: 'Sampah/Kebersihan', nominal: 20000, danaId: dana.SAMPAH, urutan: 3 },
      ] },
    } });
  }

  const adaSuper = await prisma.user.findFirst({ where: { isSuperAdmin: true } });
  if (!adaSuper) {
    const u = process.env.SUPERADMIN_USERNAME;
    const pw = process.env.SUPERADMIN_PASSWORD;
    if (!u || !pw) { console.warn('SUPERADMIN_USERNAME/SUPERADMIN_PASSWORD belum diset — Super Admin tidak dibuat.'); }
    else if (!password.validateStrength(pw)) { throw new Error('SUPERADMIN_PASSWORD minimal 6 karakter'); }
    else {
      await prisma.user.create({ data: { username: u.toLowerCase(), nama: process.env.SUPERADMIN_NAMA || 'Super Admin', passwordHash: await password.hash(pw), isSuperAdmin: true } });
      console.log(`Super Admin "${u}" dibuat. Hapus SUPERADMIN_PASSWORD dari .env setelah login pertama.`);
    }
  }
  console.log('Seed selesai.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
