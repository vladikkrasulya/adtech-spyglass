#!/usr/bin/env bash
#
# Roll Spyglass back to a previous immutable image.
#
# Uses an existing self-contained image (default: the rollback image from the last
# deploy). Pins it in .env and brings it up WITHOUT rebuilding. The expected
# BUILD_SHA is read FROM THE SELECTED IMAGE (so an arbitrary tag is verified
# against its own metadata, never a stale PREV_BUILD_SHA from a different image).
# Does NOT touch git, source mounts, /data, or persistent content.
#
# Run on the host: ./scripts/rollback.sh [image_tag]

set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
# shellcheck source=scripts/deploy-lib.sh
. "$REPO/scripts/deploy-lib.sh"

ENV_FILE="$REPO/.env"
DATA_DIR="/srv/DATA/AppData/adtech-spyglass"
STATE_FILE="$DATA_DIR/deploy-state.env"
BASE="http://127.0.0.1:8090"
CONTAINER="adtech-spyglass"
READY_TIMEOUT=120

# Resolve the target tag: explicit arg, else ROLLBACK_TAG from the deploy state.
ROLLBACK_TAG=""
if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$STATE_FILE"
fi
TAG="${1:-${ROLLBACK_TAG:-}}"
[ -n "$TAG" ] || { echo "ABORT: no rollback tag given and none recorded in ${STATE_FILE}"; exit 2; }

# Expected BUILD_SHA comes from the SELECTED image's own baked metadata.
EXPECT="$(image_build_sha "adtech-spyglass:${TAG}" || true)"
[ -n "$EXPECT" ] || { echo "ABORT: adtech-spyglass:${TAG} missing or carries no BUILD_SHA metadata"; exit 2; }

echo "==> Rolling back to adtech-spyglass:${TAG} (image BUILD_SHA=${EXPECT})"
set_env SPYGLASS_TAG "$TAG" "$ENV_FILE"
SPYGLASS_TAG="$TAG" docker compose up -d --no-build

if wait_ready "$CONTAINER" "$BASE" "$READY_TIMEOUT" && "$REPO/scripts/smoke.sh" "$BASE" "$EXPECT" "$CONTAINER"; then
  write_state "$STATE_FILE" <<EOF
ACTIVE_TAG=${TAG}
ACTIVE_BUILD_SHA=${EXPECT}
ROLLBACK_TAG=${ROLLBACK_TAG:-}
ROLLED_BACK_AT=$(date -Is)
EOF
  echo "==> ROLLBACK OK: ${TAG} is live (BUILD_SHA=${EXPECT})."
  exit 0
else
  echo "==> CRITICAL: rollback smoke FAILED for ${TAG} (expected BUILD_SHA=${EXPECT}) — manual intervention required."
  exit 3
fi
