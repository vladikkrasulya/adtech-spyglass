#!/usr/bin/env bash
#
# NON-DESTRUCTIVE smoke test for a Spyglass deployment — production OR an isolated
# candidate. It does NOT mutate source, config, the container, the SQLite tables a
# user owns, or content-posts. It DOES cause two benign, by-design derived writes,
# the same a normal visitor would:
#   - POST /api/analyze   → a derived-telemetry row (ClickHouse validation_logs +
#                           spyglass_events; never the payload, no /data SQLite row).
#   - GET  /api/v1/stream → warms the in-memory + SQLite synthetic-specimen cache.
# These are product side-effects, not test artifacts.
#
# Usage: smoke.sh <base_url> <expected_build_sha> [container_name]
#   base_url            e.g. http://127.0.0.1:8090   (candidate: http://127.0.0.1:8099)
#   expected_build_sha  short SHA /api/health must report; "" skips the SHA match
#   container_name      optional; if set, also assert health=healthy + RestartCount=0
#
# Exit 0 iff every check passes; non-zero otherwise.

set -uo pipefail
BASE="${1:?base_url required}"
EXPECT_SHA="${2-}"
CONTAINER="${3-}"
fail=0
ok() { echo "  PASS  $*"; }
bad() {
  echo "  FAIL  $*"
  fail=1
}

# 1. /api/health + expected BUILD_SHA
H=$(curl -fsS --max-time 8 "$BASE/api/health" 2>/dev/null || echo '')
echo "$H" | grep -q '"status":"ok"' && ok "health status ok" || bad "health not ok: ${H:0:140}"
SHA=$(echo "$H" | sed -n 's/.*"sha":"\([^"]*\)".*/\1/p')
if [ -n "$EXPECT_SHA" ]; then
  [ "$SHA" = "$EXPECT_SHA" ] && ok "BUILD_SHA=$SHA matches expected" || bad "BUILD_SHA=$SHA != expected $EXPECT_SHA"
else
  ok "BUILD_SHA=$SHA (no expectation given)"
fi

# 2. /api/analyze — server-side validation returns findings
A=$(curl -fsS --max-time 10 -X POST "$BASE/api/analyze" -H 'content-type: application/json' \
  --data '{"bidReq":{"id":"smoke","imp":[{"id":"1","banner":{"w":300,"h":250}}],"at":1}}' 2>/dev/null || echo '')
echo "$A" | grep -q '"success":true' && ok "/api/analyze returns findings" || bad "/api/analyze failed: ${A:0:140}"

# 3. /api/v1/stream — SSE (demand-gated; subscribing starts the generator)
S=$(curl -fsS --max-time 7 "$BASE/api/v1/stream" 2>/dev/null | head -c 400 || true)
echo "$S" | grep -q 'data:' && ok "/api/v1/stream emits SSE" || bad "/api/v1/stream no SSE: ${S:0:80}"

# 4. main pages EN/UK/RU
for p in /inspector /uk/inspector /ru/inspector /about /uk/about /ru/about /account /uk/account /ru/account; do
  c=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 8 "$BASE$p" 2>/dev/null || echo 000)
  [ "$c" = 200 ] && ok "page $p -> 200" || bad "page $p -> $c"
done

# 5. content posts — REQUIRE the markdown `welcome` post per language. This
#    proves CONTENT_DIR (/data/content-posts in prod) is seeded AND served from
#    markdown, not from a DB row or an empty list.
for lang in en uk ru; do
  P=$(curl -fsS --max-time 8 "$BASE/api/v1/blog/post?slug=welcome&lang=$lang" 2>/dev/null || echo '')
  if echo "$P" | grep -q '"ok":true' &&
    echo "$P" | grep -q '"slug":"welcome"' &&
    echo "$P" | grep -q '"source":"markdown"'; then
    ok "blog welcome ($lang) served from markdown"
  else
    bad "blog welcome ($lang) not ok/markdown: ${P:0:140}"
  fi
done

# 6. container health (production stage only)
if [ -n "$CONTAINER" ]; then
  HS=$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo '?')
  RC=$(docker inspect "$CONTAINER" --format '{{.RestartCount}}' 2>/dev/null || echo '?')
  [ "$HS" = healthy ] && ok "container health=healthy" || bad "container health=$HS"
  [ "$RC" = 0 ] && ok "RestartCount=0" || bad "RestartCount=$RC"
fi

if [ "$fail" = 0 ]; then
  echo "SMOKE OK"
  exit 0
else
  echo "SMOKE FAILED"
  exit 1
fi
