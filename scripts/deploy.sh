#!/usr/bin/env bash
#
# Immutable production deploy for Spyglass.
#
# Builds a self-contained image from a CLEAN main == origin/main checkout, seeds
# the persistent blog content, pins the image tag in .env (auto-read by compose —
# a reboot / plain `up -d` re-runs the SAME image), waits for readiness, runs the
# non-destructive smoke, and AUTO-ROLLS-BACK to the previous image on failure.
# Never touches /data SQLite or persistent content, never re-adds source mounts.
#
# Run on the host: ./scripts/deploy.sh

set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
# shellcheck source=scripts/deploy-lib.sh
. "$REPO/scripts/deploy-lib.sh"

ENV_FILE="$REPO/.env"
DATA_DIR="/srv/DATA/AppData/adtech-spyglass"
STATE_FILE="$DATA_DIR/deploy-state.env"     # OUT of the git working tree
CONTENT_DST="$DATA_DIR/content-posts"
BASE="http://127.0.0.1:8090"
CONTAINER="adtech-spyglass"
READY_TIMEOUT=120

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

# 2. Idempotent content seed BEFORE launching the new image. rsync --ignore-existing
#    never overwrites runtime-promoted posts; the dir must be writable by the
#    container's uid 1000.
echo "==> Seeding persistent content at ${CONTENT_DST}"
mkdir -p "$CONTENT_DST"/en "$CONTENT_DST"/uk "$CONTENT_DST"/ru
rsync -a --ignore-existing content/posts/ "$CONTENT_DST"/
SEED_UID="$(stat -c %u "$CONTENT_DST")"
[ "$SEED_UID" = "1000" ] || { echo "ABORT: ${CONTENT_DST} is owned by uid ${SEED_UID}; container runs as uid 1000 — chown it first"; exit 4; }
for l in en uk ru; do
  [ -f "$CONTENT_DST/$l/welcome.md" ] || { echo "ABORT: content seed failed — missing $l/welcome.md"; exit 4; }
done
echo "    seed ok (en/uk/ru welcome.md present, owner uid 1000)"

# 3. Capture previous state for rollback (image + its real BUILD_SHA).
PREV_TAG="$(grep -E '^SPYGLASS_TAG=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)"
PREV_IMG="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || echo '')"
PREV_SHA=""
ROLLBACK_TAG="rollback-pre-${VER}"
if [ -n "$PREV_IMG" ]; then
  docker tag "$PREV_IMG" "adtech-spyglass:${ROLLBACK_TAG}"
  PREV_SHA="$(image_build_sha "adtech-spyglass:${ROLLBACK_TAG}" || true)"
  echo "    tagged rollback image adtech-spyglass:${ROLLBACK_TAG}  (BUILD_SHA=${PREV_SHA:-unknown})"
fi

# 4. Build the immutable image (provenance via build-args), tag short-sha + version.
BUILD_SHA="$SHA" GIT_SHA="$GIT_SHA" APP_VERSION="$APP_VERSION" SPYGLASS_TAG="$SHA" docker compose build
docker tag "adtech-spyglass:${SHA}" "adtech-spyglass:${VER}"

# 5. Pin the active tag (atomic, 0600) and bring it up WITHOUT rebuilding.
set_env SPYGLASS_TAG "$SHA" "$ENV_FILE"
SPYGLASS_TAG="$SHA" docker compose up -d --no-build

# 6. Wait for readiness, THEN smoke. Failure (not-ready or smoke) → auto-rollback.
deploy_failed=0
if wait_ready "$CONTAINER" "$BASE" "$READY_TIMEOUT"; then
  "$REPO/scripts/smoke.sh" "$BASE" "$SHA" "$CONTAINER" || deploy_failed=1
else
  echo "==> NOT READY within ${READY_TIMEOUT}s"
  deploy_failed=1
fi

if [ "$deploy_failed" = 0 ]; then
  write_state "$STATE_FILE" <<EOF
ACTIVE_TAG=${SHA}
ACTIVE_VERSION=${VER}
ACTIVE_BUILD_SHA=${SHA}
ACTIVE_GIT_SHA=${GIT_SHA}
PREV_TAG=${PREV_TAG}
PREV_BUILD_SHA=${PREV_SHA}
ROLLBACK_TAG=${ROLLBACK_TAG}
LAST_FAILED_TAG=
LAST_FAILED_BUILD_SHA=
DEPLOYED_AT=$(date -Is)
EOF
  echo "==> DEPLOY OK: ${VER} (${SHA}) is live."
  exit 0
fi

# 7. Auto-rollback to the previous self-contained image.
echo "==> DEPLOY FAILED — auto-rolling back to ${ROLLBACK_TAG} (expect BUILD_SHA=${PREV_SHA:-unknown})"
set_env SPYGLASS_TAG "$ROLLBACK_TAG" "$ENV_FILE"
SPYGLASS_TAG="$ROLLBACK_TAG" docker compose up -d --no-build
if [ -n "$PREV_SHA" ] && wait_ready "$CONTAINER" "$BASE" "$READY_TIMEOUT" \
  && "$REPO/scripts/smoke.sh" "$BASE" "$PREV_SHA" "$CONTAINER"; then
  # The rollback image is now ACTIVE; the new release is the LAST_FAILED candidate.
  write_state "$STATE_FILE" <<EOF
ACTIVE_TAG=${ROLLBACK_TAG}
ACTIVE_VERSION=rolled-back-from-${VER}
ACTIVE_BUILD_SHA=${PREV_SHA}
PREV_TAG=${PREV_TAG}
PREV_BUILD_SHA=
ROLLBACK_TAG=${ROLLBACK_TAG}
LAST_FAILED_TAG=${SHA}
LAST_FAILED_BUILD_SHA=${SHA}
DEPLOYED_AT=$(date -Is)
EOF
  echo "==> ROLLBACK OK: restored ${ROLLBACK_TAG} (BUILD_SHA=${PREV_SHA}). DEPLOY FAILED."
  exit 1
else
  write_state "$STATE_FILE" <<EOF
ACTIVE_TAG=UNKNOWN
ACTIVE_BUILD_SHA=UNKNOWN
ROLLBACK_TAG=${ROLLBACK_TAG}
LAST_FAILED_TAG=${SHA}
LAST_FAILED_BUILD_SHA=${SHA}
DEPLOYED_AT=$(date -Is)
EOF
  echo "==> CRITICAL: deploy AND rollback failed — manual intervention required."
  exit 3
fi
