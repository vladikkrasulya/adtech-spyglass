'use strict';

/**
 * lib/validation-log.js — fire-and-forget INSERT into analytics.validation_logs.
 *
 * Stage 5 (Insights Dashboard). Called from two hot paths:
 *   1. stream/handler.js enrichAndStore — one row per synthetic specimen emitted
 *   2. analyze/handler.js handleAnalyze — one row per /api/analyze call
 *
 * Never blocks the caller. Failures are logged via pino but never thrown.
 * Disabled if CLICKHOUSE_USER env var is absent (same pattern as event-log.js).
 */

const logger = require('./logger').child('validation-log');

const CH_URL = (process.env.CLICKHOUSE_URL || 'http://clickhouse:8123').replace(/\/+$/, '');
const CH_USER = process.env.CLICKHOUSE_USER || '';
const CH_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CH_ENABLED = !!(CH_URL && CH_USER);

let _degradedWarned = false;

function chHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (CH_USER) h['X-ClickHouse-User'] = CH_USER;
  if (CH_PASSWORD) h['X-ClickHouse-Key'] = CH_PASSWORD;
  return h;
}

/**
 * Log a validation event.
 *
 * @param {{
 *   format: string,
 *   version: string,
 *   has_errors: 0|1,
 *   error_count: number,
 *   warning_count: number,
 *   info_count: number,
 *   source: 'stream'|'analyze',
 * }} args
 */
function logValidation(args) {
  if (!CH_ENABLED) {
    if (!_degradedWarned) {
      _degradedWarned = true;
      logger.warn('CH env not configured — validation-log is a no-op');
    }
    return;
  }

  // Timestamp without trailing Z — CH DateTime64 quirk (see memory feedback).
  const ts = new Date().toISOString().slice(0, -1);

  const row = {
    timestamp: ts,
    format: String(args.format || 'unknown').slice(0, 32),
    version: String(args.version || 'unknown').slice(0, 16),
    has_errors: args.has_errors ? 1 : 0,
    error_count: Math.max(0, Math.floor(Number(args.error_count) || 0)),
    warning_count: Math.max(0, Math.floor(Number(args.warning_count) || 0)),
    info_count: Math.max(0, Math.floor(Number(args.info_count) || 0)),
    source: args.source === 'analyze' ? 'analyze' : 'stream',
  };

  const url =
    CH_URL +
    '/?query=' +
    encodeURIComponent('INSERT INTO analytics.validation_logs FORMAT JSONEachRow');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  fetch(url, {
    method: 'POST',
    headers: chHeaders(),
    body: JSON.stringify(row),
    signal: controller.signal,
  })
    .then((resp) => {
      clearTimeout(timer);
      if (!resp.ok) {
        resp
          .text()
          .then((t) =>
            logger.warn(
              { status: resp.status, body: t.slice(0, 200) },
              'validation-log insert failed',
            ),
          )
          .catch(() => {});
      }
    })
    .catch((err) => {
      clearTimeout(timer);
      if (err.name !== 'AbortError') {
        logger.warn({ err: err.message }, 'validation-log fetch error');
      }
    });
}

/**
 * Infer format string from a raw specimen (OpenRTB BidRequest).
 * Matches fmtFrom() logic in public/modules/stream/index.js.
 */
function fmtFromSpecimen(specimen) {
  if (!specimen || typeof specimen !== 'object') return 'unknown';
  const imp0 = specimen.imp && specimen.imp[0];
  if (imp0) {
    if (imp0.banner) return 'banner';
    if (imp0.video) return 'video';
    if (imp0.native) return 'native';
    if (imp0.audio) return 'audio';
  }
  // BidResponse-shaped
  const bid0 =
    specimen.seatbid &&
    specimen.seatbid[0] &&
    specimen.seatbid[0].bid &&
    specimen.seatbid[0].bid[0];
  if (bid0 && typeof bid0.adm === 'string') {
    const head = bid0.adm.trimStart().slice(0, 64).toLowerCase();
    if (head.includes('<vast') || head.includes('<?xml')) return 'video';
    if (head.startsWith('{') && head.includes('"native"')) return 'native';
    if (head.startsWith('<')) return 'banner';
  }
  return 'unknown';
}

module.exports = { logValidation, fmtFromSpecimen };
