'use strict';

/**
 * lib/event-log.js — durable event log for the admin observability panel.
 *
 * Sits alongside lib/logger.js (pino → stdout). Pino still emits structured
 * JSON for container-level observation; this module persists a curated
 * subset to SQLite so the operator can browse historical events in the
 * kyivtech-portal admin UI without SSH-ing in.
 *
 * Write path is batched: callers push synchronously into an in-memory
 * buffer, a flusher drains it every 500ms (or sooner when the buffer
 * crosses BATCH_HIGH_WATER). Writes never block the request thread —
 * if SQLite is slow we just queue. The buffer is also drained on process
 * exit so we don't lose the final seconds of activity on `compose restart`.
 *
 * Retention: 7 days. Pruning runs once daily (caller wires the cron in
 * server.js boot) plus opportunistically every PRUNE_EVERY_N_WRITES.
 *
 * NOT a substitute for stdout/pino — fatal/uncaught errors still flow
 * through pino + GlitchTip. This is the *user-visible* event log, not
 * the *crash* log.
 */

const { db } = require('../db');
const logger = require('./logger').child('event-log');

const BUFFER_FLUSH_MS = 500;
const BATCH_HIGH_WATER = 100;
const RETENTION_DAYS = 7;
const PRUNE_EVERY_N_WRITES = 5_000;

const VALID_LEVELS = new Set(['info', 'warn', 'error']);

let _buffer = [];
let _flushTimer = null;
let _writesSinceLastPrune = 0;
let _shutdownHookInstalled = false;

const insertStmt = db.prepare(`
  INSERT INTO event_log
    (ts, level, component, msg, method, path, status, latency_ms, user_id, ip, request_id, ctx)
  VALUES
    (@ts, @level, @component, @msg, @method, @path, @status, @latency_ms, @user_id, @ip, @request_id, @ctx)
`);

const insertManyTx = db.transaction((rows) => {
  for (const r of rows) insertStmt.run(r);
});

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
      entry.ctx && typeof entry.ctx === 'object' ? safeStringify(entry.ctx).slice(0, 2000) : null;

    _buffer.push({
      ts: Date.now(),
      level,
      component,
      msg,
      method: entry.method ? String(entry.method).slice(0, 8) : null,
      path: entry.path ? String(entry.path).slice(0, 500) : null,
      status: Number.isFinite(entry.status) ? entry.status : null,
      latency_ms: Number.isFinite(entry.latency_ms) ? entry.latency_ms : null,
      user_id: Number.isFinite(entry.user_id) ? entry.user_id : null,
      ip: entry.ip ? String(entry.ip).slice(0, 64) : null,
      request_id: entry.request_id ? String(entry.request_id).slice(0, 32) : null,
      ctx,
    });

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
  const drained = _buffer;
  _buffer = [];
  try {
    insertManyTx(drained);
    _writesSinceLastPrune += drained.length;
    if (_writesSinceLastPrune >= PRUNE_EVERY_N_WRITES) {
      _writesSinceLastPrune = 0;
      pruneOlderThan(RETENTION_DAYS);
    }
  } catch (err) {
    logger.error({ err, dropped: drained.length }, 'flush failed');
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
function query(filters) {
  // Flush before reading so the operator sees freshest data.
  flushNow();

  const f = filters || {};
  const where = [];
  const params = {};

  if (Number.isFinite(f.since)) {
    where.push('ts >= @since');
    params.since = f.since;
  }
  if (Number.isFinite(f.until)) {
    where.push('ts < @until');
    params.until = f.until;
  }
  if (f.level && VALID_LEVELS.has(f.level)) {
    where.push('level = @level');
    params.level = f.level;
  }
  if (f.component && typeof f.component === 'string') {
    where.push('component = @component');
    params.component = f.component;
  }
  if (Number.isFinite(f.user_id)) {
    where.push('user_id = @user_id');
    params.user_id = f.user_id;
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = clamp(Number(f.limit) || 200, 1, 1000);
  const offset = Math.max(0, Number(f.offset) || 0);

  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM event_log ${whereSql}`).get(params);

  const rows = db
    .prepare(
      `SELECT id, ts, level, component, msg, method, path, status,
              latency_ms, user_id, ip, request_id, ctx
       FROM event_log
       ${whereSql}
       ORDER BY ts DESC, id DESC
       LIMIT ${limit} OFFSET ${offset}`,
    )
    .all(params);

  return {
    total: totalRow.n,
    items: rows.map((r) => ({
      ...r,
      ctx: r.ctx ? safeParse(r.ctx) : null,
    })),
  };
}

/**
 * Distinct components currently present — used to populate the
 * filter dropdown in the portal UI.
 * @returns {string[]}
 */
function listComponents() {
  flushNow();
  return db
    .prepare('SELECT DISTINCT component FROM event_log ORDER BY component')
    .all()
    .map((r) => r.component);
}

/**
 * Delete entries older than N days. Returns how many rows were removed.
 *
 * @param {number} days
 * @returns {number}
 */
function pruneOlderThan(days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const info = db.prepare('DELETE FROM event_log WHERE ts < ?').run(cutoff);
  if (info.changes > 0) {
    logger.info({ removed: info.changes, days }, 'pruned old events');
  }
  return info.changes;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
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

module.exports = {
  record,
  query,
  listComponents,
  pruneOlderThan,
  flushNow,
  RETENTION_DAYS,
};
