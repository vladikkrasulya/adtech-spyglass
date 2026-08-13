'use strict';

/**
 * Decode the query fields shared by authenticated JSON-feed GET endpoints.
 *
 * The endpoint-specific modules own detection. Keeping the field mapping
 * here prevents `/link` and `/search` variants of the same wire family from
 * drifting while still letting each decoder use a precise path signature.
 */

const { makeCanonicalUrlRequest } = require('./_canonical');
const { parseRawQuery, findDecodeDamage } = require('./_raw-query');

function isIPv6(s) {
  return typeof s === 'string' && s.includes(':');
}

function decodeAuthenticatedJsonFeed(id, text, parsedUrl, opts) {
  const can = makeCanonicalUrlRequest(id, text);
  can.endpoint = `${parsedUrl.hostname}${parsedUrl.pathname}`;
  if (opts && opts.format) can.format = opts.format;

  const q = parsedUrl.searchParams;
  // Read `_raw` off the query string itself, not off `q`. FIRST value wins on a
  // repeated key, because that is what detect() matched on (`q.get()` returns
  // the first). Last-wins here let one extra `&format=cu` at the end overwrite
  // the `format=json` that detection saw: `_raw` then disagreed with the
  // signature and format-detect read the overwritten value, re-labelling the
  // feed `pops` — the exact label this decoder family exists to avoid. One
  // query string, one reading.
  const raw = parseRawQuery(parsedUrl.search);
  can._raw = raw;

  // Unexpanded feed macros can decode into U+FFFD without throwing, so say so
  // rather than letting a mangled value pass as the operator's own input.
  for (const { key, decoded } of findDecodeDamage(q, raw)) {
    can.warnings.push({
      code: 'query_value_decode_damage',
      param: key,
      detail: `Percent-decoding replaced bytes in "${key}"; raw value preserved in _raw.`,
      decoded,
    });
  }

  const ip = q.get('user_ip');
  if (ip) {
    if (isIPv6(ip)) can.device.ipv6 = ip;
    else can.device.ip = ip;
  }

  const ua = q.get('ua');
  if (ua) can.device.ua = ua;

  const lang = q.get('lang');
  if (lang) can.device.language = lang;

  const sua = {};
  if (q.get('ch-ua')) sua.brands = q.get('ch-ua');
  if (q.get('ch-uafull')) sua.fullVersion = q.get('ch-uafull');
  if (q.get('ch-platform')) sua.platform = q.get('ch-platform');
  if (q.get('ch-platformv')) sua.platformVersion = q.get('ch-platformv');
  if (q.get('ch-mobile')) sua.mobile = q.get('ch-mobile');
  if (q.get('ch-model')) sua.model = q.get('ch-model');
  if (Object.keys(sua).length) can.device.sua = sua;

  const refUrl = q.get('url');
  if (refUrl) can.site.page = refUrl;

  const subid = q.get('subid');
  if (subid) can.user.id = subid;

  return can;
}

module.exports = { decodeAuthenticatedJsonFeed };
