#!/usr/bin/env bash
#
# Durable disposable simulation of the v1.1.7 "Grafana read-only via shared
# group" SQLite contract. Run as ROOT (uses chgrp to a raw GID + setpriv to
# assume uids). Operates ONLY in a temp dir — no production path touched, no
# host group created. Prints KEY=VALUE assertions (never DB contents).
#
# Proves: app (uid 1000, umask 027) + setgid 2710 dir ⇒ DB/-wal/-shm are
# 1000:2472 0640; recreation preserves it; grafana (uid 472 + supp 2472) reads;
# grafana without the group, a stranger, and the 0600 deploy-state are denied;
# directory LISTING is denied at 2710 while a known DB path is readable.

set -u
G=2472 U=1000 GRAFANA=472 STRANGER=65533
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

chown "$U:$G" "$T"
chmod 2710 "$T" # setgid + owner rwx + group --x (traverse, NOT list) + other ---

# app (uid U, umask 027) creates the DB trio + a 0600 deploy-state
setpriv --reuid "$U" --regid "$U" --groups "$U" sh -c \
  "umask 027; : > '$T/spyglass.db'; : > '$T/spyglass.db-wal'; : > '$T/spyglass.db-shm'; : > '$T/deploy-state.env'; chmod 600 '$T/deploy-state.env'"

r() { setpriv --reuid "$1" --regid "$2" --groups "$3" cat "$4" >/dev/null 2>&1 && echo ALLOW || echo DENY; }
l() { setpriv --reuid "$1" --regid "$2" --groups "$3" ls "$4" >/dev/null 2>&1 && echo ALLOW || echo DENY; }

echo "DIR_MODE=$(stat -c %a "$T")"
echo "DB_MODE=$(stat -c '%a %u:%g' "$T/spyglass.db")"
echo "WAL_MODE=$(stat -c '%a %u:%g' "$T/spyglass.db-wal")"
echo "SHM_MODE=$(stat -c '%a %u:%g' "$T/spyglass.db-shm")"
echo "GRAFANA_READ_DB=$(r "$GRAFANA" "$GRAFANA" "$G" "$T/spyglass.db")"
echo "GRAFANA_READ_WAL=$(r "$GRAFANA" "$GRAFANA" "$G" "$T/spyglass.db-wal")"
echo "GRAFANA_READ_SHM=$(r "$GRAFANA" "$GRAFANA" "$G" "$T/spyglass.db-shm")"
echo "GRAFANA_LIST_DIR=$(l "$GRAFANA" "$GRAFANA" "$G" "$T")"
echo "GRAFANA_NOGROUP_READ=$(r "$GRAFANA" "$GRAFANA" "$GRAFANA" "$T/spyglass.db")"
echo "STRANGER_READ=$(r "$STRANGER" "$STRANGER" "$STRANGER" "$T/spyglass.db")"
echo "GRAFANA_READ_DEPLOYSTATE=$(r "$GRAFANA" "$GRAFANA" "$G" "$T/deploy-state.env")"
echo "APP_WRITE=$(setpriv --reuid "$U" --regid "$U" --groups "$U" sh -c "echo x >> '$T/spyglass.db'" >/dev/null 2>&1 && echo OK || echo FAIL)"

# restart/checkpoint: delete + recreate WAL/SHM as the app (umask 027) → must
# inherit group via setgid + stay 0640
setpriv --reuid "$U" --regid "$U" --groups "$U" sh -c \
  "rm -f '$T/spyglass.db-wal' '$T/spyglass.db-shm'; umask 027; : > '$T/spyglass.db-wal'; : > '$T/spyglass.db-shm'"
echo "WAL_RECREATE_MODE=$(stat -c '%a %u:%g' "$T/spyglass.db-wal")"
echo "GRAFANA_READ_RECREATED_WAL=$(r "$GRAFANA" "$GRAFANA" "$G" "$T/spyglass.db-wal")"
