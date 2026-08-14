'use strict';

/**
 * Case-insensitive signature matching for request decoders.
 *
 * RFC 3986 §6.2.2.1 makes only the scheme and host case-insensitive; a path and
 * a query are case-sensitive as far as the origin server is concerned, so we
 * never rewrite them. `/SEARCH` stays `/SEARCH` in `url` and `_raw`, and that is
 * exactly what gets sent if anyone replays the request.
 *
 * Recognising a feed is a different question from reproducing it. An operator
 * pasting `/SEARCH?FORMAT=json` from a case-mangling ticket system, a wiki, or
 * a mail client is holding the same feed URL, and refusing to recognise it
 * teaches them the tool is broken rather than that their paste was. So we match
 * loosely and preserve exactly.
 *
 * This module therefore only ever reads. Nothing here returns a modified URL.
 */

/**
 * Compare a pathname to a decoder's endpoint path, ignoring case and any
 * trailing slashes on either side.
 *
 * @param {string} pathname From `URL.pathname`.
 * @param {string} expected Decoder constant, e.g. `/search`.
 * @returns {boolean}
 */
function pathEquals(pathname, expected) {
  if (typeof pathname !== 'string' || typeof expected !== 'string') return false;
  const strip = (s) => s.replace(/\/+$/, '').toLowerCase();
  return strip(pathname) === strip(expected);
}

/**
 * Read a query parameter by name, ignoring the case of the name.
 *
 * Returns the first match in query order, matching `URLSearchParams.get()` and
 * `parseRawQuery` — one query string, one reading. When a query carries both
 * `format` and `FORMAT`, whichever appears first is the one every layer sees.
 *
 * @param {URLSearchParams} searchParams
 * @param {string} name
 * @returns {string|null} The raw (decoded) value, or `null` when absent.
 */
function getParam(searchParams, name) {
  const wanted = String(name).toLowerCase();
  for (const [key, value] of searchParams.entries()) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

/**
 * Presence test for a parameter name, ignoring case.
 *
 * A present-but-empty parameter counts as present: `?auth=` is a supplied
 * credential that happens to be blank, which is a validator's problem, not a
 * detection one.
 *
 * @param {URLSearchParams} searchParams
 * @param {string} name
 * @returns {boolean}
 */
function hasParam(searchParams, name) {
  return getParam(searchParams, name) !== null;
}

/**
 * Compare a query value to an expected enumerated token, ignoring case.
 *
 * Only for closed vocabularies a decoder defines — `format=json`, `format=cu`.
 * Never for opaque operator data such as ids, tokens or search terms, where
 * case belongs to the origin server.
 *
 * @param {string|null} value
 * @param {string} expected
 * @returns {boolean}
 */
function valueEquals(value, expected) {
  return typeof value === 'string' && value.toLowerCase() === String(expected).toLowerCase();
}

module.exports = { pathEquals, getParam, hasParam, valueEquals };
