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

const DECODERS = [require('./url-linkfeed')];

/**
 * Try to decode a URL-style request payload. Returns the first decoder's
 * canonical output, `{ ok: false, reason }` if a decoder claimed-then-
 * failed, or `null` if no decoder claimed the text.
 *
 * @param {string} text
 * @returns {Object|null}
 */
function decodeRequest(text) {
  if (typeof text !== 'string' || text.length === 0) return null;

  let parsedUrl;
  try {
    parsedUrl = new URL(text);
  } catch {
    return null;
  }

  for (const dec of DECODERS) {
    let claimed = false;
    try {
      claimed = !!dec.detect(text, parsedUrl);
    } catch (e) {
      logger.error(
        { decoderId: dec.id, phase: 'detect', err: e },
        '[request-decoder] plugin threw',
      );
      continue;
    }
    if (!claimed) continue;
    try {
      return dec.decode(text, parsedUrl);
    } catch (e) {
      logger.error(
        { decoderId: dec.id, phase: 'decode', err: e },
        '[request-decoder] plugin threw',
      );
      return { ok: false, reason: 'decoder_threw', detail: String((e && e.message) || e) };
    }
  }
  return null;
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
