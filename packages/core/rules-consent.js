'use strict';

/**
 * Findings for a TCF consent string that decodes into something implausible.
 *
 * A TC string is a packed bit array in Base64URL. Corrupt a few characters and
 * it does not fail to decode — it decodes into different consent. Measured on
 * `@iabtcf/core`: four substituted characters turned `purposeConsents: [1,2]`
 * into `[1,4,6,7,10,12,13,16]` and switched on `specialFeatureOptins`, which
 * covers precise geolocation and device scanning. No exception, no signal. A
 * truncated string throws immediately; the quiet case is the dangerous one.
 *
 * `checkTcString` does the structural work — this module only decides where to
 * look for a string and how loudly to report what comes back.
 *
 * Severity is capped at WARNING throughout, deliberately. Every check here is a
 * plausibility argument, not a proof: an unpublished policy version or a
 * reserved bit that is set means the string is almost certainly damaged, but
 * IAB can publish a new policy version tomorrow and make today's confident
 * error tomorrow's false alarm. A consent string that reads as valid but is
 * not is a serious problem; a validator that cries wolf about a working one
 * gets switched off, and then reports nothing at all.
 */

const { checkTcString } = require('./tcstring-sanity');
const { makeFinding, LEVELS } = require('./findings');

/**
 * Where a TCF v2 string is carried in a bid request.
 *
 * `user.consent` is the 2.6 home; `user.ext.consent` is where it lived before
 * and is still what most senders emit. `regs.gpp` is deliberately absent: GPP
 * is a different container with its own sections, and running a TCF bit reader
 * over it would produce confident nonsense.
 */
const CONSENT_PATHS = [
  ['user', 'consent'],
  ['user', 'ext', 'consent'],
];

/**
 * @param {unknown} obj
 * @param {string[]} path
 * @returns {unknown}
 */
function at(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * @param {unknown} payload Parsed bid request.
 * @returns {{ findings: Array<Object> }}
 */
function validateConsent(payload) {
  const findings = [];
  if (payload === null || typeof payload !== 'object') return { findings };

  for (const path of CONSENT_PATHS) {
    const value = at(payload, path);
    if (typeof value !== 'string' || value.length === 0) continue;

    const dotted = path.join('.');
    const result = checkTcString(value);

    for (const f of result.findings) {
      findings.push(
        makeFinding('consent.tcstring_implausible', LEVELS.WARNING, dotted, {
          code: f.code,
          field: f.field || '',
          value: f.value === undefined ? '' : String(f.value),
          expected: f.expected === undefined ? '' : String(f.expected),
          detail: f.detail || '',
        }),
      );
    }

    // The round trip is the strongest single check the module has: it does not
    // prove the string is the one the CMP wrote, but it proves the reader
    // accounted for every bit. A string that re-encodes to something else is
    // carrying structure this decoder never modelled.
    if (result.roundTrip && result.roundTrip.attempted && !result.roundTrip.matched) {
      findings.push(
        makeFinding('consent.tcstring_roundtrip_mismatch', LEVELS.WARNING, dotted, {
          detail: result.roundTrip.reason || '',
        }),
      );
    }
  }

  return { findings };
}

module.exports = { validateConsent, CONSENT_PATHS };
