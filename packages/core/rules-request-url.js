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
 * Decoder warning codes this file knows how to phrase, keyed by the `code`
 * a decoder puts in `canonical.warnings[]`.
 *
 * Absence from this table is not silence — see the unmapped branch in
 * `emitDecoderWarnings()`. Adding an entry upgrades a generic report to a
 * specific one; it is never what makes the warning visible in the first place.
 *
 * Each entry spells its finding id as a literal inside `F(...)` rather than
 * storing it as a table field. `tests/spec-refs.test.js` discovers ids by
 * grepping for exactly that call shape, so an id handed over as data would be
 * invisible to the coverage gate — an untracked finding, which is the same
 * kind of hole this rule exists to close.
 *
 * @type {Object<string, (path: string, params: Object) => Object>}
 */
const WARNING_FINDINGS = {
  // Percent-decoding replaced bytes with U+FFFD. The wire value survives in
  // `_raw`, so the request is still usable — this reports damage to the
  // decoded projection, not grounds to reject.
  query_value_decode_damage: (path, params) =>
    F('request.url.query_value_decode_damage', LEVELS.WARNING, path, params),

  // `&amp;` followed by `amp;`: the input looks double-escaped. Left alone on
  // purpose — whether the sender escaped twice or a parameter is genuinely
  // named `amp;b` is not recoverable from the bytes, and ambiguous structure
  // is not guessed at.
  query_double_escaped_entity: (path, params) =>
    F('request.url.query_double_escaped_entity', LEVELS.WARNING, path, params),
};

/**
 * Turn `canonical.warnings[]` into findings.
 *
 * Decoders have been writing this array since the first URL decoder landed and
 * nothing has ever read it. A warning that reaches no one is not a warning —
 * it is the silent failure this validator exists to surface, one layer up. So
 * every entry produces a finding.
 *
 * Unknown codes are reported verbatim rather than dropped. Dropping them would
 * mean a decoder that learns a new warning goes quiet until this file catches
 * up, which is the same defect wearing a different hat. Staying quiet has to be
 * a decision someone wrote down, not the default for anything unrecognized.
 *
 * @param {Array<Object>} warnings
 * @param {Object} raw  `canonical._raw` — the values as sent.
 * @returns {Array<Object>} findings
 */
function emitDecoderWarnings(warnings, raw) {
  /** @type {Array<Object>} */
  const out = [];
  if (!Array.isArray(warnings)) return out;

  for (const w of warnings) {
    if (!w || typeof w !== 'object') continue;
    const param = typeof w.param === 'string' ? w.param : '';
    const build = WARNING_FINDINGS[w.code];

    if (build) {
      // `raw` is the source of truth; the decoded value is the lossy side.
      // Show both so the operator can see what the damage actually did rather
      // than being told damage occurred.
      out.push(
        build(param, {
          param,
          raw: typeof raw[param] === 'string' ? raw[param] : '',
          decoded: typeof w.decoded === 'string' ? w.decoded : '',
        }),
      );
      continue;
    }

    // WARNING, not INFO, on purpose: `rollupStatus()` folds an info-only result
    // into `clean`, and a clean badge over input a decoder flagged is exactly
    // the green-status-over-mutated-value failure this work removes. An
    // unmapped code should also be mildly annoying — that is what gets it
    // mapped.
    out.push(
      F('request.url.decoder_warning', LEVELS.WARNING, param, {
        code: typeof w.code === 'string' && w.code ? w.code : 'unknown',
        detail: typeof w.detail === 'string' ? w.detail : '',
      }),
    );
  }
  return out;
}

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

  findings.push(...emitDecoderWarnings(canonical.warnings, raw));

  return { findings };
}

module.exports = { validateUrlRequest };
