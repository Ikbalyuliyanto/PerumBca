'use strict';
const prisma = require('../lib/prisma');
const { AppError } = require('../lib/util');

/** Muat user + permission dari sesi ke req.user / res.locals. */
exports.loadUser = async (req, res, next) => {
  res.locals.user = null;
  res.locals.can = () => false;
  req.can = () => false;
  const uid = req.session?.userId;
  if (!uid) return next();
  const user = await prisma.user.findUnique({
    where: { id: uid },
    include: { roles: { include: { role: { include: { permissions: true } } } }, rumah: { select: { rumahId: true } } },
  });
  if (!user || !user.aktif) { delete req.session.userId; return next(); }
  const perms = new Set();
  const roles = [];
  for (const ur of user.roles) { roles.push(ur.role.kode); for (const rp of ur.role.permissions) perms.add(rp.permissionKode); }
  req.user = { id: user.id, username: user.username, nama: user.nama, isSuperAdmin: user.isSuperAdmin, roles, perms, rumahIds: user.rumah.map((r) => r.rumahId) };
  req.can = (p) => user.isSuperAdmin || perms.has(p);
  res.locals.user = req.user;
  res.locals.can = req.can;
  res.locals.isStaff = exports.isStaff(req.user);
  next();
};

exports.requireLogin = (req, res, next) => {
  if (req.user) return next();
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  res.redirect('/login');
};

/** Wajib punya salah satu permission. */
exports.requirePerm = (...perms) => (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  if (perms.some((p) => req.can(p))) return next();
  next(new AppError('Anda tidak memiliki izin untuk halaman ini.', 403));
};

exports.requireSuperAdmin = (req, res, next) => {
  if (req.user?.isSuperAdmin) return next();
  next(new AppError('Khusus Super Admin.', 403));
};

/** Apakah user staf (punya izin admin apa pun)? */
exports.isStaff = (u) => Boolean(u && (u.isSuperAdmin || u.perms.size > 0));
