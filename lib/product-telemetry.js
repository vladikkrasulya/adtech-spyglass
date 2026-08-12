'use strict';

/**
 * lib/product-telemetry.js — privacy-safe product analytics.
 *
 * Answers product questions the operational logs cannot: how many REAL people
 * show up, how many of them ever complete an analysis (activation), how many
 * come back (repeat usage), and what the D1/D7/D30 retention curve looks like.
 *
 * Sits beside — not inside — the two existing ClickHouse writers:
 *
 *   lib/validation-log.js  → analytics.validation_logs      what was analysed
 *   lib/event-log.js       → analytics.ortbtools_events     operational, keeps IP
 *   THIS MODULE            → analytics.ortbtools_product_events
 *
 * ── The privacy boundary ───────────────────────────────────────────────────
 * `buildRow()` RECONSTRUCTS every row from a fixed contract. It reads a closed
 * set of keys, validates each against an enum / regex / numeric range, and
 * returns a fresh object literal. Nothing is spread, copied wholesale, or
 * passed through. A caller cannot smuggle an extra field into ClickHouse even
 * by accident, which is the same idiom `authContract()` in lib/event-log.js
 * uses for auth events. `buildRow` is exported so the contract is testable
 * without a live ClickHouse.
 *
 * Consequences, by construction:
 *   - No BidRequest / BidResponse content can ever reach this table. There is
 *     no field that accepts free-form text; the only strings are enums, a
 *     32-hex id, a hostname, and three sanitised UTM slugs.
 *   - No IP address is stored. The IP is used transiently by
 *     lib/traffic-class.js to decide bot/internal/owner, then dropped.
 *   - No User-Agent string is stored, only a five-value `ua_class`.
 *   - No URL path or query string is stored — a referrer contributes its HOST
 *     only, never its path.
 *
 * ── Identity ───────────────────────────────────────────────────────────────
 * `visitor_id` is a random 128-bit value the BROWSER mints into localStorage
 * (public/telemetry.js). It is not a cookie: it never rides along on ordinary
 * requests, only on explicit beacon calls. It carries no PII and cannot
 * correlate across sites. Under an explicit opt-out no beacon is sent at all;
 * under GPC/DNT the beacon is sent with an empty `visitor_id` and `dnt=1`, so
 * the visit is still counted but never joined into a retention cohort.
 *
 * ── Write path ─────────────────────────────────────────────────────────────
 * Buffered like event-log.js: callers push synchronously, a timer drains the
 * batch into one JSONEachRow INSERT, failures are logged and dropped, and the
 * buffer is flushed on SIGTERM/SIGINT/beforeExit. Telemetry never blocks or
 * breaks a request.
 *
 * Env gates (all three must pass, else the module is an inert no-op):
 *   CLICKHOUSE_USER set  &&  ORTBTOOLS_ANALYTICS_DISABLED !== '1'
 *   &&  ORTBTOOLS_PRODUCT_TELEMETRY_DISABLED !== '1'
 *
 * Table DDL and the analysis SQL live in docs/OPERATIONS.md §4.10.
 */

const logger = require('./logger').child('product-telemetry');
const { isClickHouseAnalyticsEnabled } = require('./analytics-enabled');
const { chInsert } = require('./clickhouse');
const { classifyTraffic } = require('./traffic-class');

const TABLE = 'analytics.ortbtools_product_events';
const BUFFER_FLUSH_MS = 1_000;
const BATCH_HIGH_WATER = 50;
const FLUSH_TIMEOUT_MS = 5_000;
/** Long enough that a D30 cohort still has its acquisition row in range. */
const RETENTION_DAYS = 180;

/**
 * The closed event vocabulary. Adding a name here is the ONLY way to add an
 * event — `buildRow` drops anything else.
 *
 * Wired today (all emitted by the browser beacon — see "One writer" below):
 *   landing          one per document load of a public page
 *   session_start    one per browser tab-session (first document load)
 *   analyze_success  /api/analyze returned success in this tab
 *   macro_use        first interaction with the Macro Evaluator in a session
 *   share_use        a share permalink was produced
 *   register         a new account was created
 *   verify_email     an email verification link was confirmed
 *
 * Reserved for the features already on the roadmap, so those land without
 * touching this contract:
 *   gist_create / gist_open  — Shareable Encrypted Gists
 *   diff_use                 — Visual Semantic Diff
 *
 * ── One writer ─────────────────────────────────────────────────────────────
 * Only public/telemetry.js writes to this table. That is a deliberate choice,
 * not an omission:
 *
 *   - Every row then carries the same anonymous `visitor_id`, so activation and
 *     retention are computable. A server-side emitter has no visitor id to
 *     attach (the browser never sends it on ordinary API calls, by design), so
 *     its rows could only ever be counted, never cohorted.
 *   - Traffic that cannot run JavaScript — Docker health checks, Uptime Kuma,
 *     curl, most crawlers — is absent from this table BY CONSTRUCTION rather
 *     than by filtering. `traffic_class` then only has to catch the
 *     JS-capable non-humans: headless drivers, AI agents, the owner's browser.
 *   - Authoritative server-side volume already exists elsewhere and is not
 *     duplicated here: analytics.validation_logs counts every analyze
 *     including API/CLI callers, analytics.ortbtools_events counts requests.
 *
 * The trade-off is that a content blocker suppresses these counters. Because
 * the whole funnel travels the one path, the RATIOS (activation %, retention %)
 * stay sound even when the absolute totals under-count.
 */
const PRODUCT_EVENTS = Object.freeze([
  'landing',
  'session_start',
  'analyze_success',
  'macro_use',
  'share_use',
  'gist_create',
  'gist_open',
  'diff_use',
  'register',
  'verify_email',
]);
const EVENT_SET = new Set(PRODUCT_EVENTS);

/** Where the event came from. `web` = browser, `api` = direct API, `cli` = npm CLI. */
const SURFACES = Object.freeze(['web', 'api', 'cli']);
const SURFACE_SET = new Set(SURFACES);

/** Locales the app actually serves. Anything else becomes ''. */
const LOCALES = Object.freeze(['en', 'uk', 'ru']);
const LOCALE_SET = new Set(LOCALES);

const ID_RE = /^[0-9a-f]{32}$/;
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,61}[a-z0-9])?$/;
const UTM_RE = /^[a-z0-9][a-z0-9._-]{0,47}$/;

let APP_VERSION = 'unknown';
try {
  APP_VERSION = String(require('../package.json').version || 'unknown').slice(0, 16);
} catch (_e) {
  /* version is cosmetic — never fail boot over it */
}

/** All three env gates. Read per call so an ops flip needs no code change. */
function isProductTelemetryEnabled() {
  if (process.env.ORTBTOOLS_PRODUCT_TELEMETRY_DISABLED === '1') return false;
  return isClickHouseAnalyticsEnabled();
}

// ── Field sanitisers ────────────────────────────────────────────────────────

/**
 * A 32-hex opaque id, or '' when absent/malformed. Never derived from anything
 * user-identifying — the browser mints it from crypto.getRandomValues().
 * @param {unknown} value
 */
function sanitizeId(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim().toLowerCase();
  return ID_RE.test(v) ? v : '';
}

/**
 * Reduce a referrer to its bare host: no scheme, no path, no query, no port,
 * no userinfo. `www.` is stripped so google.com and www.google.com aggregate.
 * Anything that does not parse as a plain hostname becomes ''.
 * @param {unknown} value a full URL or a bare host
 */
function sanitizeReferrerHost(value) {
  if (typeof value !== 'string') return '';
  let host = value.trim().toLowerCase();
  if (!host) return '';
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname;
    } catch (_e) {
      return '';
    }
  }
  // A bare host must not carry a path, query or credentials.
  if (/[/?#@\s]/.test(host)) return '';
  // The only colon a bare host may carry is a port separator. Anything else is
  // a scheme we did not recognise (`javascript:…`, `mailto:…`) — reject it
  // rather than keeping the scheme name as if it were a hostname.
  const colon = host.indexOf(':');
  if (colon !== -1) {
    if (!/^\d{1,5}$/.test(host.slice(colon + 1))) return '';
    host = host.slice(0, colon);
  }
  if (host.startsWith('www.')) host = host.slice(4);
  if (host.length > 64) return '';
  return HOST_RE.test(host) ? host : '';
}

/**
 * UTM values are campaign slugs, not free text. Lowercased and restricted to
 * `[a-z0-9._-]`, max 48 chars — long enough for real campaign names, far too
 * short and too narrow to carry a payload.
 * @param {unknown} value
 */
function sanitizeUtm(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim().toLowerCase();
  if (!v || v.length > 48) return '';
  return UTM_RE.test(v) ? v : '';
}

/**
 * @param {unknown} value
 * @param {Set<string>} allowed
 * @param {string} fallback
 */
function sanitizeEnum(value, allowed, fallback) {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  return allowed.has(v) ? v : fallback;
}

/** Non-negative 32-bit int, 0 meaning "anonymous"/"unset". */
function sanitizeUint(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 0xffffffff) return 0;
  return n;
}

// ── The boundary ────────────────────────────────────────────────────────────

/**
 * Build the ClickHouse row for one product event, or return null to drop it.
 *
 * PURE — no clock beyond `ts`, no I/O. Every returned key is written here
 * explicitly; the input object is never spread. Exported for the contract
 * tests in tests/product-telemetry.test.js.
 *
 * The traffic classification is ALWAYS recomputed server-side from ip/headers.
 * `clientHint` can only demote a request out of `external` (see
 * lib/traffic-class.js), so a caller cannot promote itself into the real-user
 * numbers.
 *
 * @param {object} input
 * @param {string} input.event           must be in PRODUCT_EVENTS
 * @param {string} [input.ip]            transient — classified, never stored
 * @param {object} [input.headers]       transient — classified, never stored
 * @param {string} [input.userAgent]     transient — reduced to ua_class
 * @param {unknown} [input.clientHint]   self-reported traffic class (demote-only)
 * @param {unknown} [input.visitorId]
 * @param {unknown} [input.sessionId]
 * @param {unknown} [input.userId]
 * @param {unknown} [input.locale]
 * @param {unknown} [input.surface]
 * @param {unknown} [input.referrer]     full URL or host; only the host survives
 * @param {unknown} [input.utmSource]
 * @param {unknown} [input.utmMedium]
 * @param {unknown} [input.utmCampaign]
 * @param {unknown} [input.dnt]          truthy → 1
 * @param {number} [input.now]           unix ms; defaults to Date.now()
 * @returns {object | null}
 */
function buildRow(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  // Read the event exactly once into a local, then validate that local — a
  // getter cannot pass the check and later yield something else.
  const event = input.event;
  if (typeof event !== 'string' || !EVENT_SET.has(event)) return null;

  const userId = sanitizeUint(input.userId);
  const { traffic_class, is_external, ua_class } = classifyTraffic({
    ip: input.ip,
    headers: input.headers,
    userAgent: input.userAgent,
    userId,
    clientHint: input.clientHint,
  });

  const dnt = input.dnt ? 1 : 0;
  // Under GPC/DNT the visit is still counted, but it is never joined into a
  // cohort — dropping the ids here is what makes that true at the storage layer
  // rather than only in the client.
  const visitor_id = dnt ? '' : sanitizeId(input.visitorId);
  const session_id = dnt ? '' : sanitizeId(input.sessionId);

  const ts = Number.isFinite(input.now) ? Number(input.now) : Date.now();

  return {
    ts,
    event,
    traffic_class,
    is_external: is_external ? 1 : 0,
    visitor_id,
    session_id,
    user_id: userId,
    locale: sanitizeEnum(input.locale, LOCALE_SET, ''),
    surface: sanitizeEnum(input.surface, SURFACE_SET, 'web'),
    ua_class,
    referrer_host: sanitizeReferrerHost(input.referrer),
    utm_source: sanitizeUtm(input.utmSource),
    utm_medium: sanitizeUtm(input.utmMedium),
    utm_campaign: sanitizeUtm(input.utmCampaign),
    dnt,
    app_version: APP_VERSION,
  };
}

/** Exactly the keys buildRow emits — asserted by the contract test. */
const ROW_KEYS = Object.freeze([
  'ts',
  'event',
  'traffic_class',
  'is_external',
  'visitor_id',
  'session_id',
  'user_id',
  'locale',
  'surface',
  'ua_class',
  'referrer_host',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'dnt',
  'app_version',
]);

// ── Buffered writer ─────────────────────────────────────────────────────────

/** @type {object[]} */
let _buffer = [];
/** @type {NodeJS.Timeout | null} */
let _flushTimer = null;
let _shutdownHookInstalled = false;
let _degradedWarned = false;

function warnDegradedOnce() {
  if (_degradedWarned) return;
  _degradedWarned = true;
  logger.warn('product telemetry disabled (CH env / kill-switch) — running as no-op');
}

/**
 * Record one product event. Synchronous from the caller's POV, never throws.
 * Returns true when the event was accepted into the buffer.
 *
 * @param {object} input see buildRow
 * @returns {boolean}
 */
function recordProductEvent(input) {
  try {
    if (!isProductTelemetryEnabled()) {
      warnDegradedOnce();
      return false;
    }
    const row = buildRow(input);
    if (!row) return false;

    _buffer.push(row);
    if (_buffer.length >= BATCH_HIGH_WATER) {
      flushNow();
    } else if (!_flushTimer) {
      _flushTimer = setTimeout(flushNow, BUFFER_FLUSH_MS);
      if (typeof _flushTimer.unref === 'function') _flushTimer.unref();
    }
    if (!_shutdownHookInstalled) installShutdownHook();
    return true;
  } catch (err) {
    logger.error({ err }, 'recordProductEvent failed');
    return false;
  }
}

/** Drain the buffer into one INSERT. Fire-and-forget; failures drop the batch. */
function flushNow() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  if (_buffer.length === 0) return;
  if (!isProductTelemetryEnabled()) {
    _buffer = [];
    return;
  }
  const drained = _buffer;
  _buffer = [];
  const rows = drained.map((r) => ({
    ...r,
    // CH DateTime64 in JSONEachRow rejects ISO-8601 with a trailing 'Z' —
    // same quirk handled in event-log.js and validation-log.js.
    ts: new Date(r.ts).toISOString().slice(0, -1),
  }));
  chInsert(TABLE, rows, { timeoutMs: FLUSH_TIMEOUT_MS }).catch((err) => {
    reportFlushFailure(err, rows.length);
  });
}

// A persistent failure — most likely the table was never created (the app
// issues no DDL; see docs/OPERATIONS.md §4.10) — would otherwise emit one error
// line per second for as long as there is traffic. Log the first failure
// immediately, then at most one line per minute carrying the suppressed count,
// so the signal survives without drowning the operator's logs.
const FLUSH_ERROR_LOG_INTERVAL_MS = 60_000;
let _lastFlushErrorLoggedAt = 0;
let _suppressedFlushErrors = 0;
let _suppressedFlushRows = 0;

function reportFlushFailure(err, droppedRows) {
  _suppressedFlushErrors += 1;
  _suppressedFlushRows += droppedRows;
  const now = Date.now();
  if (_lastFlushErrorLoggedAt && now - _lastFlushErrorLoggedAt < FLUSH_ERROR_LOG_INTERVAL_MS) {
    return;
  }
  _lastFlushErrorLoggedAt = now;
  logger.error(
    { err, failures: _suppressedFlushErrors, dropped: _suppressedFlushRows },
    'product telemetry flush failed',
  );
  _suppressedFlushErrors = 0;
  _suppressedFlushRows = 0;
}

function installShutdownHook() {
  _shutdownHookInstalled = true;
  const drain = () => {
    try {
      flushNow();
    } catch (_e) {
      /* best effort */
    }
  };
  process.once('SIGTERM', drain);
  process.once('SIGINT', drain);
  process.once('beforeExit', drain);
}

/** Buffered row count — used by tests to assert accept/drop without ClickHouse. */
function pendingCount() {
  return _buffer.length;
}

/** Drop the buffer without writing. Test helper. */
function resetForTest() {
  _buffer = [];
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
}

module.exports = {
  recordProductEvent,
  buildRow,
  flushNow,
  isProductTelemetryEnabled,
  sanitizeId,
  sanitizeReferrerHost,
  sanitizeUtm,
  pendingCount,
  resetForTest,
  PRODUCT_EVENTS,
  SURFACES,
  LOCALES,
  ROW_KEYS,
  TABLE,
  RETENTION_DAYS,
};
