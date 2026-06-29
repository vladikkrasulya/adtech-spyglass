#!/usr/bin/env bash
#
# cutover-spyglass-ro.sh — coordinated security cutover for the Grafana read-only
# SQLite contract (v1.1.7). Runs as the HOST user (e.g. vk), NOT root; escalates
# only via `sudo -n` for the provisioning + the stranger-read probe.
#
# Orchestration: gate → apply host perms (provision --apply) → deploy app.
#   • deploy OK + target active + FULL secure-state verified → SECURITY_CUTOVER, 0
#   • target active but deploy non-zero OR secure verify incomplete → DEGRADED
#     (perms NOT rolled back — the app is on target), return rc (or 8 if rc was 0)
#   • target NOT active → roll host perms to baseline; confirm baseline + Grafana
#     read → ROLLED_BACK, return the deploy's original code
#   • provision --apply fails → state is potentially PARTIAL: roll back + confirm
#     baseline; if confirmed → ABORTED (2), else → CRITICAL (9)
#   • any baseline/rollback NOT confirmed → CRITICAL, exit 9
#
# Usage:  cutover-spyglass-ro.sh [--dry-run|--apply|--recover]
# State:  $DATA_DIR/cutover-state.env — ALWAYS a full snapshot (0600, no secrets):
#   STATUS TARGET HOST_PERMS APP_DEPLOY ACTIVE_BUILD_SHA PREV_BUILD_SHA DEPLOY_RC
#   LAST_ERROR STARTED_AT UPDATED_AT
#
# NEVER copies/replaces the DB; NEVER recursive chmod/chgrp.

set -uo pipefail # deliberately NOT -e: failures are handled to coordinate rollback
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/deploy-lib.sh
. "$REPO/scripts/deploy-lib.sh"

DATA_DIR="${SPYGLASS_DEPLOY_DATA_DIR:-/srv/DATA/AppData/adtech-spyglass}"
STATE="$DATA_DIR/cutover-state.env"
BASE="${SPYGLASS_BASE_URL:-http://127.0.0.1:8090}"
GRAFANA="${SPYGLASS_GRAFANA_CONTAINER:-grafana}"
GRAFANA_DB="${SPYGLASS_GRAFANA_DB:-/var/lib/grafana/spyglass-data/spyglass.db}"
SPY_CONTAINER="${SPYGLASS_CONTAINER:-adtech-spyglass}"
DB_GID="${SPYGLASS_DB_GID:-2472}"
DIR_MODE="${SPYGLASS_DIR_MODE:-2710}"
APP_UID="${SPYGLASS_APP_UID:-1000}"
APP_GID="${SPYGLASS_APP_GID:-1000}"
EXPECT_PREV_SHA="${SPYGLASS_EXPECT_PREV_SHA:-7715045}" # v1.1.6, pre-cutover
EXPECT_UMASK="${SPYGLASS_EXPECT_UMASK:-0027}"
STRANGER_UID="${SPYGLASS_STRANGER_UID:-65533}"
TARGET_VER="v$(node -p "require('$REPO/package.json').version" 2>/dev/null || echo 1.1.7)"
DB_FILES="spyglass.db spyglass.db-wal spyglass.db-shm"

SUDO="${SPYGLASS_SUDO-sudo -n}"
PROVISION="${SPYGLASS_PROVISION_CMD:-$REPO/scripts/provision-spyglass-ro.sh}"
DEPLOY="${SPYGLASS_DEPLOY_CMD:-$REPO/scripts/deploy.sh}"
MODE="${1:-}"

# ── state (FULL snapshot every write — never drop a field) ───────────────────
ST_STATUS=NONE ST_HOST_PERMS=UNKNOWN ST_APP_DEPLOY=NONE
ST_ACTIVE_SHA="" ST_PREV_SHA="" ST_DEPLOY_RC="" ST_LAST_ERROR="" ST_STARTED_AT=""
now() { date -Is 2>/dev/null || date; }
snapshot() {
  write_state "$STATE" <<EOF
STATUS=${ST_STATUS}
TARGET=${TARGET_VER}
HOST_PERMS=${ST_HOST_PERMS}
APP_DEPLOY=${ST_APP_DEPLOY}
ACTIVE_BUILD_SHA=${ST_ACTIVE_SHA}
PREV_BUILD_SHA=${ST_PREV_SHA}
DEPLOY_RC=${ST_DEPLOY_RC}
LAST_ERROR=${ST_LAST_ERROR}
STARTED_AT=${ST_STARTED_AT}
UPDATED_AT=$(now)
EOF
}
prev_status() { grep -E '^STATUS=' "$STATE" 2>/dev/null | head -1 | cut -d= -f2; }

active_sha() { curl -fsS --max-time 5 "$BASE/api/health" 2>/dev/null | sed -n 's/.*"sha":"\([^"]*\)".*/\1/p'; }
target_sha() { git -C "$REPO" rev-parse --short HEAD 2>/dev/null; }
run_provision() { $SUDO $PROVISION "--$1"; }
run_deploy() { $DEPLOY; }

# ── precise state predicates (dir + DB/WAL/SHM: owner, group, mode) ──────────
_path_is() { # path uid gid mode
  [ "$(_stat_uid "$1")" = "$2" ] && [ "$(_stat_gid "$1")" = "$3" ] && [ "$(_stat_mode "$1")" = "$4" ]
}
is_secure_state() {
  _path_is "$DATA_DIR" "$APP_UID" "$DB_GID" "$DIR_MODE" || return 1
  for f in $DB_FILES; do
    [ -e "$DATA_DIR/$f" ] || continue
    _path_is "$DATA_DIR/$f" "$APP_UID" "$DB_GID" 640 || return 1
  done
  return 0
}
is_baseline_state() {
  _path_is "$DATA_DIR" "$APP_UID" "$APP_GID" 755 || return 1
  for f in $DB_FILES; do
    [ -e "$DATA_DIR/$f" ] || continue
    _path_is "$DATA_DIR/$f" "$APP_UID" "$APP_GID" 644 || return 1
  done
  return 0
}
pid1_umask_ok() { docker exec "$SPY_CONTAINER" cat /proc/1/status 2>/dev/null | grep -qE "Umask:[[:space:]]*${EXPECT_UMASK}"; }
grafana_reads() { docker exec "$GRAFANA" sh -c "dd if='$GRAFANA_DB' bs=1 count=1 >/dev/null 2>&1"; }
stranger_reads() { $SUDO setpriv --reuid "$STRANGER_UID" --regid "$STRANGER_UID" --groups "$STRANGER_UID" dd if="$DATA_DIR/spyglass.db" bs=1 count=1 >/dev/null 2>&1; }

# verify the FULL secure contract; echoes the first failed check ('' = all ok)
verify_secure() {
  local e=""
  pid1_umask_ok || e="umask!=${EXPECT_UMASK}"
  [ -z "$e" ] && { is_secure_state || e="db-contract"; }
  [ -z "$e" ] && { grafana_reads || e="grafana-cannot-read"; }
  [ -z "$e" ] && { stranger_reads && e="stranger-can-read"; }
  printf '%s' "$e"
  [ -z "$e" ]
}

restore_baseline() { # roll perms back + confirm full baseline + Grafana read
  run_provision rollback
  is_baseline_state && grafana_reads
}

# ── minimum gates (fail-closed; used by --apply AND --recover) ───────────────
gate() {
  local bad=0
  $SUDO true 2>/dev/null || { echo "  GATE FAIL: sudo -n unavailable"; bad=1; }
  [ -z "$(git -C "$REPO" status --porcelain 2>/dev/null)" ] || { echo "  GATE FAIL: working tree dirty"; bad=1; }
  docker exec "$GRAFANA" id 2>/dev/null | grep -qwE "$DB_GID" || { echo "  GATE FAIL: grafana not in group ${DB_GID} (run CP3A)"; bad=1; }
  [ -n "$(active_sha)" ] || { echo "  GATE FAIL: cannot read active BUILD_SHA"; bad=1; }
  [ -d "$DATA_DIR" ] || { echo "  GATE FAIL: data dir ${DATA_DIR} missing"; bad=1; }
  return $bad
}

cutover() {
  local recover="$1" active target rc err
  active="$(active_sha)"
  target="$(target_sha)"

  if [ "$recover" != recover ]; then
    case "$(prev_status)" in
      SECURITY_CUTOVER) echo "ABORT: cutover already completed (STATUS=SECURITY_CUTOVER). Use --recover."; return 2 ;;
      APPLYING | ROLLING_BACK) echo "ABORT: a previous run was interrupted (STATUS=$(prev_status)). Use --recover."; return 2 ;;
    esac
    [ "$active" = "$EXPECT_PREV_SHA" ] || { echo "ABORT: active '${active}' != expected pre-cutover '${EXPECT_PREV_SHA}' (use --recover)"; return 2; }
    is_secure_state && { echo "ABORT: secure perms already applied while app is '${active}' (half state) — use --recover"; return 2; }
  fi

  ST_STARTED_AT="$(now)" ST_PREV_SHA="$active" ST_STATUS=APPLYING ST_HOST_PERMS=BASELINE ST_APP_DEPLOY=NONE
  snapshot

  # apply host perms — on failure the state may be PARTIAL → roll back + confirm
  if ! run_provision apply; then
    ST_HOST_PERMS=PARTIAL ST_LAST_ERROR="provision-apply-failed" ST_STATUS=ROLLING_BACK
    snapshot
    if restore_baseline; then
      ST_STATUS=ABORTED ST_HOST_PERMS=BASELINE
      snapshot
      echo "ABORT: provision --apply failed; perms restored to baseline. Deploy NOT started."
      return 2
    fi
    ST_STATUS=CRITICAL ST_HOST_PERMS=UNKNOWN ST_LAST_ERROR="provision-apply-failed; baseline NOT restored"
    snapshot
    echo "CRITICAL: provision --apply failed AND baseline not restored — manual intervention."
    return 9
  fi
  ST_HOST_PERMS=APPLIED
  snapshot

  # deploy
  run_deploy
  rc=$?
  active="$(active_sha)"
  ST_ACTIVE_SHA="$active" ST_DEPLOY_RC="$rc"

  if [ "$active" = "$target" ]; then
    # app is on the target — NEVER roll perms back here; verify the secure contract
    err="$(verify_secure)"
    if [ "$rc" = 0 ] && [ -z "$err" ]; then
      ST_STATUS=SECURITY_CUTOVER ST_HOST_PERMS=APPLIED ST_APP_DEPLOY=ACTIVE ST_LAST_ERROR=""
      snapshot
      echo "==> CUTOVER OK: ${TARGET_VER} (${active}) active; DB locked 0640 spyglass-ro; Grafana reads, others denied."
      return 0
    fi
    ST_STATUS=DEGRADED ST_APP_DEPLOY=ACTIVE
    is_secure_state && ST_HOST_PERMS=APPLIED || ST_HOST_PERMS=PARTIAL
    ST_LAST_ERROR="${err:-deploy-rc-$rc}"
    snapshot
    echo "==> DEGRADED: target ${active} active but not fully verified (${ST_LAST_ERROR}). Perms NOT rolled back."
    [ "$rc" != 0 ] && return "$rc"
    return 8
  fi

  # target NOT active → restore host baseline (coordinated rollback)
  echo "==> deploy rc=${rc}, target not active (active='${active}') — rolling host perms to baseline."
  ST_STATUS=ROLLING_BACK ST_LAST_ERROR="deploy-rc-${rc};target-not-active"
  snapshot
  if restore_baseline; then
    ST_STATUS=ROLLED_BACK ST_HOST_PERMS=BASELINE ST_APP_DEPLOY=ROLLED_BACK
    snapshot
    echo "==> host perms restored to baseline (Grafana still reads). Returning deploy code ${rc}."
    return "$rc"
  fi
  ST_STATUS=CRITICAL ST_HOST_PERMS=UNKNOWN ST_LAST_ERROR="host rollback failed / baseline not confirmed (deploy-rc-${rc})"
  snapshot
  echo "==> CRITICAL: host permission rollback FAILED / baseline not confirmed — manual intervention."
  return 9
}

case "$MODE" in
  --apply)
    gate || { echo "ABORT: gate failed."; exit 2; }
    cutover noop
    exit $?
    ;;
  --recover)
    echo "RECOVER mode: minimum gates still fail-closed."
    gate || { echo "ABORT: gate failed (recover requires the minimum gates)."; exit 2; }
    cutover recover
    exit $?
    ;;
  "" | --dry-run)
    echo "DRY-RUN (no changes). --apply to cut over, --recover from a half state."
    echo "  active=$(active_sha) target=$(target_sha) secure_now=$(is_secure_state && echo yes || echo no) baseline_now=$(is_baseline_state && echo yes || echo no)"
    if gate; then echo "  gates: PASS"; else
      echo "  gates: FAIL"
      exit 2
    fi
    ;;
  *)
    echo "usage: $0 [--dry-run|--apply|--recover]"
    exit 2
    ;;
esac
