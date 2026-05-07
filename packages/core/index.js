'use strict';

/**
 * Spyglass validator — public API.
 *
 *   validate(payload, { dialect, locale })   → { type, status, findings }
 *   crosscheck(req, res, { locale })         → [findings]
 *   detectType(payload)                      → string
 *   listDialects()                           → ['iab', 'kadam', …]
 *
 * Findings have a stable `id` (e.g. `'imp.banner.size_required'`), structured
 * `params` for interpolation, the JSON `path` they apply to, the spec section
 * URL `specRef`, and a localized `msg` resolved at presentation time. The
 * underlying rule files emit i18n-neutral findings; this module decorates
 * them on the way out.
 *
 * Why this surface:
 *   - Browser-side validation in the public demo (no Node-only deps)
 *   - Server-side `/api/analyze` (this module is what server.js requires)
 *   - CLI / CI mode in Phase 6 (same module wrapped by @spyglass/cli)
 */

const { detectType, detectVersion, TYPES, VERSIONS } = require('./detect');
const { validateRequest } = require('./rules-request');
const { validateResponse } = require('./rules-response');
const { validateFeedResponse } = require('./rules-feed');
const { crosscheck: doCrosscheck, nativeAssetCrosscheck } = require('./crosscheck');
const { LEVELS, CROSS_LEVELS, makeFinding, rollupStatus } = require('./findings');
const { resolve, listLocales, FALLBACK_LOCALE } = require('./messages');

const dialectIab = require('./dialects/iab');
const dialectKadam = require('./dialects/kadam');
const dialectKadamInPagePush = require('./dialects/kadam-inpage-push');
const specRefs = require('./spec-refs.json');

const DIALECTS = {
  iab: dialectIab,
  kadam: dialectKadam,
  'kadam-inpage-push': dialectKadamInPagePush,
};
const DEFAULT_DIALECT = 'iab';

/**
 * Validate a pasted payload. Auto-detects type. Returns a result object with
 * a top-level rollup `status` and a list of decorated `findings`.
 *
 * @param {unknown} payload
 * @param {{dialect?: string, locale?: string}} [opts]
 */
function validate(payload, opts) {
  const o = opts || {};
  const dialect = DIALECTS[o.dialect || DEFAULT_DIALECT] || DIALECTS[DEFAULT_DIALECT];
  const locale = o.locale || FALLBACK_LOCALE;

  if (payload == null || typeof payload !== 'object') {
    return finalize(
      {
        type: TYPES.UNKNOWN,
        version: detectVersion(payload),
        findings: [makeFinding('payload.invalid_root', LEVELS.ERROR, '')],
      },
      'invalid',
      locale,
    );
  }

  const t = detectType(payload);
  const version = detectVersion(payload);
  let findings = [];
  let resolvedType = t;

  if (t === TYPES.ORTB_REQUEST) {
    findings = validateRequest(payload, { dialect, version });
  } else if (t === TYPES.ORTB_RESPONSE) {
    findings = validateResponse(payload, { dialect, version });
  } else if (t === TYPES.KADAM_FEED) {
    const r = validateFeedResponse(payload);
    findings = r.findings;
    resolvedType = r.type;
  } else if (t === TYPES.JSON_FEED) {
    return finalize({ type: TYPES.JSON_FEED, version, findings: [] }, 'clean', locale);
  } else {
    findings = [makeFinding('payload.unknown_type', LEVELS.ERROR, '')];
  }

  return finalize({ type: resolvedType, version, findings }, null, locale);
}

/**
 * Semantic crosscheck. Uses {@link doCrosscheck} for the rule logic and
 * decorates findings the same way validate() does.
 *
 * @param {object} req
 * @param {object} res
 * @param {{locale?: string}} [opts]
 */
function crosscheck(req, res, opts) {
  const o = opts || {};
  const locale = o.locale || FALLBACK_LOCALE;
  const findings = doCrosscheck(req, res);
  return findings.map((f) => decorate(f, locale));
}

function finalize(result, statusOverride, locale) {
  const decorated = result.findings.map((f) => decorate(f, locale));
  const status = statusOverride || rollupStatus(result.findings);
  return { type: result.type, version: result.version, status, findings: decorated };
}

function decorate(f, locale) {
  return Object.assign({}, f, {
    specRef: specRefs[f.id] || null,
    msg: resolve(f.id, f.params, locale),
  });
}

function listDialects() {
  return Object.keys(DIALECTS);
}

const { decodeCategory, decodeCategories, extractAllCategories } = require('./categories');

module.exports = {
  validate,
  crosscheck,
  detectType,
  detectVersion,
  listDialects,
  listLocales,
  // IAB Content Taxonomy lookup — bundled English labels.
  decodeCategory,
  decodeCategories,
  extractAllCategories,
  // re-exports for advanced usage / testing
  TYPES,
  VERSIONS,
  LEVELS,
  CROSS_LEVELS,
  nativeAssetCrosscheck,
};
