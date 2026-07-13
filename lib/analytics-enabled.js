'use strict';

/**
 * Gate for ClickHouse-derived telemetry (validation_logs + event_log).
 *
 * Self-host / privacy:
 *   - Leave CLICKHOUSE_USER unset → analytics modules no-op (see .env.example).
 *   - Or set ORTBTOOLS_ANALYTICS_DISABLED=1 to disable CH telemetry even when
 *     ClickHouse credentials are present (other apps on the host may still use CH).
 *
 * Does NOT affect per-user SQLite analyze_log (Cabinet activity for signed-in users).
 */

function isClickHouseAnalyticsEnabled() {
  // legacy-spyglass-ok: honour the pre-rename opt-out for self-hosts (~v1.6)
  if (
    process.env.ORTBTOOLS_ANALYTICS_DISABLED === '1' ||
    process.env.SPYGLASS_ANALYTICS_DISABLED === '1' // legacy-spyglass-ok
  )
    return false;
  const url = (process.env.CLICKHOUSE_URL || 'http://clickhouse:8123').replace(/\/+$/, '');
  const user = process.env.CLICKHOUSE_USER || '';
  return !!(url && user);
}

module.exports = { isClickHouseAnalyticsEnabled };
