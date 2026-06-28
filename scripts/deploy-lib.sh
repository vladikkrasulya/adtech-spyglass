#!/usr/bin/env bash
#
# Shared helpers for scripts/deploy.sh and scripts/rollback.sh. Sourceable: it
# only DEFINES functions, with no side effects at source time. The deploy-state
# and .env writes are atomic (temp-in-same-dir + mv) and 0600; secret values are
# never printed.

# set_env KEY VALUE ENV_FILE
#   Atomic, owner-preserving, 0600 upsert of KEY=VALUE in ENV_FILE. The temp file
#   is created in the SAME directory (so `mv` is atomic on the same filesystem)
#   and removed via a RETURN trap if anything fails before the mv. Never prints
#   the value.
set_env() {
  local k="$1" v="$2" f="$3" dir tmp
  dir="$(dirname "$f")"
  tmp="$(mktemp "${dir}/.env.tmp.XXXXXX")"
  trap 'rm -f "${tmp}" 2>/dev/null' RETURN
  if [ -f "$f" ] && grep -qE "^${k}=" "$f"; then
    sed "s|^${k}=.*|${k}=${v}|" "$f" >"$tmp"
  else
    [ -f "$f" ] && cat "$f" >"$tmp"
    printf '%s=%s\n' "$k" "$v" >>"$tmp"
  fi
  chmod 600 "$tmp"
  mv -f "$tmp" "$f" # tmp gone after mv → RETURN trap rm is a no-op
  echo "    set_env: ${k} written to $(basename "$f") (0600, value hidden)"
}

# write_state STATE_FILE   (reads KEY=VALUE lines from stdin)
#   Atomic, 0600 write of a deploy-state file in its own directory.
write_state() {
  local f="$1" dir tmp
  dir="$(dirname "$f")"
  tmp="$(mktemp "${dir}/.deploy-state.tmp.XXXXXX")"
  trap 'rm -f "${tmp}" 2>/dev/null' RETURN
  cat >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$f"
}

# wait_ready CONTAINER BASE_URL [TIMEOUT_SECONDS=120]
#   Poll until BOTH `/api/health` reports status=ok AND docker reports
#   health=healthy. Aborts early on a terminal `unhealthy`, or on timeout. Logs
#   the observed (http, docker) state each poll. Returns 0 ready / 1 not ready.
wait_ready() {
  local container="$1" base="$2" timeout="${3:-120}" waited=0 interval=3 hstatus chealth
  while [ "$waited" -lt "$timeout" ]; do
    hstatus="$(curl -fsS --max-time 4 "$base/api/health" 2>/dev/null | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
    chealth="$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo missing)"
    echo "    readiness t=${waited}s: http=${hstatus:-none} docker=${chealth}"
    if [ "$hstatus" = "ok" ] && [ "$chealth" = "healthy" ]; then
      return 0
    fi
    if [ "$chealth" = "unhealthy" ]; then
      echo "    readiness: container reports UNHEALTHY — aborting wait"
      return 1
    fi
    sleep "$interval"
    waited=$((waited + interval))
  done
  echo "    readiness: TIMEOUT after ${timeout}s (http=${hstatus:-none} docker=${chealth})"
  return 1
}

# image_build_sha IMAGE_REF
#   Print the BUILD_SHA the given image was built with, read from its baked ENV.
#   Returns 1 (and prints nothing) if the image is missing or carries no
#   BUILD_SHA — so a caller never smokes against an unknown expected SHA.
image_build_sha() {
  local ref="$1" sha
  docker image inspect "$ref" >/dev/null 2>&1 || return 1
  sha="$(docker image inspect "$ref" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null |
    sed -n 's/^BUILD_SHA=//p' | head -1)"
  [ -n "$sha" ] || return 1
  printf '%s' "$sha"
}
