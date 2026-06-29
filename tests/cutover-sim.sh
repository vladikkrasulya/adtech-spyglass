#!/usr/bin/env bash
#
# Disposable simulator for scripts/cutover-spyglass-ro.sh (used by
# tests/cutover-coordination.test.js). Mocks git/docker/curl + injects a mock
# provision and a mock deploy whose behaviour is driven by the scenario, against
# a throwaway DATA dir with fake DB files. Runs the REAL wrapper.
#
# Usage:  cutover-sim.sh <scenario>
#   scenario ∈ { provision-apply-fail, deploy-success, deploy-preflight-fail,
#                deploy-candidate-fail, deploy-critical, host-rollback-fail,
#                repeated-success }
# Prints: EXIT=<code>, the cutover-state.env (STATUS/HOST_PERMS/APP_DEPLOY) and
#         the resulting spyglass.db mode (640 applied / 644 baseline).

set -u
SCEN="${1:?scenario required}"
export SCEN
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
BIN="$WORK/bin"
DATA="$WORK/data"
export DATA
TESTGID="$(id -g)"
export TESTGID
mkdir -p "$BIN" "$DATA"
trap 'rm -rf "$WORK"' EXIT

# Baseline DATA: fake DB trio 0644, dir 0755, active sha = the pre-cutover sha.
for f in spyglass.db spyglass.db-wal spyglass.db-shm; do printf x >"$DATA/$f"; chmod 0644 "$DATA/$f"; done
chmod 0755 "$DATA"
echo "oldsha6" >"$DATA/.active_sha"
[ "$SCEN" = repeated-success ] && printf 'STATUS=SECURITY_CUTOVER\nHOST_PERMS=APPLIED\n' >"$DATA/cutover-state.env" && chmod 600 "$DATA/cutover-state.env" && echo "newsha7" >"$DATA/.active_sha"

# mock git: clean tree; HEAD short = newsha7 (the deploy target)
cat >"$BIN/git" <<'EOG'
#!/bin/sh
[ "$1" = "-C" ] && shift 2
case "$*" in
  "status --porcelain") exit 0 ;;
  "rev-parse --short HEAD") echo "newsha7" ;;
  *) exit 0 ;;
esac
EOG

# mock docker: grafana id has the supp group; grafana DB read succeeds
cat >"$BIN/docker" <<EOD
#!/bin/sh
case "\$*" in
  *"exec grafana id"*|*"exec grafana"*" id") echo "uid=472(grafana) gid=472 groups=472,${TESTGID}" ;;
  *"exec grafana sh -c"*) exit 0 ;;
  *) exit 0 ;;
esac
EOD

# mock curl: /api/health → {"build":{"sha": <contents of .active_sha>}}
cat >"$BIN/curl" <<EOC
#!/bin/sh
printf '{"build":{"sha":"%s"}}' "\$(cat "$DATA/.active_sha")"
EOC

# mock provision: manipulates DATA perms; fails per scenario
cat >"$BIN/mock-provision" <<EOP
#!/bin/sh
case "\$1--\$SCEN" in
  --apply--provision-apply-fail) exit 1 ;;
  --apply--*)
    chmod 2710 "$DATA"
    for f in spyglass.db spyglass.db-wal spyglass.db-shm; do chgrp "$TESTGID" "$DATA/\$f"; chmod 0640 "$DATA/\$f"; done
    exit 0 ;;
  --rollback--host-rollback-fail) exit 1 ;;
  --rollback--*)
    chmod 0755 "$DATA"; chmod g-s "$DATA"
    for f in spyglass.db spyglass.db-wal spyglass.db-shm; do chmod 0644 "$DATA/\$f"; done
    exit 0 ;;
esac
EOP

# mock deploy: sets the post-deploy active sha + exits per scenario
cat >"$BIN/mock-deploy" <<EOM
#!/bin/sh
case "\$SCEN" in
  deploy-preflight-fail) exit 6 ;;                                   # app unchanged (active stays oldsha6)
  deploy-candidate-fail) echo oldsha6 > "$DATA/.active_sha"; exit 1 ;; # app auto-rolled-back
  deploy-critical)       echo UNKNOWN > "$DATA/.active_sha"; exit 3 ;;
  host-rollback-fail)    echo UNKNOWN > "$DATA/.active_sha"; exit 3 ;;
  *)                     echo newsha7 > "$DATA/.active_sha"; exit 0 ;;
esac
EOM
chmod +x "$BIN"/git "$BIN"/docker "$BIN"/curl "$BIN"/mock-provision "$BIN"/mock-deploy

PATH="$BIN:$PATH" \
  SPYGLASS_DEPLOY_DATA_DIR="$DATA" \
  SPYGLASS_SUDO="" \
  SPYGLASS_PROVISION_CMD="$BIN/mock-provision" \
  SPYGLASS_DEPLOY_CMD="$BIN/mock-deploy" \
  SPYGLASS_EXPECT_PREV_SHA="oldsha6" \
  SPYGLASS_DB_GID="$TESTGID" \
  SPYGLASS_APP_UID="$(id -u)" \
  SPYGLASS_DIR_MODE="2710" \
  SPYGLASS_GRAFANA_CONTAINER="grafana" \
  bash "$REPO/scripts/cutover-spyglass-ro.sh" --apply >/dev/null 2>&1
rc=$?

echo "EXIT=$rc"
if [ -f "$DATA/cutover-state.env" ]; then grep -E '^(STATUS|HOST_PERMS|APP_DEPLOY|DEPLOY_RC)=' "$DATA/cutover-state.env"; else echo "(no state)"; fi
echo "DB_MODE=$(stat -c '%a' "$DATA/spyglass.db" 2>/dev/null || stat -f '%Lp' "$DATA/spyglass.db" 2>/dev/null)"
exit "$rc"
