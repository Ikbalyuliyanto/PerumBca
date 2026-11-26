-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Verifikasi" AS ENUM ('OK', 'PERLU_VERIFIKASI');

-- CreateEnum
CREATE TYPE "KondisiRumah" AS ENUM ('AKTIF', 'KOSONG', 'TIDAK_DITEMPATI', 'PIHAK_KEDUA');

-- CreateEnum
CREATE TYPE "StatusPengajuan" AS ENUM ('PENDING', 'DISETUJUI', 'DITOLAK');

-- CreateEnum
CREATE TYPE "StatusTagihan" AS ENUM ('BELUM', 'SEBAGIAN', 'LUNAS', 'DIBATALKAN');

-- CreateEnum
CREATE TYPE "MetodeBayar" AS ENUM ('TUNAI', 'TRANSFER', 'MIDTRANS');

-- CreateEnum
CREATE TYPE "StatusBayar" AS ENUM ('MENUNGGU', 'DITOLAK', 'DIPOSTING', 'DIBATALKAN');

-- CreateEnum
CREATE TYPE "Arah" AS ENUM ('MASUK', 'KELUAR');

-- CreateEnum
CREATE TYPE "StatusPengeluaran" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "noWa" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" SERIAL NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "sistem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "grup" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("kode")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" INTEGER NOT NULL,
    "permissionKode" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionKode")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "UserRumah" (
    "userId" INTEGER NOT NULL,
    "rumahId" INTEGER NOT NULL,

    CONSTRAINT "UserRumah_pkey" PRIMARY KEY ("userId","rumahId")
);

-- CreateTable
CREATE TABLE "Blok" (
    "id" SERIAL NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT,
    "urutan" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Blok_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rumah" (
    "id" SERIAL NOT NULL,
    "blokId" INTEGER NOT NULL,
    "nomor" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "noUrutSumber" INTEGER,
    "verifikasi" "Verifikasi" NOT NULL DEFAULT 'OK',
    "catatan" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersi" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rumah_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Penghunian" (
    "id" SERIAL NOT NULL,
    "rumahId" INTEGER NOT NULL,
    "nama" TEXT NOT NULL,
    "noWa" TEXT,
    "mulai" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "selesai" DATE,
    "verifikasi" "Verifikasi" NOT NULL DEFAULT 'OK',
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Penghunian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusRumah" (
    "id" SERIAL NOT NULL,
    "rumahId" INTEGER NOT NULL,
    "kondisi" "KondisiRumah" NOT NULL,
    "berlakuMulai" TEXT NOT NULL,
    "komponenWajib" TEXT[],
    "catatan" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusRumah_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PengajuanPerubahan" (
    "id" SERIAL NOT NULL,
    "rumahId" INTEGER NOT NULL,
    "namaBaru" TEXT,
    "noWaBaru" TEXT,
    "alasan" TEXT,
    "status" "StatusPengajuan" NOT NULL DEFAULT 'PENDING',
    "diputuskanOlehId" INTEGER,
    "diputuskanAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PengajuanPerubahan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiwayatImpor" (
    "id" SERIAL NOT NULL,
    "rumahId" INTEGER NOT NULL,
    "periode" TEXT NOT NULL,
    "kodeKomponen" TEXT NOT NULL,
    "terbayar" BOOLEAN NOT NULL,
    "sumber" TEXT NOT NULL,
    "verifikasi" "Verifikasi" NOT NULL DEFAULT 'OK',
    "keputusan" TEXT,

    CONSTRAINT "RiwayatImpor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dana" (
    "id" SERIAL NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "publik" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Dana_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kebijakan" (
    "id" SERIAL NOT NULL,
    "nama" TEXT NOT NULL,
    "berlakuMulai" TEXT NOT NULL,
    "catatan" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kebijakan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KomponenIuran" (
    "id" SERIAL NOT NULL,
    "kebijakanId" INTEGER NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "nominal" INTEGER NOT NULL,
    "danaId" INTEGER NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "urutan" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KomponenIuran_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tagihan" (
    "id" SERIAL NOT NULL,
    "rumahId" INTEGER NOT NULL,
    "periode" TEXT NOT NULL,
    "kebijakanId" INTEGER,
    "total" INTEGER NOT NULL,
    "terbayar" INTEGER NOT NULL DEFAULT 0,
    "status" "StatusTagihan" NOT NULL DEFAULT 'BELUM',
    "sumber" TEXT NOT NULL DEFAULT 'SISTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tagihan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagihanItem" (
    "id" SERIAL NOT NULL,
    "tagihanId" INTEGER NOT NULL,
    "kodeKomponen" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "nominal" INTEGER NOT NULL,
    "danaId" INTEGER NOT NULL,
    "terbayar" INTEGER NOT NULL DEFAULT 0,
    "urutan" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TagihanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pembayaran" (
    "id" SERIAL NOT NULL,
    "nomor" TEXT NOT NULL,
    "rumahId" INTEGER NOT NULL,
    "metode" "MetodeBayar" NOT NULL,
    "nominal" INTEGER NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StatusBayar" NOT NULL DEFAULT 'MENUNGGU',
    "catatan" TEXT,
    "alasanTolak" TEXT,
    "buktiFileId" INTEGER,
    "dibuatOlehId" INTEGER,
    "diverifikasiOlehId" INTEGER,
    "diverifikasiAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pembayaran_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlokasiPembayaran" (
    "id" SERIAL NOT NULL,
    "pembayaranId" INTEGER NOT NULL,
    "tagihanItemId" INTEGER NOT NULL,
    "nominal" INTEGER NOT NULL,

    CONSTRAINT "AlokasiPembayaran_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MidtransTransaksi" (
    "id" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "rumahId" INTEGER NOT NULL,
    "pembayaranId" INTEGER,
    "grossAmount" INTEGER NOT NULL,
    "snapToken" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "transactionId" TEXT,
    "paymentType" TEXT,
    "settlementAt" TIMESTAMP(3),
    "fee" INTEGER,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MidtransTransaksi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" SERIAL NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "danaId" INTEGER NOT NULL,
    "arah" "Arah" NOT NULL,
    "nominal" INTEGER NOT NULL,
    "jenis" TEXT NOT NULL,
    "sumberTipe" TEXT,
    "sumberId" INTEGER,
    "membalikId" INTEGER,
    "keterangan" TEXT,
    "dibuatOlehId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pengeluaran" (
    "id" SERIAL NOT NULL,
    "nomor" TEXT NOT NULL,
    "danaId" INTEGER NOT NULL,
    "kategori" TEXT NOT NULL,
    "nominal" INTEGER NOT NULL,
    "alasan" TEXT NOT NULL,
    "status" "StatusPengeluaran" NOT NULL DEFAULT 'DRAFT',
    "lampiranFileId" INTEGER,
    "buktiFileId" INTEGER,
    "alasanTolak" TEXT,
    "dibuatOlehId" INTEGER NOT NULL,
    "disetujuiOlehId" INTEGER,
    "disetujuiAt" TIMESTAMP(3),
    "dibayarAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pengeluaran_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileUpload" (
    "id" SERIAL NOT NULL,
    "path" TEXT NOT NULL,
    "namaAsli" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "ukuran" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" INTEGER,
    "rumahId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaPesan" (
    "id" SERIAL NOT NULL,
    "tujuan" TEXT NOT NULL,
    "jenis" TEXT NOT NULL,
    "isi" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ANTRI',
    "percobaan" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rumahId" INTEGER,
    "refKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "WaPesan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "aksi" TEXT NOT NULL,
    "entitas" TEXT NOT NULL,
    "entitasId" TEXT,
    "data" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pengaturan" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Pengaturan_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Role_kode_key" ON "Role"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "Blok_kode_key" ON "Blok"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "Rumah_kode_key" ON "Rumah"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "Rumah_blokId_nomor_key" ON "Rumah"("blokId", "nomor");

-- CreateIndex
CREATE INDEX "Penghunian_rumahId_selesai_idx" ON "Penghunian"("rumahId", "selesai");

-- CreateIndex
CREATE UNIQUE INDEX "StatusRumah_rumahId_berlakuMulai_key" ON "StatusRumah"("rumahId", "berlakuMulai");

-- CreateIndex
CREATE UNIQUE INDEX "RiwayatImpor_rumahId_periode_kodeKomponen_sumber_key" ON "RiwayatImpor"("rumahId", "periode", "kodeKomponen", "sumber");

-- CreateIndex
CREATE UNIQUE INDEX "Dana_kode_key" ON "Dana"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "Kebijakan_berlakuMulai_key" ON "Kebijakan"("berlakuMulai");

-- CreateIndex
CREATE UNIQUE INDEX "KomponenIuran_kebijakanId_kode_key" ON "KomponenIuran"("kebijakanId", "kode");

-- CreateIndex
CREATE INDEX "Tagihan_status_idx" ON "Tagihan"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Tagihan_rumahId_periode_key" ON "Tagihan"("rumahId", "periode");

-- CreateIndex
CREATE UNIQUE INDEX "Pembayaran_nomor_key" ON "Pembayaran"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "MidtransTransaksi_orderId_key" ON "MidtransTransaksi"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "MidtransTransaksi_pembayaranId_key" ON "MidtransTransaksi"("pembayaranId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_membalikId_key" ON "LedgerEntry"("membalikId");

-- CreateIndex
CREATE INDEX "LedgerEntry_danaId_tanggal_idx" ON "LedgerEntry"("danaId", "tanggal");

-- CreateIndex
CREATE INDEX "LedgerEntry_sumberTipe_sumberId_idx" ON "LedgerEntry"("sumberTipe", "sumberId");

-- CreateIndex
CREATE UNIQUE INDEX "Pengeluaran_nomor_key" ON "Pengeluaran"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "WaPesan_refKey_key" ON "WaPesan"("refKey");

-- CreateIndex
CREATE INDEX "WaPesan_status_nextRetryAt_idx" ON "WaPesan"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "AuditLog_entitas_entitasId_idx" ON "AuditLog"("entitas", "entitasId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionKode_fkey" FOREIGN KEY ("permissionKode") REFERENCES "Permission"("kode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRumah" ADD CONSTRAINT "UserRumah_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRumah" ADD CONSTRAINT "UserRumah_rumahId_fkey" FOREIGN KEY ("rumahId") REFERENCES "Rumah"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rumah" ADD CONSTRAINT "Rumah_blokId_fkey" FOREIGN KEY ("blokId") REFERENCES "Blok"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Penghunian" ADD CONSTRAINT "Penghunian_rumahId_fkey" FOREIGN KEY ("rumahId") REFERENCES "Rumah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusRumah" ADD CONSTRAINT "StatusRumah_rumahId_fkey" FOREIGN KEY ("rumahId") REFERENCES "Rumah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengajuanPerubahan" ADD CONSTRAINT "PengajuanPerubahan_rumahId_fkey" FOREIGN KEY ("rumahId") REFERENCES "Rumah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiwayatImpor" ADD CONSTRAINT "RiwayatImpor_rumahId_fkey" FOREIGN KEY ("rumahId") REFERENCES "Rumah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KomponenIuran" ADD CONSTRAINT "KomponenIuran_kebijakanId_fkey" FOREIGN KEY ("kebijakanId") REFERENCES "Kebijakan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KomponenIuran" ADD CONSTRAINT "KomponenIuran_danaId_fkey" FOREIGN KEY ("danaId") REFERENCES "Dana"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tagihan" ADD CONSTRAINT "Tagihan_rumahId_fkey" FOREIGN KEY ("rumahId") REFERENCES "Rumah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tagihan" ADD CONSTRAINT "Tagihan_kebijakanId_fkey" FOREIGN KEY ("kebijakanId") REFERENCES "Kebijakan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagihanItem" ADD CONSTRAINT "TagihanItem_tagihanId_fkey" FOREIGN KEY ("tagihanId") REFERENCES "Tagihan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pembayaran" ADD CONSTRAINT "Pembayaran_rumahId_fkey" FOREIGN KEY ("rumahId") REFERENCES "Rumah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pembayaran" ADD CONSTRAINT "Pembayaran_buktiFileId_fkey" FOREIGN KEY ("buktiFileId") REFERENCES "FileUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlokasiPembayaran" ADD CONSTRAINT "AlokasiPembayaran_pembayaranId_fkey" FOREIGN KEY ("pembayaranId") REFERENCES "Pembayaran"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlokasiPembayaran" ADD CONSTRAINT "AlokasiPembayaran_tagihanItemId_fkey" FOREIGN KEY ("tagihanItemId") REFERENCES "TagihanItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MidtransTransaksi" ADD CONSTRAINT "MidtransTransaksi_pembayaranId_fkey" FOREIGN KEY ("pembayaranId") REFERENCES "Pembayaran"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_danaId_fkey" FOREIGN KEY ("danaId") REFERENCES "Dana"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Buku kas append-only: entri yang sudah diposting tidak boleh diubah/dihapus.
CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry bersifat append-only; gunakan entri pembalik';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_no_update BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- Tabel sesi untuk connect-pg-simple
CREATE TABLE "session" (
  "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");
