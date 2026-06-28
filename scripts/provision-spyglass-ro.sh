#!/usr/bin/env bash
#
# provision-spyglass-ro.sh — idempotent host setup for the Grafana read-only
# shared-group SQLite access contract (adtech-spyglass v1.1.7+).
#
# Grants Grafana (uid 472, joined to group spyglass-ro via the grafana-stack
# `group_add`) READ access to the live SQLite while removing world ("other")
# access. NON-RECURSIVE by construction: ONLY the AppData dir + spyglass.db/-wal/
# -shm are touched. content-posts and deploy-state.env are NEVER opened up.
#
# Usage (run as root on core):
#   provision-spyglass-ro.sh             # DRY-RUN (default): show plan + state, change nothing
#   provision-spyglass-ro.sh --apply     # apply the contract (backup first)
#   provision-spyglass-ro.sh --rollback  # revert to 1000:1000 / 0644 / 0755 (NON-RECURSIVE)
#
# Never prints DB contents. Pair with grafana-stack `group_add: ["2472"]` + the
# v1.1.7 image (umask 027). See docs/OPERATIONS.md.

set -euo pipefail

GID="${SPYGLASS_DB_GID:-2472}"
GROUP="${SPYGLASS_DB_GROUP:-spyglass-ro}"
APPDATA="${SPYGLASS_APPDATA:-/srv/DATA/AppData/adtech-spyglass}"
APP_UID="${SPYGLASS_APP_UID:-1000}"
DIR_MODE="${SPYGLASS_DIR_MODE:-2710}"
GRAFANA_UID="${SPYGLASS_GRAFANA_UID:-472}"
DB_FILES=(spyglass.db spyglass.db-wal spyglass.db-shm)
MODE="${1:-}"

require_root() { [ "$(id -u)" = 0 ] || { echo "ABORT: must run as root"; exit 1; }; }

ensure_group() { # $1 = apply|plan
  if getent group "$GID" >/dev/null; then
    local cur
    cur="$(getent group "$GID" | cut -d: -f1)"
    [ "$cur" = "$GROUP" ] || { echo "ABORT: GID ${GID} already used by group '${cur}' (collision)"; exit 1; }
    echo "  group ${GROUP} (GID ${GID}) already present"
  elif [ "$1" = apply ]; then
    groupadd -g "$GID" "$GROUP"
    echo "  created group ${GROUP} (GID ${GID})"
  else
    echo "  WOULD: groupadd -g ${GID} ${GROUP}"
  fi
}

show_state() {
  echo "  current:"
  stat -c '    %a %u:%g  %n' "$APPDATA" 2>/dev/null || true
  for f in "${DB_FILES[@]}" deploy-state.env; do
    [ -e "$APPDATA/$f" ] && stat -c "    %a %u:%g  %n" "$APPDATA/$f"
  done
}

verify() { # access checks — reads are discarded (never prints DB contents)
  echo "  === verification ==="
  echo "  AppData:          $(stat -c '%a %u:%g' "$APPDATA")  (want ${DIR_MODE} ${APP_UID}:${GID})"
  for f in "${DB_FILES[@]}"; do
    [ -e "$APPDATA/$f" ] && echo "  ${f}: $(stat -c '%a %u:%g' "$APPDATA/$f")  (want 640 ${APP_UID}:${GID})"
  done
  echo "  deploy-state.env: $(stat -c '%a %u:%g' "$APPDATA/deploy-state.env" 2>/dev/null || echo absent)  (want 600)"
  if command -v setpriv >/dev/null 2>&1 && [ -e "$APPDATA/spyglass.db" ]; then
    setpriv --reuid "$GRAFANA_UID" --regid "$GRAFANA_UID" --groups "$GID" cat "$APPDATA/spyglass.db" >/dev/null 2>&1 \
      && echo "  grafana(${GRAFANA_UID}+${GID}) read DB:   OK"   || echo "  grafana read DB: FAIL"
    setpriv --reuid "$GRAFANA_UID" --regid "$GRAFANA_UID" --groups "$GRAFANA_UID" cat "$APPDATA/spyglass.db" >/dev/null 2>&1 \
      && echo "  grafana-NO-group read DB:    UNEXPECTED-OK" || echo "  grafana-NO-group read DB:    DENY (good)"
    setpriv --reuid 65533 --regid 65533 --groups 65533 cat "$APPDATA/spyglass.db" >/dev/null 2>&1 \
      && echo "  stranger read DB:            UNEXPECTED-OK" || echo "  stranger read DB:            DENY (good)"
    setpriv --reuid "$GRAFANA_UID" --regid "$GRAFANA_UID" --groups "$GID" cat "$APPDATA/deploy-state.env" >/dev/null 2>&1 \
      && echo "  grafana read deploy-state:   UNEXPECTED-OK" || echo "  grafana read deploy-state:   DENY (good)"
  fi
}

apply() {
  require_root
  echo "==> 1. backup first"
  bash "$(dirname "$0")/backup-db.sh"
  echo "==> 2. group"
  ensure_group apply
  echo "==> 3. AppData dir: chgrp ${GROUP} + chmod ${DIR_MODE} (setgid; NON-recursive)"
  chgrp "$GID" "$APPDATA"
  chmod "$DIR_MODE" "$APPDATA"
  echo "==> 4. DB files ONLY: chgrp ${GROUP} + chmod 0640 (explicit list — never -R)"
  for f in "${DB_FILES[@]}"; do
    [ -e "$APPDATA/$f" ] && { chgrp "$GID" "$APPDATA/$f"; chmod 0640 "$APPDATA/$f"; echo "    ${f} -> 0640 ${APP_UID}:${GID}"; }
  done
  echo "==> 5. invariant: deploy-state.env forced 0600 (owner-only); content-posts untouched"
  [ -e "$APPDATA/deploy-state.env" ] && chmod 0600 "$APPDATA/deploy-state.env"
  verify
}

rollback() {
  require_root
  echo "==> ROLLBACK (NON-RECURSIVE): DB files + AppData -> 1000:1000 / 0644 / 0755"
  for f in "${DB_FILES[@]}"; do
    [ -e "$APPDATA/$f" ] && { chgrp "$APP_UID" "$APPDATA/$f"; chmod 0644 "$APPDATA/$f"; echo "    ${f} -> 0644 ${APP_UID}:${APP_UID}"; }
  done
  chgrp "$APP_UID" "$APPDATA"
  chmod 0755 "$APPDATA" # clears setgid
  echo "    deploy-state.env left 0600; content-posts untouched; group ${GROUP} left intact (groupdel ${GROUP} manually if abandoning)"
  verify
}

case "$MODE" in
  --apply) apply ;;
  --rollback) rollback ;;
  "" | --dry-run)
    echo "DRY-RUN (no changes). Re-run with --apply to apply, --rollback to revert."
    echo "Contract: AppData ${APP_UID}:${GID} ${DIR_MODE} (setgid) | DB/-wal/-shm ${APP_UID}:${GID} 0640 | deploy-state 0600."
    ensure_group plan
    show_state
    ;;
  *)
    echo "usage: $0 [--dry-run|--apply|--rollback]"
    exit 2
    ;;
esac
