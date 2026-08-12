#!/usr/bin/env bash
#
# usage-report.sh — how many real people used ortbtools, per day / week / month.
#
#   ./scripts/usage-report.sh              # last 30 days, 12 weeks, 12 months
#   ./scripts/usage-report.sh --days 90    # widen the daily table
#   ./scripts/usage-report.sh --all        # also show the traffic-class split
#
# Reads analytics.ortbtools_usage_daily, the AggregatingMergeTree rollup fed by
# a materialized view on analytics.ortbtools_product_events.
#
# WHY A ROLLUP AND NOT THE RAW TABLE
#   1. Raw events expire after 180 days. The rollup has no TTL, so "visitors in
#      March" is still answerable next year.
#   2. Unique visitors do not add up. A person who visits Monday and Tuesday is
#      ONE weekly visitor, not two, so a weekly figure cannot be the sum of
#      daily figures. The rollup stores uniq STATES, and uniqMerge() re-computes
#      the true distinct count at whatever grain is asked for.
#
# Only `external` traffic is counted: the owner, dev agents, CI, uptime probes
# and crawlers are classified out (lib/traffic-class.js). Bots that cannot run
# JavaScript never reach the source table at all — see docs/PRIVACY.md.
#
# Numbers start from 2026-08-12, when telemetry shipped. Anything earlier is
# genuinely unknown, not zero.
set -euo pipefail

CH_CONTAINER="${CLICKHOUSE_CONTAINER:-clickhouse}"
DAYS=30
WEEKS=12
MONTHS=12
SHOW_ALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --days) DAYS="$2"; shift 2 ;;
    --weeks) WEEKS="$2"; shift 2 ;;
    --months) MONTHS="$2"; shift 2 ;;
    --all) SHOW_ALL=1; shift ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

for v in DAYS WEEKS MONTHS; do
  case "${!v}" in
    ''|*[!0-9]*) echo "--${v,,} must be a positive integer" >&2; exit 2 ;;
  esac
done

ch() { docker exec -i "$CH_CONTAINER" clickhouse-client -q "$1"; }

if ! ch "SELECT 1" >/dev/null 2>&1; then
  echo "Cannot reach ClickHouse in container '$CH_CONTAINER'." >&2
  echo "Set CLICKHOUSE_CONTAINER if it runs elsewhere." >&2
  exit 1
fi

TOTAL=$(ch "SELECT sum(events) FROM analytics.ortbtools_usage_daily" 2>/dev/null || echo 0)
if [ "${TOTAL:-0}" = "0" ]; then
  cat <<'EMPTY'
No usage recorded yet.

That is expected right after deploy: the rollup only fills as visitors arrive.
If you believe there IS traffic, check in this order:
  1. ORTBTOOLS_TRUSTED_PROXIES is set   → otherwise everyone is filed 'internal'
  2. docker exec clickhouse clickhouse-client -q \
       "SELECT traffic_class, count() FROM analytics.ortbtools_product_events GROUP BY traffic_class"
  3. docs/OPERATIONS.md 4.10
EMPTY
  exit 0
fi

echo "═══ REAL USERS — external traffic only ═══"
echo

echo "── PER DAY (last ${DAYS}) ──"
ch "
SELECT day AS \`day\`,
       uniqMerge(visitors_state) AS \`visitors\`,
       uniqMerge(sessions_state) AS \`sessions\`,
       sum(analyses)             AS \`analyses\`,
       sum(macro_uses)           AS \`macro\`,
       sum(share_uses)           AS \`share\`,
       sum(registrations)        AS \`signups\`
FROM analytics.ortbtools_usage_daily
WHERE traffic_class = 'external' AND day >= today() - ${DAYS}
GROUP BY day ORDER BY day DESC
FORMAT PrettyCompactMonoBlock"
echo

echo "── PER WEEK (last ${WEEKS}, Mon-start; a visitor active on 3 days counts ONCE) ──"
ch "
SELECT toStartOfWeek(day, 1)    AS \`week_of\`,
       uniqMerge(visitors_state) AS \`visitors\`,
       uniqMerge(sessions_state) AS \`sessions\`,
       sum(analyses)             AS \`analyses\`,
       sum(registrations)        AS \`signups\`
FROM analytics.ortbtools_usage_daily
WHERE traffic_class = 'external' AND day >= today() - ${WEEKS} * 7
GROUP BY week_of ORDER BY week_of DESC
FORMAT PrettyCompactMonoBlock"
echo

echo "── PER MONTH (last ${MONTHS}) ──"
ch "
SELECT formatDateTime(toStartOfMonth(day), '%Y-%m') AS \`month\`,
       uniqMerge(visitors_state) AS \`visitors\`,
       uniqMerge(sessions_state) AS \`sessions\`,
       sum(analyses)             AS \`analyses\`,
       sum(registrations)        AS \`signups\`
FROM analytics.ortbtools_usage_daily
WHERE traffic_class = 'external' AND day >= toStartOfMonth(today()) - INTERVAL ${MONTHS} MONTH
GROUP BY month ORDER BY month DESC
FORMAT PrettyCompactMonoBlock"

if [ "$SHOW_ALL" = "1" ]; then
  echo
  echo "── WHO ELSE IS HITTING US (last ${DAYS} days, all classes) ──"
  echo "   Only 'external' counts as a user. The rest is you, agents, CI, monitors, bots."
  ch "
  SELECT traffic_class            AS \`class\`,
         uniqMerge(visitors_state) AS \`visitors\`,
         sum(events)               AS \`events\`
  FROM analytics.ortbtools_usage_daily
  WHERE day >= today() - ${DAYS}
  GROUP BY traffic_class ORDER BY events DESC
  FORMAT PrettyCompactMonoBlock"
fi
