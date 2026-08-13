'use strict';

/**
 * Verbatim query-string reading for URL-style ad requests.
 *
 * `URLSearchParams` percent-decodes every value it hands back. That is correct
 * for a finished URL and wrong for an ad-feed template, because ad servers pass
 * unexpanded macros through the query and some of them decode into garbage:
 *
 *   ?cb=%%CACHEBUSTER%%  →  searchParams.get('cb') === '%�CHEBUSTER%%'
 *   ?cu=%%CLICK_URL%%    →  searchParams.get('cu') === '%%CLICK_URL%%'
 *
 * The second `%` plus the macro name's first two letters form a percent-escape
 * whenever those letters are a valid hex pair: `CA` → 0xCA → invalid UTF-8 →
 * U+FFFD. `CL` is not a hex pair, so that macro survives. Damage therefore
 * depends on the macro's name, `href` still looks intact, and nothing throws.
 * Measured identically on Node (ada), Chrome (GURL) and Firefox (rust-url).
 *
 * So `_raw` is read straight from `url.search` without decoding, and decoded
 * values stay where decoding is actually wanted (`device.ip`, `site.page`,
 * `user.id`). Comparing the two also detects the damage for free — no registry
 * of known macro syntaxes required, so unseen macros are covered too.
 */

/** Unicode replacement character — what a bad percent-escape decodes into. */
const REPLACEMENT = '�';

/**
 * Read `url.search` verbatim: no percent-decoding, no `+`→space folding.
 *
 * FIRST value wins on a repeated key, matching `decodeAuthenticatedJsonFeed`
 * and `URLSearchParams.get()`, so `_raw` cannot disagree with the signature
 * `detect()` matched on.
 *
 * @param {string} search Query string, with or without the leading `?`.
 * @returns {Object<string, string>} Key → raw value, exactly as sent.
 */
function parseRawQuery(search) {
  /** @type {Object<string, string>} */
  const raw = {};
  if (typeof search !== 'string' || search.length === 0) return raw;

  const body = search.charCodeAt(0) === 0x3f ? search.slice(1) : search;
  if (body.length === 0) return raw;

  for (const pair of body.split('&')) {
    if (pair.length === 0) continue;
    const eq = pair.indexOf('=');
    // A bare `?flag` is a present key with an empty value, same as searchParams.
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    if (key.length === 0) continue;
    if (!Object.hasOwn(raw, key)) raw[key] = value;
  }
  return raw;
}

/**
 * Find parameters that percent-decoding destroyed.
 *
 * Only reports values the decode turned into U+FFFD, not every raw/decoded
 * difference: `%20`→space and `+`→space are decoding working as intended.
 * A value that already contained U+FFFD on the wire is not damage either.
 *
 * @param {URLSearchParams} searchParams Decoded view.
 * @param {Object<string, string>} raw Verbatim view from `parseRawQuery`.
 * @returns {Array<{ key: string, raw: string, decoded: string }>}
 */
function findDecodeDamage(searchParams, raw) {
  const damaged = [];
  for (const key of Object.keys(raw)) {
    const decoded = searchParams.get(key);
    if (typeof decoded !== 'string') continue;
    if (!decoded.includes(REPLACEMENT)) continue;
    if (raw[key].includes(REPLACEMENT)) continue;
    damaged.push({ key, raw: raw[key], decoded });
  }
  return damaged;
}

module.exports = { parseRawQuery, findDecodeDamage, REPLACEMENT };
