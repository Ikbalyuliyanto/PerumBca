#!/bin/sh
# Backup database terenkripsi (AES-256, kunci di BACKUP_PASSPHRASE_FILE). Jalankan dari cron host:
#   15 2 * * * /opt/perumbca/scripts/backup.sh >> /opt/perumbca/backups/backup.log 2>&1
# Restore:
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:$KEY -in FILE.sql.gz.enc | gunzip | docker exec -i postgres psql -U perumbca -d perumbca
set -eu
DIR=${BACKUP_DIR:-/opt/perumbca/backups}
KEY=${BACKUP_PASSPHRASE_FILE:-/opt/perumbca/backup.key}
DB=${DB_NAME:-perumbca}
DBUSER=${DB_USER:-perumbca}
KEEP_DAYS=${KEEP_DAYS:-30}
mkdir -p "$DIR"
[ -s "$KEY" ] || { umask 077; openssl rand -base64 48 > "$KEY"; echo "Kunci backup baru dibuat: $KEY (SIMPAN salinannya di tempat aman!)"; }
OUT="$DIR/perumbca-$(date +%Y%m%d-%H%M%S).sql.gz.enc"
umask 077
docker exec postgres pg_dump -U "$DBUSER" -d "$DB" --no-owner --clean --if-exists \
  | gzip -9 | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$KEY" -out "$OUT"
[ -s "$OUT" ] || { echo "Backup gagal (file kosong)"; exit 1; }
cp -a /opt/perumbca/storage/uploads "$DIR/uploads-latest" 2>/dev/null || true
find "$DIR" -name 'perumbca-*.sql.gz.enc' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) OK $OUT $(du -h "$OUT" | cut -f1)"
