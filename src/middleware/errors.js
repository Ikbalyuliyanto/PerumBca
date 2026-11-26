'use strict';
const multer = require('multer');

module.exports = (err, req, res, _next) => {
  let status = err.status || 500;
  let message = err.expose ? err.message : 'Terjadi kesalahan pada server.';
  if (err instanceof multer.MulterError) { status = 400; message = err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran file terlalu besar.' : 'Upload gagal.'; }
  if (err.name === 'ZodError') { status = 400; message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '); }
  if (status >= 500) console.error(err);
  if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/') || req.xhr) {
    return res.status(status).json({ error: message });
  }
  // POST form: kembali ke halaman sebelumnya dengan pesan.
  if (req.method === 'POST' && status < 500 && req.session) {
    req.session.flash = { type: 'danger', msg: message };
    return res.redirect(req.get('referer') || '/');
  }
  res.status(status).render('errors/error', { title: 'Kesalahan', status, message });
};
