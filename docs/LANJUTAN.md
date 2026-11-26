# Catatan lanjutan (untuk sesi berikutnya)

Terakhir diperbarui: 2026-11-26. Ditulis untuk melanjutkan dari komputer lain (mis. di rumah).

## Status
- Aplikasi jalan di STB **b860h-1g** (Armbian): `http://192.168.15.35:3000` (LAN kantor) atau `http://100.99.234.119:3000` (Tailscale).
- Login admin: username `admin` (password sudah disampaikan ke pemilik; ganti lewat menu nama → Ganti password).
- Data 54 rumah dari sheet 2026 sudah diimpor (8 PERLU VERIFIKASI, 18 calon tunggakan di menu Impor & Verifikasi).
- Tes: 28/28 lolos.

## Arah yang disepakati pemilik
1. **Fokus dulu di sisi admin.** Tampilan khusus warga dibuat belakangan (halaman `/r/<token>` yang sekarang ada dianggap sementara).
2. Tampilan bergaya admin dashboard bersih (referensi: DropX admin). Sidebar, kartu putih, aksen hijau, mobile-first.
3. Dibuat **sederhana**. Alur utama:
   - *Bayar Iuran* → "Bayar semua" melunasi semua jenis iuran sebulan (bisa banyak rumah sekaligus).
   - "Pilih" → centang bulan × jenis iuran untuk bayar sebagian.
   - *Jenis Iuran* adalah master (nama, nominal, dana, aktif).
4. Iuran normalnya Rp50.000/bulan dibayar sekaligus. Centang di sheet lama = kebersihan lunas (nominal tidak diketahui, tidak masuk kas).
5. Penomoran rumah tanpa angka 13 (B12A dst.) memang resmi.
6. Password dibuat mudah (minimal 6 karakter) selama masih diakses lewat LAN/Tailscale.

## Belum dikerjakan
- Tampilan khusus warga.
- HTTPS/domain publik (dibutuhkan untuk webhook Midtrans), lalu aktifkan Midtrans sandbox.
- WhatsApp otomatis (Baileys) karena nomor pengirim belum ditentukan. Saat ini mode manual wa.me.
- Cron backup di STB (`scripts/backup.sh`).
- Tanggal mulai pembukuan dan saldo awal tiap dana (menunggu angka dari pemilik).
- Halaman lain (Data Warga, Pengeluaran, Buku Kas, Laporan) masih bergaya lama dan perlu disederhanakan mengikuti gaya baru.

## Cara deploy
Lihat [OPERASIONAL.md](OPERASIONAL.md). Ringkasnya: `git archive HEAD | gzip` → scp ke `/opt/perumbca/` → cocokkan sha256 → ekstrak ke `src/` → `./deploy.sh` (otomatis migrate + seed). Akses SSH ke STB memakai kunci yang ada di PC kantor. Di komputer lain, tambahkan kunci SSH baru ke `/root/.ssh/authorized_keys` di STB.

Data warga (CSV) **tidak** ada di repo (`data/import/` di-gitignore). Datanya sudah tersimpan di database STB.
