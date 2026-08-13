'use strict';

/**
 * modules/gists/handler.js — shareable encrypted gists.
 *
 *   POST /api/v1/gists      store one ciphertext bundle, get a short id back
 *   GET  /api/v1/gists/:id  fetch that ciphertext back
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The existing share link (public/modules/share/index.js) packs the whole
 * auction into a URL fragment. That is genuinely zero-knowledge — a fragment
 * is never transmitted — but it caps out around 7 KB because chat clients
 * truncate long links, so a real BidRequest/BidResponse pair often cannot be
 * shared at all. A gist keeps the fragment link for short payloads and adds a
 * server-side store for the rest, WITHOUT giving the server the contents.
 *
 * ── What the server knows ──────────────────────────────────────────────────
 * Ciphertext, a nonce, a format number, and two timestamps. That is the whole
 * row. The browser compresses the bundle, encrypts it under a fresh
 * AES-GCM-256 key, and puts that key in the URL fragment — so it reaches the
 * recipient's browser and never this process. There is deliberately no
 * decryption path anywhere on this side, and adding one would be a change to
 * the contract in docs/PRIVACY.md rather than an implementation detail.
 *
 * Consequences worth stating plainly:
 *   - A database dump yields opaque blobs. Not "hard to read" — unreadable
 *     without a key that was never stored.
 *   - Integrity is the client's to check. A tampered ciphertext fails its
 *     AES-GCM auth tag in the recipient's browser; this endpoint cannot tell
 *     a valid bundle from a corrupted one and does not pretend to.
 *   - Losing the fragment means losing the data. That is the design, not a bug.
 *
 * ── Abuse bounds ───────────────────────────────────────────────────────────
 * Creation is anonymous on purpose — requiring an account to share a debugging
 * payload would defeat the point. So the limits do the work instead: a hard
 * ciphertext cap, a per-IP rate limit on writes, a 30-day default TTL, and
 * 128-bit random ids that cannot be enumerated.
 */

const {
  readJson,
  sendJson,
  sendError,
  MAX_BODY_BYTES: GLOBAL_MAX_BODY_BYTES,
} = require('../../lib/http');
const log = require('../../lib/logger').child('gists');
const { resolveClientIp } = require('../../lib/client-ip');

/**
 * Room for the JSON envelope around the ciphertext: the field names, the iv,
 * the version, and the braces.
 */
const ENVELOPE_HEADROOM = 8 * 1024;

/**
 * Ciphertext cap — just under 2 MiB, and DERIVED from the global body cap
 * rather than written next to it.
 *
 * They have to be related, because readJson clamps any per-route limit down to
 * the global one. Declaring an independent 2 MiB ciphertext cap made the
 * largest legal gist unreachable: the envelope pushed the body past the global
 * cap, so a valid payload came back 413 instead of being stored. Deriving the
 * value means the two constants cannot drift apart again.
 *
 * At this size the compressed bundle is ~1.5 MiB, which is far beyond any real
 * auction — this is a flood ceiling, not a target.
 */
const MAX_CIPHERTEXT_CHARS = GLOBAL_MAX_BODY_BYTES - ENVELOPE_HEADROOM;

/** Bundle formats this build knows how to produce. Read-back is not filtered. */
const SUPPORTED_BUNDLE_VERSIONS = new Set([1]);

const DEFAULT_TTL_DAYS = 30;
const MIN_TTL_DAYS = 1;
const MAX_TTL_DAYS = 365;

/** base64 (standard alphabet, optional padding) — what the browser sends. */
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
/** base64url, 22 chars = 128 bits. Mirrors db.js Gists.newId(). */
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

function ttlMs() {
  const raw = Number(process.env.ORTBTOOLS_GIST_TTL_DAYS);
  const days = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_DAYS;
  const clamped = Math.min(MAX_TTL_DAYS, Math.max(MIN_TTL_DAYS, days));
  return clamped * 24 * 60 * 60 * 1000;
}

/**
 * Accept a base64 string of bounded length, or return '' — never a partial or
 * "repaired" value. The server does not decode it; it only checks that what it
 * is about to store looks like base64 and is not enormous.
 *
 * @param {unknown} value
 * @param {number} maxChars
 */
function sanitizeB64(value, maxChars) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxChars) return '';
  return B64_RE.test(trimmed) ? trimmed : '';
}

/**
 * @param {object} deps
 * @param {{ create: Function, get: Function, pruneExpired: Function }} deps.Gists
 * @param {(key: string) => boolean} deps.gistWriteLimiter
 * @param {(key: string) => boolean} [deps.readLimiter]
 */
function createGistsModule(deps) {
  const { Gists, gistWriteLimiter, readLimiter } = deps;

  // ── POST /api/v1/gists ───────────────────────────────────────────────────
  function handleCreate(req, res) {
    const ip = (() => {
      try {
        return resolveClientIp(req) || 'unknown';
      } catch (_e) {
        return 'unknown';
      }
    })();

    if (gistWriteLimiter && !gistWriteLimiter(ip)) {
      return sendError(
        res,
        429,
        'rate_limited',
        'Too many share links created. Try again shortly.',
      );
    }

    return readJson(req, { maxBytes: GLOBAL_MAX_BODY_BYTES })
      .then((body) => {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return sendError(res, 400, 'bad_request', 'Body must be a JSON object');
        }

        // Read each field once into a local and store THAT — a getter cannot
        // pass validation and then hand a different value to the INSERT.
        const ciphertext = sanitizeB64(body.ciphertext, MAX_CIPHERTEXT_CHARS);
        if (!ciphertext) {
          return sendError(
            res,
            400,
            'invalid_ciphertext',
            `ciphertext must be base64 and at most ${MAX_CIPHERTEXT_CHARS} characters`,
          );
        }
        // 12-byte IV → 16 base64 chars; the cap only rejects the absurd.
        const iv = sanitizeB64(body.iv, 64);
        if (!iv) return sendError(res, 400, 'invalid_iv', 'iv must be base64');

        const bundleVersion = Number(body.bundle_version);
        if (!SUPPORTED_BUNDLE_VERSIONS.has(bundleVersion)) {
          return sendError(
            res,
            400,
            'unsupported_bundle_version',
            `bundle_version must be one of: ${[...SUPPORTED_BUNDLE_VERSIONS].join(', ')}`,
          );
        }

        try {
          const { id, expiresAt } = Gists.create({
            ciphertext,
            iv,
            bundleVersion,
            ttlMs: ttlMs(),
          });
          return sendJson(res, 201, { success: true, id, expires_at: expiresAt });
        } catch (e) {
          log.error({ err: e }, 'gist create failed');
          return sendError(res, 500, 'gist_create_failed', e.message);
        }
      })
      .catch((e) => {
        const code = e && e.code === 'payload_too_large' ? 413 : 400;
        return sendError(res, code, e.code || 'bad_request', e.message);
      });
  }

  // ── GET /api/v1/gists/:id ────────────────────────────────────────────────
  function handleRead(req, res, _parsed, match) {
    const ip = (() => {
      try {
        return resolveClientIp(req) || 'unknown';
      } catch (_e) {
        return 'unknown';
      }
    })();
    if (readLimiter && !readLimiter(ip)) {
      return sendError(res, 429, 'rate_limited', 'Too many requests. Try again shortly.');
    }

    const id = match && match.params ? match.params.id : '';
    if (!ID_RE.test(String(id || ''))) {
      return sendError(res, 404, 'not_found', 'No such share link');
    }

    let row;
    try {
      row = Gists.get(id);
    } catch (e) {
      log.error({ err: e }, 'gist read failed');
      return sendError(res, 500, 'gist_read_failed', e.message);
    }

    if (!row) return sendError(res, 404, 'not_found', 'No such share link');
    if (row.expired) {
      // 410 rather than 404: "this link expired" is actionable, "no such link"
      // sends the recipient hunting for a typo. Distinguishing them leaks only
      // that a 128-bit id once existed.
      return sendError(res, 410, 'gist_expired', 'This share link has expired');
    }

    // Opaque passthrough. Cached privately and briefly: a gist is immutable
    // for its whole life, so a reload should not re-fetch, but a shared cache
    // must never hold someone else's bundle.
    res.setHeader('Cache-Control', 'private, max-age=60');
    return sendJson(res, 200, {
      success: true,
      id: row.id,
      ciphertext: row.ciphertext,
      iv: row.iv,
      bundle_version: row.bundleVersion,
      expires_at: row.expiresAt,
    });
  }

  return {
    id: 'gists',
    routes: [
      { method: 'POST', path: '/api/v1/gists', handler: handleCreate },
      { method: 'GET', path: '/api/v1/gists/:id', handler: handleRead },
    ],
  };
}

module.exports = {
  createGistsModule,
  sanitizeB64,
  ttlMs,
  MAX_CIPHERTEXT_CHARS,
  SUPPORTED_BUNDLE_VERSIONS,
  ID_RE,
};
