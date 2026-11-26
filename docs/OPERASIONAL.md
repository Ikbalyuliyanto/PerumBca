# Operasional

## Lokasi di STB (b860h-1g, Armbian)

| Item | Lokasi |
|---|---|
| Aplikasi | `/opt/perumbca` (`compose.yml`, `.env` mode 600, `src/` = salinan repo) |
| File upload & sesi WA | `/opt/perumbca/storage` (volume, milik uid 1000) |
| Backup | `/opt/perumbca/backups` |
| Database | container `postgres` (`/opt/db`), hanya `127.0.0.1:5432` dan network `backend` |

Container aplikasi: `perumbca-app`, port 3000. Setiap start otomatis menjalankan `prisma migrate deploy` dan seed (idempoten), jadi migration baru tidak perlu dijalankan manual.

## Deploy versi baru

Dari PC (folder repo):

```bash
git archive --format=tar HEAD | gzip -9 > perumbca.tar.gz
scp perumbca.tar.gz root@STB:/opt/perumbca/
# cocokkan sha256sum di PC dan STB (WiFi STB kadang korup)
ssh root@STB 'cd /opt/perumbca && rm -rf src && mkdir src && tar -xzf perumbca.tar.gz -C src && nohup ./deploy.sh &'
ssh root@STB 'cat /opt/perumbca/deploy-done.txt'   # tunggu sampai berisi "... OK"
```

## Langkah awal setelah instal

1. Login `superadmin` (password awal ada di `/opt/perumbca/superadmin-awal.txt`), lalu **ganti password** dan hapus `SUPERADMIN_PASSWORD` dari `.env` serta file `superadmin-awal.txt`.
2. **Kebijakan iuran**: periksa kebijakan awal (Pembangunan 20rb, Kas 10rb, Sampah 20rb, mulai 2026-01). Buat versi baru bila nominal atau tanggal mulai berbeda.
3. **Impor data**: menu *Lainnya → Impor & verifikasi*, unggah CSV hasil ekstraksi sheet. Lalu verifikasi rumah yang ditandai PERLU VERIFIKASI dan putuskan *calon tunggakan*.
4. **Nomor WhatsApp** penghuni: isi di halaman detail rumah.
5. **Saldo awal** per dana (menu Buku kas), sekali saja, pada tanggal mulai pembukuan.
6. **Akun pengurus**: menu Akun pengguna. Pilih role Bendahara / Ketua RT / Admin Pengurus.
7. **Pengaturan**: info rekening, tanggal tagihan, jadwal pengingat, template WA.

## Tagihan otomatis

Setiap hari pukul 08:00 WIB, job memeriksa pengaturan:
- `tanggal_tagihan` (default 1): membuat tagihan bulan berjalan untuk rumah yang wajib bayar (idempoten), lalu mengantrekan WA.
- `hari_pengingat` (default 10,20): mengantrekan pengingat untuk rumah yang menunggak.

Tagihan juga bisa dibuat manual di menu Tagihan.

## WhatsApp

- `WA_PROVIDER=none` (default): pesan masuk antrean, lalu dikirim dari menu WhatsApp lewat tombol **Kirim via wa.me** (dari HP/WA Web pengurus).
- `WA_PROVIDER=baileys`: ubah `.env`, jalankan `docker compose up -d`, lalu `docker logs -f perumbca-app` dan scan QR dari HP (Perangkat tertaut). Sesi disimpan di `storage/wa-auth`. Pesan gagal dicoba ulang otomatis (maksimal 5 kali, backoff eksponensial).

## Midtrans

1. Isi `MIDTRANS_SERVER_KEY` dan `MIDTRANS_CLIENT_KEY` (sandbox dulu), lalu `docker compose up -d`.
2. Di dashboard Midtrans, set *Payment Notification URL* ke `https://<domain>/webhook/midtrans`. Ini butuh domain publik HTTPS (Traefik atau Cloudflare Tunnel).
3. Pembayaran hanya diposting dari webhook yang lolos verifikasi signature **dan** dikonfirmasi ulang ke API status Midtrans. Redirect dari browser tidak dipercaya.
4. Biaya Midtrans dicatat terpisah sebagai pengeluaran `BIAYA_MIDTRANS` dari dana `midtrans_fee_dana`, dengan tarif dari pengaturan `midtrans_fee_flat` / `midtrans_fee_persen`.

## HTTPS / domain

Aplikasi saat ini diakses lewat LAN/Tailscale `http://<ip>:3000`. Untuk publik: pasang Traefik (label contoh ada di `docker/compose.yml`) atau Cloudflare Tunnel. Setelah itu set `COOKIE_SECURE=true`, `APP_URL=https://...`, dan `TRUST_PROXY` sesuai proxy.

## Backup

```bash
/opt/perumbca/scripts/backup.sh            # sekali jalan
crontab -e   # 15 2 * * * /opt/perumbca/scripts/backup.sh >> /opt/perumbca/backups/backup.log 2>&1
```

Kunci enkripsi ada di `/opt/perumbca/backup.key` (dibuat otomatis). **Simpan salinan kunci di luar STB.** Tanpa kunci itu, backup tidak bisa dipulihkan. Cara restore ada di komentar `scripts/backup.sh`.

## Prinsip data

- Buku kas append-only (trigger database). Koreksi = transaksi pembalik (Super Admin) atau pembatalan pembayaran.
- Tagihan menyimpan rincian komponen dan nominal saat dibuat. Perubahan kebijakan hanya berlaku untuk periode berikutnya.
- Riwayat dari sheet 2026 hanya berupa status per bulan (tanpa nominal), tidak masuk buku kas.
