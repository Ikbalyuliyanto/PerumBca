'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const prisma = require('../lib/prisma');
const { AppError } = require('../lib/util');

const dir = path.resolve(config.UPLOAD_DIR);
fs.mkdirSync(dir, { recursive: true });

const IMG = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
const CSV = { 'text/csv': '.csv', 'application/vnd.ms-excel': '.csv', 'text/plain': '.csv' };

function make(allowed) {
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + (allowed[file.mimetype] || '')),
    }),
    limits: { fileSize: config.UPLOAD_MAX_MB * 1024 * 1024, files: 2 },
    fileFilter: (req, file, cb) => (allowed[file.mimetype] ? cb(null, true) : cb(new AppError('Tipe file tidak didukung.'))),
  });
}
// File disimpan di luar folder publik dengan nama acak; diakses lewat route berizin.
exports.upload = make(IMG);
exports.uploadCsv = make(CSV);
exports.UPLOAD_DIR = dir;

// Validasi magic bytes supaya file berbahaya yang mengaku gambar ditolak.
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  return null;
}

/** Simpan metadata file ke DB setelah validasi isi. */
exports.saveFile = async (file, { userId = null, rumahId = null } = {}, db = prisma) => {
  if (!file) return null;
  const buf = fs.readFileSync(file.path);
  const real = sniff(buf);
  if (!real) { fs.unlinkSync(file.path); throw new AppError('Isi file tidak valid. Unggah foto (JPG/PNG/WEBP) atau PDF.'); }
  return db.fileUpload.create({
    data: {
      path: path.basename(file.path), namaAsli: file.originalname.slice(0, 200), mime: real, ukuran: file.size,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'), uploadedById: userId, rumahId,
    },
  });
};
