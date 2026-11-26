# Rancangan Sistem Iuran Bumi Cikarang Asri

## 1. Prinsip
- **Rumah = identitas tetap** (`blok` + `nomor`, unik). Penghuni hanya relasi berwaktu ke rumah.
- **Ledger append-only.** Transaksi yang sudah diposting tidak bisa di-UPDATE/DELETE (ditegakkan aplikasi + trigger DB); koreksi = entri pembalik.
- **Snapshot kebijakan.** Baris tagihan menyalin nama komponen, nominal, dan dana saat dibuat.
- **Uang dalam rupiah bulat** (`BigInt`/`Int`, tanpa float).
- Semua operasi keuangan dalam `prisma.$transaction` dengan isolasi Serializable + lock baris tagihan.

## 2. ERD (ringkas)

```
User ─┬─< UserRole >── Role ─< RolePermission >── Permission
      ├─< Session
      └─ (resident_link) ── Rumah            (akun WARGA terikat ke 1+ rumah)

Blok ─< Rumah ─┬─< Penghunian (nama, no_wa, mulai, selesai, status_verifikasi)
               ├─< StatusRumah  (AKTIF|KOSONG|TIDAK_DITEMPATI|PIHAK_KEDUA, berlaku_mulai)
               │      └─< StatusKomponenWajib >── KomponenIuran   (untuk KOSONG dll.)
               ├─< PengajuanPerubahan (nama/WA, status, disetujui_oleh)
               ├─  TokenAkses (hash token link tagihan, kedaluwarsa, dicabut)
               ├─< ImporSumber (no_urut_sumber, data_mentah, PERLU_VERIFIKASI)
               └─< Tagihan (periode YYYY-MM, UNIQUE(rumah_id, periode), total, terbayar, status)
                      └─< TagihanItem (snapshot: komponen_id, nama, nominal, dana_id, terbayar)

Dana (Kas Umum, Pembangunan, Sampah, ...)
KebijakanIuran (versi, berlaku_mulai, status) ─< KomponenIuran (nama, nominal, dana_id, aktif)

Pembayaran (metode TUNAI|TRANSFER|MIDTRANS, nominal, status, rumah_id, diterima_oleh,
            bukti_file, diverifikasi_oleh)
   ├─< AlokasiPembayaran >── TagihanItem          (hasil FIFO)
   └── MidtransTransaksi (order_id UNIQUE, transaction_id, gross, status, settlement_at,
                          fee, payload_mentah)

Pengeluaran (dana_id, nominal, alasan, status DRAFT..PAID, dibuat_oleh, disetujui_oleh,
             bukti_bayar, lampiran)

LedgerEntry (tanggal, dana_id, arah MASUK|KELUAR, nominal, jenis SALDO_AWAL|IURAN|
             PENGELUARAN|BIAYA_MIDTRANS|PEMBALIK|LAINNYA, sumber_tipe, sumber_id,
             membalik_id, keterangan, dibuat_oleh)

WaPesan (tujuan, template, isi, status ANTRI|TERKIRIM|GAGAL, percobaan, error, next_retry_at)
AuditLog (user_id, aksi, entitas, entitas_id, sebelum JSON, sesudah JSON, ip, waktu)
Pengaturan (key/value konfigurasi sistem)
FileUpload (path privat, mime, ukuran, sha256, pemilik_entitas)
```

Saldo dana = `SUM(MASUK) - SUM(KELUAR)` dari `LedgerEntry` (saldo awal = entri `SALDO_AWAL`, sekali per dana, dikunci setelah dibuat).

## 3. Flowchart utama

### Generate tagihan bulanan (cron tgl 1, juga bisa manual)
```
untuk tiap rumah:
  status = StatusRumah berlaku di periode
  kebijakan = KebijakanIuran berlaku di periode
  komponen = AKTIF → semua komponen aktif
             KOSONG/TIDAK_DITEMPATI/PIHAK_KEDUA → hanya StatusKomponenWajib
  komponen kosong? → lewati (tidak ada tagihan)
  INSERT Tagihan ... ON CONFLICT (rumah_id, periode) DO NOTHING
  antre WaPesan "tagihan" berisi link token
```

### Pembayaran (semua metode bermuara ke `posting()`)
```
TUNAI    : bendahara input ───────────────────────────────┐
TRANSFER : warga upload bukti → MENUNGGU → bendahara setuju ┤→ posting(pembayaran)
MIDTRANS : snap token → webhook → cek signature SHA512      │
           + GET status ke API Midtrans → settlement? ──────┘
posting (1 transaksi DB, idempoten via status/order_id):
  lock tagihan rumah (FOR UPDATE), urut periode lama → baru
  alokasikan FIFO per TagihanItem; sisa → kredit/kelebihan (keputusan #4)
  LedgerEntry MASUK per dana sesuai item teralokasi
  fee Midtrans → LedgerEntry KELUAR jenis BIAYA_MIDTRANS (terpisah)
  update status tagihan (BELUM | SEBAGIAN | LUNAS)
  buat nomor kuitansi, antre WA konfirmasi
```

### Pengeluaran
```
DRAFT → (bendahara ajukan) PENDING → Ketua RT: APPROVED | REJECTED
APPROVED → bendahara bayar + upload bukti → PAID (LedgerEntry KELUAR)
DRAFT/PENDING/APPROVED → CANCELLED
Aturan: penyetuju ≠ pembuat; saldo cukup dicek saat PAID.
```

## 4. Struktur folder
```
PerumBca/
├─ prisma/ schema.prisma, migrations/, seed.js (role, permission, super admin dari ENV)
├─ src/
│  ├─ app.js, server.js, config/ (env tervalidasi)
│  ├─ middleware/ auth, rbac, csrf, rateLimit, errorHandler, upload
│  ├─ modules/
│  │  ├─ auth/  users/  rbac/  rumah/  penghuni/  impor/
│  │  ├─ kebijakan/  tagihan/  pembayaran/  midtrans/
│  │  ├─ ledger/  pengeluaran/  laporan/  whatsapp/  audit/  backup/
│  │  │   (tiap modul: routes.js, controller.js, service.js, validator.js)
│  ├─ jobs/ generateTagihan, pengingat, waRetry, backup
│  ├─ views/ (EJS + Bootstrap 5)   public/ (css, js)
│  └─ lib/ prisma, argon2, money, logger
├─ tests/ (node:test / vitest + Postgres test DB)
├─ storage/uploads (privat, di luar public)
├─ docker/ Dockerfile, docker-compose.yml (app, postgres, traefik)
└─ docs/
```
Templating memakai EJS (server-rendered, ringan, tanpa build step).

## 5. Keamanan (ringkas)
Argon2id; session di Postgres (`connect-pg-simple`) dengan cookie HttpOnly+Secure+SameSite=Lax; CSRF token (csrf-sync); helmet + CSP; express-rate-limit pada login; validasi zod; Prisma (parameterized); file bukti disajikan lewat route berizin; token link tagihan 32 byte acak, hanya hash yang disimpan; Super Admin dilindungi di service (tidak bisa diubah/dihapus selain oleh dirinya); Postgres tidak di-expose port; backup `pg_dump | age/gpg` terjadwal.

## 6. Keputusan yang dibutuhkan
1. **Gambar data perumahan 2026** belum terlampir — wajib untuk Tahap 2.
2. Link tagihan warga: cukup token rahasia, atau token + PIN/OTP WA?
3. Apakah warga punya akun login, atau hanya via link token?
4. Kelebihan bayar: simpan sebagai kredit untuk bulan berikutnya atau tolak?
5. Pembayaran sebagian lewat Midtrans boleh (warga isi nominal) atau hanya penuh per bulan?
6. Fee Midtrans ditanggung kas (pengeluaran dana apa?) atau dibebankan ke warga?
7. Pembayaran Jan–Nov 2026 di gambar: diimpor sebagai riwayat lunas (tanpa ledger, karena tercermin di saldo awal) — setuju? Lalu tanggal mulai pembukuan & saldo awal per dana.
8. Pengingat: tanggal kirim tagihan dan jadwal pengingat (mis. tgl 1, 10, 20).
9. Domain / subdomain dan perangkat Armbian target.
10. Nomor WhatsApp pengirim (akun Baileys khusus).
