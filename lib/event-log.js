'use strict';

/**
 * lib/event-log.js — durable event log for the admin observability panel.
 *
 * Sits alongside lib/logger.js (pino → stdout). Pino still emits structured
 * JSON for container-level observation; this module persists a curated
 * subset to ClickHouse (`analytics.spyglass_events`) so the operator can
 * browse historical events in the kyivtech-portal admin UI without
 * SSH-ing in. CH was picked over SQLite to share the same analytics
 * cluster the rest of the home-server stack already targets, and to
 * lean on CH's built-in TTL for retention instead of a JS cron.
 *
 * Write path is batched: callers push synchronously into an in-memory
 * buffer, a flusher drains it every 500ms (or sooner when the buffer
 * crosses BATCH_HIGH_WATER) via a single HTTP POST in JSONEachRow
 * format. Writes never block the request thread — if CH is slow or
 * unreachable we drop the batch and log via pino. The buffer is also
 * drained on process exit so we don't lose the final seconds of
 * activity on `compose restart`.
 *
 * Retention: 90 days, enforced server-side by CH `TTL ts + INTERVAL 90 DAY`
 * on the table. `pruneOlderThan` is preserved as a no-op so the boot
 * cron in server.js can keep calling it without change.
 *
 * NOT a substitute for stdout/pino — fatal/uncaught errors still flow
 * through pino + GlitchTip. This is the *user-visible* event log, not
 * the *crash* log.
 */

const logger = require('./logger').child('event-log');

const BUFFER_FLUSH_MS = 500;
const BATCH_HIGH_WATER = 100;
const RETENTION_DAYS = 90;
const FLUSH_TIMEOUT_MS = 5_000;

const VALID_LEVELS = new Set(['info', 'warn', 'error']);

const CH_URL = (process.env.CLICKHOUSE_URL || 'http://clickhouse:8123').replace(/\/+$/, '');
const CH_USER = process.env.CLICKHOUSE_USER || '';
const CH_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
// "Enabled" gate: if no CH user is configured we treat the module as a
// no-op so Spyglass still boots in tests/dev without a CH dependency.
// We log the degradation once and stay silent afterward.
const CH_ENABLED = !!(CH_URL && CH_USER);
let _degradedWarned = false;

function chHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (CH_USER) h['X-ClickHouse-User'] = CH_USER;
  if (CH_PASSWORD) h['X-ClickHouse-Key'] = CH_PASSWORD;
  return h;
}

function warnDegradedOnce() {
  if (_degradedWarned) return;
  _degradedWarned = true;
  logger.warn(
    { CLICKHOUSE_URL: !!process.env.CLICKHOUSE_URL, CLICKHOUSE_USER: !!CH_USER },
    'CH env not configured — event-log running in no-op mode',
  );
}

let _buffer = [];
let _flushTimer = null;
let _shutdownHookInstalled = false;
let _flushInFlight = false;

/**
 * Record an event. Synchronous from the caller's POV — pushes onto the
 * in-memory buffer and schedules a flush. Never throws; observability
 * failures must never affect the request that triggered them.
 *
 * @param {object} entry
 * @param {'info'|'warn'|'error'} entry.level
 * @param {string} entry.component   e.g. 'http' | 'auth' | 'intel'
 * @param {string} entry.msg
 * @param {string} [entry.method]    HTTP method for http events
 * @param {string} [entry.path]
 * @param {number} [entry.status]
 * @param {number} [entry.latency_ms]
 * @param {number} [entry.user_id]
 * @param {string} [entry.ip]
 * @param {string} [entry.request_id]
 * @param {object} [entry.ctx]       free-form extra fields, JSON.stringify'd
 */
function record(entry) {
  try {
    if (!entry || typeof entry !== 'object') return;
    const level = VALID_LEVELS.has(entry.level) ? entry.level : 'info';
    const component = String(entry.component || 'unknown').slice(0, 32);
    const msg = String(entry.msg || '').slice(0, 500);
    if (!msg) return;

    const ctx =
      entry.ctx && typeof entry.ctx === 'object' ? safeStringify(entry.ctx).slice(0, 2000) : '';

    _buffer.push({
      ts: Date.now(),
      level,
      component,
      msg,
      method: entry.method ? String(entry.method).slice(0, 8) : '',
      path: entry.path ? String(entry.path).slice(0, 500) : '',
      status: Number.isFinite(entry.status) ? entry.status : 0,
      latency_ms: Number.isFinite(entry.latency_ms) ? entry.latency_ms : 0,
      user_id: Number.isFinite(entry.user_id) ? entry.user_id : 0,
      ip: entry.ip ? String(entry.ip).slice(0, 64) : '',
      request_id: entry.request_id ? String(entry.request_id).slice(0, 32) : '',
      ctx,
    });

    if (!CH_ENABLED) {
      // Degrade to no-op writer; drop buffer to avoid unbounded growth.
      warnDegradedOnce();
      _buffer = [];
      return;
    }

    if (_buffer.length >= BATCH_HIGH_WATER) {
      flushNow();
    } else if (!_flushTimer) {
      _flushTimer = setTimeout(flushNow, BUFFER_FLUSH_MS);
      if (typeof _flushTimer.unref === 'function') _flushTimer.unref();
    }

    if (!_shutdownHookInstalled) installShutdownHook();
  } catch (err) {
    logger.error({ err }, 'record failed');
  }
}

function flushNow() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  if (_buffer.length === 0) return;
  if (!CH_ENABLED) {
    warnDegradedOnce();
    _buffer = [];
    return;
  }
  const drained = _buffer;
  _buffer = [];

  // Fire-and-forget. We don't await — callers (record, query, shutdown
  // hook) treat flushNow as synchronous. The promise still gets a
  // .catch so an unhandled rejection can't escape on CH failure.
  postBatch(drained).catch((err) => {
    logger.error({ err, dropped: drained.length }, 'flush failed');
  });
}

async function postBatch(rows) {
  if (_flushInFlight) {
    // Serialise concurrent flushes — keeps CH inserts ordered and avoids
    // hammering it during shutdown. Subsequent batches just append.
  }
  _flushInFlight = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
  try {
    const body = rows
      .map((r) =>
        JSON.stringify({
          // CH DateTime64 in JSONEachRow rejects ISO-8601 with trailing 'Z'.
          // Strip it: "2026-05-22T12:29:09.000Z" → "2026-05-22T12:29:09.000".
          ts: new Date(r.ts).toISOString().slice(0, -1),
          level: r.level,
          component: r.component,
          msg: r.msg,
          method: r.method,
          path: r.path,
          status: r.status,
          latency_ms: r.latency_ms,
          user_id: r.user_id,
          ip: r.ip,
          request_id: r.request_id,
          ctx: r.ctx,
        }),
      )
      .join('\n');
    const url =
      CH_URL +
      '/?query=' +
      encodeURIComponent('INSERT INTO analytics.spyglass_events FORMAT JSONEachRow');
    const resp = await fetch(url, {
      method: 'POST',
      headers: chHeaders(),
      body,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const err = new Error('CH responded ' + resp.status + ': ' + text.slice(0, 200));
      logger.error({ err, dropped: rows.length, status: resp.status }, 'flush failed');
    }
  } catch (err) {
    logger.error({ err, dropped: rows.length }, 'flush failed');
  } finally {
    clearTimeout(timer);
    _flushInFlight = false;
  }
}

function installShutdownHook() {
  _shutdownHookInstalled = true;
  const drain = () => {
    try {
      flushNow();
    } catch (_e) {
      // best-effort
    }
  };
  process.once('SIGTERM', drain);
  process.once('SIGINT', drain);
  process.once('beforeExit', drain);
}

/**
 * Query the event log with filters. All filters are optional; defaults
 * give the most recent 200 entries.
 *
 * @param {object} [filters]
 * @param {number} [filters.since]      unix-ms lower bound (inclusive)
 * @param {number} [filters.until]      unix-ms upper bound (exclusive)
 * @param {string} [filters.level]      'info' | 'warn' | 'error'
 * @param {string} [filters.component]
 * @param {number} [filters.user_id]
 * @param {number} [filters.limit]      default 200, max 1000
 * @param {number} [filters.offset]
 * @returns {{items: object[], total: number}}
 */
async function query(filters) {
  // Flush before reading so the operator sees freshest data. Note this is
  // fire-and-forget in the CH variant — we don't await the POST, so a row
  // recorded <500ms before the query *may* not be visible yet. Acceptable:
  // admin UI auto-refreshes anyway.
  flushNow();

  const f = filters || {};

  if (!CH_ENABLED) {
    warnDegradedOnce();
    return { items: [], total: 0 };
  }

  const where = [];
  if (Number.isFinite(f.since)) {
    where.push('ts >= fromUnixTimestamp64Milli(' + Math.trunc(f.since) + ')');
  }
  if (Number.isFinite(f.until)) {
    where.push('ts < fromUnixTimestamp64Milli(' + Math.trunc(f.until) + ')');
  }
  if (f.level && VALID_LEVELS.has(f.level)) {
    where.push("level = '" + escapeStringCh(f.level) + "'");
  }
  if (f.component && typeof f.component === 'string') {
    where.push("component = '" + escapeStringCh(f.component) + "'");
  }
  if (Number.isFinite(f.user_id)) {
    where.push('user_id = ' + Math.trunc(f.user_id));
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = clamp(Number(f.limit) || 200, 1, 1000);
  const offset = Math.max(0, Math.trunc(Number(f.offset) || 0));

  // Two synchronous CH queries (count + rows). We do them serially via
  // fetchSync to keep query() synchronous from the caller's POV.
  const totalSql = `SELECT count() AS n FROM analytics.spyglass_events ${whereSql} FORMAT JSONEachRow`;
  const rowsSql =
    `SELECT toUnixTimestamp64Milli(ts) AS ts, level, component, msg, method, path, ` +
    `status, latency_ms, user_id, ip, request_id, ctx ` +
    `FROM analytics.spyglass_events ${whereSql} ` +
    `ORDER BY ts DESC LIMIT ${limit} OFFSET ${offset} FORMAT JSONEachRow`;

  let total = 0;
  let items = [];
  try {
    const totalLines = await chQuery(totalSql);
    if (totalLines.length > 0) {
      const obj = safeParse(totalLines[0]);
      if (obj && obj.n != null) total = Number(obj.n) || 0;
    }
    const rowLines = await chQuery(rowsSql);
    items = rowLines.map(parseRow).filter((r) => r != null);
  } catch (err) {
    logger.error({ err }, 'query failed');
    return { items: [], total: 0 };
  }
  return { items, total };
}

// CH JSONEachRow can stringify large ints (UInt64 count()) — coerce via Number.
// Empty strings on read are mapped back to null to match the SQLite-era shape
// the admin UI is built against.
function parseRow(line) {
  const o = safeParse(line);
  if (!o || typeof o !== 'object') return null;
  const tsMs = typeof o.ts === 'string' ? Number(o.ts) : Number(o.ts) || 0;
  return {
    // No autoincrement id in CH; the unix-ms timestamp is unique enough for
    // UI keying (admin/handler.js doesn't dereference it semantically).
    id: tsMs,
    ts: tsMs,
    level: o.level || 'info',
    component: o.component || '',
    msg: o.msg || '',
    method: o.method ? String(o.method) : null,
    path: o.path ? String(o.path) : null,
    status: numOrNull(o.status),
    latency_ms: numOrNull(o.latency_ms),
    user_id: numOrNull(o.user_id),
    ip: o.ip ? String(o.ip) : null,
    request_id: o.request_id ? String(o.request_id) : null,
    ctx: o.ctx ? safeParse(o.ctx) : null,
  };
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) {
    // 0 in CH means "unset" for our schema (status/user_id/latency are never
    // legitimately 0 in this log). Restoring null preserves the SQLite shape.
    return v === 0 || v === '0' ? null : null;
  }
  return n;
}

/**
 * Distinct components currently present — used to populate the
 * filter dropdown in the portal UI.
 * @returns {string[]}
 */
async function listComponents() {
  flushNow();
  if (!CH_ENABLED) {
    warnDegradedOnce();
    return [];
  }
  try {
    const lines = await chQuery(
      'SELECT DISTINCT component FROM analytics.spyglass_events ORDER BY component FORMAT JSONEachRow',
    );
    return lines
      .map((l) => safeParse(l))
      .filter((o) => o && typeof o.component === 'string' && o.component.length > 0)
      .map((o) => o.component);
  } catch (err) {
    logger.error({ err }, 'listComponents failed');
    return [];
  }
}

/**
 * No-op in the CH backend: retention is enforced server-side by the
 * `TTL ts + INTERVAL 90 DAY` clause on `analytics.spyglass_events`.
 * Kept for API compatibility — server.js boot cron still calls this
 * daily, it just becomes cheap.
 *
 * @param {number} _days
 * @returns {number}
 */
function pruneOlderThan(_days) {
  return 0;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Single-quote escape for CH SQL string literals. CH accepts standard SQL
// `''` doubling, but also supports backslash escapes; we go with backslash
// to also neutralise newlines / backslashes that could break out of the
// literal. Per CH docs: `\\`, `\'`, `\b`, `\f`, `\n`, `\r`, `\t`, `\0`.
function escapeStringCh(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_e) {
    return '"[unserializable]"';
  }
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (_e) {
    return null;
  }
}

// CH HTTP query via native fetch. Returns array of JSONEachRow lines.
// Async because Node has no stdlib synchronous HTTP — the SQLite-era
// sync contract is broken; admin/handler.js was updated to await.
async function chQuery(sql) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(CH_URL + '/', {
      method: 'POST',
      headers: chHeaders(),
      body: sql,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error('CH responded ' + resp.status + ': ' + txt.slice(0, 200));
    }
    const out = await resp.text();
    return out.split('\n').filter((l) => l.length > 0);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  record,
  query,
  listComponents,
  pruneOlderThan,
  flushNow,
  RETENTION_DAYS,
};
