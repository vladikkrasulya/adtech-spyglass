'use strict';

/**
 * lib/client-ip.js — resolve the real client address behind the front proxy.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `auth.clientIp()` trusts `X-Forwarded-For` only when the TCP peer is loopback,
 * on the assumption that the reverse proxy dials `127.0.0.1:8090`. In this
 * deployment it never does. The published port is `127.0.0.1:8090 -> 3000`, so
 * Docker's userland proxy re-originates every connection and the container sees
 * the bridge GATEWAY as the peer, not loopback:
 *
 *   Cloudflare edge → cloudflared (host) → 127.0.0.1:8090
 *                   → docker-proxy → container, peer = 172.24.0.1
 *
 * Measured, not assumed: an identical `/api/v1/telemetry/summary` 401 fired at
 * `https://ortbtools.com` and at `http://127.0.0.1:8090` both landed in
 * `analytics.ortbtools_events` with `ip = 172.24.0.1`, and 4461 http rows over
 * seven days contained zero public addresses.
 *
 * The consequence for product telemetry is total: every genuine visitor would
 * resolve to a private address, classify as `internal`, and `is_external` would
 * be 0 forever — activation and retention permanently empty.
 *
 * ── Why it is separate from auth.clientIp ──────────────────────────────────
 * `auth.clientIp()` also keys the login / analyze rate limiters. Widening what
 * it trusts changes a security-sensitive control, and it belongs to a file with
 * unrelated work in flight. This module is therefore additive and used only by
 * the telemetry path. NOTE for a future change: because auth still resolves the
 * gateway, its per-IP limiters currently bucket every visitor together — worth
 * fixing on purpose, in its own change, not as a side effect of this one.
 *
 * ── Trust model ────────────────────────────────────────────────────────────
 * A forwarded header is believed ONLY when the peer is a configured trusted
 * proxy (`ORTBTOOLS_TRUSTED_PROXIES`, plus loopback which is always trusted).
 * With no configuration this module behaves exactly like `auth.clientIp()`, so
 * a self-hoster who never sets the env var loses nothing and trusts nothing.
 *
 * `CF-Connecting-IP` is preferred because Cloudflare OVERWRITES it at the edge —
 * a client cannot forge it. `X-Forwarded-For` is the fallback, read
 * right-to-left past trusted hops, since a client can prepend arbitrary entries
 * to its left.
 *
 * Residual risk, stated plainly: anything able to connect from a trusted-proxy
 * address can claim any client IP. Here that address is the Docker gateway,
 * reachable only by host processes through the published port — the same trust
 * boundary the loopback rule already assumed. It affects counter attribution
 * only; no authorization decision reads this value.
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
