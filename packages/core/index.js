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
const { detectFormat, FORMATS, CONTEXTS, PROTOCOLS } = require('./format-detect');
const { validateRequest } = require('./rules-request');
const { validateRequest30 } = require('./rules-request-30');
const { validateResponse } = require('./rules-response');
const { validateResponse30 } = require('./rules-response-30');
const { validateFeedResponse } = require('./rules-feed');
const { crosscheck: doCrosscheck, nativeAssetCrosscheck } = require('./crosscheck');
const {
  LEVELS,
  CROSS_LEVELS,
  makeFinding,
  rollupStatus,
  sortFindings,
  dedupFindings,
  applyDisabledRules,
} = require('./findings');
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
 * Findings are returned in deterministic order (severity DESC → path ASC →
 * id ASC) and deduplicated: repeated (id, path) pairs collapse to one
 * finding with a `count` param. Pass `disabledRules` to suppress specific
 * ids — exact ('imp.id_required') or '*'-suffixed prefix ('regs.*').
 *
 * @param {unknown} payload
 * @param {{dialect?: string, locale?: string, disabledRules?: string[]}} [opts]
 */
function validate(payload, opts) {
  const o = opts || {};
  const dialect = DIALECTS[o.dialect || DEFAULT_DIALECT] || DIALECTS[DEFAULT_DIALECT];
  const locale = o.locale || FALLBACK_LOCALE;
  const disabledRules = o.disabledRules;

  if (payload == null || typeof payload !== 'object') {
    return finalize(
      {
        type: TYPES.UNKNOWN,
        version: detectVersion(payload),
        findings: [makeFinding('payload.invalid_root', LEVELS.ERROR, '')],
      },
      'invalid',
      locale,
      disabledRules,
    );
  }

  const t = detectType(payload);
  const version = detectVersion(payload);
  let findings = [];
  let resolvedType = t;

  if (t === TYPES.ORTB_REQUEST) {
    // 3.0 envelope is structurally distinct from 2.x — `imp[]` becomes
    // `item[]` under `openrtb.request`. Running 2.x rules against a 3.0
    // payload produces wholly irrelevant findings ("imp_required",
    // "no_site_or_app", etc.) so we route by version BEFORE rule dispatch.
    if (version && version.version === VERSIONS.V_3_0) {
      findings = validateRequest30(payload, { dialect });
    } else {
      findings = validateRequest(payload, { dialect, version });
    }
  } else if (t === TYPES.ORTB_RESPONSE) {
    // Same version dispatch on the response side. 3.0 BidResponse lives
    // under `openrtb.response` and uses `bid.item` (not 2.x `bid.impid`).
    if (version && version.version === VERSIONS.V_3_0) {
      findings = validateResponse30(payload);
    } else {
      findings = validateResponse(payload, { dialect, version });
    }
  } else if (t === TYPES.KADAM_FEED) {
    const r = validateFeedResponse(payload);
    findings = r.findings;
    resolvedType = r.type;
  } else if (t === TYPES.JSON_FEED) {
    return finalize({ type: TYPES.JSON_FEED, version, findings: [] }, 'clean', locale, disabledRules);
  } else {
    findings = [makeFinding('payload.unknown_type', LEVELS.ERROR, '')];
  }

  return finalize({ type: resolvedType, version, findings }, null, locale, disabledRules);
}

/**
 * Semantic crosscheck. Uses {@link doCrosscheck} for the rule logic and
 * decorates findings the same way validate() does. Output is deduplicated
 * and sorted by the same contract.
 *
 * @param {object} req
 * @param {object} res
 * @param {{locale?: string, dialect?: string, disabledRules?: string[]}} [opts]
 */
function crosscheck(req, res, opts) {
  const o = opts || {};
  const locale = o.locale || FALLBACK_LOCALE;
  // Resolve dialect the same way validate() does — opts.dialect may be a
  // string slug ('iab' / 'kadam' / ...) coming from the HTTP layer or an
  // already-resolved dialect object from internal callers.
  const dialect =
    typeof o.dialect === 'string'
      ? DIALECTS[o.dialect] || DIALECTS[DEFAULT_DIALECT]
      : o.dialect || DIALECTS[DEFAULT_DIALECT];
  // doCrosscheck() is currently dialect-independent (the schema-level
  // alignment rules are spec-agnostic), but the parameter is forwarded
  // so future dialect-aware crosscheck rules can pick it up without
  // changing the public surface.
  let findings = doCrosscheck(req, res, { dialect });
  findings = applyDisabledRules(findings, o.disabledRules);
  findings = dedupFindings(findings);
  findings = sortFindings(findings);
  return findings.map((f) => decorate(f, locale));
}

function finalize(result, statusOverride, locale, disabledRules) {
  let raw = applyDisabledRules(result.findings, disabledRules);
  raw = dedupFindings(raw);
  raw = sortFindings(raw);
  const decorated = raw.map((f) => decorate(f, locale));
  const status = statusOverride || rollupStatus(raw);
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
  detectFormat,
  listDialects,
  listLocales,
  // IAB Content Taxonomy lookup — bundled English labels.
  decodeCategory,
  decodeCategories,
  extractAllCategories,
  // re-exports for advanced usage / testing
  TYPES,
  VERSIONS,
  FORMATS,
  CONTEXTS,
  PROTOCOLS,
  LEVELS,
  CROSS_LEVELS,
  nativeAssetCrosscheck,
};
