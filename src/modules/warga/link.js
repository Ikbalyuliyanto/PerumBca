'use strict';
// Link akses rumah: /r/<payload>.<hmac>. Tidak bisa ditebak tanpa SESSION_SECRET,
// dapat dicabut dengan menaikkan Rumah.tokenVersi.
const crypto = require('crypto');
const config = require('../../config');
const prisma = require('../../lib/prisma');

const KEY = crypto.createHash('sha256').update('rumah-link:' + config.SESSION_SECRET).digest();

function sign(payload) {
  return crypto.createHmac('sha256', KEY).update(payload).digest('base64url').slice(0, 32);
}

exports.tokenFor = (rumah) => {
  const payload = Buffer.from(`${rumah.id}:${rumah.tokenVersi}`).toString('base64url');
  return `${payload}.${sign(payload)}`;
};

exports.urlFor = (rumah) => `${config.APP_URL.replace(/\/$/, '')}/r/${exports.tokenFor(rumah)}`;

/** Kembalikan rumah bila token valid & belum dicabut, selain itu null. */
exports.resolve = async (token) => {
  if (typeof token !== 'string' || token.length > 120) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expect = sign(payload);
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  const [id, versi] = Buffer.from(payload, 'base64url').toString().split(':').map(Number);
  if (!Number.isInteger(id)) return null;
  const rumah = await prisma.rumah.findUnique({ where: { id }, include: { blok: true } });
  if (!rumah || rumah.tokenVersi !== versi || !rumah.aktif) return null;
  return rumah;
};
