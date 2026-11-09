# Database backup and restore

The Docker setup keeps accounts, projects, drafts and sharing data in the
`mindmap-db` Postgres volume. The scripts in `scripts/` wrap `pg_dump` and
`psql` inside that container.

## Take a backup

```bash
./scripts/backup-db.sh
```

- Writes `backups/ytmindmap-YYYYmmdd-HHMMSS.sql.gz`.
- Uses `--clean --if-exists`, so a restore replaces the current schema.
- Deletes backups older than `BACKUP_KEEP_DAYS` (default 14).
- Overridable: `BACKUP_DIR`, `DB_SERVICE`, `DB_USER`, `DB_NAME`,
  `BACKUP_KEEP_DAYS`.

Schedule it with cron and copy the files somewhere off the server:

```cron
15 3 * * * cd /srv/yt-mindmap && ./scripts/backup-db.sh >> /var/log/ytmm-backup.log 2>&1
```

A backup that only lives on the same disk as the database is not a backup.

## Restore

Stop the backend to avoid writes during the restore:

```bash
docker compose stop backend
./scripts/restore-db.sh backups/ytmindmap-20261108-031500.sql.gz
docker compose start backend
```

The script asks you to type `restore` before it touches the database.

## Verify a backup

Restoring into production is the worst time to discover a corrupt dump. Once in
a while, restore into a throwaway database:

```bash
docker compose exec -T db createdb -U ytmindmap ytmindmap_check
gunzip -c backups/ytmindmap-YYYYmmdd-HHMMSS.sql.gz \
  | docker compose exec -T db psql -U ytmindmap -d ytmindmap_check -v ON_ERROR_STOP=1
docker compose exec -T db psql -U ytmindmap -d ytmindmap_check \
  -c 'select count(*) from users; select count(*) from projects;'
docker compose exec -T db dropdb -U ytmindmap ytmindmap_check
```

## Local (non-Docker) database

If Postgres runs directly on the host, the equivalent commands are:

```bash
pg_dump -U ytmindmap -d ytmindmap --clean --if-exists | gzip -9 > backup.sql.gz
gunzip -c backup.sql.gz | psql -U ytmindmap -d ytmindmap -v ON_ERROR_STOP=1
```

## What is not covered

- The mind map cache in the `mindmap-data` volume (`backend/data/`) is
  regenerable; it is not part of the database dump.
- Uploaded subtitle files are parsed on demand and are not stored.
- Off-site storage, encryption and retention policy are deployment concerns.
