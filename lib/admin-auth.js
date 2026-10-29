'use strict';

/**
 * lib/admin-auth.js — the one bearer-token gate for the operator surface
 * (`/api/admin/*`, `/api/v1/telemetry/summary`, the blog admin routes).
 *
 * Both halves of this used to be missing at four separate call sites:
 *   - the token was compared with `!==`, which is not constant time;
 *   - nothing slowed a guesser down — 200 wrong tokens in a row from one address
 *     all answered 401, so the token's entropy was the only defence.
 *
 * Now the comparison is constant time (over SHA-256 digests, so differing
 * lengths neither throw nor leak) and an address that fails MAX_FAILURES times
 * inside WINDOW_MS is answered 429 until the window clears, whatever token it
 * presents. Successful calls neither count nor reset: the legitimate callers
 * (the portal over the internal network) never fail.
 *
 * The address comes from lib/client-ip (trusted-proxy aware), so this is only
 * as good as ORTBTOOLS_TRUSTED_PROXIES; behind Cloudflare an unconfigured proxy
 * list would put every visitor in one bucket (see docs/OPERATIONS.md).
 */

const crypto = require('node:crypto');
const { resolveClientIp } = require('./client-ip');
const { sendError } = require('./http');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const MAX_TRACKED = 10_000;

/** @type {Map<string, number[]>} address → timestamps of recent failures */
const failures = new Map();

/** @param {string} value */
function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

/**
 * Constant-time equality for secrets of any length.
 * @param {string} provided
 * @param {string} expected
 */
function tokensMatch(provided, expected) {
  return crypto.timingSafeEqual(digest(provided), digest(expected));
}

/** @param {string} ip @param {number} now */
function recentFailures(ip, now) {
  const fresh = (failures.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (fresh.length) failures.set(ip, fresh);
  else failures.delete(ip);
  return fresh;
}

/** @param {string} ip @param {number} now */
function recordFailure(ip, now) {
  if (failures.size >= MAX_TRACKED && !failures.has(ip)) {
    for (const key of failures.keys()) recentFailures(key, now);
    // Still full of live windows (a flood of distinct addresses): forget the
    // oldest rather than grow without bound.
    if (failures.size >= MAX_TRACKED) failures.delete(failures.keys().next().value);
  }
  failures.set(ip, [...recentFailures(ip, now), now]);
}

/**
 * Gate a request on `Authorization: Bearer $ADMIN_STATS_TOKEN`.
 *
 * @param {any} req
 * @param {any} res
 * @param {{ disabledCode?: string }} [opts] error code used when no token is configured
 * @returns {boolean} true when the caller may proceed; otherwise the response was written
 */
function requireAdminBearer(req, res, opts = {}) {
  const expected = process.env.ADMIN_STATS_TOKEN;
  if (!expected) {
    sendError(res, 503, opts.disabledCode || 'admin_disabled', 'ADMIN_STATS_TOKEN not configured');
    return false;
  }
  const ip = resolveClientIp(req) || 'unknown';
  const now = Date.now();
  if (recentFailures(ip, now).length >= MAX_FAILURES) {
    sendError(res, 429, 'rate_limited', 'Too many failed attempts. Try again later.');
    return false;
  }
  const header = String((req.headers && req.headers['authorization']) || '');
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !tokensMatch(provided, expected)) {
    recordFailure(ip, now);
    sendError(res, 401, 'unauthorized', 'Bearer token required');
    return false;
  }
  return true;
}

/** Test hook: forget every recorded failure. */
function resetAdminAuthFailures() {
  failures.clear();
}

module.exports = {
  requireAdminBearer,
  tokensMatch,
  resetAdminAuthFailures,
  MAX_FAILURES,
  WINDOW_MS,
};
