'use strict';
// Provider Baileys (opsional). Aktif bila WA_PROVIDER=baileys.
// Scan QR dari halaman Admin → WhatsApp, atau dari log container.
const path = require('path');
const config = require('../../config');

let sock = null;
let connected = false;
let lastQr = null;
let info = 'Memulai…';

async function start() {
  let baileys;
  try { baileys = require('baileys'); } catch { info = 'Paket baileys tidak terpasang'; return; }
  const makeWASocket = baileys.default || baileys.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;
  const { state, saveCreds } = await useMultiFileAuthState(path.resolve(config.WA_AUTH_DIR));
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch { /* pakai default */ }
  const silent = { level: 'silent', child() { return this; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
  sock = makeWASocket({ auth: state, version, logger: silent, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (u.qr) {
      lastQr = u.qr; info = 'Menunggu scan QR';
      try { require('qrcode-terminal').generate(u.qr, { small: true }); } catch { console.log('[wa] QR:', u.qr); }
    }
    if (u.connection === 'open') { connected = true; lastQr = null; info = `Terhubung sebagai ${sock.user?.id?.split(':')[0] || '?'}`; console.log('[wa]', info); }
    if (u.connection === 'close') {
      connected = false;
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) { info = 'Logout — hapus folder auth lalu scan ulang'; return; }
      info = `Terputus (${code ?? '?'}), menyambung ulang…`;
      setTimeout(() => start().catch((e) => console.error('[wa] restart gagal', e)), 5000);
    }
  });
}

async function send(no, text) {
  if (!sock || !connected) throw new Error('WhatsApp belum terhubung');
  const jid = `${no}@s.whatsapp.net`;
  const [r] = await sock.onWhatsApp(jid);
  if (!r?.exists) throw new Error('Nomor tidak terdaftar di WhatsApp');
  await sock.sendMessage(r.jid, { text });
}

module.exports = { start, send, status: () => ({ connected, info, qr: lastQr }) };
