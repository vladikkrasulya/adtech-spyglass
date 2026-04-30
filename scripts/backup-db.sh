#!/usr/bin/env bash
#
# Daily SQLite backup for Spyglass.
#
# Uses sqlite3's online .backup command (NOT cp) — handles WAL correctly,
# no torn-page risk while the app is writing. Compresses with gzip and
# rotates anything older than RETENTION_DAYS.
#
# Install via /etc/cron.d/spyglass-backup:
#   30 3 * * * root /srv/DATA/Stacks/adtech-spyglass/scripts/backup-db.sh >> /var/log/spyglass-backup.log 2>&1

set -euo pipefail

SRC=/srv/DATA/AppData/adtech-spyglass/spyglass.db
DEST_DIR=/srv/DATA/Backups/adtech-spyglass
RETENTION_DAYS=30

if [ ! -f "$SRC" ]; then
  echo "$(date -Is) skip: $SRC does not exist" >&2
  exit 0
fi

mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/spyglass-$(date +%Y-%m-%d).db"

# Online backup — safe with concurrent writers (WAL aware)
sqlite3 "$SRC" ".backup '$DEST'"

gzip -f "$DEST"

# Retention
find "$DEST_DIR" -maxdepth 1 -name "spyglass-*.db.gz" -mtime +"$RETENTION_DAYS" -delete

SIZE=$(stat -c%s "$DEST.gz")
echo "$(date -Is) backup ok: $DEST.gz ($SIZE bytes)"
