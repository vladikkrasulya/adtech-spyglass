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
    // Once the cap is exceeded we reject with payload_too_large and stop
    // buffering, but we must NOT destroy the socket: a mid-upload reset reaches
    // the client as ECONNRESET and swallows the documented 400 envelope the
    // handler is about to write (docs/api-v1.md). Instead keep the request
    // stream flowing (draining, not accumulating) so the client finishes its
    // upload and can read the structured error response.
    //
    // Trade-off (deliberate): the drain has no explicit upper bound, so a
    // hostile slow uploader holds the connection open longer than the old
    // `req.destroy()` did. This is bounded in practice — discarding is O(bytes)
    // and memory stays flat (measured ~44 ms for a 40 MiB body, ~20x the cap),
    // and the per-IP analyze rate limiter caps how often a single client can
    // reach this path — so we accept the longer-lived connection in exchange
    // for delivering the documented error envelope instead of a raw reset.
    let over = false;
    // Count BYTES and decode once at the end. The cap is documented in bytes,
    // but `body += chunk` counted UTF-16 units (a multi-byte body could reach
    // ~3x the cap in memory) and decoded each chunk separately, corrupting a
    // character split across two chunks.
    /** @type {Buffer[]} */
    let chunks = [];
    let size = 0;
    req.on('data', (c) => {
      if (over) return;
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
      size += buf.length;
      if (size > limit) {
        over = true;
        chunks = [];
        reject(makeError('payload_too_large', `Payload exceeds ${limit} byte limit`));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (over) return;
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(makeError('invalid_json', 'Body is not valid JSON: ' + e.message));
      }
    });
    req.on('error', (e) => {
      if (!over) reject(e);
    });
  });
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * Page the operator about a failure. sendError calls this for every 5xx;
 * handlers whose failure is reported to the client as a non-5xx status
 * (424 for a failed dependency, so Cloudflare does not swallow the JSON body)
 * but is still operator-actionable call it directly.
 * @param {any} res
 * @param {string|number} label shown after "ortbtools", normally the HTTP status
 * @param {string} code machine-readable failure code
 * @param {unknown} [detail]
 * @param {string} [tagPrefix] rate-limit tag prefix
 */
function alertOperator(res, label, code, detail, tagPrefix = '5xx') {
  if (!_notifyAdmin || !_notifyEscape) return;
  try {
    const path = (res.req && res.req.url ? res.req.url.split('?')[0] : '?').slice(0, 80);
    _notifyAdmin(
      `🔴 <b>ortbtools ${label}</b> <code>${_notifyEscape(code)}</code>\n` +
        `path <code>${_notifyEscape(path)}</code>\n` +
        (detail ? `<pre>${_notifyEscape(String(detail).slice(0, 400))}</pre>` : ''),
      { tag: `${tagPrefix}:${code}` },
    );
  } catch (_e) {
    /* never let alerting break the response */
  }
}

/**
 * Tell a throttled client when to come back. Call before sendError(…, 429, …)
 * with the limiter's window; sendError supplies DEFAULT_RETRY_AFTER_S otherwise.
 * @param {any} res
 * @param {number} seconds
 */
function setRetryAfter(res, seconds) {
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(seconds))));
  }
}

// The per-minute limiters (analyze, library, intel, …) use a 60 s rolling
// window, so a minute is the honest default for a 429 nobody has qualified.
const DEFAULT_RETRY_AFTER_S = 60;

function sendError(res, status, code, error, detail) {
  const body = { success: false, error, code };
  if (detail !== undefined) body.detail = detail;
  if (
    status === 429 &&
    res &&
    typeof res.setHeader === 'function' &&
    !(typeof res.hasHeader === 'function' && res.hasHeader('Retry-After'))
  ) {
    setRetryAfter(res, DEFAULT_RETRY_AFTER_S);
  }
  sendJson(res, status, body);
  if (status >= 500 && status < 600) alertOperator(res, status, code, detail);
}

function makeError(code, msg) {
  const e = /** @type {Error & {code?: string}} */ (new Error(msg));
  e.code = code;
  return e;
}

/**
 * Authority (`host[:port]`, default ports stripped) of a URL-ish string, or ''.
 * @param {string} value an Origin header, a Host header or a base URL
 */
function authorityOf(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : 'http://' + v).host.toLowerCase();
  } catch (_e) {
    return '';
  }
}

/**
 * Decide whether a state-changing browser request must be refused as
 * cross-site (login CSRF / forced logout / forced registration). Returns null
 * when the request may proceed.
 *
 * A cross-site HTML form can POST `text/plain` (a CORS-"simple" request, no
 * preflight) and the server parses the body as JSON regardless of its type, so
 * SameSite=Lax alone does not stop a top-level cross-site POST from *setting*
 * a session cookie. Three independent checks, each skipped when the client does
 * not send the signal (curl, server-to-server, older browsers), so only
 * browsers — the only CSRF victims — are constrained:
 *   1. Sec-Fetch-Site must be `same-origin` (or `none`, user-initiated);
 *      `same-site` is refused too: a sibling subdomain is not this app.
 *   2. Origin, when present, must name this host (Host / X-Forwarded-Host) or
 *      PUBLIC_BASE_URL; `Origin: null` is refused.
 *   3. A request that carries a body must declare `application/json`, which a
 *      cross-site form cannot send without a CORS preflight (and there is no
 *      CORS on this API).
 *
 * @param {{ headers?: Record<string, any> }} req
 * @param {{ publicBaseUrl?: string }} [opts]
 * @returns {{ status: number, code: string, message: string } | null}
 */
function crossSiteRejection(req, opts) {
  const h = (req && req.headers) || {};
  const forbidden = {
    status: 403,
    code: 'cross_site_request',
    message: 'Cross-site requests are not allowed',
  };

  const site = typeof h['sec-fetch-site'] === 'string' ? h['sec-fetch-site'].toLowerCase() : '';
  if (site && site !== 'same-origin' && site !== 'none') return forbidden;

  const origin = typeof h.origin === 'string' ? h.origin.trim() : '';
  if (origin) {
    const originAuthority = origin === 'null' ? '' : authorityOf(origin);
    const allowed = new Set(
      [h.host, h['x-forwarded-host'], opts && opts.publicBaseUrl]
        .map((v) => authorityOf(String(v || '').split(',')[0]))
        .filter(Boolean),
    );
    if (!originAuthority || !allowed.has(originAuthority)) return forbidden;
  }

  const hasBody =
    (h['content-length'] !== undefined && String(h['content-length']).trim() !== '0') ||
    h['transfer-encoding'] !== undefined;
  if (hasBody) {
    const type = String(h['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (type !== 'application/json') {
      return {
        status: 415,
        code: 'unsupported_media_type',
        message: 'Content-Type must be application/json',
      };
    }
  }
  return null;
}

/**
 * Wrap a route handler so cross-site browser requests are refused before the
 * body is read or any session/cookie side effect happens.
 *
 * @template {(req: any, res: any) => any} H
 * @param {H} handler
 * @param {() => { publicBaseUrl?: string }} [getOpts] evaluated per request
 * @returns {H}
 */
function guardCrossSite(handler, getOpts) {
  /** @param {any} req @param {any} res @param {...any} rest */
  const guarded = (req, res, ...rest) => {
    const rejection = crossSiteRejection(req, getOpts ? getOpts() : undefined);
    if (rejection) return sendError(res, rejection.status, rejection.code, rejection.message);
    // Router handlers also receive (parsed, match); routes with :params need them.
    return /** @type {Function} */ (handler)(req, res, ...rest);
  };
  // The wrapper is transparent to tooling that identifies a route by its
  // handler's name or source (the route-access inventory does).
  Object.defineProperty(guarded, 'name', { value: handler.name, configurable: true });
  guarded.toString = () => String(handler);
  return /** @type {H} */ (guarded);
}

/**
 * Apply the cross-site guard to every state-changing route of a module and
 * leave its reads alone. For cookie-authenticated mutation surfaces (the saved
 * library) that must refuse a request a foreign page caused the browser to send.
 *
 * @template {{ routes: Array<{ method: string, handler: Function }> }} M
 * @param {M} mod
 * @param {() => { publicBaseUrl?: string }} [getOpts]
 * @returns {M}
 */
function guardMutations(mod, getOpts) {
  return {
    ...mod,
    routes: mod.routes.map((r) =>
      /^(POST|PUT|PATCH|DELETE)$/.test(r.method)
        ? { ...r, handler: guardCrossSite(/** @type {any} */ (r.handler), getOpts) }
        : r,
    ),
  };
}

module.exports = {
  setRetryAfter,
  DEFAULT_RETRY_AFTER_S,
  guardMutations,
  init,
  readJson,
  sendJson,
  sendError,
  alertOperator,
  makeError,
  crossSiteRejection,
  guardCrossSite,
  MAX_BODY_BYTES,
};
