#!/usr/bin/env bash
#
# Shared helpers for scripts/deploy.sh and scripts/rollback.sh. Sourceable: it
# only DEFINES functions, with no side effects at source time. The deploy-state
# and .env writes are atomic (temp-in-same-dir + mv) and 0600; secret values are
# never printed.

# _stat_owner FILE  → "uid:gid" (portable across GNU + BSD stat)
_stat_owner() { stat -c '%u:%g' "$1" 2>/dev/null || stat -f '%u:%g' "$1" 2>/dev/null; }

# _stat_mode FILE  → octal mode like "600" / "755" / "2710" (incl. setgid),
#   portable across GNU + BSD stat. BSD `%Mp%Lp` keeps the special bits but renders
#   a 4-digit "0NNN" for plain files; normalize that to GNU's "NNN".
_stat_mode() {
  local m
  m="$(stat -c '%a' "$1" 2>/dev/null || stat -f '%Mp%Lp' "$1" 2>/dev/null)"
  case "$m" in 0???) m="${m#0}" ;; esac
  printf '%s' "$m"
}

# _stat_uid / _stat_gid FILE  → numeric owner / group (portable across GNU + BSD)
_stat_uid() { stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1" 2>/dev/null; }
_stat_gid() { stat -c '%g' "$1" 2>/dev/null || stat -f '%g' "$1" 2>/dev/null; }

# _group_name GID  → the group's name (getent on Linux; falls back to the current
#   process's gid name where getent is unavailable, e.g. macOS). Empty if unknown.
_group_name() {
  local n
  n="$(getent group "$1" 2>/dev/null | cut -d: -f1)"
  if [ -z "$n" ] && [ "$1" = "$(id -g)" ]; then n="$(id -gn)"; fi
  [ -n "$n" ] && printf '%s' "$n"
}

# check_group GID EXPECT_NAME  → 0 if GID exists AND its name == EXPECT_NAME.
#   Aborts (1) on a MISSING group or a NAME/GID collision — so a deploy never
#   ships onto a host where the shared group isn't the expected one.
check_group() {
  local gid="$1" expect="$2" name
  name="$(_group_name "$gid")"
  if [ -z "$name" ]; then
    echo "UNSAFE: group GID ${gid} does not exist"
    return 1
  fi
  if [ "$name" != "$expect" ]; then
    echo "UNSAFE: GID ${gid} is group '${name}', expected '${expect}' (collision)"
    return 1
  fi
  return 0
}

# _world_writable FILE  → 0 (true) if the path is writable by "other".
#   Tests the last octal digit (the "other" perms) so it is independent of the
#   shell's octal-literal handling and of any file-type prefix from stat.
_world_writable() {
  local m
  m="$(_stat_mode "$1")"
  [ -n "$m" ] || return 1
  case "${m: -1}" in
    2 | 3 | 6 | 7) return 0 ;;
    *) return 1 ;;
  esac
}

# check_perms ENV_FILE STATE_FILE DATA_DIR  → 0 safe / 1 unsafe (prints UNSAFE: …)
#   Pre-deploy gate over the deploy-critical files the DEPLOYING user owns/sees.
#   Never prints secrets or DB contents — only file names + octal modes.
#     • .env            MUST be 0600 (it holds API keys / token secrets).
#     • deploy-state    MUST be 0600 if present.
#     • AppData dir     MUST NOT be world-writable (corruption / tamper).
#     • live SQLite     MUST NOT be world-writable. World-READ is intentionally
#                       allowed: the grafana datasource (uid 472) reads it via
#                       "other", and the app rewrites -wal/-shm with its own
#                       umask, so 0600 there is neither stable nor compatible.
#                       The secret-at-rest exposure is closed on the BACKUPS
#                       (0600, see backup-db.sh), which have no non-root consumer.
check_perms() {
  local env_file="$1" state_file="$2" data_dir="$3" bad=0 m
  if [ -f "$env_file" ]; then
    m="$(_stat_mode "$env_file")"
    [ "$m" = 600 ] || { echo "UNSAFE: $(basename "$env_file") mode ${m} (want 600)"; bad=1; }
  else
    echo "UNSAFE: env file missing: ${env_file}"
    bad=1
  fi
  if [ -f "$state_file" ]; then
    m="$(_stat_mode "$state_file")"
    [ "$m" = 600 ] || { echo "UNSAFE: $(basename "$state_file") mode ${m} (want 600)"; bad=1; }
  fi
  if [ -d "$data_dir" ]; then
    _world_writable "$data_dir" && {
      echo "UNSAFE: ${data_dir} is world-writable (mode $(_stat_mode "$data_dir"))"
      bad=1
    }
    for db in "$data_dir"/spyglass.db "$data_dir"/spyglass.db-wal "$data_dir"/spyglass.db-shm; do
      [ -e "$db" ] && _world_writable "$db" && {
        echo "UNSAFE: $(basename "$db") is world-writable (mode $(_stat_mode "$db"))"
        bad=1
      }
    done
  fi
  return "$bad"
}

# check_db_perms DATA_DIR EXPECT_UID GID [DIR_MODE]  → 0 ok / 1 unsafe (prints UNSAFE:)
#   Enforces the v1.1.7 "Grafana read-only via shared group" contract EXACTLY —
#   not just "no other bit". Prints only names + numeric owner/group/mode, never
#   secrets or DB contents. EXPECT_UID is a parameter (prod = 1000) so the check
#   is unit-testable without root.
#     • DATA_DIR : owner EXPECT_UID, group = GID, mode = DIR_MODE (default 2710 —
#                  setgid + owner rwx + group --x; group can traverse to a known
#                  path but NOT list the dir). 2750 only if proven necessary.
#     • spyglass.db/-wal/-shm : owner EXPECT_UID, group = GID, mode 0640 (the app's
#                  umask 027 + the setgid dir keep recreated WAL/SHM at this).
#   The DB files may not yet exist on a first provision — those are skipped; the
#   DIR contract is always required once GID-mode security is in effect.
check_db_perms() {
  local dir="$1" uid="$2" gid="$3" dir_mode="${4:-2710}" bad=0 u g m
  u="$(_stat_uid "$dir")"
  g="$(_stat_gid "$dir")"
  m="$(_stat_mode "$dir")"
  [ "$u" = "$uid" ] || { echo "UNSAFE: ${dir} owner uid ${u} (want ${uid})"; bad=1; }
  [ "$g" = "$gid" ] || { echo "UNSAFE: ${dir} group gid ${g} (want ${gid})"; bad=1; }
  [ "$m" = "$dir_mode" ] || { echo "UNSAFE: ${dir} mode ${m} (want ${dir_mode} setgid)"; bad=1; }
  for f in spyglass.db spyglass.db-wal spyglass.db-shm; do
    [ -e "$dir/$f" ] || continue
    u="$(_stat_uid "$dir/$f")"
    g="$(_stat_gid "$dir/$f")"
    m="$(_stat_mode "$dir/$f")"
    [ "$u" = "$uid" ] || { echo "UNSAFE: ${f} owner uid ${u} (want ${uid})"; bad=1; }
    [ "$g" = "$gid" ] || { echo "UNSAFE: ${f} group gid ${g} (want ${gid})"; bad=1; }
    [ "$m" = 640 ] || { echo "UNSAFE: ${f} mode ${m} (want 640 — no 'other', group read)"; bad=1; }
  done
  return "$bad"
}

# set_env KEY VALUE ENV_FILE
#   Atomic, owner-preserving, 0600 upsert of KEY=VALUE in ENV_FILE. The temp file
#   is created in the SAME directory (so `mv` is atomic on the same filesystem)
#   and removed via a RETURN trap if anything fails before the mv. The existing
#   file's uid:gid is captured and re-applied to the temp before the mv; if the
#   owner CANNOT be preserved (e.g. running as a different non-root user) the
#   function ABORTS rather than silently changing ownership. Never prints the
#   value.
set_env() {
  local k="$1" v="$2" f="$3" dir tmp own
  dir="$(dirname "$f")"
  tmp="$(mktemp "${dir}/.env.tmp.XXXXXX")"
  trap 'rm -f "${tmp}" 2>/dev/null' RETURN
  if [ -f "$f" ]; then
    own="$(_stat_owner "$f")"
    if grep -qE "^${k}=" "$f"; then
      sed "s|^${k}=.*|${k}=${v}|" "$f" >"$tmp"
    else
      cat "$f" >"$tmp"
      printf '%s=%s\n' "$k" "$v" >>"$tmp"
    fi
    if [ -n "$own" ]; then
      chown "$own" "$tmp" 2>/dev/null || {
        echo "    set_env: ABORT — cannot preserve owner ${own} on $(basename "$f")"
        return 1
      }
    fi
  else
    printf '%s=%s\n' "$k" "$v" >>"$tmp"
  fi
  chmod 600 "$tmp"
  mv -f "$tmp" "$f" # tmp gone after mv → RETURN trap rm is a no-op
  echo "    set_env: ${k} written to $(basename "$f") (0600, owner preserved, value hidden)"
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
