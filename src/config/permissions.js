'use strict';
// Daftar permission + role bawaan. Seed menyinkronkan daftar ini ke DB;
// Super Admin dapat mengubah pemetaan role↔permission dari UI.
const PERMISSIONS = [
  ['dashboard.lihat', 'Lihat dashboard', 'Umum'],
  ['rumah.lihat', 'Lihat data rumah & penghuni', 'Perumahan'],
  ['rumah.kelola', 'Kelola penghuni & status rumah', 'Perumahan'],
  ['pengajuan.putuskan', 'Setujui/tolak pengajuan perubahan warga', 'Perumahan'],
  ['impor.kelola', 'Impor & verifikasi data sumber', 'Perumahan'],
  ['kebijakan.lihat', 'Lihat kebijakan iuran', 'Iuran'],
  ['kebijakan.kelola', 'Kelola dana & kebijakan iuran', 'Iuran'],
  ['tagihan.lihat', 'Lihat tagihan & tunggakan', 'Iuran'],
  ['tagihan.generate', 'Buat tagihan bulanan', 'Iuran'],
  ['pembayaran.lihat', 'Lihat pembayaran', 'Keuangan'],
  ['pembayaran.input', 'Input pembayaran tunai', 'Keuangan'],
  ['pembayaran.verifikasi', 'Verifikasi transfer', 'Keuangan'],
  ['pembayaran.koreksi', 'Batalkan pembayaran (transaksi pembalik)', 'Keuangan'],
  ['ledger.lihat', 'Lihat buku kas & saldo', 'Keuangan'],
  ['ledger.saldo_awal', 'Input saldo awal', 'Keuangan'],
  ['pengeluaran.lihat', 'Lihat pengeluaran', 'Keuangan'],
  ['pengeluaran.ajukan', 'Buat & ajukan pengeluaran', 'Keuangan'],
  ['pengeluaran.setujui', 'Setujui/tolak pengeluaran', 'Keuangan'],
  ['pengeluaran.bayar', 'Catat pembayaran pengeluaran', 'Keuangan'],
  ['laporan.lihat', 'Lihat laporan', 'Laporan'],
  ['wa.kelola', 'Kelola notifikasi WhatsApp', 'Sistem'],
  ['user.kelola', 'Kelola akun pengguna', 'Sistem'],
  ['audit.lihat', 'Lihat audit log', 'Sistem'],
  ['pengaturan.kelola', 'Kelola pengaturan sistem', 'Sistem'],
];

const ROLES = {
  ADMIN: { nama: 'Admin Pengurus', perms: ['dashboard.lihat', 'rumah.lihat', 'rumah.kelola', 'pengajuan.putuskan', 'impor.kelola', 'kebijakan.lihat', 'kebijakan.kelola', 'tagihan.lihat', 'pembayaran.lihat', 'laporan.lihat', 'wa.kelola'] },
  BENDAHARA: { nama: 'Bendahara', perms: ['dashboard.lihat', 'rumah.lihat', 'kebijakan.lihat', 'tagihan.lihat', 'tagihan.generate', 'pembayaran.lihat', 'pembayaran.input', 'pembayaran.verifikasi', 'ledger.lihat', 'ledger.saldo_awal', 'pengeluaran.lihat', 'pengeluaran.ajukan', 'pengeluaran.bayar', 'laporan.lihat', 'wa.kelola'] },
  KETUA_RT: { nama: 'Ketua RT', perms: ['dashboard.lihat', 'rumah.lihat', 'pengajuan.putuskan', 'kebijakan.lihat', 'tagihan.lihat', 'pembayaran.lihat', 'ledger.lihat', 'pengeluaran.lihat', 'pengeluaran.setujui', 'laporan.lihat'] },
  WARGA: { nama: 'Warga', perms: [] },
};
module.exports = { PERMISSIONS, ROLES };
