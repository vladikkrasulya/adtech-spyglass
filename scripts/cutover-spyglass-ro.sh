#!/usr/bin/env bash
#
# cutover-spyglass-ro.sh — coordinated security cutover for the Grafana read-only
# SQLite contract (v1.1.7). Runs as the HOST user (e.g. vk), NOT root; escalates
# only via `sudo -n` for the provisioning step.
#
# Orchestration:
#   gate → apply host perms (provision --apply) → deploy app (deploy.sh)
#   • deploy succeeds + v1.1.7 active        → STATUS=SECURITY_CUTOVER, exit 0
#   • deploy fails + v1.1.7 NOT active       → roll host perms back to baseline,
#                                              return the deploy's ORIGINAL code
#   • host permission rollback ALSO fails    → STATUS=CRITICAL, exit 9
#   • provision --apply fails (no deploy)    → STATUS=ABORTED, exit 2
#
# Usage:
#   cutover-spyglass-ro.sh            # DRY-RUN (default): gates + plan, change nothing
#   cutover-spyglass-ro.sh --apply    # cutover from a clean v1.1.6 baseline
#   cutover-spyglass-ro.sh --recover  # explicit recovery from a half-applied state
#
# NEVER copies/replaces the DB; NEVER recursive chmod/chgrp (provision does the
# file work). State is written 0600 with no secrets.

set -uo pipefail # deliberately NOT -e: we handle failures to coordinate rollback
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/deploy-lib.sh
. "$REPO/scripts/deploy-lib.sh"

DATA_DIR="${SPYGLASS_DEPLOY_DATA_DIR:-/srv/DATA/AppData/adtech-spyglass}"
STATE="$DATA_DIR/cutover-state.env"
BASE="${SPYGLASS_BASE_URL:-http://127.0.0.1:8090}"
GRAFANA="${SPYGLASS_GRAFANA_CONTAINER:-grafana}"
GRAFANA_DB="${SPYGLASS_GRAFANA_DB:-/var/lib/grafana/spyglass-data/spyglass.db}"
DB_GID="${SPYGLASS_DB_GID:-2472}"
DIR_MODE="${SPYGLASS_DIR_MODE:-2710}"
APP_UID="${SPYGLASS_APP_UID:-1000}"
EXPECT_PREV_SHA="${SPYGLASS_EXPECT_PREV_SHA:-7715045}" # v1.1.6, pre-cutover
TARGET_VER="v$(node -p "require('$REPO/package.json').version" 2>/dev/null || echo 1.1.7)"

# Overridable hooks (real defaults; the disposable sim injects mocks):
SUDO="${SPYGLASS_SUDO-sudo -n}"
PROVISION="${SPYGLASS_PROVISION_CMD:-$REPO/scripts/provision-spyglass-ro.sh}"
DEPLOY="${SPYGLASS_DEPLOY_CMD:-$REPO/scripts/deploy.sh}"

MODE="${1:-}"
now() { date -Is 2>/dev/null || date; }
active_sha() { curl -fsS --max-time 5 "$BASE/api/health" 2>/dev/null | sed -n 's/.*"sha":"\([^"]*\)".*/\1/p'; }
target_sha() { git -C "$REPO" rev-parse --short HEAD 2>/dev/null; }

state() { { for kv in "$@"; do echo "$kv"; done; echo "UPDATED_AT=$(now)"; } | write_state "$STATE"; }
run_provision() { $SUDO $PROVISION "--$1"; }
run_deploy() { $DEPLOY; }

perms_applied() { check_db_perms "$DATA_DIR" "$APP_UID" "$DB_GID" "$DIR_MODE" >/dev/null 2>&1; }
perms_baseline() { [ "$(_stat_mode "$DATA_DIR/spyglass.db" 2>/dev/null)" = 644 ]; }
grafana_reads() { docker exec "$GRAFANA" sh -c "dd if='$GRAFANA_DB' bs=1 count=1 >/dev/null 2>&1"; }

# ── A. final gates (read-only) ──────────────────────────────────────────────
gate() {
  local bad=0 cur
  $SUDO true 2>/dev/null || { echo "  GATE FAIL: sudo -n unavailable"; bad=1; }
  [ -z "$(git -C "$REPO" status --porcelain 2>/dev/null)" ] || { echo "  GATE FAIL: working tree dirty"; bad=1; }
  docker exec "$GRAFANA" id 2>/dev/null | grep -qwE "$DB_GID" || { echo "  GATE FAIL: grafana not in group ${DB_GID} (run CP3A first)"; bad=1; }
  cur="$(active_sha)"
  [ -n "$cur" ] || { echo "  GATE FAIL: cannot read active BUILD_SHA"; bad=1; }
  [ -d "$DATA_DIR" ] || { echo "  GATE FAIL: data dir ${DATA_DIR} missing"; bad=1; }
  echo "  gate: active=${cur:-?} target=$(target_sha) grafana-group=ok? perms_applied=$(perms_applied && echo yes || echo no)"
  return $bad
}

# ── core cutover (apply perms → deploy → success / coordinated rollback) ─────
cutover() {
  local recover="$1" cur target rc
  cur="$(active_sha)"
  target="$(target_sha)"

  if [ "$recover" != recover ]; then
    # idempotency + baseline guards (skipped in --recover)
    if [ -f "$STATE" ] && grep -q '^STATUS=SECURITY_CUTOVER' "$STATE" 2>/dev/null; then
      echo "ABORT: cutover already completed (STATUS=SECURITY_CUTOVER). Use --recover to re-attempt."
      return 2
    fi
    if [ "$cur" != "$EXPECT_PREV_SHA" ]; then
      echo "ABORT: active BUILD_SHA '${cur}' != expected pre-cutover '${EXPECT_PREV_SHA}' (already cut over? use --recover)"
      return 2
    fi
    if perms_applied; then
      echo "ABORT: host perms already applied while app is '${cur}' (half state) — use --recover"
      return 2
    fi
  fi

  state "STATUS=APPLYING" "TARGET=${TARGET_VER}" "HOST_PERMS=BASELINE" "APP_DEPLOY=NONE" "STARTED_AT=$(now)"

  # B. apply host perms
  if ! run_provision apply; then
    echo "ABORT: host permission apply FAILED — deploy NOT started (perms remain baseline)"
    state "STATUS=ABORTED" "HOST_PERMS=BASELINE" "APP_DEPLOY=NONE"
    return 2
  fi
  state "HOST_PERMS=APPLIED"

  # C. deploy the app
  run_deploy
  rc=$?
  cur="$(active_sha)"

  # D. success
  if [ "$rc" = 0 ] && [ "$cur" = "$target" ]; then
    state "STATUS=SECURITY_CUTOVER" "HOST_PERMS=APPLIED" "APP_DEPLOY=ACTIVE" "ACTIVE_BUILD_SHA=${cur}"
    echo "==> CUTOVER OK: ${TARGET_VER} (${cur}) active + host perms applied (Grafana reads via group, others denied)."
    return 0
  fi

  # E. deploy failed. If v1.1.7 somehow IS active, keep perms (correct for 0640) + report.
  if [ "$cur" = "$target" ]; then
    state "STATUS=ROLLED_BACK" "HOST_PERMS=APPLIED" "APP_DEPLOY=FAILED" "DEPLOY_RC=${rc}"
    echo "==> deploy reported ${rc} but ${target} is active; perms kept. Returning ${rc}."
    return "$rc"
  fi

  # v1.1.7 NOT active → roll host perms back to baseline (controlled).
  echo "==> deploy failed (rc=${rc}, active='${cur}', target='${target}') — rolling host perms back to baseline."
  if run_provision rollback && perms_baseline && grafana_reads; then
    state "STATUS=ROLLED_BACK" "HOST_PERMS=BASELINE" "APP_DEPLOY=ROLLED_BACK" "DEPLOY_RC=${rc}"
    echo "==> host perms restored to baseline (Grafana still reads). Returning original deploy code ${rc}."
    return "$rc"
  fi

  # F. host rollback ALSO failed → CRITICAL.
  state "STATUS=CRITICAL" "HOST_PERMS=UNKNOWN" "APP_DEPLOY=FAILED" "DEPLOY_RC=${rc}"
  echo "==> CRITICAL: host permission rollback FAILED — manual intervention required (deploy rc was ${rc})."
  return 9
}

case "$MODE" in
  --apply)
    if ! gate; then
      echo "ABORT: gate failed — not applying."
      exit 2
    fi
    cutover noop
    exit $?
    ;;
  --recover)
    echo "RECOVER mode: re-applying perms + deploy from the current state."
    gate || true
    cutover recover
    exit $?
    ;;
  "" | --dry-run)
    echo "DRY-RUN (no changes). Re-run with --apply to perform the cutover, --recover to recover."
    echo "Plan: gate → ${PROVISION##*/} --apply (sudo -n) → ${DEPLOY##*/} → verify / coordinated rollback."
    if gate; then echo "  gates: PASS"; else
      echo "  gates: FAIL (fix before --apply)"
      exit 2
    fi
    ;;
  *)
    echo "usage: $0 [--dry-run|--apply|--recover]"
    exit 2
    ;;
esac
