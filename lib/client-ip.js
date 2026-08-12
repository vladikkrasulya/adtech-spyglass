'use strict';

/**
 * lib/client-ip.js — the single client-address rule for the whole app.
 *
 * Every per-IP decision goes through here: the auth/analyze/behavior/intel/read
 * rate limiters and session records (via `auth.clientIp`), the SSE
 * connection cap (`modules/stream`), the GlitchTip ingest limiter
 * (`modules/sentry-ingest`), the operational request log, and product-telemetry
 * traffic classification.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The app previously had two opposite bugs at once.
 *
 * TOO STRICT — `auth.clientIp()` trusted `X-Forwarded-For` only when the TCP
 * peer was loopback, on the assumption that the reverse proxy dials
 * `127.0.0.1:8090`. It does, but the published port is `127.0.0.1:8090 -> 3000`,
 * so Docker's userland proxy re-originates every connection and the container
 * sees the bridge GATEWAY as the peer, never loopback:
 *
 *   Cloudflare edge → cloudflared (host) → 127.0.0.1:8090
 *                   → docker-proxy → container, peer = 172.24.0.1
 *
 * Measured, not assumed: an identical `/api/v1/telemetry/summary` 401 fired at
 * `https://ortbtools.com` and at `http://127.0.0.1:8090` both landed in
 * `analytics.ortbtools_events` with `ip = 172.24.0.1`, and 4461 http rows over
 * seven days contained zero public addresses.
 *
 * Two consequences. For product telemetry it was total: every genuine visitor
 * resolved to a private address, classified as `internal`, and `is_external`
 * stayed 0 forever. For rate limiting it was quieter but worse — every visitor
 * shared ONE bucket, so the per-IP limiters were per-IP in name only.
 *
 * TOO LAX — `modules/stream` and `modules/sentry-ingest` each read the LEFTMOST
 * `X-Forwarded-For` entry from ANY peer. Cloudflare appends to that header
 * rather than replacing it, so the leftmost entry is whatever the client sent.
 * A caller rotating a fake value got a fresh allowance every request, which
 * made the SSE connection cap and the ingest limiter decorative.
 *
 * Both directions collapse into one question — "may this peer speak for someone
 * else, and which hop do we believe?" — which is what this module answers, once.
 *
 * ── Trust model ────────────────────────────────────────────────────────────
 * A forwarded header is believed ONLY when the peer is a configured trusted
 * proxy (`ORTBTOOLS_TRUSTED_PROXIES`, plus loopback which is always trusted).
 * With no configuration it falls back to the raw peer, so a self-hoster who
 * never sets the env var trusts nothing at all.
 *
 * `CF-Connecting-IP` is preferred because Cloudflare OVERWRITES it at the edge —
 * a client cannot forge it. `X-Forwarded-For` is the fallback, read
 * right-to-left past trusted hops, since a client can prepend arbitrary entries
 * to its left.
 *
 * Residual risk, stated plainly: anything able to connect from a trusted-proxy
 * address can claim any client IP, and therefore any rate-limit bucket. Here
 * that address is the Docker gateway, reachable only by host processes through
 * the published port — the same trust boundary the loopback rule already
 * assumed, and a strictly smaller one than the "believe any caller's header"
 * behaviour this replaces. No authentication or authorization decision reads
 * this value; it selects a throttling bucket and labels a log row.
 */

const { normalizeIp, ipMatchesRules, makeEnvRuleCache } = require('./traffic-class');

const trustedProxyRules = makeEnvRuleCache('ORTBTOOLS_TRUSTED_PROXIES');

/** Loopback is always trusted — it is the one peer that cannot be re-originated. */
function isLoopback(normalized) {
  return normalized === '127.0.0.1' || normalized === '::1' || normalized.startsWith('127.');
}

/**
 * Is this peer allowed to speak for someone else?
 * @param {string} normalizedIp output of normalizeIp()
 */
function isTrustedProxy(normalizedIp) {
  if (!normalizedIp) return false;
  if (isLoopback(normalizedIp)) return true;
  return ipMatchesRules(normalizedIp, trustedProxyRules());
}

/** A header may legally repeat; Node hands those over as an array. */
function firstHeaderValue(value) {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

/**
 * Resolve the address to attribute this request to.
 *
 * Falls back to the raw peer whenever the peer is untrusted or no usable
 * forwarded header is present, so the result is never worse than
 * `auth.clientIp()` and never invented.
 *
 * @param {{ headers?: Record<string, any>, socket?: { remoteAddress?: string } }} req
 * @returns {string} a normalized address, or '' when nothing is resolvable
 */
function resolveClientIp(req) {
  if (!req || typeof req !== 'object') return '';
  const headers = req.headers && typeof req.headers === 'object' ? req.headers : {};
  const peer = normalizeIp(req.socket && req.socket.remoteAddress);

  if (!isTrustedProxy(peer)) return peer;

  // Set by Cloudflare at the edge and overwritten on every request, so unlike
  // X-Forwarded-For it cannot carry a client-supplied prefix.
  const cf = normalizeIp(firstHeaderValue(headers['cf-connecting-ip']));
  if (cf) return cf;

  // Fallback: rightmost entry that is not itself a trusted hop. Reading from
  // the right is what makes a client-prepended entry unreachable.
  const xff = firstHeaderValue(headers['x-forwarded-for']);
  if (xff) {
    const parts = xff.split(',');
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = normalizeIp(parts[i]);
      if (candidate && !isTrustedProxy(candidate)) return candidate;
    }
  }

  return peer;
}

module.exports = { resolveClientIp, isTrustedProxy };
