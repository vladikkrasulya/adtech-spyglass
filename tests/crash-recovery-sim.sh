#!/usr/bin/env bash
#
# Disposable crash/power-loss recovery simulator (used by tests/immutable-image.test.js
# and tests/privacy-floor.test.js).
#
# Mocks docker/git/curl/smoke on PATH and runs the REAL scripts/deploy.sh /
# scripts/rollback.sh against a throwaway DATA_DIR + .env. Purpose: prove the
# crash-safe state machine (LAST_GOOD/ACTIVE → CANDIDATE_STARTING →
# CANDIDATE_READY → ACTIVE) recovers correctly — or fails closed with a clear
# operator action — from a "power loss" at each phase. A power loss mid-script
# cannot be observed by that same (now-dead) process, so each crash point is
# simulated by PRE-SEEDING deploy-state.env with the STATUS that phase would
# have left behind, then running the real script fresh and observing what it
# does. Privacy-floor logic is out of scope here (see privacy-floor.test.js) —
# FLOOR is left unseeded and the mock git always allows ancestry so the state
# machine is what's under test, not the floor guard.
#
# Usage: crash-recovery-sim.sh <scenario> [tag_arg]
#   scenario ∈ { preflight-blocks-candidate-starting, preflight-blocks-candidate-ready,
#                preflight-blocks-rolling-back, preflight-blocks-legacy-deploying,
#                preflight-allows-active, preflight-allows-rolled-back,
#                preflight-allows-critical, preflight-allows-no-state,
#                rollback-works-during-candidate-starting,
#                restart-armed-only-on-full-success,
#                restart-not-armed-on-candidate-up-fail,
#                restart-not-armed-on-total-failure,
#                env-never-pinned-to-failed-candidate }

set -u
SCEN="${1:?scenario required}"
TAG_ARG="${2:-}"
export SCEN

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
BIN="$WORK/bin"
DATA="$WORK/data"
mkdir -p "$BIN" "$DATA"
trap 'rm -rf "$WORK"' EXIT

# ── mock git: HEAD==main==origin/main always clean; floor ancestry always allows
#    (state-machine tests are not floor tests — see privacy-floor.test.js) ──────
cat >"$BIN/git" <<'EOG'
#!/bin/sh
case "$*" in
  "fetch -q origin") exit 0 ;;
  "status --porcelain") exit 0 ;;
  "rev-parse HEAD"|"rev-parse main"|"rev-parse origin/main")
    echo "ffffffffffffffffffffffffffffffffffffffff" ;;
  "rev-parse --short HEAD") echo "abc1234" ;;
  *"rev-parse --verify"*)
    # Strip the ^{commit} suffix and echo back — any syntactically-valid-looking
    # 40-hex or short ref resolves. Floor logic itself is tested elsewhere.
    arg="$3"
    echo "${arg%%^*}" | grep -qE '^[0-9a-fA-F]{7,40}$' && echo "ffffffffffffffffffffffffffffffffffffffff" || echo "ffffffffffffffffffffffffffffffffffffffff"
    ;;
  *"merge-base --is-ancestor"*) exit 0 ;; # always "is an ancestor" — floor always passes
  *) exit 0 ;;
esac
EOG

# ── mock docker: build/tag ok; `compose up` controlled by SCEN; restart-policy
#    arming and compose-up calls are BOTH traced so tests can assert on ORDER,
#    not just final state ──────────────────────────────────────────────────────
cat >"$BIN/docker" <<EOD
#!/bin/sh
case "\$1 \$2" in
  "compose build") exit 0 ;;
  "compose up")
    echo "COMPOSE_UP \${SPYGLASS_TAG:-} STATUS=\$(grep -E '^STATUS=' "$DATA/deploy-state.env" 2>/dev/null | tail -1)" >> "$DATA/compose-trace"
    case "$SCEN" in
      restart-not-armed-on-candidate-up-fail|env-never-pinned-to-failed-candidate)
        if [ "\${SPYGLASS_TAG:-}" = "abc1234" ]; then exit 1; else exit 0; fi ;;
      restart-not-armed-on-total-failure) exit 1 ;;
      *) exit 0 ;;
    esac
    ;;
esac
case "\$1" in
  tag) exit 0 ;;
  update)
    # docker update --restart=<policy> <container>  → trace policy + container +
    # the STATUS on disk AT THE MOMENT of arming (proves ordering, not just result)
    pol="\${2#--restart=}"
    echo "ARM \$pol \$3 STATUS=\$(grep -E '^STATUS=' "$DATA/deploy-state.env" 2>/dev/null | tail -1)" >> "$DATA/restart-trace"
    exit 0
    ;;
  inspect)
    case "\$*" in
      *Health*) echo healthy ;;
      *Image*)  echo "sha256:previmage" ;;
      *)        echo "" ;;
    esac ;;
  image)
    case "\$*" in
      *--format*org.opencontainers.image.revision*) echo "ffffffffffffffffffffffffffffffffffffffff" ;;
      *--format*) echo "BUILD_SHA=prevsha0" ;;
      *) : ;;
    esac ;;
esac
exit 0
EOD

# ── mock curl: /api/health always ok ──
cat >"$BIN/curl" <<'EOC'
#!/bin/sh
for a in "$@"; do
  case "$a" in *api/health*) echo '{"success":true,"status":"ok","build":{"sha":"abc1234"}}'; exit 0 ;; esac
done
exit 0
EOC

# ── mock smoke: passes (compose-up exit codes above drive the failure scenarios) ──
printf '#!/bin/sh\nexit 0\n' >"$BIN/mock-smoke.sh"
chmod +x "$BIN/git" "$BIN/docker" "$BIN/curl" "$BIN/mock-smoke.sh"

printf 'SPYGLASS_TAG=old\n' >"$WORK/.env"
chmod 600 "$WORK/.env"

# Pre-seed deploy-state.env to the STATUS a crash at that phase would have left
# behind. This is the crash simulation: the process that would have written the
# NEXT state is gone; we observe what a FRESH script invocation does next.
write_seed() {
  cat >"$DATA/deploy-state.env" <<EOF
STATUS=$1
ACTIVE_TAG=old
ROLLBACK_TAG=rollback-pre-oldsha
EOF
  chmod 600 "$DATA/deploy-state.env"
}

case "$SCEN" in
  preflight-blocks-candidate-starting) write_seed CANDIDATE_STARTING ;;
  preflight-blocks-candidate-ready) write_seed CANDIDATE_READY ;;
  preflight-blocks-rolling-back) write_seed ROLLING_BACK ;;
  preflight-blocks-legacy-deploying) write_seed DEPLOYING ;;
  preflight-allows-active) write_seed ACTIVE ;;
  preflight-allows-rolled-back) write_seed ROLLED_BACK ;;
  preflight-allows-critical) write_seed CRITICAL ;;
  preflight-allows-no-state) : ;; # no file at all — first-ever deploy
  rollback-works-during-candidate-starting) write_seed CANDIDATE_STARTING ;;
  restart-armed-only-on-full-success | restart-not-armed-on-candidate-up-fail | restart-not-armed-on-total-failure | env-never-pinned-to-failed-candidate)
    write_seed ACTIVE
    ;;
esac

run_deploy() {
  PATH="$BIN:$PATH" \
    SPYGLASS_DEPLOY_DATA_DIR="$DATA" \
    SPYGLASS_DEPLOY_ENV_FILE="$WORK/.env" \
    SMOKE_CMD="$BIN/mock-smoke.sh" \
    SPYGLASS_SEED_UID="$(id -u)" \
    SPYGLASS_APP_UID="$(id -u)" \
    SPYGLASS_DB_GID="$(id -g)" \
    SPYGLASS_DB_GROUP="$(id -gn)" \
    SPYGLASS_DIR_MODE="2710" \
    READY_TIMEOUT=6 \
    bash "$REPO/scripts/deploy.sh" >"$WORK/stdout.log" 2>&1
  echo $?
}

run_rollback() {
  PATH="$BIN:$PATH" \
    SPYGLASS_DEPLOY_DATA_DIR="$DATA" \
    SPYGLASS_DEPLOY_ENV_FILE="$WORK/.env" \
    SMOKE_CMD="$BIN/mock-smoke.sh" \
    SPYGLASS_BASE_URL="http://127.0.0.1:8090" \
    SPYGLASS_CONTAINER="adtech-spyglass" \
    READY_TIMEOUT=6 \
    bash "$REPO/scripts/rollback.sh" "$TAG_ARG" >"$WORK/stdout.log" 2>&1
  echo $?
}

chmod 2710 "$DATA" # satisfy the always-on check_db_perms dir contract

case "$SCEN" in
  rollback-works-during-candidate-starting)
    [ -n "$TAG_ARG" ] || TAG_ARG="rollback-pre-oldsha"
    rc="$(run_rollback)"
    ;;
  *)
    rc="$(run_deploy)"
    ;;
esac

echo "EXIT=$rc"
if [ -f "$DATA/deploy-state.env" ]; then cat "$DATA/deploy-state.env"; else echo "(no state)"; fi
echo "ENV_SPYGLASS_TAG=$(grep -E '^SPYGLASS_TAG=' "$WORK/.env" | cut -d= -f2)"
if [ -f "$DATA/compose-trace" ]; then
  echo "COMPOSE_UP_CALLS=$(wc -l < "$DATA/compose-trace" | tr -d ' ')"
else
  echo "COMPOSE_UP_CALLS=0"
fi
echo "--- compose-trace ---"
cat "$DATA/compose-trace" 2>/dev/null
echo "--- restart-trace ---"
cat "$DATA/restart-trace" 2>/dev/null
echo "--- stdout ---"
cat "$WORK/stdout.log"
exit "$rc"
