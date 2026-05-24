'use strict';

/**
 * TMAX sanity validation — oRTB §3.2.1.
 *
 * req.tmax is the maximum time in milliseconds the exchange will wait for
 * a bid response. When present it must be a positive integer; extremely
 * low (<50ms) or high (>3000ms) values are flagged as warnings.
 *
 * Rules:
 *   err-tmax-invalid      — tmax is present but not a positive integer
 *   warn-tmax-too-small   — tmax < 50ms (almost certainly a timeout in practice)
 *   warn-tmax-too-large   — tmax > 3000ms (unusual, may indicate a misconfiguration)
 */

const { LEVELS, makeFinding } = require('../../findings');

const F = makeFinding;

const TMAX_MIN_WARN = 50;    // ms below which we warn
const TMAX_MAX_WARN = 3000;  // ms above which we warn

function validate(req /*, ctx */) {
  const findings = [];
  if (!req || typeof req !== 'object') return findings;
  if (req.tmax == null) return findings; // absent is allowed per spec

  const tmax = req.tmax;

  // Must be a positive integer
  if (!Number.isInteger(tmax) || tmax <= 0) {
    findings.push(F('err-tmax-invalid', LEVELS.ERROR, 'tmax', { val: String(tmax) }));
    return findings;
  }

  // Warn on suspiciously small values
  if (tmax < TMAX_MIN_WARN) {
    findings.push(F('warn-tmax-too-small', LEVELS.WARNING, 'tmax', { val: tmax, min: TMAX_MIN_WARN }));
  }

  // Warn on suspiciously large values
  if (tmax > TMAX_MAX_WARN) {
    findings.push(F('warn-tmax-too-large', LEVELS.WARNING, 'tmax', { val: tmax, max: TMAX_MAX_WARN }));
  }

  return findings;
}

module.exports = {
  id: 'tmax',
  description: 'Validates req.tmax: must be a positive integer; warns when below 50ms or above 3000ms.',
  appliesTo: ['ORTB_REQUEST'],
  validate,
};
