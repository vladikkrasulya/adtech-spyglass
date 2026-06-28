#!/usr/bin/env bash
#
# Roll Spyglass back to a previous immutable image.
#
# Uses an existing self-contained image tag (default: the rollback image recorded
# by the last deploy). Pins it in .env and brings it up WITHOUT rebuilding. Does
# NOT touch git, does NOT re-add source bind-mounts, does NOT touch /data or
# persistent content. Verifies the SPECIFIC expected previous BUILD_SHA.
#
# Run on the host: ./scripts/rollback.sh [image_tag]

set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
ENV_FILE="$REPO/.env"
STATE_FILE="$REPO/.deploy-state"

set_env() {
  local k="$1" v="$2" tmp
  tmp="$(mktemp)"
  if [ -f "$ENV_FILE" ] && grep -qE "^${k}=" "$ENV_FILE"; then
    sed "s|^${k}=.*|${k}=${v}|" "$ENV_FILE" >"$tmp"
  else
    [ -f "$ENV_FILE" ] && cat "$ENV_FILE" >"$tmp"
    echo "${k}=${v}" >>"$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
}

ROLLBACK_TAG=""
PREV_BUILD_SHA=""
if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  . "$STATE_FILE"
fi
TAG="${1:-${ROLLBACK_TAG:-}}"
EXPECT="${PREV_BUILD_SHA:-}"
[ -n "$TAG" ] || {
  echo "ABORT: no rollback tag given and none in .deploy-state"
  exit 2
}
docker image inspect "adtech-spyglass:${TAG}" >/dev/null 2>&1 || {
  echo "ABORT: rollback image adtech-spyglass:${TAG} not found"
  exit 2
}

echo "==> Rolling back to adtech-spyglass:${TAG} (expect BUILD_SHA=${EXPECT:-unknown})"
set_env SPYGLASS_TAG "$TAG"
SPYGLASS_TAG="$TAG" docker compose up -d --no-build
sleep 5
if "$REPO/scripts/smoke.sh" http://127.0.0.1:8090 "$EXPECT" adtech-spyglass; then
  echo "==> ROLLBACK OK: ${TAG} is live (BUILD_SHA=${EXPECT:-?})."
  exit 0
else
  echo "==> CRITICAL: rollback smoke FAILED for ${TAG} — manual intervention required."
  exit 3
fi
