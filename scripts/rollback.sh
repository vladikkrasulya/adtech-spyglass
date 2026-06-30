#!/usr/bin/env bash
#
# Roll Spyglass back to a previous immutable image.
#
# Uses an existing self-contained image (default: the rollback image from the last
# deploy). The expected BUILD_SHA is read FROM THE SELECTED IMAGE (never a stale
# PREV from a different image). The `docker compose up` is guarded so a non-zero
# exit yields a controlled CRITICAL + state update rather than a silent `set -e`
# abort. Does NOT touch git, source mounts, /data, or persistent content.
#
# Run on the host: ./scripts/rollback.sh [image_tag]
#
# Env overrides (for tests): SPYGLASS_DEPLOY_DATA_DIR, SPYGLASS_DEPLOY_ENV_FILE,
#   SMOKE_CMD, SPYGLASS_BASE_URL, SPYGLASS_CONTAINER, READY_TIMEOUT.

set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
# shellcheck source=scripts/deploy-lib.sh
. "$REPO/scripts/deploy-lib.sh"

DATA_DIR="${SPYGLASS_DEPLOY_DATA_DIR:-/srv/DATA/AppData/adtech-spyglass}"
ENV_FILE="${SPYGLASS_DEPLOY_ENV_FILE:-$REPO/.env}"
SMOKE_CMD="${SMOKE_CMD:-$REPO/scripts/smoke.sh}"
BASE="${SPYGLASS_BASE_URL:-http://127.0.0.1:8090}"
CONTAINER="${SPYGLASS_CONTAINER:-adtech-spyglass}"
STATE_FILE="$DATA_DIR/deploy-state.env"
READY_TIMEOUT="${READY_TIMEOUT:-120}"

# Resolve the target tag: explicit arg, else ROLLBACK_TAG from the deploy state.
ROLLBACK_TAG=""
PRIVACY_FLOOR_BUILD_SHA=""
if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$STATE_FILE"
fi
TAG="${1:-${ROLLBACK_TAG:-}}"
[ -n "$TAG" ] || { echo "ABORT: no rollback tag given and none recorded in ${STATE_FILE}"; exit 2; }

# Expected BUILD_SHA comes from the SELECTED image's own baked metadata.
EXPECT="$(image_build_sha "adtech-spyglass:${TAG}" || true)"
[ -n "$EXPECT" ] || { echo "ABORT: adtech-spyglass:${TAG} missing or carries no BUILD_SHA metadata"; exit 2; }

# Guard against rollback to an image that does not contain the privacy floor commit
if ! image_contains_privacy_floor "adtech-spyglass:${TAG}" "${PRIVACY_FLOOR_BUILD_SHA:-}"; then
  echo "ABORT: target image adtech-spyglass:${TAG} does not satisfy the privacy floor ${PRIVACY_FLOOR_BUILD_SHA}"
  exit 2
fi

echo "==> Rolling back to adtech-spyglass:${TAG} (image BUILD_SHA=${EXPECT})"
write_state "$STATE_FILE" <<EOF
STATUS=ROLLING_BACK
ATTEMPTING_TAG=${TAG}
ATTEMPTING_BUILD_SHA=${EXPECT}
PRIVACY_FLOOR_BUILD_SHA=${PRIVACY_FLOOR_BUILD_SHA:-}
STARTED_AT=$(date -Is)
EOF

set_env SPYGLASS_TAG "$TAG" "$ENV_FILE"
rollback_ok=0
if SPYGLASS_TAG="$TAG" docker compose up -d --no-build; then
  if wait_ready "$CONTAINER" "$BASE" "$READY_TIMEOUT" && "$SMOKE_CMD" "$BASE" "$EXPECT" "$CONTAINER"; then
    rollback_ok=1
  fi
else
  echo "==> docker compose up FAILED for ${TAG}"
fi

if [ "$rollback_ok" = 1 ]; then
  write_state "$STATE_FILE" <<EOF
STATUS=ROLLED_BACK
ACTIVE_TAG=${TAG}
ACTIVE_BUILD_SHA=${EXPECT}
ROLLBACK_TAG=${ROLLBACK_TAG:-}
PRIVACY_FLOOR_BUILD_SHA=${PRIVACY_FLOOR_BUILD_SHA:-}
ROLLED_BACK_AT=$(date -Is)
EOF
  echo "==> ROLLBACK OK: ${TAG} is live (BUILD_SHA=${EXPECT})."
  exit 0
else
  write_state "$STATE_FILE" <<EOF
STATUS=CRITICAL
ACTIVE_TAG=UNKNOWN
ATTEMPTING_TAG=${TAG}
ATTEMPTING_BUILD_SHA=${EXPECT}
PRIVACY_FLOOR_BUILD_SHA=${PRIVACY_FLOOR_BUILD_SHA:-}
FAILED_AT=$(date -Is)
EOF
  echo "==> CRITICAL: rollback FAILED for ${TAG} (expected BUILD_SHA=${EXPECT}) — manual intervention required."
  exit 3
fi
