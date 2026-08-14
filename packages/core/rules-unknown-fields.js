'use strict';

/**
 * Findings for fields a receiver will ignore without saying so.
 *
 * OpenRTB tells a receiver to ignore fields it does not recognise, so that an
 * old implementation is not broken by a newer version's additions. The cost of
 * that rule is that a misspelling is indistinguishable from a field from the
 * future: `protcols` and `bidfloorcurr` simply have no effect, nothing rejects
 * the payload, and the value the operator wrote is silently absent.
 *
 * `findUnknownFields` does the analysis. This module only decides how loudly to
 * say each result, which turns on how much is actually known:
 *
 *   - a name one edit away from a real one, in the same object, is a typo in
 *     all but name — WARNING, with the correction
 *   - a real spec field in the wrong object is not a typo at all. We say where
 *     it belongs and nothing else, because guessing intent from a correct name
 *     in a wrong place is how a helpful tool starts inventing
 *   - a field known in another version is a version problem, not a spelling one
 *   - anything else is INFO. Extensions live in `ext` by design and are never
 *     reported, so what is left here is a vendor key on a core object: worth
 *     seeing once, not worth alarming over
 */

const { findUnknownFields } = require('./unknown-fields');
const { makeFinding, LEVELS } = require('./findings');

/**
 * @param {unknown} payload Parsed request or response.
 * @param {{version?: string, kind?: string}} [opts]
 * @returns {{ findings: Array<Object> }}
 */
function validateUnknownFields(payload, opts) {
  const findings = [];
  const hits = findUnknownFields(payload, opts || {});

  for (const h of hits) {
    if (h.reason === 'likely_typo') {
      findings.push(
        makeFinding('payload.field_misspelled', LEVELS.WARNING, h.path, {
          field: h.field,
          suggestion: h.suggestion,
          object: h.object,
          scope: h.suggestionScope,
        }),
      );
      continue;
    }
    if (h.reason === 'known_elsewhere') {
      findings.push(
        makeFinding('payload.field_wrong_object', LEVELS.WARNING, h.path, {
          field: h.field,
          object: h.object,
          belongsOn: (h.knownOn || []).join(', '),
        }),
      );
      continue;
    }
    if (h.reason === 'version_mismatch') {
      findings.push(
        makeFinding('payload.field_wrong_version', LEVELS.WARNING, h.path, {
          field: h.field,
          object: h.object,
          knownIn: (h.knownIn || []).join(', '),
        }),
      );
      continue;
    }
    findings.push(
      makeFinding('payload.field_unrecognized', LEVELS.INFO, h.path, {
        field: h.field,
        object: h.object,
      }),
    );
  }

  return { findings };
}

module.exports = { validateUnknownFields };
