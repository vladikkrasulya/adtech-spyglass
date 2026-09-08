'use strict';

/**
 * tests/corpus/lib/http-run.js — drive the REAL HTTP server for corpus cases.
 *
 * The server is spawned exactly as the browser tests spawn it (isolated data
 * directory, analytics/news/FX timers off). Nothing inside the analysis path
 * is stubbed: the request travels through the router, the body cap, the
 * limiter, Core, category decoding and format union.
 *
 * The analyze limiter is 60 calls per minute per client IP and has no test
 * override (server.js). A loopback peer is always a trusted proxy, so the
 * client IP is taken from `X-Forwarded-For`; rotating a documentation-range
 * address per call keeps every call in its own bucket without touching the
 * limiter. That is the only accommodation the runner makes, and it is made at
 * the transport edge, not inside the product.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * @param {{env?: Record<string, string>}} [opts]
 * @returns {Promise<{url: string, port: number, dataDir: string, stop: () => Promise<void>}>}
 */
async function startServer(opts = {}) {
  const port = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-corpus-'));
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      // LOG_LEVEL defaults to silent under NODE_ENV=test; readiness is detected
      // from the "listening" log line, so logging must stay on.
      LOG_LEVEL: 'info',
      ORTBTOOLS_DATA_DIR: dataDir,
      ORTBTOOLS_ANALYTICS_DISABLED: '1',
      NEWS_CRAWLER_DISABLED: '1',
      FX_DISABLED: '1',
      ...(opts.env || {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(undefined);
      };
      const timer = setTimeout(
        () => finish(new Error('corpus server did not start within 15s')),
        15000,
      );
      const onData = (chunk) => {
        if (chunk.toString().includes('listening')) finish(null);
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.once('error', finish);
      proc.once('exit', (code) => finish(new Error(`corpus server exited ${code}`)));
    });
  } catch (error) {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    fs.rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
  const stop = () =>
    new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        fs.rmSync(dataDir, { recursive: true, force: true });
        resolve(undefined);
        return;
      }
      const force = setTimeout(() => proc.kill('SIGKILL'), 2000);
      proc.once('exit', () => {
        clearTimeout(force);
        try {
          fs.rmSync(dataDir, { recursive: true, force: true });
        } catch (_e) {
          /* the OS reclaims the temp dir */
        }
        resolve(undefined);
      });
      proc.kill('SIGTERM');
    });
  return { url: `http://127.0.0.1:${port}`, port, dataDir, stop };
}

let forwardedCounter = 0;

/**
 * A fresh documentation-range client address per call (RFC 5737 blocks), so
 * the per-IP analyze limiter never sees two corpus calls from one client.
 * @returns {string}
 */
function nextClientIp() {
  const n = forwardedCounter++;
  const block = ['203.0.113', '198.51.100', '192.0.2'][Math.floor(n / 254) % 3];
  return `${block}.${(n % 254) + 1}`;
}

/**
 * @param {string} baseUrl
 * @param {string} rawBody exact bytes to send (lets a case send invalid JSON)
 * @param {{locale?: string, dialect?: string}} [opts]
 * @returns {Promise<{status: number, body: any, text: string, transportError?: string}>}
 */
async function postAnalyzeRaw(baseUrl, rawBody, opts = {}) {
  const q = new URLSearchParams();
  q.set('locale', opts.locale || 'en');
  if (opts.dialect) q.set('dialect', opts.dialect);
  let resp;
  try {
    resp = await fetch(`${baseUrl}/api/analyze?${q.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': nextClientIp() },
      body: rawBody,
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    // A transport failure (connection reset mid-upload, timeout) is an
    // observable outcome of the real server, recorded as status 0 with its
    // cause so the oracle can judge it against the documented contract.
    const cause = /** @type {any} */ (error)?.cause;
    const reason =
      (cause && (cause.code || cause.message)) ||
      /** @type {any} */ (error)?.message ||
      String(error);
    return { status: 0, body: null, text: '', transportError: String(reason) };
  }
  const text = await resp.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_e) {
    body = null;
  }
  return { status: resp.status, body, text };
}

/**
 * Build the real analyze envelope, including raw lexical sidecars for valid
 * JSON. Unparseable text is a separate malformed HTTP-envelope probe; the
 * browser normally rejects it before posting.
 *
 * @param {import('./load').Materialized} c
 * @returns {string}
 */
function analyzeBodyFor(c) {
  const body = {};
  const malformed = [];
  for (const [side, field] of [
    ['Request', 'bidReq'],
    ['Response', 'bidRes'],
  ]) {
    const raw = c[`raw${side}`];
    if (raw !== undefined) {
      try {
        body[field] = JSON.parse(raw);
        body[`${field}Raw`] = raw;
      } catch (_e) {
        // Explicit malformed-transport probe. Inspector rejects this text
        // before posting; its browser outcome is asserted independently.
        malformed.push(`"${field}":${raw}`);
      }
    } else if (c[side.toLowerCase()] !== undefined) {
      body[field] = c[side.toLowerCase()];
    }
  }
  if (!malformed.length) return JSON.stringify(body);
  const encoded = JSON.stringify(body).slice(1, -1);
  return `{${[encoded, ...malformed].filter(Boolean).join(',')}}`;
}

/**
 * Run one case through POST /api/analyze and normalize into the oracle shape.
 * Request-side findings arrive without prefix; response-side findings carry the
 * "[response] " message prefix and are split out by their `side` when the
 * server provides one, else by message prefix.
 *
 * @param {string} baseUrl
 * @param {import('./load').Materialized} c
 * @returns {Promise<any>}
 */
async function runHttp(baseUrl, c) {
  const res = await postAnalyzeRaw(baseUrl, analyzeBodyFor(c), { dialect: c.meta.dialect });
  /** @type {any} */
  const actual = {
    http: { status: res.status, body: res.body, transportError: res.transportError || null },
    crosscheck: [],
    format: null,
  };
  if (res.status !== 200 || !res.body || !res.body.success) return actual;
  const v = res.body.validation || {};
  const findings = Array.isArray(v.findings) ? v.findings : [];
  const isResponseFinding = (f) =>
    f.side === 'response' ||
    f.location?.side === 'response' ||
    (typeof f.msg === 'string' && f.msg.startsWith('[response] '));
  const submitted = JSON.parse(analyzeBodyFor(c));
  const nonemptyObject = (value) =>
    value && typeof value === 'object' && Object.keys(value).length > 0;
  const hasReq =
    nonemptyObject(submitted.bidReq) ||
    (typeof submitted.bidReq === 'string' && submitted.bidReq.trim().length > 0);
  // A response side is present when bidRes is a non-empty object/array OR a
  // present scalar (e.g. a bare `42`). The scalar branch mirrors the handler:
  // Core validates such a root and rejects it, so its findings belong to the
  // response side rather than being folded into the request bucket.
  const hasRes =
    nonemptyObject(submitted.bidRes) ||
    (submitted.bidRes !== undefined &&
      submitted.bidRes !== null &&
      typeof submitted.bidRes !== 'object');
  const reqFindings = (hasRes ? findings.filter((f) => !isResponseFinding(f)) : findings).map(
    (f) => ({ ...f, side: 'request' }),
  );
  const resFindings = (hasReq ? findings.filter(isResponseFinding) : findings).map((f) => ({
    ...f,
    side: 'response',
  }));
  const statusFor = (rows) =>
    rows.some((f) => f.level === 'error')
      ? 'errors'
      : rows.some((f) => f.level === 'warning')
        ? 'warnings'
        : 'clean';
  if (hasReq) {
    actual.request = {
      type: v.type,
      version: v.version,
      status: hasRes ? statusFor(reqFindings) : v.status,
      findings: reqFindings,
    };
  }
  if (hasRes) {
    actual.response = {
      type: hasReq ? undefined : v.type,
      version: hasReq ? undefined : v.version,
      status: hasReq ? statusFor(resFindings) : v.status,
      findings: resFindings,
    };
  }
  actual.http.success = true;
  actual.union = { type: v.type, status: v.status, version: v.version };
  actual.crosscheck = Array.isArray(res.body.crosscheck) ? res.body.crosscheck : [];
  actual.format = res.body.meta ? res.body.meta.format : null;
  return actual;
}

/** Adapt only metadata absent from the real HTTP contract. Finding/status
 * assertions stay active for each side. @param {any} c */
function httpExpectFor(c) {
  const e = JSON.parse(JSON.stringify(c.meta.expect || {}));
  if (e.http?.status >= 400) {
    for (const key of ['request', 'response', 'crosscheck', 'format', 'consistency']) delete e[key];
    return e;
  }
  const both =
    (c.request !== undefined || c.rawRequest !== undefined) &&
    (c.response !== undefined || c.rawResponse !== undefined);
  if (both && e.response) {
    delete e.response.type;
    delete e.response.version;
    // When both sides are present the API returns one merged validation object;
    // the harness synthesizes a per-side status from finding levels, so
    // validate()'s root-level 'invalid' status is not reconstructible here (it
    // is asserted directly at the Core layer). Drop only that status; errors/
    // warnings/clean remain representable and stay checked.
    if (e.response.status === 'invalid') delete e.response.status;
  }
  return e;
}

/** Judge the actual HTTP envelope plus every exposed semantic assertion.
 * @param {any} actual @param {any} c */
function evaluateHttp(actual, c) {
  const { evaluate } = require('./oracle');
  const e = httpExpectFor(c);
  const expectsError = e.http?.status >= 400;
  if (!expectsError && actual.http.status !== 200)
    return {
      failures: [
        `http: expected 200, got ${actual.http.status} ${JSON.stringify(actual.http.body)}`,
      ],
    };
  if (!expectsError && actual.http.body?.success !== true)
    return { failures: ['http: expected success:true envelope'] };
  if (
    !expectsError &&
    (!Array.isArray(actual.http.body.validation?.findings) ||
      !Array.isArray(actual.http.body.crosscheck) ||
      !actual.http.body.meta?.format)
  )
    return { failures: ['http: success envelope missing validation/crosscheck/format'] };
  const result = evaluate(actual, e, { layers: expectsError ? ['http'] : ['core', 'http'] });
  if (expectsError && actual.http.body?.success !== false)
    result.failures.push('http: expected success:false error envelope');
  return result;
}

module.exports = {
  startServer,
  postAnalyzeRaw,
  analyzeBodyFor,
  runHttp,
  httpExpectFor,
  evaluateHttp,
  nextClientIp,
  ROOT,
};
