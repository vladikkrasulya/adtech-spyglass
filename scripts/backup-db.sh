#!/usr/bin/env bash
#
# Daily backup for ortbtools: the SQLite store AND the persistent blog content
# (content-posts/, since v1.1.5). Both rotate after RETENTION_DAYS so the
# backup directory never grows unbounded.
#
# SQLite uses sqlite3's online .backup (NOT cp) — WAL-aware, no torn-page risk
# while the app writes. content-posts is archived atomically (tar to a temp file
# in the same dir, then mv into place) so a partial run never leaves a corrupt
# archive.
#
# Install via /etc/cron.d/ortbtools-backup:
#   30 3 * * * root /srv/DATA/Stacks/ortbtools/scripts/backup-db.sh >> /var/log/ortbtools-backup.log 2>&1
#
# PRE-DEPLOY (the constitution's standing deployment gate):
#   sudo -n /srv/DATA/Stacks/ortbtools/scripts/backup-db.sh --pre-deploy
# `--pre-deploy` stamps the archive names with the time (ortbtools-YYYY-MM-DDTHHMM.db.gz)
# so an operator gate run NEVER overwrites the nightly YYYY-MM-DD archive of the same
# day — which is exactly what happened on 2026-09-02, three times, when the gate was
# run without the suffix (and without sudo). Retention globs match both shapes.
# Always run through `sudo -n`: the directory is root:root 0700 by contract, and an
# unprivileged run fails on the chmod below with a hint instead of half-writing.
#
# RESTORE:
#   DB:            gunzip -c $DEST_DIR/ortbtools-YYYY-MM-DD.db.gz > /srv/DATA/AppData/ortbtools/ortbtools.db
#                 (stop the container first; remove stale -wal/-shm)
#   content-posts: tar xzf $DEST_DIR/content-posts-YYYY-MM-DD.tar.gz -C /srv/DATA/AppData/ortbtools
#
# SECURITY: the archives are full copies of the SQLite store (bcrypt password
# hashes, session/email tokens, encrypted samples). They have NO non-root
# consumer, so every file this script creates is 0600 and the backup directory
# is 0700 — `umask 077` makes that the default, and we additionally chmod the
# directory + each archive so a pre-existing 0644/0755 from older runs is fixed.

set -euo pipefail
umask 077 # every file/dir created below is owner-only (0600 / 0700) by default

# Paths are overridable for tests (disposable dirs); prod defaults unchanged.
DATA_DIR="${ORTBTOOLS_BACKUP_DATA_DIR:-/srv/DATA/AppData/ortbtools}"
DEST_DIR="${ORTBTOOLS_BACKUP_DEST_DIR:-/srv/DATA/Backups/ortbtools}"
SRC="$DATA_DIR/ortbtools.db"
CONTENT_DIR="$DATA_DIR/content-posts"
RETENTION_DAYS=30
DATE=$(date +%Y-%m-%d)
MODE="nightly"
if [ "${1:-}" = "--pre-deploy" ]; then
  MODE="pre-deploy"
  DATE="$(date +%Y-%m-%dT%H%M)" # never collide with the nightly archive of the day
fi

mkdir -p "$DEST_DIR"
if [ ! -w "$DEST_DIR" ]; then
  echo "$(date -Is) ERROR: $DEST_DIR is not writable by $(id -un) — run through 'sudo -n' (the directory is root:root 0700 by contract; see docs/OPERATIONS.md)" >&2
  exit 3
fi
chmod 700 "$DEST_DIR" # restrictive even if an older run created it 0755

# ── SQLite ──────────────────────────────────────────────────────────────────
if [ -f "$SRC" ]; then
  DEST="$DEST_DIR/ortbtools-$DATE.db"
  sqlite3 "$SRC" ".backup '$DEST'"
  gzip -f "$DEST"
  chmod 600 "$DEST.gz" # explicit: never inherit a stale 0644 when overwriting same-day
  find "$DEST_DIR" -maxdepth 1 -name "ortbtools-*.db.gz" -mtime +"$RETENTION_DAYS" -delete
  echo "$(date -Is) db backup ok [$MODE]: $DEST.gz ($(stat -c%s "$DEST.gz") bytes)"
else
  echo "$(date -Is) db skip: $SRC does not exist" >&2
fi

# ── content-posts (persistent blog content) ─────────────────────────────────
if [ -d "$CONTENT_DIR" ]; then
  ARCHIVE="$DEST_DIR/content-posts-$DATE.tar.gz"
  TMP="$(mktemp "$DEST_DIR/.content-posts-$DATE.XXXXXX.tmp")"
  # Remove a half-written temp archive if tar/mv fails (set -e would exit mid-run).
  trap 'rm -f "${TMP:-}" 2>/dev/null' EXIT
  # Atomic: write to temp, then move into place.
  tar czf "$TMP" -C "$DATA_DIR" content-posts
  mv -f "$TMP" "$ARCHIVE" # TMP gone after mv → the EXIT trap rm is a no-op
  chmod 600 "$ARCHIVE" # explicit: never inherit a stale 0644 when overwriting same-day
  trap - EXIT
  find "$DEST_DIR" -maxdepth 1 -name "content-posts-*.tar.gz" -mtime +"$RETENTION_DAYS" -delete
  echo "$(date -Is) content backup ok [$MODE]: $ARCHIVE ($(stat -c%s "$ARCHIVE") bytes)"
else
  echo "$(date -Is) content skip: $CONTENT_DIR does not exist (not yet seeded)" >&2
fi
