'use strict';

/**
 * Extended User IDs (EIDs) validation — IAB OpenRTB 2.x §3.2.20.
 *
 * EIDs travel in `user.ext.eids` as an array of identity sources.
 * Each EID entry has a `source` domain + a `uids` array of individual
 * ID records. Each UID has a required `id` string and an optional
 * `atype` integer (1=cookie, 2=device, 3=people-based).
 *
 * Spec: https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#3220-object-user
 * EID spec: https://github.com/InteractiveAdvertisingBureau/openrtb/blob/main/eids.md
 *
 * Rules:
 *   err-eids-not-array         — user.ext.eids is present but not an array
 *   err-eids-source-missing    — eid.source missing or empty
 *   err-eids-uids-empty        — eid.uids missing or empty array
 *   err-eids-uid-id-missing    — uid.id missing or empty
 *   warn-eids-uid-atype-invalid — uid.atype present but not 1, 2, or 3
 */

const { LEVELS, makeFinding } = require('../../findings');

const F = makeFinding;

function validate(req /*, ctx */) {
  const findings = [];
  if (!req || typeof req !== 'object') return findings;

  const user = req.user;
  if (!user || !user.ext) return findings;

  const eids = user.ext.eids;
  if (eids == null) return findings; // absent is fine — no enforcement

  // Present but wrong type
  if (!Array.isArray(eids)) {
    findings.push(F('err-eids-not-array', LEVELS.ERROR, 'user.ext.eids', { type: typeof eids }));
    return findings;
  }

  eids.forEach((eid, i) => {
    if (!eid || typeof eid !== 'object') return;
    const ep = `user.ext.eids[${i}]`;

    // source — required non-empty string
    if (typeof eid.source !== 'string' || eid.source.length === 0) {
      findings.push(F('err-eids-source-missing', LEVELS.ERROR, ep + '.source', { idx: i }));
    }

    // uids — required non-empty array
    if (!Array.isArray(eid.uids) || eid.uids.length === 0) {
      findings.push(F('err-eids-uids-empty', LEVELS.ERROR, ep + '.uids', { idx: i }));
      return; // can't walk uids
    }

    eid.uids.forEach((uid, j) => {
      if (!uid || typeof uid !== 'object') return;
      const up = `user.ext.eids[${i}].uids[${j}]`;

      // id — required non-empty string
      if (typeof uid.id !== 'string' || uid.id.length === 0) {
        findings.push(F('err-eids-uid-id-missing', LEVELS.ERROR, up + '.id', { eidIdx: i, uidIdx: j }));
      }

      // atype — optional, but if present must be integer 1, 2, or 3
      if (uid.atype != null) {
        if (!Number.isInteger(uid.atype) || uid.atype < 1 || uid.atype > 3) {
          findings.push(F('warn-eids-uid-atype-invalid', LEVELS.WARNING, up + '.atype', { eidIdx: i, uidIdx: j, val: String(uid.atype) }));
        }
      }
    });
  });

  return findings;
}

module.exports = {
  id: 'eids',
  description: 'Validates Extended User IDs (user.ext.eids): source/uids per entry and id/atype per UID.',
  appliesTo: ['ORTB_REQUEST'],
  validate,
};
