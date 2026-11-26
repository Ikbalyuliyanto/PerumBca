'use strict';
// Impor CSV dari terminal:
//   node src/modules/impor/cli.js data.csv --tahun 2026 --komponen SAMPAH --sumber sheet-kebersihan-2026
const fs = require('fs');
const prisma = require('../../lib/prisma');
const { imporCsv } = require('./service');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; }

(async () => {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) { console.error('Pemakaian: node src/modules/impor/cli.js <file.csv> [--tahun 2026] [--komponen SAMPAH] [--sumber nama]'); process.exit(1); }
  const tahun = Number(arg('tahun', new Date().getFullYear()));
  const hasil = await imporCsv(fs.readFileSync(file, 'utf8'), { tahun, komponen: arg('komponen', 'SAMPAH').toUpperCase(), sumber: arg('sumber', `sheet-${tahun}`), userId: null });
  await prisma.auditLog.create({ data: { aksi: 'IMPOR_CSV_CLI', entitas: 'Rumah', data: hasil } });
  console.log(JSON.stringify(hasil, null, 2));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
