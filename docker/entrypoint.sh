#!/bin/sh
# Migrasi + seed (idempoten) setiap start, lalu jalankan aplikasi.
set -e
npx prisma migrate deploy
node prisma/seed.js
exec node src/server.js
