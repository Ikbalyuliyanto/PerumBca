'use strict';
// Uji HTTP end-to-end: login, CSRF, RBAC, portal warga.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma, seedDasar } = require('./helpers');
const password = require('../src/lib/password');
const link = require('../src/modules/warga/link');
const { PERMISSIONS, ROLES } = require('../src/config/permissions');

let server, base, D;

class Client {
  constructor() { this.cookie = ''; }
  async req(path, { method = 'GET', form = null } = {}) {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie: this.cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const sc = res.headers.getSetCookie?.() || [];
    for (const c of sc) { const kv = c.split(';')[0]; if (kv.startsWith('bca.sid=')) this.cookie = kv; }
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }
  async csrf(path) { const r = await this.req(path); return (r.text.match(/name="_csrf" value="([^"]+)"/) || [])[1]; }
  async login(username, pw) { const t = await this.csrf('/login'); return this.req('/login', { method: 'POST', form: { _csrf: t, username, password: pw } }); }
}

before(async () => {
  D = await seedDasar();
  for (const [kode, nama, grup] of PERMISSIONS) await prisma.permission.create({ data: { kode, nama, grup } });
  for (const [kode, def] of Object.entries(ROLES)) await prisma.role.create({ data: { kode, nama: def.nama, permissions: { create: def.perms.map((p) => ({ permissionKode: p })) } } });
  const hash = await password.hash('rahasia-sekali-123');
  await prisma.user.create({ data: { username: 'super', nama: 'Super', passwordHash: hash, isSuperAdmin: true } });
  const bend = await prisma.role.findUnique({ where: { kode: 'BENDAHARA' } });
  await prisma.user.update({ where: { id: D.bendahara.id }, data: { passwordHash: hash, roles: { create: { roleId: bend.id } } } });
  const warga = await prisma.role.findUnique({ where: { kode: 'WARGA' } });
  await prisma.user.create({ data: { username: 'warga1', nama: 'Warga', passwordHash: hash, roles: { create: { roleId: warga.id } }, rumah: { create: { rumahId: D.a1.id } } } });
  const { createApp } = require('../src/app');
  await new Promise((ok) => { server = createApp().listen(0, ok); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await prisma.$disconnect(); });

test('halaman admin butuh login', async () => {
  const r = await new Client().req('/admin');
  assert.equal(r.status, 302);
  assert.equal(r.location, '/login');
});

test('POST tanpa token CSRF ditolak', async () => {
  const c = new Client();
  await c.req('/login');
  const r = await c.req('/login', { method: 'POST', form: { username: 'super', password: 'rahasia-sekali-123' } });
  assert.equal(r.status, 302); // diarahkan kembali dengan pesan error, tidak login
  const after = await c.req('/admin');
  assert.equal(after.location, '/login');
});

test('password salah ditolak; benar → masuk dashboard', async () => {
  const c = new Client();
  assert.equal((await c.login('super', 'salah-password')).status, 401);
  const ok = await c.login('super', 'rahasia-sekali-123');
  assert.equal(ok.status, 302);
  const dash = await c.req('/admin');
  assert.equal(dash.status, 200);
  assert.match(dash.text, /Dashboard/);
});

test('RBAC: bendahara tidak bisa ke pengaturan/akun; warga tidak bisa ke admin', async () => {
  const b = new Client();
  await b.login('bendahara', 'rahasia-sekali-123');
  assert.equal((await b.req('/admin/pembayaran')).status, 200);
  assert.equal((await b.req('/admin/pengaturan')).status, 403);
  assert.equal((await b.req('/admin/users')).status, 403);
  const w = new Client();
  await w.login('warga1', 'rahasia-sekali-123');
  assert.equal((await w.req('/admin')).status, 403);
  const home = await w.req('/warga');
  assert.equal(home.status, 302);
  assert.match(home.location, /^\/r\//);
});

test('bendahara tidak bisa mengubah akun Super Admin', async () => {
  const sup = await prisma.user.findUnique({ where: { username: 'super' } });
  const userRole = await prisma.role.findUnique({ where: { kode: 'BENDAHARA' } });
  await prisma.rolePermission.create({ data: { roleId: userRole.id, permissionKode: 'user.kelola' } });
  const b = new Client();
  await b.login('bendahara', 'rahasia-sekali-123');
  const t = await b.csrf('/admin/users');
  const r = await b.req(`/admin/users/${sup.id}`, { method: 'POST', form: { _csrf: t, nama: 'Diambil alih', password: 'password-baru-123' } });
  assert.equal(r.status, 302);
  const after = await prisma.user.findUnique({ where: { id: sup.id } });
  assert.equal(after.nama, 'Super');
  assert.equal(after.passwordHash, sup.passwordHash);
  await prisma.rolePermission.delete({ where: { roleId_permissionKode: { roleId: userRole.id, permissionKode: 'user.kelola' } } });
});

test('portal warga via link: tampil, link palsu 404, tidak bocor rumah lain', async () => {
  const iuran = require('../src/modules/iuran/service');
  await iuran.generateTagihan('2026-01');
  const rumah = await prisma.rumah.findUnique({ where: { id: D.a1.id } });
  const c = new Client();
  const ok = await c.req(`/r/${link.tokenFor(rumah)}`);
  assert.equal(ok.status, 200);
  assert.match(ok.text, /Rumah A1/);
  assert.doesNotMatch(ok.text, /Rumah A2/);
  assert.equal((await c.req('/r/abc.def')).status, 404);
});

test('semua halaman admin & warga ter-render tanpa error (Super Admin)', async () => {
  const c = new Client();
  await c.login('super', 'rahasia-sekali-123');
  const pages = ['/admin', '/admin/rumah', `/admin/rumah/${D.a1.id}`, '/admin/rumah/baru', '/admin/pengajuan', '/admin/impor', '/admin/kebijakan', '/admin/kebijakan/baru',
    '/admin/tagihan', '/admin/tagihan?tunggakan=1', '/admin/pembayaran', '/admin/pembayaran/baru', `/admin/pembayaran/baru?rumah=${D.a1.id}`, '/admin/ledger', '/admin/pengeluaran',
    '/admin/laporan', '/admin/laporan?format=csv', '/admin/users', '/admin/roles', '/admin/audit', '/admin/wa', '/admin/pengaturan', '/akun/password', '/r/selesai'];
  for (const p of pages) {
    const r = await c.req(p);
    assert.equal(r.status, 200, `${p} → ${r.status}: ${r.text.slice(0, 300)}`);
  }
  // bayar tunai lewat form HTTP lalu buka detail & kuitansi
  const t = await c.csrf(`/admin/pembayaran/baru?rumah=${D.a1.id}`);
  const post = await c.req('/admin/pembayaran', { method: 'POST', form: { _csrf: t, rumahId: D.a1.id, nominal: '50.000', mode: 'fifo' } });
  assert.equal(post.status, 302);
  assert.match(post.location, /^\/admin\/pembayaran\/\d+$/);
  assert.equal((await c.req(post.location)).status, 200);
  const pid = post.location.split('/').pop();
  assert.equal((await c.req(`/admin/kuitansi/${pid}`)).status, 200);
});
