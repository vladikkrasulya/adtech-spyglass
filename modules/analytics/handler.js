'use strict';

/**
 * modules/analytics/handler.js — GET /api/v1/analytics/summary
 *
 * Stage 5 — Insights Dashboard backend.
 * Returns a 1-hour analytics summary from analytics.validation_logs:
 *   - stream_activity: 60 one-per-minute buckets (zero-filled)
 *   - validation_totals: sum of error/warning/info counts
 *   - format_mix: top formats by count + pct
 *   - version_mix: top versions by count + pct
 *
 * The gate (lib/analytics-enabled) is checked FIRST. Every writer of
 * analytics.validation_logs already honours it — lib/validation-log.js,
 * lib/event-log.js and lib/product-telemetry.js all no-op when ClickHouse is
 * not configured — but this reader did not, so the documented self-host setup
 * (".env.example: leave CLICKHOUSE_USER empty → analytics modules no-op") made
 * /insights answer 500 analytics_failed on every load, once per auto-refresh
 * tick, after burning the full outbound fetch timeout. A disabled telemetry
 * backend is an EMPTY dataset, not a server fault: we answer 200 with a
 * zero-filled window plus `enabled: false`, which the Insights page already
 * renders as its "Stream is warming up" state. 5xx stays reserved for a
 * ClickHouse that is configured and genuinely broken.
 */

const { sendJson, sendError } = require('../../lib/http');
const { isClickHouseAnalyticsEnabled } = require('../../lib/analytics-enabled');
const log = require('../../lib/logger').child('analytics');

const CH_URL = (process.env.CLICKHOUSE_URL || 'http://clickhouse:8123').replace(/\/+$/, '');
const CH_USER = process.env.CLICKHOUSE_USER || '';
const CH_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';

function chHeaders() {
  const h = { 'Content-Type': 'text/plain' };
  if (CH_USER) h['X-ClickHouse-User'] = CH_USER;
  if (CH_PASSWORD) h['X-ClickHouse-Key'] = CH_PASSWORD;
  return h;
}

async function queryCh(sql) {
  const url = CH_URL + '/?query=' + encodeURIComponent(sql + ' FORMAT JSON');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: chHeaders(),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error('CH query failed ' + resp.status + ': ' + txt.slice(0, 200));
    }
    const json = await resp.json();
    return (json && json.data) || [];
  } finally {
    clearTimeout(timer);
  }
}

/** Zero-fill 60 minutes of stream activity data. */
function zeroFillMinutes(rows) {
  // Build a map of existing data
  const map = Object.create(null);
  for (const r of rows) {
    // CH returns toStartOfMinute as "2026-05-23 15:00:00"
    // Normalise to ISO8601 without seconds
    const key = String(r.minute).replace(' ', 'T').slice(0, 16);
    map[key] = Number(r.count) || 0;
  }

  const result = [];
  const now = new Date();
  // Round down to minute
  now.setSeconds(0, 0);
  for (let i = 59; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 60_000);
    const key =
      d.getUTCFullYear() +
      '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getUTCDate()).padStart(2, '0') +
      'T' +
      String(d.getUTCHours()).padStart(2, '0') +
      ':' +
      String(d.getUTCMinutes()).padStart(2, '0');
    result.push({ minute: key, count: map[key] || 0 });
  }
  return result;
}

/** The shape of an hour with nothing in it — same keys, all empty. */
function emptySummary() {
  return {
    ok: true,
    enabled: false,
    window: '1h',
    stream_activity: zeroFillMinutes([]),
    validation_totals: { errors: 0, warnings: 0, info: 0 },
    format_mix: [],
    version_mix: [],
  };
}

async function handleSummary(req, res) {
  // Telemetry off (self-host / privacy) → an empty window, not an error. No
  // outbound fetch, no error log, no 8s timeout on a host that has no CH.
  if (!isClickHouseAnalyticsEnabled()) {
    res.setHeader('Cache-Control', 'public, max-age=15');
    return sendJson(res, 200, emptySummary());
  }
  try {
    const [activityRows, totalsRows, formatRows, versionRows] = await Promise.all([
      queryCh(
        'SELECT toStartOfMinute(timestamp) AS minute, count() AS count ' +
          'FROM analytics.validation_logs ' +
          'WHERE timestamp >= now() - INTERVAL 1 HOUR ' +
          'GROUP BY minute ORDER BY minute',
      ),
      queryCh(
        'SELECT sum(error_count) AS errors, sum(warning_count) AS warnings, sum(info_count) AS info ' +
          'FROM analytics.validation_logs ' +
          'WHERE timestamp >= now() - INTERVAL 1 HOUR',
      ),
      queryCh(
        'SELECT format, count() AS count FROM analytics.validation_logs ' +
          'WHERE timestamp >= now() - INTERVAL 1 HOUR ' +
          'GROUP BY format ORDER BY count DESC',
      ),
      queryCh(
        'SELECT version, count() AS count FROM analytics.validation_logs ' +
          'WHERE timestamp >= now() - INTERVAL 1 HOUR ' +
          'GROUP BY version ORDER BY count DESC',
      ),
    ]);

    const stream_activity = zeroFillMinutes(activityRows);

    const totals = totalsRows[0] || {};
    const validation_totals = {
      errors: Number(totals.errors) || 0,
      warnings: Number(totals.warnings) || 0,
      info: Number(totals.info) || 0,
    };

    // Compute totals for pct
    const fmtTotal = formatRows.reduce((s, r) => s + (Number(r.count) || 0), 0) || 1;
    const format_mix = formatRows.map((r) => ({
      format: r.format || 'unknown',
      count: Number(r.count) || 0,
      pct: Math.round(((Number(r.count) || 0) / fmtTotal) * 100),
    }));

    const verTotal = versionRows.reduce((s, r) => s + (Number(r.count) || 0), 0) || 1;
    const version_mix = versionRows.map((r) => ({
      version: r.version || 'unknown',
      count: Number(r.count) || 0,
      pct: Math.round(((Number(r.count) || 0) / verTotal) * 100),
    }));

    res.setHeader('Cache-Control', 'public, max-age=15');
    sendJson(res, 200, {
      ok: true,
      enabled: true,
      window: '1h',
      stream_activity,
      validation_totals,
      format_mix,
      version_mix,
    });
  } catch (e) {
    log.error({ err: e }, 'analytics summary failed');
    sendError(res, 500, 'analytics_failed', e.message);
  }
}

// Public, ClickHouse-backed read. A per-IP limiter bounds CH load-amplification
// from an anonymous bot loop. deps optional so it can be constructed bare.
function createAnalyticsModule(deps = {}) {
  const { readLimiter, auth, READ_MAX_PER_WINDOW } = deps;
  async function handler(req, res) {
    if (readLimiter && auth && !readLimiter(auth.clientIp(req))) {
      return sendError(
        res,
        429,
        'rate_limited',
        `Too many requests. Try again shortly (limit: ${READ_MAX_PER_WINDOW}/min/IP).`,
      );
    }
    return handleSummary(req, res);
  }
  return {
    id: 'analytics',
    routes: [{ method: 'GET', path: '/api/v1/analytics/summary', handler }],
  };
}

module.exports = { createAnalyticsModule };
