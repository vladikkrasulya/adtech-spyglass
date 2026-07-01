#!/usr/bin/env bash
#
# Disposable deploy.sh flow simulator (used by tests/immutable-image.test.js).
#
# Mocks docker/git/curl on PATH and runs the REAL scripts/deploy.sh against a
# throwaway DATA_DIR + .env, so the control flow (compose-up failures, gate,
# auto-rollback, STATUS state machine) is exercised without docker or git.
#
# Usage: deploy-sim.sh <scenario>
#   scenario ∈ { happy, candidate-up-fail, rollback-up-fail, missing-prev-sha,
#                unsafe-perms, empty-gid, wrong-group }
# Prints:  EXIT=<code> and the resulting deploy-state.env (or "(no state)").
#
# The v1.1.7 SQLite group/mode contract is ALWAYS enforced (no bypass). The sim
# points deploy.sh at a TEST-owned dir/group via the SPYGLASS_APP_UID /
# SPYGLASS_DB_GID / SPYGLASS_DB_GROUP / SPYGLASS_DIR_MODE params (test uid/gid),
# and provisions the DATA dir to mode 2710 — it never disables the check.

set -u
SCEN="${1:?scenario required}"
export SCEN
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
BIN="$WORK/bin"
DATA="$WORK/data"
mkdir -p "$BIN" "$DATA"
chmod 2710 "$DATA" # satisfy the (always-on) check_db_perms dir contract
trap 'rm -rf "$WORK"' EXIT

export DATA="$WORK/data"
export CANDIDATE_REV="cafe000000000000000000000000000000000000"
export PREV_REV="cafe000000000000000000000000000000000000"
FLOOR=""
case "$SCEN" in
  floor-absent) ;;
  floor-safe|floor-rollback-tampered|floor-auto-rollback-success) FLOOR="2437646" ;;
  floor-unsafe-candidate) FLOOR="2437646"; export CANDIDATE_REV="dead000000000000000000000000000000000000" ;;
  floor-unsafe-rollback) FLOOR="2437646"; export PREV_REV="dead000000000000000000000000000000000000" ;;
  floor-candidate-ancestor) FLOOR="2437646"; export CANDIDATE_REV="a43adad666b8eb8601391fa95c6a2b4aad699f63" ;;
  floor-candidate-unrelated) FLOOR="2437646"; export CANDIDATE_REV="bbbb000000000000000000000000000000000000" ;;
  floor-candidate-missing-oci) FLOOR="2437646"; export CANDIDATE_REV="" ;;
  floor-candidate-missing-git) FLOOR="2437646"; export CANDIDATE_REV="beef000000000000000000000000000000000000" ;;
  # State WIPED (no PRIVACY_FLOOR line at all) + a PRE-baseline candidate. Proves
  # the immutable baseline is enforced even with an empty runtime floor: a deleted
  # /reset deploy-state can NOT disable the floor and re-open a pre-privacy image.
  floor-reset-prefloor) export CANDIDATE_REV="a43adad666b8eb8601391fa95c6a2b4aad699f63" ;;
esac
if [ -n "$FLOOR" ]; then
  cat > "$DATA/deploy-state.env" <<EOF
STATUS=ACTIVE
ACTIVE_TAG=old
PRIVACY_FLOOR_BUILD_SHA=$FLOOR
EOF
  chmod 600 "$DATA/deploy-state.env"
fi

# ── mock git: clean tree, HEAD == main == origin/main, short = abc1234 ──
cat >"$BIN/git" <<'EOG'
#!/bin/sh
case "$*" in
  "fetch -q origin") exit 0 ;;
  "status --porcelain") exit 0 ;;
  "rev-parse HEAD"|"rev-parse main"|"rev-parse origin/main")
    echo "ffffffffffffffffffffffffffffffffffffffff" ;;
  "rev-parse --short HEAD") echo "abc1234" ;;
  *"rev-parse --verify"*)
    case "$*" in
      *2437646*) echo "24376462c3fd1988447b26ee69a897190bdeac1a" ;;
      *cafe00*) echo "cafe000000000000000000000000000000000000" ;;
      *dead00*) echo "dead000000000000000000000000000000000000" ;;
      *a43adad*) echo "a43adad666b8eb8601391fa95c6a2b4aad699f63" ;;
      *bbbb00*) echo "bbbb000000000000000000000000000000000000" ;;
      *beef00*) exit 128 ;;
      *) echo "defaultrev" ;;
    esac
    ;;
  *"merge-base --is-ancestor"*)
    if echo "$*" | grep -q "24376462c3fd1988447b26ee69a897190bdeac1a cafe000000000000000000000000000000000000"; then exit 0; fi
    exit 1
    ;;
  *) exit 0 ;;
esac
EOG

# ── mock docker: build/tag ok; `up` driven by SCEN + SPYGLASS_TAG; inspect
#    returns a prev image + healthy; image inspect yields BUILD_SHA (or none) ──
cat >"$BIN/docker" <<'EOD'
#!/bin/sh
case "$1 $2" in
  "compose build") exit 0 ;;
  "compose up")
    echo "COMPOSE_UP_CALLED" >> "$DATA/compose-trace"
    if [ "${SPYGLASS_TAG:-}" = "abc1234" ]; then
      case "$SCEN" in candidate-up-fail|rollback-up-fail|floor-rollback-tampered|floor-auto-rollback-success) exit 1 ;; *) exit 0 ;; esac
    else
      case "$SCEN" in rollback-up-fail) exit 1 ;; *) exit 0 ;; esac
    fi ;;
esac
case "$1" in
  tag) exit 0 ;;
  inspect)
    case "$*" in
      *Health*) echo healthy ;;
      *Image*)  echo "sha256:previmage" ;;
      *)        echo "" ;;
    esac ;;
  image)
    case "$*" in
      *--format*org.opencontainers.image.revision*)
         if echo "$*" | grep -q "rollback-pre"; then
           if [ "$SCEN" = "floor-rollback-tampered" ] && grep -q DEPLOYING "$DATA/deploy-state.env" 2>/dev/null; then
             echo "dead000000000000000000000000000000000000"
           else
             echo "${PREV_REV}"
           fi
         else
           echo "${CANDIDATE_REV}"
         fi
         ;;
      *--format*) case "$SCEN" in missing-prev-sha) : ;; *) echo "BUILD_SHA=prevsha0" ;; esac ;;
      *) : ;;
    esac ;;
esac
exit 0
EOD

# ── mock curl: any /api/health → status ok (so wait_ready passes) ──
cat >"$BIN/curl" <<'EOC'
#!/bin/sh
for a in "$@"; do
  case "$a" in *api/health*) echo '{"success":true,"status":"ok","build":{"sha":"abc1234"}}'; exit 0 ;; esac
done
exit 0
EOC

# ── mock smoke: passes (the `up` failures drive the scenarios) ──
printf '#!/bin/sh\nexit 0\n' >"$BIN/mock-smoke.sh"
chmod +x "$BIN/git" "$BIN/docker" "$BIN/curl" "$BIN/mock-smoke.sh"

# Pre-create a fake .env. Normal scenarios use 0600 so the permission preflight
# passes (and set_env still exercises the owner-preserve path); `unsafe-perms`
# uses 0664 to prove the preflight blocks the deploy before any transition.
printf 'SPYGLASS_TAG=old\n' >"$WORK/.env"
case "$SCEN" in
  unsafe-perms) chmod 664 "$WORK/.env" ;;
  *) chmod 600 "$WORK/.env" ;;
esac

# Point the ALWAYS-ON v1.1.7 contract at the test user's own uid/gid/group + the
# 2710 DATA dir above. `empty-gid` proves an empty value does NOT disable the
# check (it falls back to the real GID 2472, which is absent on the test host →
# exit 6); `wrong-group` proves a name mismatch aborts.
DB_GID="$(id -g)"
DB_GROUP="$(id -gn)"
case "$SCEN" in
  empty-gid) DB_GID="" ;; # → deploy.sh defaults to 2472 (missing here) → exit 6
  wrong-group) DB_GROUP="sg-bogus-$$" ;; # name mismatch → exit 6
esac
PATH="$BIN:$PATH" \
  SPYGLASS_DEPLOY_DATA_DIR="$DATA" \
  SPYGLASS_DEPLOY_ENV_FILE="$WORK/.env" \
  SMOKE_CMD="$BIN/mock-smoke.sh" \
  SPYGLASS_SEED_UID="$(id -u)" \
  SPYGLASS_APP_UID="$(id -u)" \
  SPYGLASS_DB_GID="$DB_GID" \
  SPYGLASS_DB_GROUP="$DB_GROUP" \
  SPYGLASS_DIR_MODE="2710" \
  READY_TIMEOUT=6 \
  bash "$REPO/scripts/deploy.sh" >/dev/null 2>&1
rc=$?

echo "EXIT=$rc"
if [ -f "$DATA/deploy-state.env" ]; then cat "$DATA/deploy-state.env"; else echo "(no state)"; fi
echo "ENV_SPYGLASS_TAG=$(grep -E '^SPYGLASS_TAG=' "$WORK/.env" | cut -d= -f2)"
echo "COMPOSE_UP_CALLS=$(cat "$DATA/compose-trace" 2>/dev/null | wc -l | tr -d ' ')"
exit "$rc"
