#!/usr/bin/env bash
#
# Immutable production deploy for Spyglass.
#
# Builds a self-contained image from a CLEAN main == origin/main checkout, pins
# its tag in .env (auto-read by compose, so a reboot / plain `up -d` re-runs the
# SAME image), runs the smoke test against production, and AUTO-ROLLS-BACK to the
# previous image if smoke fails. Never touches /data or persistent content, and
# never re-adds source bind-mounts.
#
# Run on the host: ./scripts/deploy.sh

set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
ENV_FILE="$REPO/.env"
STATE_FILE="$REPO/.deploy-state"

# Atomic upsert of KEY=VALUE in .env (compose reads SPYGLASS_TAG from here).
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
health_sha() { curl -fsS --max-time 5 http://127.0.0.1:8090/api/health 2>/dev/null | sed -n 's/.*"sha":"\([^"]*\)".*/\1/p'; }

APP_VERSION="$(node -p "require('./package.json').version")"
VER="v${APP_VERSION}"

# 1. Gate — deploy only from a clean main == origin/main.
git fetch -q origin
[ -z "$(git status --porcelain)" ] || {
  echo "ABORT: working tree is dirty"
  exit 2
}
HEAD="$(git rev-parse HEAD)"
[ "$HEAD" = "$(git rev-parse main)" ] && [ "$HEAD" = "$(git rev-parse origin/main)" ] || {
  echo "ABORT: HEAD != main == origin/main"
  exit 2
}
GIT_SHA="$HEAD"
SHA="$(git rev-parse --short HEAD)"
echo "==> Deploying ${VER}  (full=${GIT_SHA}  short=${SHA})"

# 2. Capture previous state for rollback.
PREV_TAG="$(grep -E '^SPYGLASS_TAG=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)"
PREV_IMG="$(docker inspect adtech-spyglass --format '{{.Image}}' 2>/dev/null || echo '')"
PREV_SHA="$(health_sha || echo '')"
ROLLBACK_TAG="rollback-pre-${VER}"
if [ -n "$PREV_IMG" ]; then
  docker tag "$PREV_IMG" "adtech-spyglass:${ROLLBACK_TAG}"
  echo "    tagged rollback image adtech-spyglass:${ROLLBACK_TAG}  (prev BUILD_SHA=${PREV_SHA:-unknown})"
fi

# 3. Build the immutable image (provenance via build-args).
BUILD_SHA="$SHA" GIT_SHA="$GIT_SHA" APP_VERSION="$APP_VERSION" SPYGLASS_TAG="$SHA" docker compose build
docker tag "adtech-spyglass:${SHA}" "adtech-spyglass:${VER}"

# 4. Pin the active tag (atomic) and bring it up WITHOUT rebuilding.
set_env SPYGLASS_TAG "$SHA"
SPYGLASS_TAG="$SHA" docker compose up -d --no-build

# 5. Record deploy state.
cat >"$STATE_FILE" <<EOF
ACTIVE_TAG=${SHA}
ACTIVE_VERSION=${VER}
ACTIVE_BUILD_SHA=${SHA}
ACTIVE_GIT_SHA=${GIT_SHA}
PREV_TAG=${PREV_TAG}
PREV_BUILD_SHA=${PREV_SHA}
ROLLBACK_TAG=${ROLLBACK_TAG}
DEPLOYED_AT=$(date -Is)
EOF

# 6. Smoke; auto-rollback on failure.
sleep 5
if "$REPO/scripts/smoke.sh" http://127.0.0.1:8090 "$SHA" adtech-spyglass; then
  echo "==> DEPLOY OK: ${VER} (${SHA}) is live."
  exit 0
fi

echo "==> DEPLOY SMOKE FAILED — auto-rolling back to ${ROLLBACK_TAG} (expect BUILD_SHA=${PREV_SHA:-unknown})"
set_env SPYGLASS_TAG "$ROLLBACK_TAG"
SPYGLASS_TAG="$ROLLBACK_TAG" docker compose up -d --no-build
sleep 5
if [ -n "$PREV_SHA" ] && "$REPO/scripts/smoke.sh" http://127.0.0.1:8090 "$PREV_SHA" adtech-spyglass; then
  echo "==> ROLLBACK OK: restored ${ROLLBACK_TAG} (BUILD_SHA=${PREV_SHA}). DEPLOY FAILED."
  exit 1
else
  echo "==> CRITICAL: deploy AND rollback smoke FAILED — manual intervention required."
  exit 3
fi
