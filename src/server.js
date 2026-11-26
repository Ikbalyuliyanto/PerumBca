'use strict';
const config = require('./config');
const { createApp } = require('./app');
const prisma = require('./lib/prisma');
const jobs = require('./jobs');
const wa = require('./modules/wa/service');

async function main() {
  await prisma.$connect();
  const app = createApp();
  const server = app.listen(config.PORT, () => console.log(`[app] ${config.APP_NAME} di port ${config.PORT} (${config.NODE_ENV})`));
  wa.initProvider().catch((e) => console.error('[wa] gagal start:', e.message));
  if (config.CRON_ENABLED) jobs.start();
  const stop = async () => { server.close(); await prisma.$disconnect(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
main().catch((e) => { console.error(e); process.exit(1); });
