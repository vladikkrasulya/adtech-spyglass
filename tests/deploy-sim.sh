#!/usr/bin/env bash
#
# Disposable deploy.sh flow simulator (used by tests/immutable-image.test.js).
#
# Mocks docker/git/curl on PATH and runs the REAL scripts/deploy.sh against a
# throwaway DATA_DIR + .env, so the control flow (compose-up failures, gate,
# auto-rollback, STATUS state machine) is exercised without docker or git.
#
# Usage: deploy-sim.sh <scenario>
#   scenario ∈ { happy, candidate-up-fail, rollback-up-fail, missing-prev-sha,
#                unsafe-perms }
# Prints:  EXIT=<code> and the resulting deploy-state.env (or "(no state)").

set -u
SCEN="${1:?scenario required}"
export SCEN
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
BIN="$WORK/bin"
DATA="$WORK/data"
mkdir -p "$BIN" "$DATA"
trap 'rm -rf "$WORK"' EXIT

# ── mock git: clean tree, HEAD == main == origin/main, short = abc1234 ──
cat >"$BIN/git" <<'EOG'
#!/bin/sh
case "$*" in
  "fetch -q origin") exit 0 ;;
  "status --porcelain") exit 0 ;;
  "rev-parse HEAD"|"rev-parse main"|"rev-parse origin/main")
    echo "ffffffffffffffffffffffffffffffffffffffff" ;;
  "rev-parse --short HEAD") echo "abc1234" ;;
  *) exit 0 ;;
esac
EOG

# ── mock docker: build/tag ok; `up` driven by SCEN + SPYGLASS_TAG; inspect
#    returns a prev image + healthy; image inspect yields BUILD_SHA (or none) ──
cat >"$BIN/docker" <<'EOD'
#!/bin/sh
case "$1 $2" in
  "compose build") exit 0 ;;
  "compose up")
    if [ "${SPYGLASS_TAG:-}" = "abc1234" ]; then
      case "$SCEN" in candidate-up-fail|rollback-up-fail) exit 1 ;; *) exit 0 ;; esac
    else
      case "$SCEN" in rollback-up-fail) exit 1 ;; *) exit 0 ;; esac
    fi ;;
esac
case "$1" in
  tag) exit 0 ;;
  inspect)
    case "$*" in
      *Health*) echo healthy ;;
      *Image*)  echo "sha256:previmage" ;;
      *)        echo "" ;;
    esac ;;
  image)
    case "$*" in
      *--format*) case "$SCEN" in missing-prev-sha) : ;; *) echo "BUILD_SHA=prevsha0" ;; esac ;;
      *) : ;;
    esac ;;
esac
exit 0
EOD

# ── mock curl: any /api/health → status ok (so wait_ready passes) ──
cat >"$BIN/curl" <<'EOC'
#!/bin/sh
for a in "$@"; do
  case "$a" in *api/health*) echo '{"success":true,"status":"ok","build":{"sha":"abc1234"}}'; exit 0 ;; esac
done
exit 0
EOC

# ── mock smoke: passes (the `up` failures drive the scenarios) ──
printf '#!/bin/sh\nexit 0\n' >"$BIN/mock-smoke.sh"
chmod +x "$BIN/git" "$BIN/docker" "$BIN/curl" "$BIN/mock-smoke.sh"

# Pre-create a fake .env. Normal scenarios use 0600 so the permission preflight
# passes (and set_env still exercises the owner-preserve path); `unsafe-perms`
# uses 0664 to prove the preflight blocks the deploy before any transition.
printf 'SPYGLASS_TAG=old\n' >"$WORK/.env"
case "$SCEN" in
  unsafe-perms) chmod 664 "$WORK/.env" ;;
  *) chmod 600 "$WORK/.env" ;;
esac

PATH="$BIN:$PATH" \
  SPYGLASS_DEPLOY_DATA_DIR="$DATA" \
  SPYGLASS_DEPLOY_ENV_FILE="$WORK/.env" \
  SMOKE_CMD="$BIN/mock-smoke.sh" \
  SPYGLASS_SEED_UID="$(id -u)" \
  SPYGLASS_DB_GID="" \
  READY_TIMEOUT=6 \
  bash "$REPO/scripts/deploy.sh" >/dev/null 2>&1
rc=$?

echo "EXIT=$rc"
if [ -f "$DATA/deploy-state.env" ]; then cat "$DATA/deploy-state.env"; else echo "(no state)"; fi
echo "ENV_SPYGLASS_TAG=$(grep -E '^SPYGLASS_TAG=' "$WORK/.env" | cut -d= -f2)"
exit "$rc"
