'use strict';

const { parsePointer } = require('./patch');
const { CONSISTENCY_RULES } = require('./oracle');

/**
 * tests/corpus/lib/schema.js — the shape of one verification-corpus case.
 *
 * A case is one JSON file. It is either a BASE PAIR (a valid request and its
 * valid response for one ad format, with spec-grounded expectations) or a
 * MUTATION (a patch applied to a base pair that must produce specific
 * findings). The runner refuses a case that does not satisfy this schema, so
 * every author writes the same vocabulary and the matrix can be derived from
 * metadata alone.
 *
 * Hand-written checks rather than a JSON-Schema dependency: the repository
 * has no schema library and the constitution asks for no new cross-cutting
 * dependency without an ADR.
 *
 * Expectations are written from the IAB specification or the documented
 * dialect, never copied from the current implementation output. When the
 * implementation is known to deviate, the case names the gap in `knownGap`
 * and the ledger in `known-gaps.json` owns the defect record.
 */

const FORMATS = ['banner', 'video', 'audio', 'native', 'push', 'pop', 'inpage'];
const PROTOCOLS = ['ortb-2.5', 'ortb-2.6', 'ortb-3.0', 'jsonfeed', 'url-request'];
const CONTEXTS = ['web', 'inapp', 'ctv', 'dooh', 'n/a'];
const DIALECTS = ['iab', 'ext-rtb', 'inpage-push'];
const SCENARIOS = ['pair', 'request-only', 'response-only'];
const STATUSES = ['clean', 'warnings', 'errors', 'invalid'];
const LEVELS = ['error', 'warning', 'info', 'question'];
const CROSS_LEVELS = ['crit', 'warn', 'ok'];
const PREVIEW_KINDS = [
  'markup',
  'native',
  'push',
  'vast',
  'json',
  'url',
  'unidentified',
  'empty',
  'n/a',
];
const PREVIEW_RENDERED = ['full', 'partial', 'inert-text', 'empty', 'n/a'];
const MEDIA = ['yes', 'no', 'n/a'];
const MUTATION_CATEGORIES = [
  'input-shape',
  'identity',
  'multiplicity',
  'format-mismatch',
  'media-constraints',
  'commercial',
  'field-shape',
  'encoding-limits',
];
const PATCH_OPS = ['add', 'replace', 'remove'];
const PARSE_STATES = ['ok', 'invalid-json'];

// Unknown keys are rejected everywhere: a typo such as `mustNto` would
// otherwise turn an assertion into silence.
const CASE_KEYS = new Set([
  'kind',
  'id',
  'title',
  'format',
  'protocol',
  'context',
  'dialect',
  'scenario',
  'tags',
  'provenance',
  'request',
  'response',
  'expect',
  'knownGap',
  'specNotes',
  'notes',
  'base',
  'category',
  'specRef',
  'patch',
  'reference',
  'assetRefs',
]);
const EXPECT_KEYS = new Set([
  'request',
  'response',
  'crosscheck',
  'format',
  'consistency',
  'http',
  'preview',
  'browser',
]);
const SIDE_KEYS = new Set([
  'type',
  'version',
  'status',
  'maxLevel',
  'parse',
  'must',
  'mustNot',
  'mustNotPrefix',
  'mustIssueAt',
]);
const CROSS_KEYS = new Set(['must', 'mustNot', 'mustNotPrefix', 'mustIssueAt', 'empty']);
const FORMAT_KEYS = new Set(['formats', 'contexts', 'protocols']);
const HTTP_KEYS = new Set(['status', 'code']);
const BROWSER_KEYS = new Set(['state', 'verdict', 'toastMatch', 'sandboxRefusals']);
const SANDBOX_REFUSAL_KINDS = ['popup', 'navigation'];
const PREVIEW_KEYS = new Set([
  'kind',
  'rendered',
  'mediaPlays',
  'assets',
  'limitation',
  'capabilityGap',
  'marker',
  'bids',
]);
const BID_PREVIEW_KEYS = new Set(
  [...PREVIEW_KEYS].filter((k) => k !== 'bids').concat(['seatIndex', 'bidIndex']),
);
const FINDING_KEYS = new Set(['id', 'path', 'level', 'params', 'ok', 'side', 'count']);
const REFERENCE_KEYS = new Set([
  'wireProtocol',
  'vendorDialect',
  'validity',
  'pairApplicability',
  'sourceIds',
  'archiveSha256',
]);
const GAP_KEYS = new Set(['id', 'layers', 'note', 'matches']);
const PROVENANCE_KEYS = new Set(['synthetic', 'source', 'modifications', 'sanitized', 'notes']);
const SOURCE_KEYS = new Set(['name', 'url', 'version', 'license', 'notes', 'path']);
const PATCH_KEYS = new Set([
  'request',
  'response',
  'replaceRequest',
  'replaceResponse',
  'rawRequest',
  'rawResponse',
]);

/**
 * @param {unknown} obj
 * @param {Set<string>} allowed
 * @param {string} where
 * @param {string[]} errors
 */
function checkKeys(obj, allowed, where, errors) {
  if (!isObj(obj)) return;
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k))
      errors.push(`${where}: unknown key "${k}" (allowed: ${[...allowed].join(', ')})`);
  }
}

/**
 * @param {unknown} side
 * @returns {boolean} whether the side expectation asserts anything at all
 */
function sideAssertsSomething(side) {
  if (!isObj(side)) return false;
  return (
    ['type', 'version', 'status', 'maxLevel', 'parse'].some((k) => side[k] !== undefined) ||
    ['must', 'mustNot', 'mustNotPrefix', 'mustIssueAt'].some(
      (k) => Array.isArray(side[k]) && side[k].length > 0,
    )
  );
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function isObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @param {unknown[]} list
 * @param {string} where
 * @param {string[]} errors
 */
function checkFindingRefs(list, where, errors) {
  list.forEach((ref, i) => {
    if (typeof ref === 'string' && ref.trim()) return;
    if (!isObj(ref) || typeof ref.id !== 'string' || !ref.id) {
      errors.push(`${where}[${i}]: must be an id string or {id, path?, level?}`);
      return;
    }
    checkKeys(ref, FINDING_KEYS, `${where}[${i}]`, errors);
    if (ref.path !== undefined && typeof ref.path !== 'string') {
      errors.push(`${where}[${i}].path: must be a string`);
    }
    if (
      ref.level !== undefined &&
      !LEVELS.includes(ref.level) &&
      !CROSS_LEVELS.includes(ref.level)
    ) {
      errors.push(`${where}[${i}].level: unknown level ${String(ref.level)}`);
    }
    if (ref.params !== undefined && !isObj(ref.params))
      errors.push(`${where}[${i}].params: object`);
    if (ref.ok !== undefined && typeof ref.ok !== 'boolean')
      errors.push(`${where}[${i}].ok: boolean`);
    if (ref.side !== undefined && !['request', 'response', 'crosscheck'].includes(ref.side))
      errors.push(`${where}[${i}].side: request|response|crosscheck`);
    if (ref.count !== undefined && (!Number.isInteger(ref.count) || ref.count < 1))
      errors.push(`${where}[${i}].count: positive integer`);
  });
}

/**
 * @param {unknown} side
 * @param {string} where
 * @param {string[]} errors
 * @param {boolean} cross
 */
function checkSideExpect(side, where, errors, cross) {
  if (side === undefined) return;
  if (!isObj(side)) {
    errors.push(`${where}: must be an object`);
    return;
  }
  checkKeys(side, cross ? CROSS_KEYS : SIDE_KEYS, where, errors);
  if (cross && side.empty !== undefined && side.empty !== true) {
    errors.push(`${where}.empty: must be true when present`);
  }
  if (cross && side.empty === true && (side.must?.length || side.mustIssueAt?.length))
    errors.push(`${where}: empty conflicts with required findings`);
  if (!cross) {
    if (side.parse === 'invalid-json' && Object.keys(side).some((key) => key !== 'parse'))
      errors.push(`${where}: invalid-json cannot also assert unexecuted Core semantics`);
    if (side.type !== undefined && typeof side.type !== 'string') {
      errors.push(`${where}.type: must be a string`);
    }
    if (side.version !== undefined && typeof side.version !== 'string') {
      errors.push(`${where}.version: must be a string`);
    }
    if (side.status !== undefined && !STATUSES.includes(side.status)) {
      errors.push(`${where}.status: must be one of ${STATUSES.join('|')}`);
    }
    if (side.maxLevel !== undefined && !LEVELS.includes(side.maxLevel)) {
      errors.push(`${where}.maxLevel: must be one of ${LEVELS.join('|')}`);
    }
    if (side.parse !== undefined && !PARSE_STATES.includes(side.parse)) {
      errors.push(`${where}.parse: must be one of ${PARSE_STATES.join('|')}`);
    }
  }
  for (const key of ['must', 'mustNot']) {
    if (side[key] === undefined) continue;
    if (!Array.isArray(side[key])) {
      errors.push(`${where}.${key}: must be an array`);
      continue;
    }
    checkFindingRefs(side[key], `${where}.${key}`, errors);
    if (key === 'mustNot' && side[key].some((ref) => isObj(ref) && ref.count !== undefined))
      errors.push(`${where}.mustNot: count is only meaningful for required findings`);
  }
  if (side.mustNotPrefix !== undefined) {
    if (
      !Array.isArray(side.mustNotPrefix) ||
      side.mustNotPrefix.some((p) => typeof p !== 'string' || !p)
    ) {
      errors.push(`${where}.mustNotPrefix: must be an array of strings`);
    }
  }
  if (
    side.mustIssueAt !== undefined &&
    (!Array.isArray(side.mustIssueAt) ||
      !side.mustIssueAt.length ||
      side.mustIssueAt.some((p) => typeof p !== 'string' || !p))
  )
    errors.push(`${where}.mustIssueAt: nonempty array of exact finding paths`);
}

/** @param {any} pv @param {string} where @param {string[]} errors @param {boolean} [bid] */
function checkPreview(pv, where, errors, bid = false) {
  if (!isObj(pv)) {
    errors.push(`${where}: object`);
    return;
  }
  checkKeys(pv, bid ? BID_PREVIEW_KEYS : PREVIEW_KEYS, where, errors);
  if ((!bid || pv.kind !== undefined) && !PREVIEW_KINDS.includes(pv.kind))
    errors.push(`${where}.kind: one of ${PREVIEW_KINDS.join('|')}`);
  if ((!bid || pv.rendered !== undefined) && !PREVIEW_RENDERED.includes(pv.rendered))
    errors.push(`${where}.rendered: one of ${PREVIEW_RENDERED.join('|')}`);
  if ((!bid || pv.mediaPlays !== undefined) && !MEDIA.includes(pv.mediaPlays))
    errors.push(`${where}.mediaPlays: one of ${MEDIA.join('|')}`);
  for (const key of ['limitation', 'capabilityGap']) {
    if (pv[key] !== undefined && pv[key] !== null && (typeof pv[key] !== 'string' || !pv[key]))
      errors.push(`${where}.${key}: nonempty string or null`);
  }
  if (pv.marker !== undefined && (typeof pv.marker !== 'string' || !pv.marker))
    errors.push(`${where}.marker: nonempty string`);
  if (
    pv.assets !== undefined &&
    (!isObj(pv.assets) || Object.values(pv.assets).some((v) => !Number.isInteger(v) || v < 0))
  )
    errors.push(`${where}.assets: object of nonnegative integer counts`);
  if (bid) {
    for (const k of ['seatIndex', 'bidIndex'])
      if (!Number.isInteger(pv[k]) || pv[k] < 0) errors.push(`${where}.${k}: nonnegative integer`);
    if (typeof pv.marker !== 'string' || !pv.marker)
      errors.push(`${where}.marker: nonempty string required for each selected bid`);
  } else if (pv.bids !== undefined) {
    if (!Array.isArray(pv.bids) || !pv.bids.length) errors.push(`${where}.bids: nonempty array`);
    else {
      const indices = new Set();
      pv.bids.forEach((b, i) => {
        checkPreview(b, `${where}.bids[${i}]`, errors, true);
        if (!isObj(b)) return;
        const key = `${b.seatIndex}:${b.bidIndex}`;
        if (indices.has(key)) errors.push(`${where}.bids: duplicate bid indices ${key}`);
        indices.add(key);
      });
    }
  }
}

/**
 * Validate one case object. Returns a list of human-readable problems; an
 * empty list means the case is well-formed.
 *
 * @param {unknown} c
 * @returns {string[]}
 */
function validateCase(c) {
  /** @type {string[]} */
  const errors = [];
  if (!isObj(c)) return ['case: must be a JSON object'];
  const kind = c.kind;
  if (kind !== 'pair' && kind !== 'mutation') {
    errors.push('kind: must be "pair" or "mutation"');
    return errors;
  }
  checkKeys(c, CASE_KEYS, 'case', errors);
  if (typeof c.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(c.id)) {
    errors.push('id: lowercase kebab-case, 3-81 chars');
  }
  if (typeof c.title !== 'string' || c.title.length < 8) {
    errors.push('title: a human sentence (>= 8 chars) describing what makes this case distinct');
  }
  if (!FORMATS.includes(c.format)) errors.push(`format: one of ${FORMATS.join('|')}`);
  if (!PROTOCOLS.includes(c.protocol)) errors.push(`protocol: one of ${PROTOCOLS.join('|')}`);
  if (!CONTEXTS.includes(c.context)) errors.push(`context: one of ${CONTEXTS.join('|')}`);
  if (!DIALECTS.includes(c.dialect)) errors.push(`dialect: one of ${DIALECTS.join('|')}`);
  if (!SCENARIOS.includes(c.scenario)) errors.push(`scenario: one of ${SCENARIOS.join('|')}`);
  if (
    c.tags !== undefined &&
    (!Array.isArray(c.tags) || c.tags.some((t) => typeof t !== 'string'))
  ) {
    errors.push('tags: array of strings');
  }
  if (
    c.assetRefs !== undefined &&
    (!Array.isArray(c.assetRefs) || c.assetRefs.some((id) => typeof id !== 'string' || !id))
  )
    errors.push('assetRefs: array of nonempty asset ids');
  if (c.reference !== undefined) {
    const r = c.reference;
    if (!isObj(r)) errors.push('reference: object');
    else {
      checkKeys(r, REFERENCE_KEYS, 'reference', errors);
      for (const key of ['wireProtocol', 'vendorDialect'])
        if (typeof r[key] !== 'string' || !r[key]) errors.push(`reference.${key}: nonempty string`);
      if (!['valid', 'vendor-valid', 'documented-reference'].includes(r.validity))
        errors.push('reference.validity: valid|vendor-valid|documented-reference');
      if (typeof r.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.archiveSha256))
        errors.push('reference.archiveSha256: lowercase SHA-256');
      if (
        !Array.isArray(r.sourceIds) ||
        !r.sourceIds.length ||
        r.sourceIds.some((id) => typeof id !== 'string' || !id)
      )
        errors.push('reference.sourceIds: nonempty source id array');
      if (!isObj(r.pairApplicability)) errors.push('reference.pairApplicability: object');
      else {
        checkKeys(
          r.pairApplicability,
          new Set(['kind', 'note']),
          'reference.pairApplicability',
          errors,
        );
        if (
          ![
            'bid-pair',
            'vendor-request-response',
            'request-only-reference',
            'response-only-reference',
          ].includes(r.pairApplicability.kind)
        )
          errors.push(
            'reference.pairApplicability.kind: bid-pair|vendor-request-response|request-only-reference|response-only-reference',
          );
        if (r.pairApplicability.kind === 'request-only-reference' && c.scenario !== 'request-only')
          errors.push(
            'reference.pairApplicability.kind: request-only-reference requires request-only scenario',
          );
        if (
          r.pairApplicability.kind === 'response-only-reference' &&
          c.scenario !== 'response-only'
        )
          errors.push(
            'reference.pairApplicability.kind: response-only-reference requires response-only scenario',
          );
        if (r.pairApplicability.note !== undefined && typeof r.pairApplicability.note !== 'string')
          errors.push('reference.pairApplicability.note: string');
      }
    }
  }

  if (kind === 'pair') {
    const p = c.provenance;
    if (!isObj(p)) {
      errors.push('provenance: required object');
    } else {
      checkKeys(p, PROVENANCE_KEYS, 'provenance', errors);
      checkKeys(p.source, SOURCE_KEYS, 'provenance.source', errors);
      if (typeof p.synthetic !== 'boolean') errors.push('provenance.synthetic: boolean required');
      if (!isObj(p.source) || typeof p.source.name !== 'string') {
        errors.push('provenance.source.name: required (spec section, doc, or "synthetic")');
      } else {
        if (p.source.url !== undefined && typeof p.source.url !== 'string') {
          errors.push('provenance.source.url: string');
        }
        if (p.source.version !== undefined && typeof p.source.version !== 'string') {
          errors.push(
            'provenance.source.version: string (commit sha, spec version or access date)',
          );
        }
        if (typeof p.source.license !== 'string') {
          errors.push('provenance.source.license: required string (license or terms of use)');
        }
      }
      if (!Array.isArray(p.modifications) || p.modifications.some((m) => typeof m !== 'string')) {
        errors.push('provenance.modifications: array of strings (may be empty)');
      }
      if (typeof p.sanitized !== 'string' || !p.sanitized) {
        errors.push(
          'provenance.sanitized: statement of what PII/tracking identifiers were removed or never present',
        );
      }
    }
    const hasReq = c.request !== undefined;
    const hasRes = c.response !== undefined;
    if (c.scenario === 'pair' && !(hasReq && hasRes))
      errors.push('pair scenario: request and response required');
    if (c.scenario === 'request-only' && (!hasReq || hasRes))
      errors.push('request-only: request only');
    if (c.scenario === 'response-only' && (hasReq || !hasRes))
      errors.push('response-only: response only');
    if (hasReq && !(isObj(c.request) || typeof c.request === 'string')) {
      errors.push('request: object or URL string');
    }
    if (hasRes && !(isObj(c.response) || Array.isArray(c.response))) {
      errors.push('response: object or array');
    }
  } else {
    if (typeof c.base !== 'string') errors.push('base: id of the base pair');
    if (!MUTATION_CATEGORIES.includes(c.category)) {
      errors.push(`category: one of ${MUTATION_CATEGORIES.join('|')}`);
    }
    if (typeof c.specRef !== 'string' || c.specRef.length < 8) {
      errors.push(
        'specRef: cite the specification or documented dialect that justifies the expectation',
      );
    }
    const ops = c.patch;
    if (!isObj(ops)) {
      errors.push('patch: object with optional request/response arrays of RFC 6902 ops');
    } else {
      checkKeys(ops, PATCH_KEYS, 'patch', errors);
      if (
        !Object.keys(ops).length ||
        Object.values(ops).every((v) => Array.isArray(v) && !v.length)
      )
        errors.push('patch: must change something');
      for (const side of ['request', 'response']) {
        const supplied = [
          side,
          side === 'request' ? 'replaceRequest' : 'replaceResponse',
          side === 'request' ? 'rawRequest' : 'rawResponse',
        ].filter((key) => Object.hasOwn(ops, key));
        if (supplied.length > 1)
          errors.push(`patch.${side}: choose one patch, replacement, or raw text operation`);
        const list = ops[side];
        if (list === undefined) continue;
        if (list === null) continue; // null side = remove that side entirely
        if (!Array.isArray(list)) {
          errors.push(`patch.${side}: array of ops or null`);
          continue;
        }
        list.forEach((op, i) => {
          if (!isObj(op) || !PATCH_OPS.includes(op.op) || typeof op.path !== 'string') {
            errors.push(
              `patch.${side}[${i}]: {op: add|replace|remove, path: "/json/pointer", value?}`,
            );
          } else if (op.op !== 'remove' && !('value' in op)) {
            errors.push(`patch.${side}[${i}]: value required for ${op.op}`);
          } else {
            checkKeys(op, new Set(['op', 'path', 'value']), `patch.${side}[${i}]`, errors);
            try {
              parsePointer(op.path);
            } catch (err) {
              errors.push(`patch.${side}[${i}]: ${err.message}`);
            }
          }
        });
      }
      if (
        ops.replaceRequest !== undefined &&
        !(
          isObj(ops.replaceRequest) ||
          typeof ops.replaceRequest === 'string' ||
          ops.replaceRequest === null
        )
      ) {
        errors.push('patch.replaceRequest: object, URL string, or null');
      }
      if (
        ops.replaceResponse !== undefined &&
        !(
          isObj(ops.replaceResponse) ||
          Array.isArray(ops.replaceResponse) ||
          ops.replaceResponse === null
        )
      ) {
        errors.push('patch.replaceResponse: object, array, or null');
      }
      if (ops.rawRequest !== undefined && typeof ops.rawRequest !== 'string') {
        errors.push('patch.rawRequest: raw text (for invalid JSON cases)');
      }
      if (ops.rawResponse !== undefined && typeof ops.rawResponse !== 'string') {
        errors.push('patch.rawResponse: raw text (for invalid JSON cases)');
      }
    }
  }

  const e = c.expect;
  if (!isObj(e)) {
    errors.push('expect: required object');
  } else {
    checkKeys(e, EXPECT_KEYS, 'expect', errors);
    checkSideExpect(e.request, 'expect.request', errors, false);
    checkSideExpect(e.response, 'expect.response', errors, false);
    checkSideExpect(e.crosscheck, 'expect.crosscheck', errors, true);
    // Minimum assertions: an expectation that asserts nothing cannot fail and
    // therefore proves nothing. Transport-level error cases (HTTP 4xx) and
    // browser-only cases are the only shapes allowed to skip side assertions.
    const patch = kind === 'mutation' && isObj(c.patch) ? c.patch : {};
    const httpError = isObj(e.http) && typeof e.http.status === 'number' && e.http.status >= 400;
    const browserOnly =
      isObj(e.browser) &&
      Object.keys(e.browser).length > 0 &&
      !e.request &&
      !e.response &&
      !e.crosscheck;
    let hasReq = kind === 'pair' ? c.request !== undefined : c.scenario !== 'response-only';
    let hasRes = kind === 'pair' ? c.response !== undefined : c.scenario !== 'request-only';
    if (kind === 'mutation') {
      if (patch.request === null || patch.replaceRequest === null) hasReq = false;
      if (patch.response === null || patch.replaceResponse === null) hasRes = false;
    }
    if (!httpError && !browserOnly) {
      if (hasReq && !sideAssertsSomething(e.request)) {
        errors.push(
          'expect.request: a present request needs at least one assertion (type/version/status/maxLevel/must/mustNot/mustNotPrefix)',
        );
      }
      if (hasRes && !sideAssertsSomething(e.response)) {
        errors.push(
          'expect.response: a present response needs at least one assertion (type/version/status/maxLevel/must/mustNot/mustNotPrefix)',
        );
      }
      const pairable =
        hasReq &&
        hasRes &&
        e.request?.parse !== 'invalid-json' &&
        e.response?.parse !== 'invalid-json' &&
        (kind === 'mutation' || isObj(c.request)) &&
        (!c.reference || c.reference.pairApplicability?.kind === 'bid-pair');
      if (pairable) {
        const x = e.crosscheck;
        const ok =
          isObj(x) &&
          (x.empty === true ||
            ['must', 'mustNot', 'mustNotPrefix', 'mustIssueAt'].some(
              (k) => Array.isArray(x[k]) && x[k].length > 0,
            ));
        if (!ok)
          errors.push(
            'expect.crosscheck: a request/response pair needs crosscheck assertions (must/mustNot/mustNotPrefix or empty: true)',
          );
      }
    }
    if (e.http !== undefined) checkKeys(e.http, HTTP_KEYS, 'expect.http', errors);
    if (e.browser !== undefined) {
      checkKeys(e.browser, BROWSER_KEYS, 'expect.browser', errors);
      if (!isObj(e.browser) || !Object.keys(e.browser).length)
        errors.push('expect.browser: nonempty object');
      else {
        if (e.browser.state !== undefined && !['success', 'failed'].includes(e.browser.state)) {
          errors.push('expect.browser.state: success|failed');
        }
        if (
          e.browser.verdict !== undefined &&
          !['clean', 'risky', 'blocked', 'invalid'].includes(e.browser.verdict)
        ) {
          errors.push('expect.browser.verdict: clean|risky|blocked|invalid');
        }
        if (e.browser.toastMatch !== undefined) {
          if (typeof e.browser.toastMatch !== 'string' || !e.browser.toastMatch)
            errors.push('expect.browser.toastMatch: nonempty regex string');
          else
            try {
              new RegExp(e.browser.toastMatch);
            } catch {
              errors.push('expect.browser.toastMatch: invalid regex');
            }
        }
        if (e.browser.sandboxRefusals !== undefined) {
          if (
            !Array.isArray(e.browser.sandboxRefusals) ||
            !e.browser.sandboxRefusals.length ||
            e.browser.sandboxRefusals.some((k) => !SANDBOX_REFUSAL_KINDS.includes(k))
          ) {
            errors.push(
              `expect.browser.sandboxRefusals: non-empty array of ${SANDBOX_REFUSAL_KINDS.join('|')} — the sandbox refusal kinds this creative is expected to trigger; only the built-in Chrome refusal messages are tolerated`,
            );
          }
        }
      }
    }
    if (e.format !== undefined) {
      if (!isObj(e.format)) errors.push('expect.format: object');
      else {
        checkKeys(e.format, FORMAT_KEYS, 'expect.format', errors);
        for (const key of ['formats', 'contexts', 'protocols']) {
          if (
            e.format[key] !== undefined &&
            (!Array.isArray(e.format[key]) ||
              e.format[key].some((v) => typeof v !== 'string' || !v))
          ) {
            errors.push(`expect.format.${key}: array of nonempty strings`);
          }
        }
      }
    }
    if (e.consistency !== undefined) {
      if (
        !Array.isArray(e.consistency) ||
        e.consistency.some((r) => !Object.hasOwn(CONSISTENCY_RULES, r))
      ) {
        errors.push('expect.consistency: array of named rules');
      }
    }
    if (e.http !== undefined) {
      if (!isObj(e.http)) errors.push('expect.http: object');
      else {
        if (!Number.isInteger(e.http.status) || e.http.status < 100 || e.http.status > 599)
          errors.push('expect.http.status: HTTP status integer required');
        if (e.http.code !== undefined && (typeof e.http.code !== 'string' || !e.http.code))
          errors.push('expect.http.code: nonempty string');
      }
    }
    if (e.preview !== undefined) checkPreview(e.preview, 'expect.preview', errors);
  }

  if (c.knownGap !== undefined && c.knownGap !== null) {
    if (!isObj(c.knownGap)) {
      errors.push('knownGap: null or {id, layers: [core|http|browser], note}');
    } else {
      checkKeys(c.knownGap, GAP_KEYS, 'knownGap', errors);
      if (typeof c.knownGap.id !== 'string' || !/^DEF-\d{3}$/.test(c.knownGap.id)) {
        errors.push('knownGap.id: DEF-NNN');
      }
      if (!Array.isArray(c.knownGap.layers) || !c.knownGap.layers.length) {
        errors.push('knownGap.layers: non-empty array of core|http|browser');
      } else if (c.knownGap.layers.some((l) => !['core', 'http', 'browser'].includes(l))) {
        errors.push('knownGap.layers: values must be core|http|browser');
      }
      if (typeof c.knownGap.note !== 'string') errors.push('knownGap.note: string');
      const layers = Array.isArray(c.knownGap.layers) ? c.knownGap.layers : [];
      if (new Set(layers).size !== layers.length) errors.push('knownGap.layers: duplicate layer');
      const signatures = c.knownGap.matches;
      if (!isObj(signatures))
        errors.push('knownGap.matches: required object keyed by declared layer');
      else {
        checkKeys(signatures, new Set(layers), 'knownGap.matches', errors);
        for (const layer of layers) {
          const patterns = signatures[layer];
          if (!Array.isArray(patterns) || !patterns.length) {
            errors.push(`knownGap.matches.${layer}: nonempty array of anchored regex strings`);
            continue;
          }
          for (const pattern of patterns) {
            if (typeof pattern !== 'string' || !pattern.startsWith('^') || !pattern.endsWith('$')) {
              errors.push(
                `knownGap.matches.${layer}: every regex must start with ^ and end with $`,
              );
              continue;
            }
            try {
              new RegExp(pattern);
            } catch {
              errors.push(`knownGap.matches.${layer}: invalid regex ${pattern}`);
            }
          }
        }
      }
    }
  }
  return errors;
}

module.exports = {
  validateCase,
  FORMATS,
  PROTOCOLS,
  CONTEXTS,
  DIALECTS,
  SCENARIOS,
  STATUSES,
  LEVELS,
  CROSS_LEVELS,
  PREVIEW_KINDS,
  PREVIEW_RENDERED,
  MEDIA,
  MUTATION_CATEGORIES,
  PATCH_OPS,
  PARSE_STATES,
  SANDBOX_REFUSAL_KINDS,
};
