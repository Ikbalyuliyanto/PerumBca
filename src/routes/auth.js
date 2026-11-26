'use strict';
const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const password = require('../lib/password');
const { audit } = require('../lib/audit');
const { requireLogin, isStaff } = require('../middleware/auth');

const r = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.username || '').toLowerCase()}`,
  handler: (req, res) => res.status(429).render('auth/login', { title: 'Masuk', error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.', username: req.body?.username || '' }),
});

r.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.redirect(isStaff(req.user) ? '/admin' : '/warga');
});

r.get('/login', (req, res) => (req.user ? res.redirect('/') : res.render('auth/login', { title: 'Masuk', error: null, username: '' })));

let DUMMY = null; // hash acak untuk menyamakan waktu respons user tak dikenal
password.hash(require('crypto').randomBytes(16).toString('hex')).then((h) => { DUMMY = h; });

r.post('/login', loginLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase().slice(0, 64);
  const pw = String(req.body.password || '').slice(0, 200);
  const user = username ? await prisma.user.findUnique({ where: { username } }) : null;
  const ok = await password.verify(user?.passwordHash || DUMMY, pw); // waktu respons seragam
  if (!user || !ok || !user.aktif) {
    await audit(req, 'LOGIN_GAGAL', 'User', user?.id, { username });
    return res.status(401).render('auth/login', { title: 'Masuk', error: 'Username atau password salah.', username });
  }
  const returnTo = req.session.returnTo;
  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.userId = user.id;
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});
    audit({ ip: req.ip, user: { id: user.id } }, 'LOGIN', 'User', user.id).catch(() => {});
    req.session.save(() => res.redirect(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'));
  });
});

r.post('/logout', (req, res) => {
  req.session.destroy(() => { res.clearCookie('bca.sid'); res.redirect('/login'); });
});

r.get('/akun/password', requireLogin, (req, res) => res.render('auth/password', { title: 'Ganti password' }));
r.post('/akun/password', requireLogin, async (req, res) => {
  const body = z.object({ lama: z.string(), baru: z.string().min(10, 'Password baru minimal 10 karakter'), ulang: z.string() }).parse(req.body);
  if (body.baru !== body.ulang) { req.flash('danger', 'Konfirmasi password tidak sama.'); return res.redirect('/akun/password'); }
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!(await password.verify(user.passwordHash, body.lama))) { req.flash('danger', 'Password lama salah.'); return res.redirect('/akun/password'); }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await password.hash(body.baru) } });
  await audit(req, 'GANTI_PASSWORD', 'User', user.id);
  req.flash('success', 'Password berhasil diganti.');
  res.redirect('/');
});

module.exports = r;
