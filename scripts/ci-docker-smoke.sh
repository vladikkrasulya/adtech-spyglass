#!/usr/bin/env bash
#
# CI Docker gate — build the production Dockerfile, start a throwaway container
# with an ephemeral /data volume, smoke /api/health + /api/analyze, and verify
# native modules load on Node 22. No production secrets required.
#
# Usage: scripts/ci-docker-smoke.sh [image_tag]
# Exit 0 iff every check passes.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TAG="${1:-spyglass-ci-smoke:local}"
CONTAINER="spyglass-ci-smoke-$$"
VOLUME="spyglass-ci-data-$$"
PORT="${CI_DOCKER_SMOKE_PORT:-13000}"
APP_VERSION="$(node -p "require('./package.json').version")"
BUILD_SHA="${GITHUB_SHA:-ci}"
GIT_SHA="${GITHUB_SHA:-ci}"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  docker image rm "$TAG" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> docker build $TAG"
docker build -t "$TAG" \
  --build-arg BUILD_SHA="${BUILD_SHA:0:7}" \
  --build-arg GIT_SHA="$GIT_SHA" \
  --build-arg APP_VERSION="$APP_VERSION" \
  .

echo "==> docker run (ephemeral /data volume)"
docker volume create "$VOLUME" >/dev/null
docker run --rm -v "${VOLUME}:/data" --user root "$TAG" \
  sh -c 'mkdir -p /data && chown -R node:node /data' >/dev/null
docker run -d --name "$CONTAINER" \
  -p "${PORT}:3000" \
  -v "${VOLUME}:/data" \
  -e NODE_ENV=production \
  -e LOG_LEVEL=silent \
  "$TAG" >/dev/null

echo "==> wait for /api/health"
ready=0
for _ in $(seq 1 90); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "FAIL: /api/health never reached status=ok" >&2
  docker logs "$CONTAINER" 2>&1 | tail -80 >&2 || true
  exit 1
fi
echo "  PASS  /api/health status ok"

HEALTH="$(curl -fsS --max-time 8 "http://127.0.0.1:${PORT}/api/health")"
echo "$HEALTH" | grep -q '"success":true' || {
  echo "FAIL: /api/health success=false: ${HEALTH:0:200}" >&2
  exit 1
}

ANALYZE="$(curl -fsS --max-time 12 -X POST "http://127.0.0.1:${PORT}/api/analyze" \
  -H 'content-type: application/json' \
  --data '{"bidReq":{"id":"ci-docker","imp":[{"id":"1","banner":{"w":300,"h":250}}],"at":1}}')"
echo "$ANALYZE" | grep -q '"success":true' || {
  echo "FAIL: /api/analyze: ${ANALYZE:0:200}" >&2
  exit 1
}
echo "  PASS  /api/analyze returns findings"

NODE_VER="$(docker exec "$CONTAINER" node -p "process.version")"
echo "$NODE_VER" | grep -q '^v22\.' || {
  echo "FAIL: container Node is $NODE_VER, expected v22.x" >&2
  exit 1
}
echo "  PASS  container Node $NODE_VER"

docker exec "$CONTAINER" node -e "
  const sqlite = require('better-sqlite3/package.json').version;
  const bcrypt = require('bcrypt/package.json').version;
  require('better-sqlite3');
  require('bcrypt');
  if (sqlite !== '11.10.0') throw new Error('better-sqlite3 ' + sqlite);
  if (bcrypt !== '6.0.0') throw new Error('bcrypt ' + bcrypt);
  console.log('native ok', sqlite, bcrypt);
"
echo "  PASS  better-sqlite3 + bcrypt load inside container"
