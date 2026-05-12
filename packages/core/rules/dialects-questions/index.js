'use strict';

/**
 * dialects-questions plugin.
 *
 * Walks imp[].ext.* and req.ext.* on oRTB requests. For any extension key
 * outside the IAB-blessed allowlist that the user hasn't already labelled
 * in their saved dialect, emit a `level:'question'` finding carrying
 * shape-based candidate formats + recommendation + fingerprint.
 *
 * Non-blocking by design: rollupStatus in findings.js ignores `question`
 * level so a payload full of vendor extensions still rolls up to `clean`
 * if no real spec violations exist.
 *
 * Inputs:
 *   - ctx.userDialect (optional): { lookupMapping(path, value) -> mapping|null }
 *     If present, signals the user already mapped are silently skipped.
 *   - ctx.dialect (existing): the static IAB/kadam/etc overlay (unused here).
 *
 * Caps emission at 20 findings per payload — UI overflow protection on
 * payloads with many vendor fields.
 */

const { makeFinding } = require('../../findings');
const {
  analyzeShape,
  recommendedFormat,
  shapeFingerprint,
} = require('../../dialects/shape-fingerprint');

// Known IAB / industry-blessed ext.* keys at the imp level. Anything
// outside this list is treated as 'unknown vendor extension'. Sourced
// from IAB oRTB 2.6, 3.0, and widely-adopted public extensions. NEVER
// add vendor-specific custom keys — those belong in user dialects.
const KNOWN_IAB_IMP_EXT_KEYS = new Set([
  'skadn', 'gpid', 'dpid', 'is_secure', 'tid',
  'data', 'reward', 'dlp', 'omidpn', 'omidpv',
]);

// Known IAB / industry-blessed ext.* keys at the req level.
const KNOWN_IAB_REQ_EXT_KEYS = new Set([
  'schain', 'sda', 'eids', 'gpc', 'dsa', 'ssn',
]);

const MAX_FINDINGS = 20;

function stringifyValue(v) {
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function isPlainObject(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

module.exports = {
  id: 'dialects-questions',
  description: 'Surface non-IAB vendor extensions as interactive questions',
  appliesTo: ['ORTB_REQUEST'],
  applies(_payload, _ctx) {
    return true;
  },

  validate(req, ctx) {
    const findings = [];
    let count = 0;
    const userDialect = (ctx && ctx.userDialect) || null;

    // ---- imp[i].ext.* ---------------------------------------------------
    if (Array.isArray(req.imp)) {
      for (let i = 0; i < req.imp.length && count < MAX_FINDINGS; i += 1) {
        const imp = req.imp[i];
        if (!isPlainObject(imp) || !isPlainObject(imp.ext)) continue;

        // Pre-compute shape data ONCE per imp — repeated for each unknown key.
        let impCandidates = null;
        let impRecommended = null;
        let impFingerprint = null;

        const keys = Object.keys(imp.ext).sort();
        for (const key of keys) {
          if (count >= MAX_FINDINGS) break;
          if (KNOWN_IAB_IMP_EXT_KEYS.has(key)) continue;

          const value = imp.ext[key];
          const valueStr = stringifyValue(value);
          const signalPath = `imp[].ext.${key}`;

          if (userDialect && userDialect.lookupMapping(signalPath, valueStr)) continue;

          // Lazy-compute shape data on first hit per imp.
          if (impCandidates === null) {
            impCandidates = analyzeShape(imp);
            impRecommended = recommendedFormat(impCandidates);
            impFingerprint = shapeFingerprint(imp);
          }

          findings.push(
            makeFinding('dialects.question.unknown_ext_signal', 'question', `imp[${i}].ext.${key}`, {
              value: valueStr,
              candidates: impCandidates,
              recommended: impRecommended,
              shape_signature: impFingerprint,
            })
          );
          count += 1;
        }
      }
    }

    // ---- req.ext.* ------------------------------------------------------
    // Request-level extensions don't have a "format" shape to fingerprint
    // (req isn't an impression), so we always emit candidates:[] and
    // recommended:null for these — UI shows them as "vendor extension,
    // label manually". Shape signature is still computed from the whole
    // req for drift detection.
    if (isPlainObject(req.ext) && count < MAX_FINDINGS) {
      const fingerprint = shapeFingerprint(req);
      const keys = Object.keys(req.ext).sort();
      for (const key of keys) {
        if (count >= MAX_FINDINGS) break;
        if (KNOWN_IAB_REQ_EXT_KEYS.has(key)) continue;

        const value = req.ext[key];
        const valueStr = stringifyValue(value);
        const signalPath = `ext.${key}`;
        if (userDialect && userDialect.lookupMapping(signalPath, valueStr)) continue;

        findings.push(
          makeFinding('dialects.question.unknown_ext_signal', 'question', `ext.${key}`, {
            value: valueStr,
            candidates: [],
            recommended: null,
            shape_signature: fingerprint,
          })
        );
        count += 1;
      }
    }

    return findings;
  },
};
