#!/usr/bin/env bash
# Dump the PostgreSQL database used by docker-compose into a compressed file.
#
# Usage:
#   ./scripts/backup-db.sh
#   BACKUP_DIR=/var/backups/ytmm ./scripts/backup-db.sh
#
# Cron example (daily at 03:15):
#   15 3 * * * cd /srv/yt-mindmap && ./scripts/backup-db.sh >> /var/log/ytmm-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-backups}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-ytmindmap}"
DB_NAME="${DB_NAME:-ytmindmap}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

command -v docker >/dev/null 2>&1 || {
  echo "docker is required" >&2
  exit 1
}

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%d-%H%M%S)"
file="$BACKUP_DIR/ytmindmap-$stamp.sql.gz"

echo "Dumping $DB_NAME from service '$DB_SERVICE' -> $file"
docker compose exec -T "$DB_SERVICE" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
  | gzip -9 > "$file"

# A zero-byte file means the pipeline failed after the shell created it.
if [ ! -s "$file" ]; then
  echo "Backup failed: $file is empty" >&2
  rm -f "$file"
  exit 1
fi

if [ "$KEEP_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -name 'ytmindmap-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -delete
fi

echo "Backup complete: $(du -h "$file" | cut -f1) $file"
