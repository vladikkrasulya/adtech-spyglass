#!/usr/bin/env bash
#
# Disposable simulator for scripts/cutover-spyglass-ro.sh. Mocks git/docker/curl/
# setpriv and injects a mock provision + mock deploy whose behaviour is driven by
# the scenario, against a throwaway DATA dir with fake DB files. Runs the REAL
# wrapper and reports its exit code + the FULL cutover-state snapshot + DB modes.
#
# Scenarios: provision-apply-fail provision-fail-rollback-fail deploy-success
#   deploy-preflight-fail deploy-candidate-fail deploy-critical host-rollback-fail
#   repeated-success partial-perms wrong-umask grafana-read-fail incomplete-baseline
#   interrupted-applying recovery-gate-fail deploy-nonzero-target-active
#   deploy-zero-not-active

set -u
SCEN="${1:?scenario required}"
export SCEN
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
BIN="$WORK/bin"
DATA="$WORK/data"
TESTGID="$(id -g)"
export DATA TESTGID
mkdir -p "$BIN" "$DATA"
trap 'rm -rf "$WORK"' EXIT

# Baseline DATA: DB trio 0644, dir 0755, active sha = pre-cutover.
for f in spyglass.db spyglass.db-wal spyglass.db-shm; do printf x >"$DATA/$f"; chmod 0644 "$DATA/$f"; done
chmod 0755 "$DATA"
echo "oldsha6" >"$DATA/.active_sha"
case "$SCEN" in
  repeated-success) printf 'STATUS=SECURITY_CUTOVER\nHOST_PERMS=APPLIED\n' >"$DATA/cutover-state.env"; chmod 600 "$DATA/cutover-state.env"; echo newsha7 >"$DATA/.active_sha" ;;
  interrupted-applying) printf 'STATUS=APPLYING\nHOST_PERMS=BASELINE\n' >"$DATA/cutover-state.env"; chmod 600 "$DATA/cutover-state.env" ;;
esac

cat >"$BIN/git" <<'EOG'
#!/bin/sh
[ "$1" = "-C" ] && shift 2
case "$*" in
  "status --porcelain") exit 0 ;;
  "rev-parse --short HEAD") echo newsha7 ;;
  *) exit 0 ;;
esac
EOG

cat >"$BIN/docker" <<EOD
#!/bin/sh
case "\$*" in
  *"exec grafana id"*)
    case "\$SCEN" in recovery-gate-fail) echo "uid=472(grafana) gid=472 groups=472" ;; *) echo "uid=472(grafana) gid=472 groups=472,${TESTGID}" ;; esac ;;
  *"/proc/1/status"*)
    case "\$SCEN" in wrong-umask) printf 'Umask:\t0022\n' ;; *) printf 'Umask:\t0027\n' ;; esac ;;
  *"exec grafana sh -c"*)
    case "\$SCEN" in grafana-read-fail) exit 1 ;; *) exit 0 ;; esac ;;
  *) exit 0 ;;
esac
EOD

cat >"$BIN/curl" <<EOC
#!/bin/sh
printf '{"build":{"sha":"%s"}}' "\$(cat "$DATA/.active_sha")"
EOC

# mock setpriv: stranger read succeeds iff the DB has an 'other' read bit
cat >"$BIN/setpriv" <<'EOS'
#!/bin/sh
f=$(echo "$*" | sed -n 's/.*if=\([^ ]*\).*/\1/p')
m=$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f" 2>/dev/null)
last=$(printf '%s' "$m" | sed 's/.*\(.\)$/\1/')
case "$last" in 4 | 5 | 6 | 7) exit 0 ;; *) exit 1 ;; esac
EOS

cat >"$BIN/mock-provision" <<EOP
#!/bin/sh
case "\$1" in
  --apply)
    case "\$SCEN" in
      provision-apply-fail) exit 1 ;;
      provision-fail-rollback-fail) chmod 2710 "$DATA"; exit 1 ;;
      partial-perms) chmod 2710 "$DATA"; chmod 0640 "$DATA/spyglass.db" "$DATA/spyglass.db-shm"; chmod 0644 "$DATA/spyglass.db-wal"; exit 0 ;;
      *) chmod 2710 "$DATA"; for f in spyglass.db spyglass.db-wal spyglass.db-shm; do chmod 0640 "$DATA/\$f"; done; exit 0 ;;
    esac ;;
  --rollback)
    case "\$SCEN" in
      provision-fail-rollback-fail|host-rollback-fail) exit 1 ;;
      incomplete-baseline) for f in spyglass.db spyglass.db-wal spyglass.db-shm; do chmod 0644 "$DATA/\$f"; done; exit 0 ;;
      *) chmod 0755 "$DATA"; chmod g-s "$DATA"; for f in spyglass.db spyglass.db-wal spyglass.db-shm; do chmod 0644 "$DATA/\$f"; done; exit 0 ;;
    esac ;;
esac
EOP

cat >"$BIN/mock-deploy" <<EOM
#!/bin/sh
case "\$SCEN" in
  deploy-preflight-fail|incomplete-baseline) exit 6 ;;
  deploy-candidate-fail) echo oldsha6 > "$DATA/.active_sha"; exit 1 ;;
  deploy-critical|host-rollback-fail) echo UNKNOWN > "$DATA/.active_sha"; exit 3 ;;
  deploy-nonzero-target-active) echo newsha7 > "$DATA/.active_sha"; exit 1 ;;
  deploy-zero-not-active) echo oldsha6 > "$DATA/.active_sha"; exit 0 ;;
  *) echo newsha7 > "$DATA/.active_sha"; exit 0 ;;
esac
EOM
chmod +x "$BIN"/*

WMODE="--apply"
[ "$SCEN" = recovery-gate-fail ] && WMODE="--recover"

PATH="$BIN:$PATH" \
  SPYGLASS_DEPLOY_DATA_DIR="$DATA" \
  SPYGLASS_SUDO="" \
  SPYGLASS_PROVISION_CMD="$BIN/mock-provision" \
  SPYGLASS_DEPLOY_CMD="$BIN/mock-deploy" \
  SPYGLASS_EXPECT_PREV_SHA="oldsha6" \
  SPYGLASS_APP_UID="$(id -u)" \
  SPYGLASS_APP_GID="$TESTGID" \
  SPYGLASS_DB_GID="$TESTGID" \
  SPYGLASS_DIR_MODE="2710" \
  SPYGLASS_GRAFANA_CONTAINER="grafana" \
  SPYGLASS_CONTAINER="adtech-spyglass" \
  bash "$REPO/scripts/cutover-spyglass-ro.sh" "$WMODE" >/dev/null 2>&1
rc=$?

echo "EXIT=$rc"
if [ -f "$DATA/cutover-state.env" ]; then
  grep -E '^(STATUS|HOST_PERMS|APP_DEPLOY|LAST_ERROR|TARGET|DEPLOY_RC|PREV_BUILD_SHA|ACTIVE_BUILD_SHA)=' "$DATA/cutover-state.env"
  echo "STATE_FIELDS=$(grep -cE '=' "$DATA/cutover-state.env")"
else
  echo "(no state)"
fi
mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null; }
echo "DB_MODE=$(mode "$DATA/spyglass.db")  WAL_MODE=$(mode "$DATA/spyglass.db-wal")  DIR_MODE=$(mode "$DATA")"
exit "$rc"
