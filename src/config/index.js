'use strict';
require('dotenv').config({ quiet: true });
const { z } = require('zod');

const bool = (d) => z.enum(['true', 'false', '1', '0']).default(d).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET minimal 32 karakter'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  APP_NAME: z.string().default('Iuran Bumi Cikarang Asri'),
  COOKIE_SECURE: bool('false'),
  TRUST_PROXY: z.string().default('loopback'),
  UPLOAD_DIR: z.string().default('./storage/uploads'),
  UPLOAD_MAX_MB: z.coerce.number().default(5),
  MIDTRANS_SERVER_KEY: z.string().default(''),
  MIDTRANS_CLIENT_KEY: z.string().default(''),
  MIDTRANS_PRODUCTION: bool('false'),
  WA_PROVIDER: z.enum(['none', 'baileys']).default('none'),
  WA_AUTH_DIR: z.string().default('./storage/wa-auth'),
  CRON_ENABLED: bool('true'),
  TZ: z.string().default('Asia/Jakarta'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Konfigurasi .env tidak valid:');
  for (const i of parsed.error.issues) console.error(` - ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
const config = parsed.data;
config.isProd = config.NODE_ENV === 'production';
config.midtransEnabled = Boolean(config.MIDTRANS_SERVER_KEY && config.MIDTRANS_CLIENT_KEY);
module.exports = config;
