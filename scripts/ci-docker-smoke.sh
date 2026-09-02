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

TAG="${1:-ortbtools-ci-smoke:local-$$}"
CONTAINER="ortbtools-ci-smoke-$$"
VOLUME="ortbtools-ci-data-$$"
PORT="${CI_DOCKER_SMOKE_PORT:-$((20000 + ($$ % 20000)))}"
APP_VERSION="$(node -p "require('./package.json').version")"
EXPECTED_SQLITE="$(node -p "require('./package-lock.json').packages['node_modules/better-sqlite3'].version")"
EXPECTED_BCRYPT="$(node -p "require('./package-lock.json').packages['node_modules/bcrypt'].version")"
BUILD_SHA="${GITHUB_SHA:-ci}"
GIT_SHA="${GITHUB_SHA:-ci}"
BUILT_IMAGE_ID=""

if docker image inspect "$TAG" >/dev/null 2>&1; then
  echo "FAIL: refusing to overwrite existing smoke image tag $TAG" >&2
  exit 2
fi

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  if [ -n "$BUILT_IMAGE_ID" ]; then
    current_image_id="$(docker image inspect --format '{{.Id}}' "$TAG" 2>/dev/null || true)"
    if [ "$current_image_id" = "$BUILT_IMAGE_ID" ]; then
      docker image rm "$TAG" >/dev/null 2>&1 || true
    fi
  fi
}
trap cleanup EXIT

echo "==> docker build $TAG"
docker build -t "$TAG" \
  --build-arg BUILD_SHA="${BUILD_SHA:0:7}" \
  --build-arg GIT_SHA="$GIT_SHA" \
  --build-arg APP_VERSION="$APP_VERSION" \
  .
BUILT_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$TAG")"

echo "==> docker run (ephemeral /data volume)"
docker volume create "$VOLUME" >/dev/null
docker run --rm -v "${VOLUME}:/data" --user root "$TAG" \
  sh -c 'mkdir -p /data && chown -R node:node /data' >/dev/null
docker run -d --name "$CONTAINER" \
  -p "127.0.0.1:${PORT}:3000" \
  -v "${VOLUME}:/data" \
  -e NODE_ENV=production \
  -e LOG_LEVEL=silent \
  "$TAG" >/dev/null

echo "==> wait for /api/health"
ready=0
for _ in $(seq 1 90); do
  if curl -fsS --max-time 2 --user-agent 'ortbtools-ci-docker-smoke/1' \
    "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
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

HEALTH="$(curl -fsS --max-time 8 --user-agent 'ortbtools-ci-docker-smoke/1' \
  "http://127.0.0.1:${PORT}/api/health")"
node -e '
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    const body = JSON.parse(input);
    if (body.success !== true || body.status !== "ok") process.exit(1);
  });
' <<<"$HEALTH" || {
  echo "FAIL: /api/health success=false: ${HEALTH:0:200}" >&2
  exit 1
}

ANALYZE="$(curl -fsS --max-time 12 --user-agent 'ortbtools-ci-docker-smoke/1' \
  -X POST "http://127.0.0.1:${PORT}/api/analyze" \
  -H 'content-type: application/json' \
  --data '{"bidReq":{"id":"ci-docker","imp":[{"id":"1","banner":{"w":300,"h":250}}],"at":1}}')"
node -e '
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    const body = JSON.parse(input);
    if (body.success !== true || !Array.isArray(body.validation?.findings)) process.exit(1);
    if (body.validation.findings.length === 0) process.exit(1);
  });
' <<<"$ANALYZE" || {
  echo "FAIL: /api/analyze: ${ANALYZE:0:200}" >&2
  exit 1
}
echo "  PASS  /api/analyze returns findings"

echo "==> verify content-hashed Blog renderer/vendor graph"
BLOG_JS="$(curl -fsS --max-time 8 --user-agent 'ortbtools-ci-docker-smoke/1' \
  "http://127.0.0.1:${PORT}/modules/blog/index.js")"
RENDERER_PATH="$(
  echo "$BLOG_JS" | grep -oE '/modules/blog/markdown-renderer\.js\?v=[0-9a-f]{8}' | head -1 || true
)"
if [ -z "$RENDERER_PATH" ]; then
  echo "FAIL: served Blog module has no content-hashed Markdown renderer import" >&2
  exit 1
fi

RENDERER_JS="$(curl -fsS --max-time 8 --user-agent 'ortbtools-ci-docker-smoke/1' \
  "http://127.0.0.1:${PORT}${RENDERER_PATH}")"
MARKED_PATH="$(
  echo "$RENDERER_JS" | grep -oE '/vendor/marked\.es\.js\?v=[0-9a-f]{8}' | head -1 || true
)"
DOMPURIFY_PATH="$(
  echo "$RENDERER_JS" | grep -oE '/vendor/dompurify\.es\.js\?v=[0-9a-f]{8}' | head -1 || true
)"
if [ -z "$MARKED_PATH" ] || [ -z "$DOMPURIFY_PATH" ]; then
  echo "FAIL: served Markdown renderer lacks both content-hashed vendor imports" >&2
  exit 1
fi

MARKED_JS="$(curl -fsS --max-time 8 --user-agent 'ortbtools-ci-docker-smoke/1' \
  "http://127.0.0.1:${PORT}${MARKED_PATH}")"
DOMPURIFY_JS="$(curl -fsS --max-time 8 --user-agent 'ortbtools-ci-docker-smoke/1' \
  "http://127.0.0.1:${PORT}${DOMPURIFY_PATH}")"
grep -q 'v15.0.12' <<<"$MARKED_JS" || {
  echo "FAIL: production-served Marked asset version drifted" >&2
  exit 1
}
grep -q 'DOMPurify 3.4.13' <<<"$DOMPURIFY_JS" || {
  echo "FAIL: production-served DOMPurify asset version drifted" >&2
  exit 1
}

NOTICE="$(docker exec "$CONTAINER" cat /app/public/vendor/NOTICE.txt)"
grep -q 'Package: marked@15.0.12' <<<"$NOTICE" || {
  echo "FAIL: vendor notice omits Package: marked@15.0.12" >&2
  exit 1
}
grep -q 'Package: dompurify@3.4.13' <<<"$NOTICE" || {
  echo "FAIL: vendor notice omits Package: dompurify@3.4.13" >&2
  exit 1
}
docker exec "$CONTAINER" test -f "/app/public/vendor/licenses/Marked-MIT.txt"
docker exec "$CONTAINER" test -f "/app/public/vendor/licenses/DOMPurify-Apache-2.0.txt"

OLD_MARKED_STATUS="$(
  curl -sS --max-time 8 --user-agent 'ortbtools-ci-docker-smoke/1' -o /dev/null \
    -w '%{http_code}' \
    "http://127.0.0.1:${PORT}/vendor/marked.esm.min.js"
)"
if [ "$OLD_MARKED_STATUS" != "404" ]; then
  echo "FAIL: obsolete Marked asset returned HTTP $OLD_MARKED_STATUS, expected 404" >&2
  exit 1
fi
echo "  PASS  hashed Blog/vendor graph, notices/licenses, obsolete asset absent"

NODE_VER="$(docker exec "$CONTAINER" node -p "process.version")"
echo "$NODE_VER" | grep -q '^v22\.' || {
  echo "FAIL: container Node is $NODE_VER, expected v22.x" >&2
  exit 1
}
echo "  PASS  container Node $NODE_VER"

docker exec \
  -e EXPECTED_SQLITE="$EXPECTED_SQLITE" \
  -e EXPECTED_BCRYPT="$EXPECTED_BCRYPT" \
  "$CONTAINER" node -e "
  const sqlite = require('better-sqlite3/package.json').version;
  const bcrypt = require('bcrypt/package.json').version;
  require('better-sqlite3');
  require('bcrypt');
  if (sqlite !== process.env.EXPECTED_SQLITE) {
    throw new Error('better-sqlite3 ' + sqlite + ' != lockfile ' + process.env.EXPECTED_SQLITE);
  }
  if (bcrypt !== process.env.EXPECTED_BCRYPT) {
    throw new Error('bcrypt ' + bcrypt + ' != lockfile ' + process.env.EXPECTED_BCRYPT);
  }
  console.log('native ok', sqlite, bcrypt);
"
echo "  PASS  better-sqlite3 + bcrypt load inside container"
