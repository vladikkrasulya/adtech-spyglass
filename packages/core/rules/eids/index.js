'use strict';

/**
 * Extended User IDs (EIDs) validation — IAB OpenRTB 2.6 §3.2.20.
 *
 * EIDs travel in:
 *   - `user.eids`     (oRTB 2.6 native — promoted from ext)
 *   - `user.ext.eids` (oRTB 2.x legacy)
 *
 * Both paths are checked independently when present. If both are present,
 * both are validated and findings from each are included.
 *
 * Each EID entry has a `source` domain + a `uids` array of individual
 * ID records. Each UID has a required `id` string and an optional
 * `atype` integer (1=cookie, 2=device, 3=people-based).
 *
 * Spec: https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#3220-object-user
 * EID spec: https://github.com/InteractiveAdvertisingBureau/openrtb/blob/main/eids.md
 *
 * Rules:
 *   err-eids-not-array          — eids is present but not an array
 *   err-eids-entry-invalid      — an eid entry is not a plain object
 *   err-eids-source-missing     — eid.source absent or empty string
 *   err-eids-source-invalid-type — eid.source present but wrong type (not string)
 *   err-eids-source-invalid     — eid.source string but not a valid domain
 *   err-eids-uids-empty         — eid.uids missing or empty array
 *   err-eids-uid-invalid        — a uid entry is not a plain object
 *   err-eids-uid-id-missing     — uid.id absent or empty string
 *   err-eids-uid-id-invalid-type — uid.id present but wrong type (not string)
 *   err-eids-uid-atype-invalid  — uid.atype present but not 1, 2, or 3
 */

const { LEVELS, makeFinding } = require('../../findings');
const { isValidDomain } = require('../../utils/domain');

const F = makeFinding;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateEidArray(eids, basePath, findings) {
  // Present but wrong type
  if (!Array.isArray(eids)) {
    findings.push(F('err-eids-not-array', LEVELS.ERROR, basePath, { type: typeof eids }));
    return;
  }

  eids.forEach((eid, i) => {
    const ep = `${basePath}[${i}]`;

    // Type guard: eid must be a plain object
    if (!isPlainObject(eid)) {
      findings.push(F('err-eids-entry-invalid', LEVELS.ERROR, ep, { idx: i, type: typeof eid }));
      return;
    }

    // source — required non-empty string that must be a valid domain
    if (eid.source == null || eid.source === '') {
      findings.push(F('err-eids-source-missing', LEVELS.ERROR, ep + '.source', { idx: i }));
    } else if (typeof eid.source !== 'string') {
      findings.push(
        F('err-eids-source-invalid-type', LEVELS.ERROR, ep + '.source', {
          idx: i,
          type: typeof eid.source,
        }),
      );
    } else if (!isValidDomain(eid.source)) {
      findings.push(
        F('err-eids-source-invalid', LEVELS.ERROR, ep + '.source', { idx: i, val: eid.source }),
      );
    }

    // uids — required non-empty array
    if (!Array.isArray(eid.uids) || eid.uids.length === 0) {
      findings.push(F('err-eids-uids-empty', LEVELS.ERROR, ep + '.uids', { idx: i }));
      return; // can't walk uids
    }

    eid.uids.forEach((uid, j) => {
      const up = `${basePath}[${i}].uids[${j}]`;

      // Type guard: uid must be a plain object
      if (!isPlainObject(uid)) {
        findings.push(
          F('err-eids-uid-invalid', LEVELS.ERROR, up, { eidIdx: i, uidIdx: j, type: typeof uid }),
        );
        return;
      }

      // id — required non-empty string
      if (uid.id == null || uid.id === '') {
        findings.push(
          F('err-eids-uid-id-missing', LEVELS.ERROR, up + '.id', { eidIdx: i, uidIdx: j }),
        );
      } else if (typeof uid.id !== 'string') {
        findings.push(
          F('err-eids-uid-id-invalid-type', LEVELS.ERROR, up + '.id', {
            eidIdx: i,
            uidIdx: j,
            type: typeof uid.id,
          }),
        );
      }

      // atype — optional, but if present must be integer 1, 2, or 3
      if (uid.atype != null) {
        if (!Number.isInteger(uid.atype) || uid.atype < 1 || uid.atype > 3) {
          findings.push(
            F('err-eids-uid-atype-invalid', LEVELS.ERROR, up + '.atype', {
              eidIdx: i,
              uidIdx: j,
              val: String(uid.atype),
            }),
          );
        }
      }
    });
  });
}

function validate(req /*, ctx */) {
  const findings = [];
  if (!req || typeof req !== 'object') return findings;

  const user = req.user;
  if (!user || typeof user !== 'object') return findings;

  // oRTB 2.6 native: user.eids
  if (user.eids != null) {
    validateEidArray(user.eids, 'user.eids', findings);
  }

  // oRTB 2.x legacy: user.ext.eids
  if (user.ext && user.ext.eids != null) {
    validateEidArray(user.ext.eids, 'user.ext.eids', findings);
  }

  return findings;
}

module.exports = {
  id: 'eids',
  description:
    'Validates Extended User IDs at user.eids (oRTB 2.6) and user.ext.eids (legacy 2.x): source domain/uids per entry and id/atype per UID.',
  appliesTo: ['ORTB_REQUEST'],
  validate,
};
