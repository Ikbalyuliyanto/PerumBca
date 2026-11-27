'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const helmet = require('helmet');
const config = require('./config');
const util = require('./lib/util');
const { loadUser } = require('./middleware/auth');
const { csrfToken, csrfProtect } = require('./middleware/csrf');
const errorHandler = require('./middleware/errors');

// Pool kecil khusus sesi (Postgres STB max_connections kecil).
let _pool = null;
function sessionPool() {
  if (_pool) return _pool;
  const url = new URL(config.DATABASE_URL);
  for (const k of ['connection_limit', 'pool_timeout', 'schema', 'pgbouncer']) url.searchParams.delete(k);
  const { Pool } = require('pg');
  _pool = new Pool({ connectionString: url.toString(), max: 2, idleTimeoutMillis: 30000 });
  return _pool;
}

function createApp() {
  const app = express();
  app.set('trust proxy', config.TRUST_PROXY === 'true' ? true : config.TRUST_PROXY);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.disable('x-powered-by');

  const midtrans = config.MIDTRANS_PRODUCTION ? ['https://app.midtrans.com', 'https://api.midtrans.com'] : ['https://app.sandbox.midtrans.com', 'https://api.sandbox.midtrans.com'];
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...midtrans, 'https://*.midtrans.com', 'https://*.veritrans.co.id'],
        frameSrc: ["'self'", ...midtrans, 'https://*.midtrans.com', 'https://*.veritrans.co.id', 'https://*.gopay.co.id'],
        connectSrc: ["'self'", ...midtrans, 'https://*.midtrans.com'],
        imgSrc: ["'self'", 'data:', 'https://*.midtrans.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.COOKIE_SECURE ? [] : null,
      },
    },
    hsts: config.COOKIE_SECURE,
  }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
  app.use('/vendor/bootstrap', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist'), { maxAge: '30d' }));
  app.use('/vendor/icons', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap-icons', 'font'), { maxAge: '30d' }));

  // Webhook Midtrans: sebelum session/CSRF.
  app.use('/webhook', express.json({ limit: '100kb' }), require('./routes/webhook'));

  app.use(express.urlencoded({ extended: true, limit: '200kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(session({
    store: new PgStore({ pool: sessionPool(), tableName: 'session', createTableIfMissing: false, pruneSessionInterval: 3600 }),
    name: 'bca.sid',
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  }));
  app.use(csrfToken);
  app.use(csrfProtect);
  app.use(loadUser);

  app.use((req, res, next) => {
    res.locals.flash = req.session.flash;
    delete req.session.flash;
    res.locals.u = util;
    res.locals.appName = config.APP_NAME;
    res.locals.path = req.path;
    res.locals.query = req.query;
    req.flash = (type, msg) => { req.session.flash = { type, msg }; };
    next();
  });

  app.use(require('./routes/auth'));
  app.use(require('./routes/warga'));
  app.use('/admin', require('./routes/admin'));
  app.use(require('./routes/files'));

  app.use((req, res) => res.status(404).render('errors/error', { title: 'Tidak ditemukan', status: 404, message: 'Halaman tidak ditemukan.' }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
