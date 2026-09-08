'use strict';

/**
 * tests/corpus/lib/core-run.js — run one materialized case through Core and
 * return the normalized `actual` shape the oracle reads.
 *
 * Only Core's public entry points are used (validate, crosscheck,
 * detectFormat), the same calls the HTTP handler makes, so a Core-layer pass
 * says something about the product and not about a private helper.
 */

const path = require('node:path');

const CORE_PATH = path.join(__dirname, '..', '..', '..', 'packages', 'core');

/**
 * @param {unknown} x
 * @returns {x is Record<string, any>}
 */
function isObj(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * @param {any} a
 * @param {any} b
 */
function unionFormat(a, b) {
  const merge = (k) => [...new Set([...((a && a[k]) || []), ...((b && b[k]) || [])])];
  return {
    formats: merge('formats'),
    contexts: merge('contexts'),
    protocols: merge('protocols'),
    tags: merge('tags'),
    confidence: Math.max((a && a.confidence) || 0, (b && b.confidence) || 0),
  };
}

/** Decode raw transport text without claiming that parsing exercises Core.
 * @param {import('./load').Materialized} c
 */
function inputValues(c) {
  const values = { request: c.request, response: c.response };
  for (const side of ['request', 'response']) {
    const raw = c[side === 'request' ? 'rawRequest' : 'rawResponse'];
    if (raw !== undefined) values[side] = JSON.parse(raw);
  }
  return values;
}

/** @param {import('./load').Materialized} c */
function coreApplicability(c) {
  try {
    inputValues(c);
  } catch {
    return {
      applicable: false,
      reason: 'Malformed JSON is rejected by transport parsing before Core validation.',
    };
  }
  const e = c.meta.expect || {};
  if (e.http && e.http.status >= 400)
    return {
      applicable: false,
      reason: 'This case asserts transport rejection; its Core validation is not exercised.',
    };
  const semantic =
    ['request', 'response', 'crosscheck', 'format'].some(
      (key) => e[key] && Object.keys(e[key]).length,
    ) ||
    (e.consistency && e.consistency.length);
  if (!semantic)
    return {
      applicable: false,
      reason:
        'This case has no Core semantic assertions; its browser or HTTP outcome is checked separately.',
    };
  return {
    applicable: true,
    reason: 'Core public validation and the declared semantic assertions are exercised.',
  };
}

/** @param {import('./load').Materialized} c */
function isBidPair(c) {
  return !c.meta.reference || c.meta.reference.pairApplicability.kind === 'bid-pair';
}

/**
 * @param {import('./load').Materialized} c
 * @param {{core?: any, locale?: string}} [opts]
 * @returns {any}
 */
function runCore(c, opts = {}) {
  const applicability = coreApplicability(c);
  if (!applicability.applicable) throw new Error(`Core not applicable: ${applicability.reason}`);
  const core = opts.core || require(CORE_PATH);
  const locale = opts.locale || 'en';
  const dialect = c.meta.dialect || 'iab';
  const values = inputValues(c);
  /** @type {any} */
  const actual = { crosscheck: [], format: null, applicability };
  if (values.request !== undefined) {
    actual.request = core.validate(values.request, { locale, dialect, rawText: c.rawRequest });
  }
  const pairReq = isBidPair(c) && isObj(values.request) ? values.request : undefined;
  if (values.response !== undefined) {
    actual.response = core.validate(values.response, {
      locale,
      dialect,
      pairReq,
      rawText: c.rawResponse,
    });
  }
  if (pairReq && values.response !== undefined) {
    actual.crosscheck = core.crosscheck(pairReq, values.response, { locale, dialect });
  }
  const requestFormatInput = isObj(values.request) ? values.request : actual.request?.urlRequest;
  const fReq = requestFormatInput ? core.detectFormat(requestFormatInput) : null;
  const fRes = values.response !== undefined ? core.detectFormat(values.response) : null;
  actual.format = unionFormat(fReq, fRes);
  return actual;
}

module.exports = { runCore, unionFormat, coreApplicability, isBidPair, CORE_PATH };
