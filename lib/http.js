'use strict';

/**
 * lib/http.js — HTTP request/response helpers.
 *
 * Extracted from server.js as part of the backend modularization
 * (after frontend modularization closed 14/14 in commit 1493913).
 * Every module under modules/<tool>/handler.js imports these to
 * read request bodies and emit responses with consistent shape.
 *
 * 5xx alerts: sendError pages the operator via Telegram (notifyAdmin)
 * for any 5xx. 4xx stays silent — client errors aren't actionable.
 * The alert sink is injected so this module stays dep-free; pass a
 * { notifyAdmin, notifyEscape } object via init() before first use.
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

let _notifyAdmin = null;
let _notifyEscape = null;

/**
 * Wire the 5xx alert sink. Called once from server.js at boot.
 */
function init({ notifyAdmin, notifyEscape }) {
  _notifyAdmin = notifyAdmin;
  _notifyEscape = notifyEscape;
}

/**
 * Read and JSON-parse a request body.
 *
 * @param {import('http').IncomingMessage} req
 * @param {{ maxBytes?: number }} [opts] Tighter per-route cap. Endpoints that
 *   only ever receive a small fixed-shape record (e.g. the telemetry beacon)
 *   pass a few KB here so an oversized body is refused at the transport layer
 *   instead of being parsed and then rejected by field validation.
 */
function readJson(req, opts) {
  const limit =
    opts && Number.isFinite(opts.maxBytes) && opts.maxBytes > 0
      ? Math.min(opts.maxBytes, MAX_BODY_BYTES)
      : MAX_BODY_BYTES;
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > limit) {
        reject(makeError('payload_too_large', `Payload exceeds ${limit} byte limit`));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(makeError('invalid_json', 'Body is not valid JSON: ' + e.message));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, code, error, detail) {
  const body = { success: false, error, code };
  if (detail !== undefined) body.detail = detail;
  sendJson(res, status, body);
  if (status >= 500 && status < 600 && _notifyAdmin && _notifyEscape) {
    try {
      const path = (res.req && res.req.url ? res.req.url.split('?')[0] : '?').slice(0, 80);
      _notifyAdmin(
        `🔴 <b>ortbtools ${status}</b> <code>${_notifyEscape(code)}</code>\n` +
          `path <code>${_notifyEscape(path)}</code>\n` +
          (detail ? `<pre>${_notifyEscape(String(detail).slice(0, 400))}</pre>` : ''),
        { tag: `5xx:${code}` },
      );
    } catch (_e) {
      /* never let alerting break the response */
    }
  }
}

function makeError(code, msg) {
  const e = /** @type {Error & {code?: string}} */ (new Error(msg));
  e.code = code;
  return e;
}

module.exports = { init, readJson, sendJson, sendError, makeError, MAX_BODY_BYTES };
