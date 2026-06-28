#!/usr/bin/env bash
#
# Daily backup for Spyglass: the SQLite store AND the persistent blog content
# (content-posts/, since v1.1.5). Both rotate after RETENTION_DAYS so the
# backup directory never grows unbounded.
#
# SQLite uses sqlite3's online .backup (NOT cp) — WAL-aware, no torn-page risk
# while the app writes. content-posts is archived atomically (tar to a temp file
# in the same dir, then mv into place) so a partial run never leaves a corrupt
# archive.
#
# Install via /etc/cron.d/spyglass-backup:
#   30 3 * * * root /srv/DATA/Stacks/adtech-spyglass/scripts/backup-db.sh >> /var/log/spyglass-backup.log 2>&1
#
# RESTORE:
#   DB:            gunzip -c $DEST_DIR/spyglass-YYYY-MM-DD.db.gz > /srv/DATA/AppData/adtech-spyglass/spyglass.db
#                 (stop the container first; remove stale -wal/-shm)
#   content-posts: tar xzf $DEST_DIR/content-posts-YYYY-MM-DD.tar.gz -C /srv/DATA/AppData/adtech-spyglass

set -euo pipefail

DATA_DIR=/srv/DATA/AppData/adtech-spyglass
SRC="$DATA_DIR/spyglass.db"
CONTENT_DIR="$DATA_DIR/content-posts"
DEST_DIR=/srv/DATA/Backups/adtech-spyglass
RETENTION_DAYS=30
DATE=$(date +%Y-%m-%d)

mkdir -p "$DEST_DIR"

# ── SQLite ──────────────────────────────────────────────────────────────────
if [ -f "$SRC" ]; then
  DEST="$DEST_DIR/spyglass-$DATE.db"
  sqlite3 "$SRC" ".backup '$DEST'"
  gzip -f "$DEST"
  find "$DEST_DIR" -maxdepth 1 -name "spyglass-*.db.gz" -mtime +"$RETENTION_DAYS" -delete
  echo "$(date -Is) db backup ok: $DEST.gz ($(stat -c%s "$DEST.gz") bytes)"
else
  echo "$(date -Is) db skip: $SRC does not exist" >&2
fi

# ── content-posts (persistent blog content) ─────────────────────────────────
if [ -d "$CONTENT_DIR" ]; then
  ARCHIVE="$DEST_DIR/content-posts-$DATE.tar.gz"
  TMP="$(mktemp "$DEST_DIR/.content-posts-$DATE.XXXXXX.tmp")"
  # Atomic: write to temp, then move into place.
  tar czf "$TMP" -C "$DATA_DIR" content-posts
  mv -f "$TMP" "$ARCHIVE"
  find "$DEST_DIR" -maxdepth 1 -name "content-posts-*.tar.gz" -mtime +"$RETENTION_DAYS" -delete
  echo "$(date -Is) content backup ok: $ARCHIVE ($(stat -c%s "$ARCHIVE") bytes)"
else
  echo "$(date -Is) content skip: $CONTENT_DIR does not exist (not yet seeded)" >&2
fi
