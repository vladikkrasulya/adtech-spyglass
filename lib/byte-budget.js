'use strict';

/**
 * lib/byte-budget.js — a per-key request-VOLUME limiter for the CPU-bound
 * analysis endpoints.
 *
 * The request-COUNT limiter (60/min/IP) treats a 200-byte paste and a 2 MiB
 * payload alike, but analysis cost scales with size: measured at ~0.5-1.1 s per
 * MB on the production-sized shapes, so one address sending a maximal body once
 * a second kept Node's single event loop busy 100 % of the time and starved
 * every other visitor. Charging the declared body size against a rolling
 * per-address byte budget bounds the CPU any one address can claim (8 MiB/min
 * is roughly 9 s of work a minute, ~15 % of a core) without touching ordinary
 * use, where a paste is tens of KB.
 *
 * A fixed window (not a sliding log) keeps this O(1) per call; the worst case
 * is a 2x burst at a window boundary, which is fine for a CPU budget.
 */

const { MAX_BODY_BYTES } = require('./http');

const MAX_TRACKED = 10_000;

/**
 * @param {{ windowMs?: number, maxBytes: number }} opts
 * @returns {(key: string, bytes: number) => boolean} true when the charge fits
 */
function createByteBudget({ windowMs = 60_000, maxBytes }) {
  /** @type {Map<string, { start: number, bytes: number }>} */
  const buckets = new Map();
  return (key, bytes) => {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.start >= windowMs) {
      if (buckets.size >= MAX_TRACKED) {
        for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
        if (buckets.size >= MAX_TRACKED) buckets.clear();
      }
      b = { start: now, bytes: 0 };
      buckets.set(key, b);
    }
    if (b.bytes + bytes > maxBytes) return false;
    b.bytes += bytes;
    return true;
  };
}

/**
 * What to charge for a request before its body is read: the declared
 * Content-Length, or the global cap when the length is unknown (chunked) or
 * nonsensical — an undeclared body can be as large as the cap allows.
 *
 * @param {{ headers?: Record<string, any> }} req
 */
function declaredBodyCost(req) {
  const raw = req && req.headers ? req.headers['content-length'] : undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || raw === undefined || raw === '') return MAX_BODY_BYTES;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_BODY_BYTES);
}

module.exports = { createByteBudget, declaredBodyCost };
