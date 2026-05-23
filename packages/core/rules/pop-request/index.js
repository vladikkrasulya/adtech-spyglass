'use strict';

/**
 * pop-request — request-side checks that fire ONLY when the request
 * was tagged as a pop-family ad slot (popunder / popup / clickunder).
 *
 * Pops are not in canonical oRTB. The hint that tells us "this is a
 * pop slot" lives in vendor extensions (`imp.ext.adtype = "popunder"`,
 * `imp.ext.pop = true`, etc.) — see packages/core/non-iab-formats.js
 * for the full recognition table.
 *
 * Three rules — none of them fire for non-pop traffic:
 *
 *   imp.pop.fcap_missing             warn   imp[N].ext  no fcap key found
 *   imp.pop.btype_popup_recommended  info   imp[N].banner.btype  missing 4
 *   imp.pop.secure_may_block_landing info   imp[N].secure         secure:1 with pop
 *
 * Why warn-not-error on fcap: pop without a cap doesn't break the
 * auction, it just hurts the publisher (CPM gets cut, fill drops).
 * Same severity rationale as the legacy `imp.bidfloorcur_missing`.
 *
 * Why info on btype/secure: these are best-practice nudges, not
 * spec violations. `secure:1` on a pop SLOT is often deliberate
 * (HTTPS landing, secure context) so we don't flag the bid itself —
 * just surface that pops historically open HTTP landings and the
 * combination is worth a sanity check.
 */

const { LEVELS, makeFinding } = require('../../findings');
const { scanExtForFormatHints, isPopFormat } = require('../../non-iab-formats');

const F = makeFinding;

/**
 * True if any pop-family hint is present anywhere on the request.
 * Cheap to call repeatedly because scanExtForFormatHints is O(keys)
 * with no allocations on the no-hint path.
 */
function requestHasPopHint(req) {
  if (!req || typeof req !== 'object') return false;
  if (scanExtForFormatHints(req.ext, '').some((h) => isPopFormat(h.format))) return true;
  const imps = Array.isArray(req.imp) ? req.imp : [];
  for (const imp of imps) {
    if (!imp || typeof imp !== 'object') continue;
    if (scanExtForFormatHints(imp.ext, '').some((h) => isPopFormat(h.format))) return true;
    if (
      imp.banner &&
      scanExtForFormatHints(imp.banner.ext, '').some((h) => isPopFormat(h.format))
    ) {
      return true;
    }
    if (imp.video && scanExtForFormatHints(imp.video.ext, '').some((h) => isPopFormat(h.format))) {
      return true;
    }
  }
  return false;
}

/**
 * Look for a frequency-cap signal anywhere a vendor commonly puts it.
 * Most networks use one of: `frequency_cap` (various SSPs),
 * `fcap` (pop vendors C+B), `freq` (shortform alt), `cap`
 * (legacy URL-based SSPs). Any non-null/empty value counts.
 */
function impHasFcap(imp) {
  if (!imp || typeof imp !== 'object') return false;
  const ext = imp.ext;
  if (!ext || typeof ext !== 'object') return false;
  for (const k of ['frequency_cap', 'fcap', 'freq', 'cap', 'frequencyCap']) {
    const v = ext[k];
    if (v == null || v === '' || v === 0) continue;
    return true;
  }
  return false;
}

function validate(req /*, ctx */) {
  if (!requestHasPopHint(req)) return [];
  const findings = [];
  const imps = Array.isArray(req.imp) ? req.imp : [];

  imps.forEach((imp, i) => {
    if (!imp || typeof imp !== 'object') return;
    const num = i + 1;
    const slot = `imp[${i}]`;

    // 1. fcap missing → warn
    if (!impHasFcap(imp)) {
      findings.push(F('imp.pop.fcap_missing', LEVELS.WARNING, `${slot}.ext`, { num }));
    }

    // 2. banner without btype:[4] → info
    if (imp.banner && (!Array.isArray(imp.banner.btype) || !imp.banner.btype.includes(4))) {
      findings.push(
        F('imp.pop.btype_popup_recommended', LEVELS.INFO, `${slot}.banner.btype`, { num }),
      );
    }

    // 3. secure:1 + pop slot → info nudge about HTTP landing compat
    if (imp.secure === 1) {
      findings.push(F('imp.pop.secure_may_block_landing', LEVELS.INFO, `${slot}.secure`, { num }));
    }
  });

  return findings;
}

module.exports = {
  id: 'pop-request',
  description: 'Request-side checks for pop / popunder / clickunder slots (fcap, btype, secure).',
  appliesTo: ['ORTB_REQUEST'],
  validate,
  // exported for the test file
  _requestHasPopHint: requestHasPopHint,
  _impHasFcap: impHasFcap,
};
