# PerumBca

Sistem Informasi Iuran Perumahan Bumi Cikarang Asri: tagihan bulanan otomatis, tunggakan (FIFO), pembayaran tunai/transfer/Midtrans, buku kas append-only, persetujuan pengeluaran, laporan, notifikasi WhatsApp, RBAC dan audit log.

**Stack:** Node.js 20 + Express 5, PostgreSQL + Prisma 6, EJS + Bootstrap 5 (tanpa build step), Midtrans Snap, Baileys (opsional), Docker di Armbian.

- Rancangan, ERD, flowchart, keputusan: [docs/RANCANGAN.md](docs/RANCANGAN.md)
- Operasional (deploy, backup, impor, Midtrans, WA): [docs/OPERASIONAL.md](docs/OPERASIONAL.md)

## Menjalankan lokal

```bash
cp .env.example .env      # isi DATABASE_URL, SESSION_SECRET, SUPERADMIN_*
npm ci
npx prisma migrate deploy
npm run seed              # role, permission, dana, kebijakan awal, Super Admin
npm run dev               # http://localhost:3000
```

## Tes

Tes memakai database terpisah (`DATABASE_URL` wajib mengandung kata `test`, isinya dihapus tiap tes):

```bash
node --env-file=.env.test --test --test-concurrency=1 tests/keuangan.test.js tests/integrasi.test.js tests/http.test.js
```

Cakupan: FIFO, alokasi manual, tolak kelebihan bayar, pembayaran bersamaan, pembalik, buku kas tidak bisa diubah/dihapus, saldo awal sekali, alur pengeluaran (tidak bisa setujui sendiri, saldo baru berkurang saat PAID), webhook Midtrans (signature, idempoten, nominal), link warga (palsu/dicabut), impor CSV, login/CSRF/RBAC, dan render semua halaman.

## Struktur

```
prisma/        schema, migration (+ trigger append-only buku kas), seed
src/config     env tervalidasi (zod), daftar permission & role bawaan
src/lib        prisma, argon2id, audit, pengaturan dinamis, util
src/middleware auth/RBAC, CSRF, upload (cek magic bytes), error
src/modules    iuran (kebijakan/status/tagihan), keuangan (pembayaran FIFO, buku kas,
               pengeluaran), midtrans, wa (antrean + baileys), warga (link HMAC), impor
src/routes     auth, warga (/r/<token>), admin/*, webhook, file berizin
src/views      EJS
src/jobs       cron: tagihan otomatis, pengingat, antrean WA
docker/        Dockerfile, compose.yml, entrypoint (migrate + seed + start)
scripts/       backup.sh (pg_dump terenkripsi)
```
