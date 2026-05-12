'use strict';

/**
 * imp.secure flag checks.
 *
 * Many publishers serve from HTTPS pages. If an impression object
 * doesn't declare `secure: 1`, the exchange may deliver an HTTP
 * creative that gets silently blocked by the browser's mixed-content
 * policy — the impression drops after the bid wins. Setting
 * `secure: 1` is the safe default in 2026.
 *
 * Two rules:
 *   - imp.secure_recommended (info) — `secure` is missing, null, or 0.
 *     Spec-valid (secure defaults to 0 per oRTB §3.2.4), but a
 *     best-practice nudge: most publishers serve HTTPS and benefit
 *     from explicit secure:1. Kept at info level so a healthy request
 *     still rolls up to status: 'clean'.
 *   - imp.secure_invalid (error) — `secure` is set to a value other
 *     than 0 or 1 (e.g. "1", 2, true). Per oRTB §3.2.4 the field is
 *     a numeric flag.
 *
 * If `secure === 1` → no finding.
 */

const { LEVELS, makeFinding } = require('../../findings');

const F = makeFinding;

function validate(req /*, ctx */) {
  const findings = [];
  if (!req || !Array.isArray(req.imp)) return findings;

  req.imp.forEach((imp, i) => {
    if (!imp || typeof imp !== 'object') return;
    const secure = imp.secure;
    // num is 1-based for user-facing "Slot #N" messages.
    const num = i + 1;
    const path = `imp[${i}].secure`;

    if (secure === 1) return;

    if (secure === undefined || secure === null || secure === 0) {
      findings.push(F('imp.secure_recommended', LEVELS.INFO, path, { num }));
      return;
    }

    findings.push(F('imp.secure_invalid', LEVELS.ERROR, path, { num }));
  });

  return findings;
}

module.exports = {
  id: 'imp-secure',
  description: 'Checks imp.secure flag: recommends secure:1 for HTTPS pages, flags non-0/1 values.',
  appliesTo: ['ORTB_REQUEST'],
  validate,
};
