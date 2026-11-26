'use strict';
// Akses file bukti dengan pemeriksaan izin (tidak ada folder upload publik).
const path = require('path');
const express = require('express');
const prisma = require('../lib/prisma');
const { UPLOAD_DIR } = require('../middleware/upload');
const { AppError } = require('../lib/util');

const r = express.Router();

async function kirim(res, f) {
  res.setHeader('Content-Type', f.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', `inline; filename="file-${f.id}${path.extname(f.path)}"`);
  res.sendFile(path.join(UPLOAD_DIR, path.basename(f.path)));
}

r.get('/file/:id', async (req, res) => {
  if (!req.user) throw new AppError('Silakan login.', 401);
  const f = await prisma.fileUpload.findUnique({ where: { id: Number(req.params.id) || 0 } });
  if (!f) throw new AppError('File tidak ditemukan.', 404);
  const staff = ['pembayaran.lihat', 'pengeluaran.lihat', 'ledger.lihat'].some((p) => req.can(p));
  const milikWarga = f.rumahId && req.user.rumahIds.includes(f.rumahId);
  if (!staff && !milikWarga) throw new AppError('Tidak berhak mengakses file ini.', 403);
  await kirim(res, f);
});

module.exports = r;
module.exports.kirim = kirim;
