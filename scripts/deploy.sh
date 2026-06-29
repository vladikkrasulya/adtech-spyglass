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
PREV_TAG="$(grep -E '^SPYGLASS_TAG=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)"
PREV_IMG="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || echo '')"
PREV_SHA=""
ROLLBACK_TAG="rollback-pre-${VER}"
if [ -n "$PREV_IMG" ]; then
  docker tag "$PREV_IMG" "adtech-spyglass:${ROLLBACK_TAG}"
  PREV_SHA="$(image_build_sha "adtech-spyglass:${ROLLBACK_TAG}" || true)"
  [ -n "$PREV_SHA" ] || { echo "ABORT: previous image carries no verifiable BUILD_SHA — refusing to deploy without a checkable rollback target"; exit 2; }
  echo "    rollback target adtech-spyglass:${ROLLBACK_TAG} (BUILD_SHA=${PREV_SHA})"
fi

# 4. Build the immutable image (provenance via build-args), tag short-sha + version.
BUILD_SHA="$SHA" GIT_SHA="$GIT_SHA" APP_VERSION="$APP_VERSION" SPYGLASS_TAG="$SHA" docker compose build
docker tag "adtech-spyglass:${SHA}" "adtech-spyglass:${VER}"

# 5. Record intent BEFORE the transition (survives a kill/reboot mid-deploy).
write_state "$STATE_FILE" <<EOF
STATUS=DEPLOYING
ATTEMPTING_TAG=${SHA}
ATTEMPTING_BUILD_SHA=${SHA}
ATTEMPTING_GIT_SHA=${GIT_SHA}
PREV_TAG=${PREV_TAG}
PREV_BUILD_SHA=${PREV_SHA}
ROLLBACK_TAG=${ROLLBACK_TAG}
STARTED_AT=$(date -Is)
EOF

# 6. Pin the active tag (atomic, 0600) and bring it up. The `up` is GUARDED so a
#    non-zero exit drops us into the rollback path instead of killing the script.
set_env SPYGLASS_TAG "$SHA" "$ENV_FILE"
deploy_failed=0
if SPYGLASS_TAG="$SHA" docker compose up -d --no-build; then
  if wait_ready "$CONTAINER" "$BASE" "$READY_TIMEOUT"; then
    "$SMOKE_CMD" "$BASE" "$SHA" "$CONTAINER" || { echo "==> smoke failed"; deploy_failed=1; }
  else
    echo "==> NOT READY within ${READY_TIMEOUT}s"; deploy_failed=1
  fi
else
  echo "==> docker compose up FAILED for the new image"; deploy_failed=1
fi

if [ "$deploy_failed" = 0 ]; then
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
DEPLOYED_AT=$(date -Is)
EOF
  echo "==> DEPLOY OK: ${VER} (${SHA}) is live."
  exit 0
fi

# 7. Auto-rollback to the previous self-contained image. The rollback `up` is
#    ALSO guarded.
echo "==> DEPLOY FAILED — auto-rolling back to ${ROLLBACK_TAG} (expect BUILD_SHA=${PREV_SHA:-unknown})"
set_env SPYGLASS_TAG "$ROLLBACK_TAG" "$ENV_FILE"
rollback_ok=0
if [ -n "$PREV_SHA" ] && SPYGLASS_TAG="$ROLLBACK_TAG" docker compose up -d --no-build; then
  if wait_ready "$CONTAINER" "$BASE" "$READY_TIMEOUT" && "$SMOKE_CMD" "$BASE" "$PREV_SHA" "$CONTAINER"; then
    rollback_ok=1
  fi
else
  echo "==> docker compose up FAILED for the rollback image"
fi

if [ "$rollback_ok" = 1 ]; then
  write_state "$STATE_FILE" <<EOF
STATUS=ROLLED_BACK
ACTIVE_TAG=${ROLLBACK_TAG}
ACTIVE_BUILD_SHA=${PREV_SHA}
ROLLBACK_TAG=${ROLLBACK_TAG}
LAST_FAILED_TAG=${SHA}
LAST_FAILED_BUILD_SHA=${SHA}
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
FAILED_AT=$(date -Is)
EOF
  echo "==> CRITICAL: deploy AND rollback failed — manual intervention required."
  exit 3
fi
