'use strict';
// Akun, role & permission, audit log, WhatsApp, pengaturan.
const express = require('express');
const { z } = require('zod');
const prisma = require('../../lib/prisma');
const password = require('../../lib/password');
const settings = require('../../lib/settings');
const { AppError, normWa } = require('../../lib/util');
const { audit } = require('../../lib/audit');
const { requirePerm, requireSuperAdmin } = require('../../middleware/auth');
const wa = require('../../modules/wa/service');
const jobs = require('../../jobs');

const r = express.Router();

// ── Akun ──
r.get('/users', requirePerm('user.kelola'), async (req, res) => {
  const [users, roles, rumah] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ isSuperAdmin: 'desc' }, { username: 'asc' }], include: { roles: { include: { role: true } }, rumah: { include: { rumah: true } } } }),
    prisma.role.findMany({ orderBy: { id: 'asc' } }),
    prisma.rumah.findMany({ orderBy: { kode: 'asc' }, select: { id: true, kode: true } }),
  ]);
  res.render('admin/users', { title: 'Akun pengguna', users, roles, rumah });
});

const userSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, 'Username 3-32 karakter (huruf kecil, angka, . _ -)'),
  nama: z.string().trim().min(2).max(80),
  noWa: z.string().trim().max(20).optional(),
  password: z.string().optional(),
});

function rolesDariForm(body) { return [].concat(body.roles || []).map(Number).filter(Boolean); }
function rumahDariForm(body) { return [].concat(body.rumah || []).map(Number).filter(Boolean); }

r.post('/users', requirePerm('user.kelola'), async (req, res) => {
  const b = userSchema.parse(req.body);
  if (!password.validateStrength(b.password)) throw new AppError('Password minimal 10 karakter.');
  const roleIds = rolesDariForm(req.body);
  const u = await prisma.user.create({
    data: {
      username: b.username, nama: b.nama, noWa: normWa(b.noWa), passwordHash: await password.hash(b.password),
      roles: { create: roleIds.map((roleId) => ({ roleId })) }, rumah: { create: rumahDariForm(req.body).map((rumahId) => ({ rumahId })) },
    },
  });
  await audit(req, 'USER_BARU', 'User', u.id, { username: u.username, roleIds });
  req.flash('success', `Akun ${u.username} dibuat.`);
  res.redirect('/admin/users');
});

r.post('/users/:id', requirePerm('user.kelola'), async (req, res) => {
  const uid = Number(req.params.id);
  const target = await prisma.user.findUnique({ where: { id: uid } });
  if (!target) throw new AppError('Akun tidak ditemukan', 404);
  // Super Admin hanya bisa diubah oleh dirinya sendiri; pengurus tidak bisa menurunkannya.
  if (target.isSuperAdmin && req.user.id !== target.id) throw new AppError('Akun Super Admin tidak dapat diubah oleh akun lain.', 403);
  const b = userSchema.omit({ username: true }).parse(req.body);
  const data = { nama: b.nama, noWa: normWa(b.noWa) };
  if (!target.isSuperAdmin) data.aktif = req.body.aktif === 'on';
  if (b.password) {
    if (!password.validateStrength(b.password)) throw new AppError('Password minimal 10 karakter.');
    data.passwordHash = await password.hash(b.password);
  }
  const roleIds = rolesDariForm(req.body);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: uid }, data });
    if (!target.isSuperAdmin) {
      await tx.userRole.deleteMany({ where: { userId: uid } });
      if (roleIds.length) await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: uid, roleId })) });
    }
    await tx.userRumah.deleteMany({ where: { userId: uid } });
    const rumah = rumahDariForm(req.body);
    if (rumah.length) await tx.userRumah.createMany({ data: rumah.map((rumahId) => ({ userId: uid, rumahId })) });
    if (data.aktif === false || b.password) await tx.$executeRaw`DELETE FROM "session" WHERE (sess->>'userId')::int = ${uid}`;
  });
  await audit(req, 'USER_UBAH', 'User', uid, { nama: b.nama, aktif: data.aktif, roleIds, gantiPassword: Boolean(b.password) });
  req.flash('success', 'Akun diperbarui.');
  res.redirect('/admin/users');
});

// ── Role & permission (Super Admin) ──
r.get('/roles', requireSuperAdmin, async (req, res) => {
  const [roles, perms] = await Promise.all([
    prisma.role.findMany({ orderBy: { id: 'asc' }, include: { permissions: true } }),
    prisma.permission.findMany({ orderBy: [{ grup: 'asc' }, { kode: 'asc' }] }),
  ]);
  res.render('admin/roles', { title: 'Role & hak akses', roles, perms });
});

r.post('/roles', requireSuperAdmin, async (req, res) => {
  const roles = await prisma.role.findMany();
  const valid = new Set((await prisma.permission.findMany()).map((p) => p.kode));
  await prisma.$transaction(async (tx) => {
    for (const role of roles) {
      const chosen = [].concat(req.body[`r${role.id}`] || []).filter((p) => valid.has(p));
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (chosen.length) await tx.rolePermission.createMany({ data: chosen.map((permissionKode) => ({ roleId: role.id, permissionKode })) });
    }
    if (req.body.newKode) {
      const kode = String(req.body.newKode).trim().toUpperCase();
      if (!/^[A-Z_]{3,30}$/.test(kode)) throw new AppError('Kode role tidak valid.');
      await tx.role.create({ data: { kode, nama: String(req.body.newNama || kode).slice(0, 60) } });
    }
  });
  await audit(req, 'ROLE_UBAH', 'Role', null, req.body);
  req.flash('success', 'Hak akses disimpan.');
  res.redirect('/admin/roles');
});

// ── Audit ──
r.get('/audit', requirePerm('audit.lihat'), async (req, res) => {
  const where = { ...(req.query.entitas ? { entitas: req.query.entitas } : {}), ...(req.query.aksi ? { aksi: req.query.aksi } : {}) };
  const list = await prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: 300 });
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  res.render('admin/audit', { title: 'Audit log', list, userMap: Object.fromEntries(users.map((u) => [u.id, u.username])) });
});

// ── WhatsApp ──
r.get('/wa', requirePerm('wa.kelola'), async (req, res) => {
  const list = await prisma.waPesan.findMany({ where: req.query.status ? { status: req.query.status } : {}, orderBy: { id: 'desc' }, take: 200 });
  res.render('admin/wa', { title: 'WhatsApp', list, st: wa.status(), waMeUrl: wa.waMeUrl });
});

r.post('/wa/pengingat', requirePerm('wa.kelola'), async (req, res) => {
  const n = await jobs.kirimPengingat(`manual-${Date.now()}`);
  await audit(req, 'WA_PENGINGAT_MANUAL', 'WaPesan', null, { n });
  req.flash('success', `${n} pengingat diantrekan.`);
  res.redirect('/admin/wa');
});

r.post('/wa/:id/:aksi', requirePerm('wa.kelola'), async (req, res) => {
  const id = Number(req.params.id);
  if (req.params.aksi === 'retry') await prisma.waPesan.update({ where: { id }, data: { status: 'ANTRI', nextRetryAt: new Date(), percobaan: 0 } });
  else if (req.params.aksi === 'manual') await prisma.waPesan.update({ where: { id }, data: { status: 'TERKIRIM', sentAt: new Date(), error: 'dikirim manual via wa.me' } });
  else if (req.params.aksi === 'batal') await prisma.waPesan.update({ where: { id }, data: { status: 'GAGAL', error: 'dibatalkan' } });
  res.redirect('/admin/wa');
});

// ── Pengaturan (Super Admin) ──
r.get('/pengaturan', requireSuperAdmin, async (req, res) => {
  res.render('admin/pengaturan', { title: 'Pengaturan', s: await settings.all(), keys: Object.keys(settings.DEFAULTS) });
});

r.post('/pengaturan', requireSuperAdmin, async (req, res) => {
  const changed = {};
  for (const k of Object.keys(settings.DEFAULTS)) {
    if (req.body[k] === undefined) continue;
    const v = String(req.body[k]).slice(0, 2000);
    await settings.set(k, v);
    changed[k] = v;
  }
  await audit(req, 'PENGATURAN_UBAH', 'Pengaturan', null, changed);
  req.flash('success', 'Pengaturan disimpan.');
  res.redirect('/admin/pengaturan');
});

module.exports = r;
