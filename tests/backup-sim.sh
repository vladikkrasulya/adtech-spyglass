#!/usr/bin/env bash
#
# Disposable backup-db.sh permission simulator (used by tests/immutable-image.test.js).
#
# Mocks sqlite3 on PATH (so no real sqlite is needed) and runs the REAL
# scripts/backup-db.sh against throwaway DATA/DEST dirs, then prints the modes of
# the directory + generated archives so the test can assert 0700 / 0600 even when
# the destination directory pre-existed as 0755 (the old, insecure default).
#
# Prints:  DEST_DIR_MODE=<oct>  DB_GZ_MODE=<oct>  CONTENT_GZ_MODE=<oct>

set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
BIN="$WORK/bin"
DATA="$WORK/data"
DEST="$WORK/dest"
mkdir -p "$BIN" "$DATA/content-posts/en" "$DEST"
trap 'rm -rf "$WORK"' EXIT

# Reproduce the insecure pre-existing destination this fix is meant to repair.
chmod 0755 "$DEST"

# A fake "live DB" + a seeded content file (real bytes so gzip/tar have input).
printf 'fake-sqlite-bytes\n' >"$DATA/spyglass.db"
printf '# welcome\n' >"$DATA/content-posts/en/welcome.md"

# Mock sqlite3: `sqlite3 SRC ".backup 'DEST'"` → just copy SRC to DEST so the
# rest of the real script (gzip + chmod + retention) runs unchanged.
cat >"$BIN/sqlite3" <<'EOS'
#!/bin/sh
# args: <src> ".backup 'DEST'"
src="$1"
dest="$(printf '%s' "$2" | sed "s/^\.backup '//; s/'$//")"
cp "$src" "$dest"
EOS
chmod +x "$BIN/sqlite3"

PATH="$BIN:$PATH" \
  SPYGLASS_BACKUP_DATA_DIR="$DATA" \
  SPYGLASS_BACKUP_DEST_DIR="$DEST" \
  bash "$REPO/scripts/backup-db.sh" >/dev/null 2>&1

mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null; }
db_gz="$(find "$DEST" -name 'spyglass-*.db.gz' | head -1)"
ct_gz="$(find "$DEST" -name 'content-posts-*.tar.gz' | head -1)"

echo "DEST_DIR_MODE=$(mode "$DEST")"
echo "DB_GZ_MODE=$([ -n "$db_gz" ] && mode "$db_gz" || echo none)"
echo "CONTENT_GZ_MODE=$([ -n "$ct_gz" ] && mode "$ct_gz" || echo none)"
