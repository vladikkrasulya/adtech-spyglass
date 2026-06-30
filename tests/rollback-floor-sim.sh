#!/usr/bin/env bash
#
# Disposable rollback.sh flow simulator (used by tests/immutable-image.test.js).
#
# Mocks docker/git/curl on PATH and runs the REAL scripts/rollback.sh against a
# throwaway DATA_DIR + .env.
#
# Usage: rollback-floor-sim.sh <scenario> [rollback_tag_override]
#   scenario ∈ { floor-empty, candidate-eq-floor, candidate-descendant,
#                candidate-ancestor, unrelated-candidate, missing-label,
#                malformed-label, missing-git-object, rollback-up-fail }

set -u
SCEN="${1:?scenario required}"
TAG_ARG="${2:-}"
export SCEN

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
BIN="$WORK/bin"
DATA="$WORK/data"
mkdir -p "$BIN" "$DATA"
trap 'rm -rf "$WORK"' EXIT

# Floor commit revision to simulate
FLOOR_REV="2437646243764624376462437646243764624376"

# Candidate OCI revision commit based on scenario
case "$SCEN" in
  floor-empty)
    # Floor is empty, candidate revision doesn't matter (we can use ancestor)
    CANDIDATE_REV="a43adada43adada43adada43adada43adada43ad"
    ;;
  candidate-eq-floor)
    CANDIDATE_REV="$FLOOR_REV"
    ;;
  candidate-descendant)
    CANDIDATE_REV="ffffffffffffffffffffffffffffffffffffffff"
    ;;
  candidate-ancestor)
    CANDIDATE_REV="a43adada43adada43adada43adada43adada43ad"
    ;;
  unrelated-candidate)
    CANDIDATE_REV="1111111111111111111111111111111111111111"
    ;;
  missing-label|malformed-label)
    CANDIDATE_REV=""
    ;;
  missing-git-object)
    CANDIDATE_REV="ffffffffffffffffffffffffffffffffffffffff"
    ;;
  rollback-up-fail)
    CANDIDATE_REV="$FLOOR_REV"
    ;;
  *)
    CANDIDATE_REV="$FLOOR_REV"
    ;;
esac

# ── mock git ──
cat >"$BIN/git" <<EOG
#!/bin/sh
case "\$1" in
  rev-parse)
    # git rev-parse --verify sha^{commit}
    sha_arg="\$3"
    sha="\${sha_arg%%^*}"
    if [ "$SCEN" = "missing-git-object" ] && [ "\$sha" = "ffffffffffffffffffffffffffffffffffffffff" ]; then
      echo "fatal: Not a valid commit name \$sha" >&2
      exit 128
    fi
    if [ -n "\$sha" ]; then
      echo "\$sha"
    else
      exit 1
    fi
    ;;
  merge-base)
    # git merge-base --is-ancestor floor candidate
    # \$3 is floor, \$4 is candidate
    case "$SCEN" in
      candidate-eq-floor)
        if [ "\$3" = "\$4" ]; then exit 0; else exit 1; fi
        ;;
      candidate-descendant)
        exit 0
        ;;
      candidate-ancestor)
        exit 1
        ;;
      unrelated-candidate)
        exit 1
        ;;
      missing-git-object)
        exit 128
        ;;
      *)
        exit 0
        ;;
    esac
    ;;
  *)
    exit 0
    ;;
esac
EOG

# ── mock docker ──
cat >"$BIN/docker" <<EOD
#!/bin/sh
case "\$1 \$2" in
  "compose up")
    case "$SCEN" in
      rollback-up-fail) exit 1 ;;
      *) exit 0 ;;
    esac
    ;;
esac
case "\$1" in
  inspect)
    case "\$*" in
      *Health*) echo healthy ;;
      *) echo "" ;;
    esac
    ;;
  image)
    case "\$*" in
      *Labels*org.opencontainers.image.revision*)
        case "$SCEN" in
          missing-label) echo "" ;;
          malformed-label) echo "not-a-40-hex-sha" ;;
          *) echo "$CANDIDATE_REV" ;;
        esac
        ;;
      *Env*)
        echo "BUILD_SHA=candidate-build-sha"
        ;;
      *)
        exit 0
        ;;
    esac
    ;;
esac
exit 0
EOD

# ── mock curl: any /api/health → status ok ──
cat >"$BIN/curl" <<'EOC'
#!/bin/sh
for a in "$@"; do
  case "$a" in *api/health*) echo '{"success":true,"status":"ok","build":{"sha":"candidate-build-sha"}}'; exit 0 ;; esac
done
exit 0
EOC

# ── mock smoke ──
printf '#!/bin/sh\nexit 0\n' >"$BIN/mock-smoke.sh"
chmod +x "$BIN/git" "$BIN/docker" "$BIN/curl" "$BIN/mock-smoke.sh"

# Pre-create env file and state file
printf 'SPYGLASS_TAG=old\n' >"$WORK/.env"
chmod 600 "$WORK/.env"

cat >"$DATA/deploy-state.env" <<EOF
ROLLBACK_TAG=targettag
STATUS=ACTIVE
EOF

if [ "$SCEN" != "floor-empty" ]; then
  echo "PRIVACY_FLOOR_BUILD_SHA=$FLOOR_REV" >> "$DATA/deploy-state.env"
fi

# Run the real rollback.sh
PATH="$BIN:$PATH" \
  SPYGLASS_DEPLOY_DATA_DIR="$DATA" \
  SPYGLASS_DEPLOY_ENV_FILE="$WORK/.env" \
  SMOKE_CMD="$BIN/mock-smoke.sh" \
  SPYGLASS_BASE_URL="http://127.0.0.1:8090" \
  SPYGLASS_CONTAINER="adtech-spyglass" \
  READY_TIMEOUT=6 \
  bash "$REPO/scripts/rollback.sh" "$TAG_ARG" >"$WORK/stdout.log" 2>"$WORK/stderr.log"
rc=$?

# Print results for JS verification
echo "EXIT=$rc"
if [ -f "$DATA/deploy-state.env" ]; then cat "$DATA/deploy-state.env"; else echo "(no state)"; fi
echo "ENV_SPYGLASS_TAG=$(grep -E '^SPYGLASS_TAG=' "$WORK/.env" | cut -d= -f2)"
echo "--- STDOUT ---"
cat "$WORK/stdout.log"
echo "--- STDERR ---"
cat "$WORK/stderr.log"

exit "$rc"
