'use strict';
const crypto = require('crypto');
const { AppError } = require('../lib/util');

// Synchronizer token per sesi. Form multipart diverifikasi setelah multer (verifyCsrf).
exports.csrfToken = (req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  res.locals.csrfToken = req.session.csrf;
  next();
};

function check(req) {
  const sent = String(req.body?._csrf || req.get('x-csrf-token') || '');
  const real = req.session?.csrf || '';
  return real.length > 0 && sent.length === real.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(real));
}

exports.csrfProtect = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/webhook/')) return next();
  if (req.is('multipart/form-data')) return next(); // dicek oleh verifyCsrf setelah multer
  if (!check(req)) return next(new AppError('Sesi formulir kedaluwarsa. Muat ulang halaman lalu coba lagi.', 403));
  next();
};

exports.verifyCsrf = (req, res, next) => (check(req) ? next() : next(new AppError('Token formulir tidak valid. Muat ulang halaman.', 403)));
