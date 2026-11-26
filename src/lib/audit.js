'use strict';
const prisma = require('./prisma');
/** Catat audit. `db` boleh berupa transaksi Prisma. */
exports.audit = (req, aksi, entitas, entitasId, data, db = prisma) =>
  db.auditLog.create({
    data: {
      userId: req?.user?.id ?? null,
      aksi, entitas,
      entitasId: entitasId != null ? String(entitasId) : null,
      data: data ?? undefined,
      ip: req?.ip ?? null,
    },
  });
