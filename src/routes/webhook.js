'use strict';
const express = require('express');
const prisma = require('../lib/prisma');
const midtrans = require('../modules/midtrans/service');
const wa = require('../modules/wa/service');

const r = express.Router();

// Notifikasi HTTP(S) Midtrans. Selalu balas 200 untuk notifikasi yang sudah diproses
// agar Midtrans tidak mengulang; error verifikasi dibalas 4xx.
r.post('/midtrans', async (req, res) => {
  try {
    const out = await midtrans.handleNotification(req.body || {});
    if (out.posted) wa.antreKonfirmasi(out.pembayaranId).catch(() => {});
    await prisma.auditLog.create({ data: { aksi: 'MIDTRANS_NOTIF', entitas: 'MidtransTransaksi', entitasId: String(req.body?.order_id || ''), data: { status: req.body?.transaction_status, ...out } } });
    res.json({ ok: true });
  } catch (e) {
    console.error('[midtrans] webhook:', e.message);
    res.status(e.status || 500).json({ error: e.expose ? e.message : 'error' });
  }
});

module.exports = r;
