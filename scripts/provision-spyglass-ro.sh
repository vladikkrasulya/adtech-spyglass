#!/usr/bin/env bash
#
# provision-spyglass-ro.sh — idempotent host setup for the Grafana read-only
# shared-group SQLite access contract (adtech-spyglass v1.1.7+).
#
# Grants Grafana (uid 472, joined to group spyglass-ro via the grafana-stack
# `group_add`) READ access to the live SQLite while removing world ("other")
# access. NON-RECURSIVE by construction: ONLY the AppData dir + spyglass.db/-wal/
# -shm are touched. content-posts stays 1000:1000 (Grafana never reads it) and
# deploy-state.env stays 0600 — neither is ever opened up.
#
# Usage (run as root on core):
#   provision-spyglass-ro.sh             # DRY-RUN (default): show plan + state, change nothing
#   provision-spyglass-ro.sh --apply     # apply (backup first); FAILS CLOSED if verify mismatches
#   provision-spyglass-ro.sh --rollback  # revert to 1000:1000 / 0644 / 0755 (NON-RECURSIVE)
#
# Never prints DB contents (access probes read at most 1 byte, discarded).

set -euo pipefail
# shellcheck source=scripts/deploy-lib.sh
. "$(dirname "$0")/deploy-lib.sh" # _stat_uid/_stat_gid/_stat_mode/_group_name

GID="${SPYGLASS_DB_GID:-2472}"
GROUP="${SPYGLASS_DB_GROUP:-spyglass-ro}"
APPDATA="${SPYGLASS_APPDATA:-/srv/DATA/AppData/adtech-spyglass}"
APP_UID="${SPYGLASS_APP_UID:-1000}"
APP_GID="${SPYGLASS_APP_GID:-1000}" # the app's OWN group — used for rollback (NOT the same as APP_UID)
DIR_MODE="${SPYGLASS_DIR_MODE:-2710}"
GRAFANA_UID="${SPYGLASS_GRAFANA_UID:-472}"
DB_FILES=(spyglass.db spyglass.db-wal spyglass.db-shm)
MODE="${1:-}"

require_root() { [ "$(id -u)" = 0 ] || { echo "ABORT: must run as root"; exit 1; }; }
require_setpriv() {
  command -v setpriv >/dev/null 2>&1 || { echo "ABORT: setpriv not available — cannot verify access (refusing to apply)"; exit 1; }
}

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
  for f in "${DB_FILES[@]}" deploy-state.env content-posts; do
    [ -e "$APPDATA/$f" ] && stat -c "    %a %u:%g  %n" "$APPDATA/$f"
  done
}

# ── verify: FAILS CLOSED. Accumulates every failure, returns non-zero on any. ──
_probe() { setpriv --reuid "$1" --regid "$2" --groups "$3" dd if="$4" bs=1 count=1 >/dev/null 2>&1; } # 1-byte open probe
_chk() {                                                                                              # path uid gid mode label
  local u g m
  u="$(_stat_uid "$1")"
  g="$(_stat_gid "$1")"
  m="$(_stat_mode "$1")"
  if [ "$u" = "$2" ] && [ "$g" = "$3" ] && [ "$m" = "$4" ]; then
    echo "  OK   ${5}: ${m} ${u}:${g}"
    return 0
  fi
  echo "  FAIL ${5}: ${m} ${u}:${g} (want ${4} ${2}:${3})"
  return 1
}
verify() {
  local bad=0 gname
  require_setpriv
  gname="$(_group_name "$GID")"
  [ "$gname" = "$GROUP" ] || {
    echo "  FAIL group: GID ${GID} is '${gname:-missing}' (want ${GROUP})"
    bad=1
  }
  _chk "$APPDATA" "$APP_UID" "$GID" "$DIR_MODE" "AppData" || bad=1
  for f in "${DB_FILES[@]}"; do
    [ -e "$APPDATA/$f" ] && { _chk "$APPDATA/$f" "$APP_UID" "$GID" 640 "$f" || bad=1; }
  done
  if [ -e "$APPDATA/deploy-state.env" ]; then
    [ "$(_stat_mode "$APPDATA/deploy-state.env")" = 600 ] || {
      echo "  FAIL deploy-state.env mode $(_stat_mode "$APPDATA/deploy-state.env") (want 600)"
      bad=1
    }
  fi
  if [ -e "$APPDATA/spyglass.db" ]; then
    _probe "$GRAFANA_UID" "$GRAFANA_UID" "$GID" "$APPDATA/spyglass.db" && echo "  OK   grafana+group read DB" || { echo "  FAIL grafana+group read DB (expected ALLOW)"; bad=1; }
    _probe "$GRAFANA_UID" "$GRAFANA_UID" "$GRAFANA_UID" "$APPDATA/spyglass.db" && { echo "  FAIL grafana NO-group read DB (expected DENY)"; bad=1; } || echo "  OK   grafana NO-group read DB denied"
    _probe 65533 65533 65533 "$APPDATA/spyglass.db" && { echo "  FAIL stranger read DB (expected DENY)"; bad=1; } || echo "  OK   stranger read DB denied"
    if [ -e "$APPDATA/deploy-state.env" ]; then
      _probe "$GRAFANA_UID" "$GRAFANA_UID" "$GID" "$APPDATA/deploy-state.env" && { echo "  FAIL grafana read deploy-state (expected DENY)"; bad=1; } || echo "  OK   grafana read deploy-state denied"
    fi
    setpriv --reuid "$APP_UID" --regid "$APP_GID" --groups "$APP_GID" sh -c "printf '' >> '$APPDATA/spyglass.db'" 2>/dev/null && echo "  OK   app uid ${APP_UID} write DB" || { echo "  FAIL app uid ${APP_UID} write DB"; bad=1; }
  fi
  if [ "$bad" = 0 ]; then echo "  VERIFY OK"; else echo "VERIFY FAILED"; fi
  return "$bad"
}

apply() {
  require_root
  require_setpriv # refuse to change anything we can't then verify
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
  echo "==> 5. invariants: deploy-state.env forced 0600; content-posts untouched (stays 1000:1000)"
  [ -e "$APPDATA/deploy-state.env" ] && chmod 0600 "$APPDATA/deploy-state.env"
  echo "==> 6. verify (FAILS CLOSED)"
  if verify; then
    echo "==> PROVISION OK"
  else
    echo "==> PROVISION FAILED — contract not satisfied (see VERIFY FAILED above). NOT claiming success."
    exit 1
  fi
}

rollback() {
  require_root
  echo "==> ROLLBACK (NON-RECURSIVE): DB files + AppData -> ${APP_UID}:${APP_GID} / 0644 / 0755"
  for f in "${DB_FILES[@]}"; do
    [ -e "$APPDATA/$f" ] && { chgrp "$APP_GID" "$APPDATA/$f"; chmod 0644 "$APPDATA/$f"; echo "    ${f} -> 0644 ${APP_UID}:${APP_GID}"; }
  done
  chgrp "$APP_GID" "$APPDATA" # APP_GID (1000), NOT APP_UID
  chmod 0755 "$APPDATA"       # clears setgid
  echo "    deploy-state.env left 0600; content-posts untouched; group ${GROUP} left intact (groupdel ${GROUP} manually if abandoning)"
}

case "$MODE" in
  --apply) apply ;;
  --rollback) rollback ;;
  "" | --dry-run)
    echo "DRY-RUN (no changes). Re-run with --apply to apply, --rollback to revert."
    echo "Contract: AppData ${APP_UID}:${GID} ${DIR_MODE} (setgid) | DB/-wal/-shm ${APP_UID}:${GID} 0640 | deploy-state 0600 | content-posts ${APP_UID}:${APP_GID} (untouched)."
    ensure_group plan
    show_state
    ;;
  *)
    echo "usage: $0 [--dry-run|--apply|--rollback]"
    exit 2
    ;;
esac
