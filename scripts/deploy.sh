#!/usr/bin/env bash
#
# Immutable production deploy for Spyglass.
#
# Builds a self-contained image from a CLEAN main == origin/main checkout, seeds
# the persistent blog content, records intent (STATUS=DEPLOYING) BEFORE switching
# anything, pins the image tag in .env (auto-read by compose), waits for
# readiness, runs the non-destructive smoke, and AUTO-ROLLS-BACK to the previous
# image on any failure. Every `docker compose up` is guarded so `set -e` can't
# kill the script before a rollback is attempted. Never touches /data SQLite or
# persistent content, never re-adds source mounts.
#
# Run on the host: ./scripts/deploy.sh
#
# Env overrides (for tests / non-default hosts):
#   SPYGLASS_DEPLOY_DATA_DIR  default /srv/DATA/AppData/adtech-spyglass
#   SPYGLASS_DEPLOY_ENV_FILE  default <repo>/.env
#   SMOKE_CMD                 default <repo>/scripts/smoke.sh
#   SPYGLASS_SEED_UID         default 1000 (expected owner uid of the content dir)
#   SPYGLASS_BASE_URL         default http://127.0.0.1:8090
#   SPYGLASS_CONTAINER        default adtech-spyglass

set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
# shellcheck source=scripts/deploy-lib.sh
. "$REPO/scripts/deploy-lib.sh"

DATA_DIR="${SPYGLASS_DEPLOY_DATA_DIR:-/srv/DATA/AppData/adtech-spyglass}"
ENV_FILE="${SPYGLASS_DEPLOY_ENV_FILE:-$REPO/.env}"
SMOKE_CMD="${SMOKE_CMD:-$REPO/scripts/smoke.sh}"
SEED_UID="${SPYGLASS_SEED_UID:-1000}"
BASE="${SPYGLASS_BASE_URL:-http://127.0.0.1:8090}"
CONTAINER="${SPYGLASS_CONTAINER:-adtech-spyglass}"
STATE_FILE="$DATA_DIR/deploy-state.env" # OUT of the git working tree
CONTENT_DST="$DATA_DIR/content-posts"
READY_TIMEOUT="${READY_TIMEOUT:-120}"

APP_VERSION="$(node -p "require('./package.json').version")"
VER="v${APP_VERSION}"

# RUNTIME floor from the deploy-state (parsed as DATA via state_get — never
# sourced, symlink-refusing, charset-sanitized). This may only RAISE the bar; the
# immutable PRIVACY_BASELINE_SHA (deploy-lib.sh) is ALWAYS enforced even when this
# is empty/missing/malformed. So a wiped or reset state can never disable the floor.
FLOOR="$(state_get "$STATE_FILE" PRIVACY_FLOOR_BUILD_SHA)"

# 0. Crash-safety preflight — refuse to start a NEW deploy on top of a state left
#    mid-transition by a crash/reboot/kill during a PRIOR attempt. We do not know
#    what, if anything, is actually running in that case, and piling a new deploy
#    attempt on unknown container state is exactly the silent-candidate risk this
#    guard exists to prevent. This is a FAIL-CLOSED, EXPLICIT-OPERATOR-ACTION gate:
#    the fix is to investigate (`docker ps`, `cat deploy-state.env`, `curl
#    /api/health`) and run `scripts/rollback.sh` to restore a known-good image
#    before retrying deploy.sh — never to silently proceed. See docs/OPERATIONS.md
#    "crash-safe deploy state machine".
PRIOR_STATUS="$(state_get "$STATE_FILE" STATUS)"
if is_inflight_status "$PRIOR_STATUS"; then
  echo "ABORT: deploy-state.env STATUS=${PRIOR_STATUS} — a prior deploy/rollback was left mid-transition."
  echo "       Do NOT retry blindly. Investigate what is actually running:"
  echo "         docker ps --filter name=${CONTAINER:-adtech-spyglass}"
  echo "         cat ${STATE_FILE}"
  echo "         curl -fsS ${SPYGLASS_BASE_URL:-http://127.0.0.1:8090}/api/health"
  echo "       Then restore a known-good image explicitly: ./scripts/rollback.sh"
  exit 7
fi

# 1. Gate — deploy only from a clean main == origin/main.
git fetch -q origin
[ -z "$(git status --porcelain)" ] || { echo "ABORT: working tree is dirty"; exit 2; }
HEAD="$(git rev-parse HEAD)"
[ "$HEAD" = "$(git rev-parse main)" ] && [ "$HEAD" = "$(git rev-parse origin/main)" ] || {
  echo "ABORT: HEAD != main == origin/main"; exit 2; }
GIT_SHA="$HEAD"
SHA="$(git rev-parse --short HEAD)"
echo "==> Deploying ${VER}  (full=${GIT_SHA}  short=${SHA})"

# 1b. Permission preflight — refuse to deploy if a deploy-critical file has unsafe
#     permissions (.env not 0600, deploy-state not 0600, AppData/live-DB
#     world-writable). Runs BEFORE any seeding or transition. Prints only file
#     names + modes, never secrets or DB contents.
if ! check_perms "$ENV_FILE" "$STATE_FILE" "$DATA_DIR"; then
  echo "ABORT: unsafe permissions on deploy-critical files (see UNSAFE: lines above) — fix before deploying"
  exit 5
fi

# 1c. SQLite group/mode contract (v1.1.7+) — ALWAYS enforced, no bypass. The live
#     DB must be owner 1000, group spyglass-ro (GID 2472), 0640 (no "other"); the
#     group must exist with the canonical name. Defaults are the production
#     contract; the four params exist ONLY so disposable tests can point at a
#     test-owned dir/group — they cannot DISABLE the check. Abort BEFORE
#     build/recreate so the umask 027 image never ships onto an un-provisioned host
#     (which would break Grafana's read).
SPYGLASS_APP_UID="${SPYGLASS_APP_UID:-1000}"
SPYGLASS_DB_GID="${SPYGLASS_DB_GID:-2472}"
SPYGLASS_DB_GROUP="${SPYGLASS_DB_GROUP:-spyglass-ro}"
SPYGLASS_DIR_MODE="${SPYGLASS_DIR_MODE:-2710}"
if ! check_group "$SPYGLASS_DB_GID" "$SPYGLASS_DB_GROUP"; then
  echo "ABORT: group ${SPYGLASS_DB_GROUP} (GID ${SPYGLASS_DB_GID}) missing or mismatched — run scripts/provision-spyglass-ro.sh (root) first"
  exit 6
fi
if ! check_db_perms "$DATA_DIR" "$SPYGLASS_APP_UID" "$SPYGLASS_DB_GID" "$SPYGLASS_DIR_MODE"; then
  echo "ABORT: SQLite group/mode contract not provisioned — run scripts/provision-spyglass-ro.sh (root) first (see UNSAFE: lines)"
  exit 6
fi

# 2. Idempotent content seed BEFORE launching the new image. rsync --ignore-existing
#    never overwrites runtime-promoted posts; the dir must be writable by the
#    container's uid (SEED_UID, default 1000).
echo "==> Seeding persistent content at ${CONTENT_DST}"
mkdir -p "$CONTENT_DST"/en "$CONTENT_DST"/uk "$CONTENT_DST"/ru
rsync -a --ignore-existing content/posts/ "$CONTENT_DST"/
OWNER_UID="$(stat -c %u "$CONTENT_DST" 2>/dev/null || stat -f %u "$CONTENT_DST")"
[ "$OWNER_UID" = "$SEED_UID" ] || { echo "ABORT: ${CONTENT_DST} owned by uid ${OWNER_UID}; container runs as uid ${SEED_UID} — chown it first"; exit 4; }
for l in en uk ru; do
  [ -f "$CONTENT_DST/$l/welcome.md" ] || { echo "ABORT: content seed failed — missing $l/welcome.md"; exit 4; }
done
echo "    seed ok (en/uk/ru welcome.md present, owner uid ${SEED_UID})"

# 3. Capture previous state for rollback (image + its real BUILD_SHA). If a
#    previous container exists but we CANNOT read a verifiable BUILD_SHA from its
#    image, ABORT before touching .env or the running container — never deploy
#    without a verifiable rollback target.
#
#    ROLLBACK_TAG is keyed by the PREVIOUS image's own immutable BUILD_SHA, NOT
#    by APP_VERSION. Two deploys under an unchanged/unbumped version (e.g. a
#    same-version retry after a failed attempt, or a hotfix that forgot to bump
#    SemVer) must never collide on the same tag name and silently overwrite a
#    DIFFERENT commit's rollback target. A SHA-keyed name is unique per distinct
#    build: retagging the SAME commit again is a harmless no-op, and retagging a
#    DIFFERENT commit never clobbers an existing distinct rollback pointer.
PREV_TAG="$(grep -E '^SPYGLASS_TAG=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)"
PREV_IMG="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || echo '')"
PREV_SHA=""
ROLLBACK_TAG=""
if [ -n "$PREV_IMG" ]; then
  PREV_SHA="$(image_build_sha "$PREV_IMG" || true)"
  [ -n "$PREV_SHA" ] || { echo "ABORT: previous image carries no verifiable BUILD_SHA — refusing to deploy without a checkable rollback target"; exit 2; }
  ROLLBACK_TAG="rollback-pre-${PREV_SHA}"
  docker tag "$PREV_IMG" "adtech-spyglass:${ROLLBACK_TAG}"
  if ! image_contains_privacy_floor "adtech-spyglass:${ROLLBACK_TAG}" "$FLOOR"; then
    echo "ABORT: previous image does not contain privacy floor ${FLOOR} — refusing to deploy"
    exit 2
  fi
  echo "    rollback target adtech-spyglass:${ROLLBACK_TAG} (BUILD_SHA=${PREV_SHA})"
fi

# 4. Build the immutable image (provenance via build-args), tag short-sha + version.
BUILD_SHA="$SHA" GIT_SHA="$GIT_SHA" APP_VERSION="$APP_VERSION" SPYGLASS_TAG="$SHA" docker compose build
docker tag "adtech-spyglass:${SHA}" "adtech-spyglass:${VER}"

if ! image_contains_privacy_floor "adtech-spyglass:${SHA}" "$FLOOR"; then
  echo "ABORT: candidate image does not contain privacy floor ${FLOOR} — refusing to deploy"
  exit 2
fi

# 5. Record intent BEFORE the transition (survives a kill/reboot mid-deploy).
#    State machine: LAST_GOOD(=ACTIVE) → CANDIDATE_STARTING → CANDIDATE_READY →
#    ACTIVE. The candidate container is brought up WITHOUT pinning .env and
#    WITHOUT arming restart:always — see docker-compose.yml `restart: 'no'`.
#    Recovery-on-boot from THIS phase: nothing runs. `.env` still names the
#    LAST_GOOD tag (unchanged until verified below), and the candidate container
#    (if it was even created before the crash) has NO restart policy armed, so
#    Docker's own restart-manager brings nothing back — a crash/reboot here fails
#    closed, never silently promoting an unverified candidate.
write_state "$STATE_FILE" <<EOF
STATUS=CANDIDATE_STARTING
ATTEMPTING_TAG=${SHA}
ATTEMPTING_BUILD_SHA=${SHA}
ATTEMPTING_GIT_SHA=${GIT_SHA}
PREV_TAG=${PREV_TAG}
PREV_BUILD_SHA=${PREV_SHA}
ROLLBACK_TAG=${ROLLBACK_TAG}
PRIVACY_FLOOR_BUILD_SHA=${FLOOR}
STARTED_AT=$(date -Is)
EOF

# 6. Bring the candidate up (tag passed inline — `.env` is NOT touched yet). The
#    `up` is GUARDED so a non-zero exit drops us into the rollback path instead
#    of killing the script.
deploy_failed=0
if SPYGLASS_TAG="$SHA" docker compose up -d --no-build; then
  if wait_ready "$CONTAINER" "$BASE" "$READY_TIMEOUT"; then
    # CANDIDATE_READY: healthy, but NOT yet smoke-verified or committed. Same
    # recovery-on-boot as CANDIDATE_STARTING — restart policy is still 'no'.
    write_state "$STATE_FILE" <<EOF
STATUS=CANDIDATE_READY
ATTEMPTING_TAG=${SHA}
ATTEMPTING_BUILD_SHA=${SHA}
ATTEMPTING_GIT_SHA=${GIT_SHA}
PREV_TAG=${PREV_TAG}
PREV_BUILD_SHA=${PREV_SHA}
ROLLBACK_TAG=${ROLLBACK_TAG}
PRIVACY_FLOOR_BUILD_SHA=${FLOOR}
STARTED_AT=$(date -Is)
EOF
    "$SMOKE_CMD" "$BASE" "$SHA" "$CONTAINER" || { echo "==> smoke failed"; deploy_failed=1; }
  else
    echo "==> NOT READY within ${READY_TIMEOUT}s"; deploy_failed=1
  fi
else
  echo "==> docker compose up FAILED for the new image"; deploy_failed=1
fi

if [ "$deploy_failed" = 0 ]; then
  # COMMIT to ACTIVE: only NOW — after wait_ready AND smoke both passed — do we
  # pin `.env` (so a manual/scripted `docker compose up -d` recovery reconstructs
  # THIS verified image) and arm restart:always in place (so Docker's own
  # restart-manager may auto-heal THIS verified image after a future crash).
  # Recovery-on-boot from ACTIVE: safe and automatic — this is the only phase
  # where that is true.
  set_env SPYGLASS_TAG "$SHA" "$ENV_FILE"
  arm_restart_policy "$CONTAINER" always
  write_state "$STATE_FILE" <<EOF
STATUS=ACTIVE
ACTIVE_TAG=${SHA}
ACTIVE_VERSION=${VER}
ACTIVE_BUILD_SHA=${SHA}
ACTIVE_GIT_SHA=${GIT_SHA}
PREV_TAG=${PREV_TAG}
PREV_BUILD_SHA=${PREV_SHA}
ROLLBACK_TAG=${ROLLBACK_TAG}
LAST_FAILED_TAG=
PRIVACY_FLOOR_BUILD_SHA=${FLOOR}
DEPLOYED_AT=$(date -Is)
EOF
  echo "==> DEPLOY OK: ${VER} (${SHA}) is live."
  exit 0
fi

# 7. Auto-rollback to the previous self-contained image. The rollback `up` is
#    ALSO guarded. Same discipline as the candidate: `.env` and restart:always
#    are committed ONLY after wait_ready + smoke both pass on the ROLLBACK image
#    too — a crash mid-rollback-attempt must fail closed exactly like a crash
#    mid-candidate-deploy, never silently promoting an unverified rollback image.
echo "==> DEPLOY FAILED — auto-rolling back to ${ROLLBACK_TAG} (expect BUILD_SHA=${PREV_SHA:-unknown})"
rollback_ok=0
if ! image_contains_privacy_floor "adtech-spyglass:${ROLLBACK_TAG}" "$FLOOR"; then
  echo "==> CRITICAL: rollback target tampered/unsafe (missing privacy floor) — aborting rollback"
else
  write_state "$STATE_FILE" <<EOF
STATUS=ROLLING_BACK
ATTEMPTING_TAG=${ROLLBACK_TAG}
ATTEMPTING_BUILD_SHA=${PREV_SHA}
PREV_TAG=${PREV_TAG}
ROLLBACK_TAG=${ROLLBACK_TAG}
LAST_FAILED_TAG=${SHA}
PRIVACY_FLOOR_BUILD_SHA=${FLOOR}
STARTED_AT=$(date -Is)
EOF
  if [ -n "$PREV_SHA" ] && SPYGLASS_TAG="$ROLLBACK_TAG" docker compose up -d --no-build; then
    if wait_ready "$CONTAINER" "$BASE" "$READY_TIMEOUT" && "$SMOKE_CMD" "$BASE" "$PREV_SHA" "$CONTAINER"; then
      rollback_ok=1
    fi
  else
    echo "==> docker compose up FAILED for the rollback image"
  fi
fi

if [ "$rollback_ok" = 1 ]; then
  set_env SPYGLASS_TAG "$ROLLBACK_TAG" "$ENV_FILE"
  arm_restart_policy "$CONTAINER" always
  write_state "$STATE_FILE" <<EOF
STATUS=ROLLED_BACK
ACTIVE_TAG=${ROLLBACK_TAG}
ACTIVE_BUILD_SHA=${PREV_SHA}
ROLLBACK_TAG=${ROLLBACK_TAG}
LAST_FAILED_TAG=${SHA}
LAST_FAILED_BUILD_SHA=${SHA}
PRIVACY_FLOOR_BUILD_SHA=${FLOOR}
ROLLED_BACK_AT=$(date -Is)
EOF
  echo "==> ROLLBACK OK: restored ${ROLLBACK_TAG} (BUILD_SHA=${PREV_SHA}). DEPLOY FAILED."
  exit 1
else
  write_state "$STATE_FILE" <<EOF
STATUS=CRITICAL
ACTIVE_TAG=UNKNOWN
ACTIVE_BUILD_SHA=UNKNOWN
ROLLBACK_TAG=${ROLLBACK_TAG}
LAST_FAILED_TAG=${SHA}
LAST_FAILED_BUILD_SHA=${SHA}
PRIVACY_FLOOR_BUILD_SHA=${FLOOR}
FAILED_AT=$(date -Is)
EOF
  echo "==> CRITICAL: deploy AND rollback failed — manual intervention required."
  exit 3
fi
