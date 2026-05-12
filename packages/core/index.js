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
const { mirror: doMirror } = require('./mirror');
const { runRulePlugins } = require('./rules');
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
// Versions that participate in the pinning contract. `detectVersion` can
// return any of these or `UNKNOWN`; expectedVersion must match one of these
// to participate in mismatch detection. Centralised so future additions
// (e.g. 2.6-202309 revision) only need adding here.
const PINNABLE_VERSIONS = [VERSIONS.V_2_5, VERSIONS.V_2_6, VERSIONS.V_3_0];

function validate(payload, opts) {
  const o = opts || {};
  const dialect = DIALECTS[o.dialect || DEFAULT_DIALECT] || DIALECTS[DEFAULT_DIALECT];
  const locale = o.locale || FALLBACK_LOCALE;
  const disabledRules = o.disabledRules;
  // v0.38.0 — Version Pinning. Caller declares the version they're targeting
  // (e.g. "I'm writing oRTB 2.5"); we emit `version.mismatch` if detection
  // lands elsewhere. Closes the circular "version inferred from fields, but
  // fields validated against version" loop that surfaced in Round 1 of the
  // audit — without pinning, a 2.5-targeted payload that accidentally
  // includes a 2.6-only field (e.g. `device.sua`) silently flips detection
  // to 2.6 and the rogue field passes unflagged. Backwards-compatible: when
  // `expectedVersion` is absent the validator behaves exactly as before.
  const expectedVersion =
    typeof o.expectedVersion === 'string' && o.expectedVersion ? o.expectedVersion : null;

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
    // Plugin pass — modular rules from packages/core/rules/<name>/.
    // Plugins join findings BEFORE dedup+sort in finalize(), so a
    // plugin can't shadow a legacy finding accidentally. See
    // packages/core/rules/README.md for the contract.
    const pluginFindings = runRulePlugins(payload, 'ORTB_REQUEST', { dialect, version });
    if (pluginFindings.length) findings = findings.concat(pluginFindings);
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
    return finalize(
      { type: TYPES.JSON_FEED, version, findings: [] },
      'clean',
      locale,
      disabledRules,
    );
  } else {
    findings = [makeFinding('payload.unknown_type', LEVELS.ERROR, '')];
  }

  // Version pinning verdict. Only meaningful for oRTB request/response —
  // other formats (Kadam feed, JSON feed) don't carry an IAB version axis.
  // Skipped when detection itself is `unknown` (we wouldn't know what to
  // compare) or when the expected value isn't a recognised pinnable
  // version (silently ignore garbage rather than throw).
  if (
    expectedVersion &&
    PINNABLE_VERSIONS.includes(expectedVersion) &&
    version &&
    PINNABLE_VERSIONS.includes(version.version) &&
    version.version !== expectedVersion &&
    (resolvedType === TYPES.ORTB_REQUEST || resolvedType === TYPES.ORTB_RESPONSE)
  ) {
    findings.push(
      makeFinding('version.mismatch', LEVELS.WARNING, '', {
        expected: expectedVersion,
        detected: version.version,
        confidence: version.confidence,
        signals: JSON.stringify(version.signals || []),
      }),
    );
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

/**
 * Generate a canonical counterpart for a paste:
 *   BidRequest  → minimal-valid BidResponse
 *   BidResponse → minimal-valid BidRequest the response would fit
 *
 * The generator is rule-based; the output is then run through validate()
 * and crosscheck() in this wrapper as a self-test, and the rolled-up
 * counts are returned in `selfTest`. A clean self-test is the contract:
 * if generator produces output that fails its own validator, that's a
 * generator bug — surface it explicitly.
 *
 * @param {unknown} input
 * @param {{dialect?: string, locale?: string, mode?: string}} [opts]
 */
function mirror(input, opts) {
  const o = opts || {};
  const locale = o.locale || FALLBACK_LOCALE;
  const dialectSlug = typeof o.dialect === 'string' ? o.dialect : DEFAULT_DIALECT;
  const mode = o.mode === 'best-practice' ? 'best-practice' : 'minimal';

  const result = doMirror(input, { mode, dialect: dialectSlug });
  const decoratedNotes = (result.notes || []).map((n) => ({
    id: n.id,
    params: n.params || {},
    msg: resolve(n.id, n.params || {}, locale),
  }));

  if (!result.ok || !result.output) {
    return {
      ok: false,
      direction: result.direction,
      inputType: result.inputType,
      output: null,
      notes: decoratedNotes,
      mode,
      selfTest: null,
    };
  }

  // Self-test: run output back through validate() (counterpart) +
  // crosscheck() (input vs output).
  const validateRes = validate(result.output, { dialect: dialectSlug, locale });
  let req, res;
  if (result.direction === 'response_from_request') {
    req = input;
    res = result.output;
  } else {
    req = result.output;
    res = input;
  }
  const crossFindings = crosscheck(req, res, { dialect: dialectSlug, locale });

  const errorCount = validateRes.findings.filter((f) => f.level === LEVELS.ERROR).length;
  const warningCount = validateRes.findings.filter((f) => f.level === LEVELS.WARNING).length;
  const critCount = crossFindings.filter((f) => f.level === CROSS_LEVELS.CRIT).length;
  const warnCount = crossFindings.filter((f) => f.level === CROSS_LEVELS.WARN).length;
  const okCount = crossFindings.filter((f) => f.level === CROSS_LEVELS.OK).length;

  return {
    ok: true,
    direction: result.direction,
    inputType: result.inputType,
    output: result.output,
    notes: decoratedNotes,
    mode,
    selfTest: {
      validate: { status: validateRes.status, errorCount, warningCount },
      crosscheck: { critCount, warnCount, okCount },
    },
  };
}

const { decodeCategory, decodeCategories, extractAllCategories } = require('./categories');

module.exports = {
  validate,
  crosscheck,
  mirror,
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
