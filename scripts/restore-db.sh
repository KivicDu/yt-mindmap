#!/usr/bin/env bash
# Restore a dump produced by backup-db.sh.
#
# Usage:
#   ./scripts/restore-db.sh backups/ytmindmap-20261108-031500.sql.gz
#
# The dump was taken with --clean --if-exists, so it replaces the current
# schema. Stop the backend first if you want to avoid writes during the restore:
#   docker compose stop backend
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <backup.sql.gz>" >&2
  exit 1
fi

file="$1"
if [ ! -f "$file" ]; then
  echo "Backup file not found: $file" >&2
  exit 1
fi

DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-ytmindmap}"
DB_NAME="${DB_NAME:-ytmindmap}"

command -v docker >/dev/null 2>&1 || {
  echo "docker is required" >&2
  exit 1
}

echo "This will overwrite database '$DB_NAME' in service '$DB_SERVICE'."
printf "Type 'restore' to continue: "
read -r answer
if [ "$answer" != "restore" ]; then
  echo "Aborted."
  exit 1
fi

echo "Restoring $file ..."
gunzip -c "$file" | docker compose exec -T "$DB_SERVICE" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1

echo "Restore complete. Run 'docker compose restart backend' if it was running."
