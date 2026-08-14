'use strict';

/**
 * Decoder registry for URL-style ad requests.
 *
 * Mirrors `packages/core/decoders/index.js` (response-side) but for the
 * request direction. See `_canonical.js` for the canonical request shape
 * every decoder produces.
 *
 * Decoder contract:
 *   module.exports = {
 *     id: 'url-linkfeed',                    // unique slug
 *     description: '…',                      // for docs/UI
 *     detect(text, parsedUrl): boolean,      // text + pre-parsed URL object
 *     decode(text, parsedUrl): CanonicalUrlRequest | { ok: false, reason },
 *   };
 *
 * Add a decoder: drop a folder under `decoders/request/<variant>/`, register
 * it in DECODERS below. Detection runs in registration order — first claim
 * wins. Keep `detect()` cheap (host/path prefix checks); save heavier work
 * for `decode()`.
 */

const logger = require('../../logger');
const { repairInput } = require('./_input-repair');

const DECODERS = [
  require('./url-clickunder-feed'),
  require('./url-search-feed'),
  require('./url-linkfeed'),
];

/**
 * The only schemes an ad-feed pull can arrive on.
 *
 * This is a registry-level gate, not a per-decoder one, because `new URL()`
 * accepts `javascript:alert(1)`, `data:…` and `file:///…` without complaint —
 * measured, not assumed. Leaving the check to each decoder meant the two that
 * forgot it rejected those inputs only by accident, through a path or format
 * that happened not to match, and reported them as "we do not know this feed"
 * rather than "that scheme is not allowed here".
 */
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Summarize a parsed URL for the `no_decoder` answer: enough for a caller to
 * show what we actually read, without handing out a live `URL` object.
 *
 * @param {URL} u
 * @returns {{ protocol: string, host: string, pathname: string, params: string[] }}
 */
function summarizeUrl(u) {
  return {
    protocol: u.protocol,
    host: u.host,
    pathname: u.pathname,
    params: [...new Set([...u.searchParams.keys()])],
  };
}

/**
 * Try to decode a URL-style request payload.
 *
 * `null` means "nothing to decode" — no input at all. Everything else gets an
 * answer with a reason, because "this is not a feed URL" and "this did not
 * parse as a URL" are different events and a caller that cannot tell them
 * apart cannot explain either one to a human. See
 * `docs/url-input-spec-2026-08-13.md` (D2).
 *
 * @param {string} text
 * @returns {Object|null} Canonical request on success; `{ ok: false, reason }`
 *   with `reason` one of `unparseable` / `unsupported_scheme` / `no_decoder` /
 *   `decoder_threw`; `null` only for absent or non-string input.
 */
function decodeRequest(text) {
  if (typeof text !== 'string' || text.length === 0) return null;

  // Repair transport artifacts first, always — not inside the catch. Measured:
  // `?a=1&amp;b=2` and `?q=shoes)` parse without throwing, so a repair-on-
  // failure strategy never sees them and the damaged value reaches the
  // operator as if they had typed it.
  const { text: repaired, repairs, warnings } = repairInput(text);

  let parsedUrl;
  try {
    parsedUrl = new URL(repaired);
  } catch (e) {
    return {
      ok: false,
      reason: 'unparseable',
      detail: String((e && e.message) || e),
      repairs,
      warnings,
    };
  }

  if (!ALLOWED_SCHEMES.has(parsedUrl.protocol)) {
    return {
      ok: false,
      reason: 'unsupported_scheme',
      scheme: parsedUrl.protocol,
      repairs,
      warnings,
    };
  }

  for (const dec of DECODERS) {
    let claimed = false;
    try {
      // Decoders see the repaired string, never the raw paste: it is what
      // `parsedUrl` was built from, so `canonical.url` and `canonical._raw`
      // describe one and the same request. The original is still recoverable
      // as `repairs[0].before` whenever anything was repaired at all.
      claimed = !!dec.detect(repaired, parsedUrl);
    } catch (e) {
      logger.error(
        { decoderId: dec.id, phase: 'detect', err: e },
        '[request-decoder] plugin threw',
      );
      continue;
    }
    if (!claimed) continue;
    try {
      const canonical = dec.decode(repaired, parsedUrl);
      canonical.repairs = repairs;
      // Merge rather than assign: the decoder has already recorded its own
      // warnings (a query value percent-decoding destroyed, say), and those
      // are about a different layer than the repair ones.
      canonical.warnings = [...warnings, ...(canonical.warnings || [])];
      return canonical;
    } catch (e) {
      logger.error(
        { decoderId: dec.id, phase: 'decode', err: e },
        '[request-decoder] plugin threw',
      );
      return {
        ok: false,
        reason: 'decoder_threw',
        detail: String((e && e.message) || e),
        repairs,
        warnings,
      };
    }
  }
  // A perfectly good URL that no decoder recognizes. Say so, and say what we
  // read, so the caller can tell the operator which signature was missing
  // instead of showing the same blank as an unparseable string.
  return { ok: false, reason: 'no_decoder', parsed: summarizeUrl(parsedUrl), repairs, warnings };
}

/**
 * Registered decoders' metadata. Same shape as response-side `info()`.
 *
 * @returns {Array<{ id: string, description: string }>}
 */
function info() {
  return DECODERS.map((d) => ({ id: d.id, description: d.description || '' }));
}

module.exports = { decodeRequest, info };
