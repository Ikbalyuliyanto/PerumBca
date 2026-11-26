'use strict';
// Impor data rumah dari CSV hasil ekstraksi sheet. Tidak pernah mengarang data:
// sel kosong tetap kosong, baris ragu ditandai PERLU_VERIFIKASI.
const prisma = require('../../lib/prisma');
const { AppError, normWa } = require('../../lib/util');

const BULAN_COL = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agt', 'sep', 'okt', 'nov', 'des'];
const KONDISI = { ADA_PENGHUNI: 'AKTIF', AKTIF: 'AKTIF', KOSONG: 'KOSONG', TIDAK_DITEMPATI: 'TIDAK_DITEMPATI', PIHAK_KEDUA: 'PIHAK_KEDUA' };

/** Parser CSV sederhana (mendukung tanda kutip). */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/**
 * Impor CSV. Kolom: no_urut,nama,blok,nomor,status,jan..des,keterangan,verifikasi,catatan[,no_wa]
 * opts.tahun = tahun kolom bulan; opts.komponen = kode komponen yang diwakili centang.
 */
async function imporCsv(text, { tahun, komponen, sumber, userId }) {
  const rows = parseCsv(text);
  if (!rows.length) throw new AppError('CSV kosong.');
  for (const k of ['blok', 'nomor', 'status']) if (!(k in rows[0])) throw new AppError(`Kolom "${k}" tidak ada di CSV.`);
  const hasil = { rumahBaru: 0, rumahAda: 0, penghuni: 0, riwayat: 0, perluVerifikasi: 0, error: [] };
  const mulai = `${tahun}-01`;

  for (const [idx, r] of rows.entries()) {
    const blokKode = r.blok.toUpperCase();
    const nomor = r.nomor.toUpperCase();
    const kondisi = KONDISI[(r.status || '').toUpperCase()];
    if (!blokKode || !nomor || !kondisi) { hasil.error.push(`Baris ${idx + 2}: blok/nomor/status tidak valid`); continue; }
    const ragu = (r.verifikasi || '').toUpperCase() === 'PERLU_VERIFIKASI';
    if (ragu) hasil.perluVerifikasi++;

    await prisma.$transaction(async (tx) => {
      const blok = await tx.blok.upsert({ where: { kode: blokKode }, update: {}, create: { kode: blokKode, urutan: blokKode.charCodeAt(0) } });
      const kode = `${blokKode}${nomor}`;
      let rumah = await tx.rumah.findUnique({ where: { kode } });
      const catatan = [r.keterangan && `Ket. sumber: ${r.keterangan}`, r.catatan].filter(Boolean).join(' | ') || null;
      if (!rumah) {
        rumah = await tx.rumah.create({ data: { blokId: blok.id, nomor, kode, noUrutSumber: Number(r.no_urut) || null, verifikasi: ragu ? 'PERLU_VERIFIKASI' : 'OK', catatan } });
        hasil.rumahBaru++;
      } else hasil.rumahAda++;

      const ada = await tx.statusRumah.findUnique({ where: { rumahId_berlakuMulai: { rumahId: rumah.id, berlakuMulai: mulai } } });
      if (!ada) await tx.statusRumah.create({ data: { rumahId: rumah.id, kondisi, berlakuMulai: mulai, komponenWajib: [], catatan: `Impor ${sumber}`, createdById: userId } });

      if (r.nama) {
        const aktif = await tx.penghunian.findFirst({ where: { rumahId: rumah.id, selesai: null } });
        if (!aktif) {
          await tx.penghunian.create({ data: { rumahId: rumah.id, nama: r.nama, noWa: normWa(r.no_wa), mulai: new Date(`${tahun}-01-01`), verifikasi: ragu ? 'PERLU_VERIFIKASI' : 'OK', catatan: `Impor ${sumber}` } });
          hasil.penghuni++;
        }
      }
      for (const [i, col] of BULAN_COL.entries()) {
        if (!(col in r)) continue;
        const periode = `${tahun}-${String(i + 1).padStart(2, '0')}`;
        await tx.riwayatImpor.upsert({
          where: { rumahId_periode_kodeKomponen_sumber: { rumahId: rumah.id, periode, kodeKomponen: komponen, sumber } },
          update: { terbayar: r[col] === '1', verifikasi: ragu ? 'PERLU_VERIFIKASI' : 'OK' },
          create: { rumahId: rumah.id, periode, kodeKomponen: komponen, sumber, terbayar: r[col] === '1', verifikasi: ragu ? 'PERLU_VERIFIKASI' : 'OK' },
        });
        hasil.riwayat++;
      }
    });
  }
  return hasil;
}

module.exports = { parseCsv, imporCsv, BULAN_COL };
