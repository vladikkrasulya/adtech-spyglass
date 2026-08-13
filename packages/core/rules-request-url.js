'use strict';

/**
 * URL-style request validator.
 *
 * Operates on the canonical request shape produced by
 * `decoders/request/<variant>/`. Unlike `rules-request.js` (oRTB JSON
 * BidRequest), this side has no IAB spec to cross-reference — findings
 * are pragmatic: what we've seen exchanges reject, and what makes a
 * pasted URL trivially malformed.
 *
 * Skeleton scope (2026-05-21): four base findings that fired on the
 * first url-linkfeed sample. Format-specific rule packs go into
 * `dialects/<vendor>.js` later, mirroring the oRTB dialect pattern —
 * this file stays vendor-neutral and works off the canonical shape.
 *
 * Add a finding: emit it from validateUrlRequest(); add the id to
 * `messages/<locale>.json` so the UI has localized text.
 */

const { LEVELS, makeFinding } = require('./findings');

const F = makeFinding;

const CH_FIELDS_REQUIRE_NONEMPTY = ['ch-platformv', 'ch-model'];

/**
 * Validate a canonical URL-style request.
 *
 * @param {Object} canonical  Output of decodeRequest() — see
 *                            `decoders/request/_canonical.js`.
 * @returns {{ findings: Array<Object> }}
 */
function validateUrlRequest(canonical) {
  const findings = [];
  if (!canonical || typeof canonical !== 'object') {
    findings.push(F('request.url.decode_failed', LEVELS.ERROR, ''));
    return { findings };
  }

  const raw = canonical._raw || {};

  // Plain HTTP can work server-to-server, but query parameters are exposed
  // in transit and browser-side calls from an HTTPS page may be rejected as
  // mixed content. Do not include the URL (and therefore credentials or
  // account identifiers) in the finding.
  try {
    if (new URL(canonical.url).protocol === 'http:') {
      // No path on purpose: URL finding locations currently resolve query
      // parameter names. Using `url` here would jump to the nested `url=`
      // referrer parameter instead of the request's `http:` scheme.
      findings.push(F('request.url.insecure_http', LEVELS.WARNING, ''));
    }
  } catch {
    // A decoder-produced canonical should always contain a valid URL. The
    // decode_failed branch owns malformed input; keep this validator total
    // for hand-built canonicals used by API consumers.
  }

  // IPv6 in user_ip — many SSPs only accept IPv4. INFO not WARNING because
  // The link-feed endpoint handles IPv6 fine; the signal is "verify your downstream
  // chain handles v6". When we observe vendor-specific intolerance we'll
  // promote to WARNING in that vendor's dialect.
  if (canonical.device && canonical.device.ipv6) {
    findings.push(
      F('request.url.user_ip_ipv6', LEVELS.INFO, 'device.ipv6', {
        ip: canonical.device.ipv6,
      }),
    );
  }

  // Client Hints fields present-but-empty. Sec-CH-UA spec: a sent field
  // must have a non-empty value; empty is a serialization bug, not "I
  // don't know" (omit the key for "unknown").
  for (const k of CH_FIELDS_REQUIRE_NONEMPTY) {
    if (k in raw && (raw[k] == null || raw[k] === '')) {
      findings.push(F('request.url.ch_field_empty', LEVELS.WARNING, k, { field: k }));
    }
  }

  // `ch-uafull` with surrounding quotes (`"147.0.7727.137"`). Sec-CH-UA-
  // Full-Version is a token, not a structured-field string — quotes are a
  // common client bug that some validators reject.
  if (typeof raw['ch-uafull'] === 'string' && /^".*"$/.test(raw['ch-uafull'])) {
    findings.push(
      F('request.url.ch_uafull_quoted', LEVELS.INFO, 'ch-uafull', {
        value: raw['ch-uafull'],
      }),
    );
  }

  // `url=` ends with a bare `?`. Trailing question mark is ambiguous — some
  // parsers split it as the start of a nested query and lose the rest.
  if (typeof raw.url === 'string' && raw.url.endsWith('?')) {
    findings.push(F('request.url.url_trailing_questionmark', LEVELS.WARNING, 'url'));
  }

  return { findings };
}

module.exports = { validateUrlRequest };
