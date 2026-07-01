#!/usr/bin/env bash
#
# Shared helpers for scripts/deploy.sh and scripts/rollback.sh. Sourceable: it
# only DEFINES functions, with no side effects at source time. The deploy-state
# and .env writes are atomic (temp-in-same-dir + mv) and 0600; secret values are
# never printed.

# ── Privacy floor baseline (IMMUTABLE, fail-closed) ──────────────────────────
# The minimum privacy-safe commit, baked into the SCRIPT (source of truth = git),
# NOT read from the mutable deploy-state. This is v1.2.1 (commit 2437646) — the
# release that removed PII from auth telemetry (#24, tests/auth-event-pii.test.js).
# Consequences:
#   • Deleting/resetting deploy-state.env can NEVER lower the bar below this SHA.
#   • A runtime floor in deploy-state may only RAISE the bar (must be a descendant
#     of the baseline); a missing/empty/malformed/weaker/unrelated runtime floor
#     is ignored and the baseline stands.
#   • The guard is FAIL-CLOSED: anything it cannot positively verify is rejected.
# There is deliberately NO env override — the baseline must not be weakenable.
# Tests exercise it against this repo's real git history.
PRIVACY_BASELINE_SHA="24376462c3fd1988447b26ee69a897190bdeac1a"

# ── Threat model / ancestry semantics (READ BEFORE CHANGING THE FLOOR) ────────
# The floor guard proves ANCESTRY, not BEHAVIOUR: it verifies (via
# `git merge-base --is-ancestor`) that the image was built from a commit that is
# the baseline or a descendant of it. It CANNOT prove the privacy fix is still
# present — a commit that descends from the baseline but REVERTS the PII removal
# would satisfy ancestry yet be privacy-unsafe. Closing that gap requires a
# behavioural check, which is a SEPARATE system: the CI privacy-regression gate
# `tests/auth-event-pii.test.js` (added with the baseline commit) asserts the
# actual invariant — auth telemetry emits no PII — and runs on every PR/push.
# So the deploy-time floor stops ACCIDENTAL rollback to a pre-privacy image, and
# CI stops a privacy-reverting commit from ever becoming a descendant that ships.
# Second limitation: the candidate revision is read from the image's OCI
# `org.opencontainers.image.revision` label, a build-arg. The guard therefore
# protects against ACCIDENTAL regression, not a maliciously forged label — that
# is out of scope for a build-arg-based guard and would need image signing.

# state_get FILE KEY  → prints the sanitized value of the LAST `KEY=` line in FILE.
#   The state file is parsed as DATA and is NEVER sourced/evaluated, so a crafted
#   value like `$(cmd)` / `; rm -rf /` / backticks cannot execute. It also:
#     • refuses to read a SYMLINK (path-swap / symlink attack) — returns empty;
#     • strips every byte outside the safe set [A-Za-z0-9._:-] so no shell
#       metacharacter, whitespace, newline or quote can survive into a caller;
#     • takes the LAST matching line (deterministic if a key is duplicated).
#   deploy.sh and rollback.sh BOTH read state through this one function → identical
#   parsing policy. Prints nothing for an absent key / missing / unsafe file.
state_get() {
  local f="$1" key="$2" raw
  [ -f "$f" ] || return 0
  if [ -L "$f" ]; then
    echo "UNSAFE: refusing to read deploy-state via symlink: $f" >&2
    return 0
  fi
  raw="$(grep -E "^${key}=" "$f" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  printf '%s' "$raw" | LC_ALL=C tr -cd 'A-Za-z0-9._:-'
}

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
  if [ -L "$f" ]; then
    echo "    set_env: ABORT — refusing to write through symlink $(basename "$f")"
    return 1
  fi
  tmp="$(mktemp "${dir}/.env.tmp.XXXXXX")"
  trap 'rm -f "${tmp:-}" 2>/dev/null; trap - RETURN' RETURN
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
  if [ -L "$f" ]; then
    echo "write_state: ABORT — refusing to write deploy-state through symlink: $f" >&2
    return 1
  fi
  tmp="$(mktemp "${dir}/.deploy-state.tmp.XXXXXX")"
  trap 'rm -f "${tmp:-}" 2>/dev/null; trap - RETURN' RETURN
  cat >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$f"
}

# arm_restart_policy CONTAINER POLICY
#   Set the restart policy on an EXISTING container IN PLACE (no recreate, no
#   downtime) via `docker update`. Used to arm `always` ONLY after a candidate
#   or rollback image has passed wait_ready + smoke — see the docker-compose.yml
#   `restart: 'no'` comment for why this must happen AFTER verification, never
#   at container-creation time.
arm_restart_policy() {
  local container="$1" policy="$2"
  docker update --restart="$policy" "$container" >/dev/null 2>&1
}

# is_inflight_status STATUS
#   0 (true) if STATUS represents a deploy/rollback attempt that was left
#   mid-transition (we do not know what, if anything, is actually running).
#   Terminal/safe-to-proceed states are ACTIVE, ROLLED_BACK, CRITICAL, or no
#   state at all (first-ever deploy) — CRITICAL is terminal-but-bad: it already
#   demands manual intervention, and a fresh deploy.sh run re-derives PREV_IMG
#   from whatever is ACTUALLY running via `docker inspect`, so it is safe to
#   allow a retry from CRITICAL. The legacy value DEPLOYING (pre-state-machine
#   deploy.sh) is treated as in-flight too, so an old stale state file left by a
#   not-yet-upgraded host still fails closed here rather than being silently
#   treated as terminal.
is_inflight_status() {
  case "$1" in
    DEPLOYING | CANDIDATE_STARTING | CANDIDATE_READY | ROLLING_BACK) return 0 ;;
    *) return 1 ;;
  esac
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

# image_git_revision IMAGE
#   Print the Git revision the given image was built with, read from OCI label
#   org.opencontainers.image.revision.
#   Returns 1 if the image is missing, has no such label, or if the label
#   is not a 40-hex Git SHA.
image_git_revision() {
  local ref="$1" rev
  docker image inspect "$ref" >/dev/null 2>&1 || return 1
  rev="$(docker image inspect "$ref" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null)"
  [ -n "$rev" ] || return 1
  if echo "$rev" | grep -qE '^[0-9a-fA-F]{40}$'; then
    printf '%s' "$rev"
  else
    return 1
  fi
}

# effective_privacy_floor [RUNTIME_FLOOR]  → prints the effective floor SHA (full
#   40-hex), fail-closed. The floor is the STRONGER of two inputs:
#     • PRIVACY_BASELINE_SHA — the immutable, in-code minimum (always applies).
#     • RUNTIME_FLOOR         — an optional value from deploy-state; it may only
#                               RAISE the bar, i.e. it is honoured ONLY when it is
#                               the baseline itself or a descendant of it.
#   A missing / empty / malformed / unresolvable / weaker (ancestor) / unrelated
#   runtime floor is IGNORED and the baseline stands — never a downgrade, never an
#   "allow-any". Returns 1 (prints nothing) ONLY if the baseline cannot be resolved
#   in the local git repo (a broken/incomplete checkout) — callers then reject.
effective_privacy_floor() {
  local runtime="${1:-}" baseline_resolved runtime_resolved
  baseline_resolved="$(git rev-parse --verify "${PRIVACY_BASELINE_SHA}^{commit}" 2>/dev/null)" || return 1
  if [ -n "$runtime" ]; then
    runtime_resolved="$(git rev-parse --verify "${runtime}^{commit}" 2>/dev/null || true)"
    # Honour the runtime floor only if it is baseline-or-newer (strengthens).
    if [ -n "$runtime_resolved" ] &&
      git merge-base --is-ancestor "$baseline_resolved" "$runtime_resolved" 2>/dev/null; then
      printf '%s' "$runtime_resolved"
      return 0
    fi
  fi
  printf '%s' "$baseline_resolved"
}

# image_contains_privacy_floor IMAGE [RUNTIME_FLOOR]  → 0 if the image's baked git
#   revision is at or newer than the EFFECTIVE floor (baseline, possibly raised by
#   a valid runtime floor); 1 otherwise.
#   FAIL-CLOSED contract:
#     - effective floor = max(baseline, valid-runtime-floor); baseline ALWAYS applies
#     - empty/missing/malformed/weaker/unrelated RUNTIME_FLOOR does NOT weaken it
#     - candidate revision is read from OCI label org.opencontainers.image.revision
#       and must be a full 40-hex Git SHA (image_git_revision enforces this)
#     - check is done only via: git merge-base --is-ancestor FLOOR CANDIDATE
#     - candidate == floor / descendant -> allow (0)
#     - candidate ancestor (pre-floor) / unrelated -> reject (1)
#     - unresolvable baseline, missing/malformed label, missing Git object -> reject (1)
#     - no timestamp/version/lexical comparison is performed
image_contains_privacy_floor() {
  local img="$1"
  local runtime="${2:-}"
  local floor candidate candidate_resolved
  floor="$(effective_privacy_floor "$runtime")" || return 1
  [ -n "$floor" ] || return 1
  candidate="$(image_git_revision "$img")" || return 1
  candidate_resolved="$(git rev-parse --verify "${candidate}^{commit}" 2>/dev/null)" || return 1
  if git merge-base --is-ancestor "$floor" "$candidate_resolved" 2>/dev/null; then
    return 0
  fi
  return 1
}
