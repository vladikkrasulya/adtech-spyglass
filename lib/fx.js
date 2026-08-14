'use strict';

/**
 * lib/fx.js — USD exchange-rate table, fetched on a timer and cached.
 *
 * The Inspector shows a bid floor in whatever currency the request priced it
 * in. When that is not USD, the strip also shows the USD equivalent, because
 * an operator reading a `12500 RUB` floor has no instinct for whether that is
 * cheap or absurd. This module is where that number comes from.
 *
 * ── Why a whole table, never a per-payload query ─────────────────────────────
 *
 * docs/PRIVACY.md states, in bold, that an analysed payload is "not written to
 * the database, not appended to log files, not forwarded to any third party".
 * A `convert?from=RUB&to=USD&amount=12500` call would send a bid floor and its
 * currency — both payload-derived — to the rate provider on every analysis,
 * and that sentence would become false. Asking for the entire USD table
 * carries nothing about any user or any payload; the arithmetic happens here.
 * Keep it that way: this module must never take an amount as input.
 *
 * The browser also cannot call the provider directly — server.js sets
 * `connect-src 'self'` — so the server-side proxy is load-bearing, not a
 * tidiness preference.
 *
 * ── Display only ────────────────────────────────────────────────────────────
 *
 * The inspector's premise is that the same payload analyses the same way. A
 * live rate breaks that the moment it moves, so a converted figure may never
 * reach a finding, a verdict, a threshold comparison or a stored record. It is
 * a reading aid rendered beside the real number, and it always travels with
 * the rate and the date it came from.
 *
 * ── Staleness is shown, never hidden ────────────────────────────────────────
 *
 * A failed refresh keeps serving the last good table with its true timestamp
 * and `stale: true`, so the UI can say "rate from the 12th" instead of quietly
 * presenting three-day-old arithmetic as today's. When there is no table at
 * all, callers get null and the UI shows the arriving currency alone. There is
 * no built-in fallback table: an invented rate is worse than no conversion.
 *
 * Exports:
 *   getRates()       — cached table or null; never triggers I/O
 *   ensureRates()    — cached table, fetching once if the cache is cold
 *   refresh()        — force one fetch+cache cycle
 *   startScheduled() — refresh on a timer, returns { stop }
 */

const fs = require('fs');
const path = require('path');
const log = require('./logger').child('fx');

// exchangerate-api's free endpoint: no key, no attribution requirement in the
// response path, updates once a day and reports both the timestamp it was
// built and the one it expects to be rebuilt.
const PROVIDER_URL = 'https://open.er-api.com/v6/latest/USD';
const PROVIDER_NAME = 'exchangerate-api.com';

const DATA_DIR = process.env.ORTBTOOLS_DATA_DIR || '/data';
const CACHE_PATH = path.join(DATA_DIR, 'fx-rates.json');

// Refresh every 6h against a source that moves once a day: four attempts per
// update window, so a single failed fetch never costs a day of freshness.
const REFRESH_MS = 6 * 60 * 60 * 1000;
// Past this the table is served but flagged stale, and the UI says so.
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/** @type {{base: string, rates: Record<string, number>, fetchedAt: number, providerUpdatedAt: string|null, provider: string}|null} */
let _table = null;
/** @type {Promise<object|null>|null} */
let _inflight = null;

/**
 * Accept only a table that is actually usable: USD-based, numeric finite
 * positive rates, and USD itself present at 1. A provider that starts
 * returning `{"result":"error"}` or a partial table must not overwrite a
 * good cached one.
 */
function validateTable(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.result && raw.result !== 'success') return null;
  if (raw.base_code !== 'USD') return null;
  const rates = raw.rates;
  if (!rates || typeof rates !== 'object') return null;
  if (!(Math.abs(Number(rates.USD) - 1) < 1e-9)) return null;

  /** @type {Record<string, number>} */
  const clean = {};
  let n = 0;
  for (const [code, value] of Object.entries(rates)) {
    if (!/^[A-Z]{3}$/.test(code)) continue;
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) continue;
    clean[code] = v;
    n++;
  }
  // A "USD table" with a handful of entries is a malformed response, not a
  // thin day. The real one carries 160+.
  if (n < 100) return null;

  return {
    base: 'USD',
    rates: clean,
    providerUpdatedAt:
      typeof raw.time_last_update_utc === 'string' ? raw.time_last_update_utc : null,
    provider: PROVIDER_NAME,
  };
}

function readCacheFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (!parsed || typeof parsed.fetchedAt !== 'number') return null;
    const table = validateTable({
      result: 'success',
      base_code: parsed.base,
      rates: parsed.rates,
      time_last_update_utc: parsed.providerUpdatedAt,
    });
    if (!table) return null;
    return { ...table, fetchedAt: parsed.fetchedAt, provider: parsed.provider || PROVIDER_NAME };
  } catch {
    return null;
  }
}

function writeCacheFile(table) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(table), 'utf8');
  } catch (err) {
    // A read-only or missing data dir costs freshness across restarts, not
    // correctness within a run.
    log.warn({ err: err.message, path: CACHE_PATH }, 'could not persist fx cache');
  }
}

/**
 * Fetch the table once. Returns the validated table or null; never throws.
 *
 * `fetchImpl` is typed to the two members this module actually reads, not to
 * the full `fetch` signature — a test stub should not have to fabricate
 * `headers`, `redirected` and eleven other Response fields nothing here
 * touches.
 *
 * @param {{
 *   fetchImpl?: (url: string, opts?: object) => Promise<{ok: boolean, status: number, json: () => Promise<any>}>,
 *   now?: () => number
 * }} [opts] Injection points for tests.
 */
async function refresh(opts = {}) {
  // FX_DISABLED gates the outbound call itself, not merely the scheduler:
  // ensureRates() would otherwise fetch on the first request and the flag
  // would describe something it does not do. An explicit fetchImpl (tests)
  // is not an outbound call and is honoured regardless.
  if (process.env.FX_DISABLED === '1' && !opts.fetchImpl) return _table;

  const doFetch = opts.fetchImpl || fetch;
  const now = opts.now || Date.now;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await doFetch(PROVIDER_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ortbtools-fx/1.0' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const table = validateTable(await resp.json());
    if (!table) throw new Error('provider returned an unusable rate table');

    _table = { ...table, fetchedAt: now() };
    writeCacheFile(_table);
    log.info(
      { currencies: Object.keys(_table.rates).length, providerUpdatedAt: _table.providerUpdatedAt },
      'fx rate table refreshed',
    );
    return _table;
  } catch (err) {
    // Keep whatever we already had; the caller reports it as stale rather
    // than losing the conversion entirely.
    log.warn({ err: err.message, hadTable: !!_table }, 'fx refresh failed');
    return _table;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The cached table, annotated with its age. Never does I/O.
 *
 * @param {{ now?: () => number }} [opts]
 * @returns {{base: string, rates: Record<string, number>, fetchedAt: number,
 *            providerUpdatedAt: string|null, provider: string, stale: boolean}|null}
 */
function getRates(opts = {}) {
  const now = opts.now || Date.now;
  if (!_table) {
    const fromDisk = readCacheFile();
    if (!fromDisk) return null;
    _table = fromDisk;
  }
  return { ..._table, stale: now() - _table.fetchedAt > STALE_AFTER_MS };
}

/**
 * The cached table, fetching once if nothing is cached yet. Concurrent callers
 * share the single in-flight fetch rather than stampeding the provider.
 */
async function ensureRates(opts = {}) {
  const cached = getRates(opts);
  if (cached) return cached;
  if (!_inflight) {
    _inflight = refresh(opts).finally(() => {
      _inflight = null;
    });
  }
  await _inflight;
  return getRates(opts);
}

/**
 * Refresh on a timer.
 *
 * @param {{ intervalMs?: number, initialDelayMs?: number }} [opts]
 * @returns {{ stop: () => void }}
 */
function startScheduled({ intervalMs = REFRESH_MS, initialDelayMs = 3_000 } = {}) {
  let running = false;
  let initialTimer = null;
  let intervalTimer = null;

  async function run() {
    if (running) return;
    running = true;
    try {
      await refresh();
    } catch (err) {
      log.error({ err: err.message }, 'unexpected fx refresh error');
    } finally {
      running = false;
    }
  }

  initialTimer = setTimeout(() => {
    run();
    intervalTimer = setInterval(run, intervalMs);
    // Neither timer should hold the process open — a rate refresh is never a
    // reason for `node server.js` (or a test run) to refuse to exit.
    if (typeof intervalTimer.unref === 'function') intervalTimer.unref();
  }, initialDelayMs);
  if (typeof initialTimer.unref === 'function') initialTimer.unref();

  return {
    stop() {
      if (initialTimer) clearTimeout(initialTimer);
      if (intervalTimer) clearInterval(intervalTimer);
    },
  };
}

/** Test seam: drop the in-process table so a test starts from a known state. */
function _reset() {
  _table = null;
  _inflight = null;
}

module.exports = {
  getRates,
  ensureRates,
  refresh,
  startScheduled,
  PROVIDER_URL,
  PROVIDER_NAME,
  STALE_AFTER_MS,
  _validateTable: validateTable,
  _reset,
};
