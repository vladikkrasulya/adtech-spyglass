'use strict';

/**
 * lib/clickhouse.js — single shared ClickHouse HTTP client.
 *
 * Consolidates the raw-fetch / JSONEachRow pattern that was copy-pasted across
 * lib/validation-log.js, lib/event-log.js, lib/news-crawler.js, intel-llm.js
 * and modules/admin/blog.js. Dependency-free (Node 18+ global fetch).
 *
 * Reads CLICKHOUSE_URL / CLICKHOUSE_USER / CLICKHOUSE_PASSWORD from env.
 * `isEnabled()` is false when URL or USER is missing — callers should no-op.
 *
 * Exports:
 *   chQuery(sql, opts)         — SELECT → array of row objects (JSONEachRow)
 *   chInsert(table, rows, opts)— INSERT rows[] via JSONEachRow (safe escaping)
 *   chExec(sql, opts)          — DDL / mutations (ALTER … UPDATE) → no rows
 *   chEsc(value)               — escape a value for a single-quoted CH literal
 *   chHeaders(contentType)     — auth headers
 *   isEnabled()                — CH configured?
 *   CH_URL
 */

const CH_URL = (process.env.CLICKHOUSE_URL || 'http://clickhouse:8123').replace(/\/+$/, '');
const CH_USER = process.env.CLICKHOUSE_USER || '';
const CH_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const DEFAULT_TIMEOUT_MS = Number(process.env.CLICKHOUSE_TIMEOUT_MS) || 5000;

function isEnabled() {
  return !!(CH_URL && CH_USER);
}

function chHeaders(contentType) {
  const h = { 'Content-Type': contentType || 'text/plain' };
  if (CH_USER) h['X-ClickHouse-User'] = CH_USER;
  if (CH_PASSWORD) h['X-ClickHouse-Key'] = CH_PASSWORD;
  return h;
}

/**
 * Escape a value for embedding inside a single-quoted ClickHouse string
 * literal. Backslash FIRST (it is the escape char), then double the quote.
 * Prefer JSONEachRow inserts over interpolation — use this only for WHERE
 * clauses on ids / urls where parameterisation isn't worth it.
 */
function chEsc(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''");
}

async function chFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`ClickHouse ${resp.status}: ${text.slice(0, 300)}`);
    }
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a SELECT. Returns an array of row objects (one per JSONEachRow line).
 * @param {string} sql
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<object[]>}
 */
async function chQuery(sql, opts = {}) {
  const url = `${CH_URL}/?query=${encodeURIComponent(sql)}&default_format=JSONEachRow`;
  const resp = await chFetch(url, { headers: chHeaders() }, opts.timeoutMs);
  const text = await resp.text();
  if (!text.trim()) return [];
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

/**
 * INSERT rows into a table via JSONEachRow. No-op on empty input.
 * @param {string} table
 * @param {object[]} rows
 * @param {{ timeoutMs?: number }} [opts]
 */
async function chInsert(table, rows, opts = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const ndjson = rows.map((r) => JSON.stringify(r)).join('\n');
  const url = `${CH_URL}/?query=${encodeURIComponent(`INSERT INTO ${table} FORMAT JSONEachRow`)}`;
  await chFetch(
    url,
    { method: 'POST', headers: chHeaders('text/plain'), body: ndjson },
    opts.timeoutMs,
  );
}

/**
 * Execute a statement with no row output (DDL, ALTER … UPDATE mutations).
 * The SQL travels in the POST body.
 * @param {string} sql
 * @param {{ timeoutMs?: number }} [opts]
 */
async function chExec(sql, opts = {}) {
  await chFetch(
    `${CH_URL}/`,
    { method: 'POST', headers: chHeaders('text/plain'), body: sql },
    opts.timeoutMs,
  );
}

module.exports = { chQuery, chInsert, chExec, chEsc, chHeaders, isEnabled, CH_URL };
