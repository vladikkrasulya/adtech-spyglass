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
 * Four rules — none of them fire for non-pop traffic:
 *
 *   imp.pop.fcap_missing             warn   imp[N].ext           no fcap key found
 *   imp.pop.battr_popup_blocked      warn   imp[N].banner.battr  blocks attr 8 (Pop)
 *   imp.pop.instl_conflict           warn   imp[N].instl         instl:1 on a pop slot
 *   imp.pop.secure_may_block_landing info   imp[N].secure        secure:1 with pop
 *
 * Why warn-not-error on fcap: pop without a cap doesn't break the
 * auction, it just hurts the publisher (CPM gets cut, fill drops).
 * Same severity rationale as the legacy `imp.bidfloorcur_missing`.
 *
 * Why warn on battr/instl (not error): both fields are individually valid
 * oRTB — the finding flags a *contradiction* with the pop intent, not a
 * spec violation. `battr:[…,8]` (Creative Attributes, IAB List 5.3, 8 = Pop)
 * on a pop slot forbids the very creatives the slot wants; `instl:1`
 * (full-screen in-page interstitial) is a different delivery model from a
 * pop (separate window/tab). This file used to reach for `btype:[4]`, but
 * btype is Banner Ad Types (4 = iframe), unrelated to pop — battr:8 is the
 * IAB-correct anchor.
 *
 * Why info on secure: `secure:1` on a pop SLOT is often deliberate
 * (HTTPS landing) so we don't flag the bid — just surface that pops
 * historically open HTTP landings and the combination is worth a check.
 */

const { LEVELS, makeFinding } = require('../../findings');
const { scanExtForFormatHints, isPopFormat } = require('../../non-iab-formats');

const F = makeFinding;

/**
 * True if any pop-family hint is present anywhere on the request. `ctx` may
 * carry a `userDialect` whose saved mappings extend recognition to vendor
 * signals (e.g. a numeric `ext.ad_type`). Cheap to call repeatedly because
 * scanExtForFormatHints is O(keys) with no allocations on the no-hint path.
 *
 * @param {object} req
 * @param {object} [ctx]
 */
function requestHasPopHint(req, ctx) {
  if (!req || typeof req !== 'object') return false;
  const userDialect = (ctx && ctx.userDialect) || null;
  if (scanExtForFormatHints(req.ext, '', userDialect).some((h) => isPopFormat(h.format)))
    return true;
  const imps = Array.isArray(req.imp) ? req.imp : [];
  for (const imp of imps) {
    if (!imp || typeof imp !== 'object') continue;
    if (scanExtForFormatHints(imp.ext, '', userDialect).some((h) => isPopFormat(h.format)))
      return true;
    if (
      imp.banner &&
      scanExtForFormatHints(imp.banner.ext, '', userDialect).some((h) => isPopFormat(h.format))
    ) {
      return true;
    }
    if (
      imp.video &&
      scanExtForFormatHints(imp.video.ext, '', userDialect).some((h) => isPopFormat(h.format))
    ) {
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

function validate(req, ctx) {
  if (!requestHasPopHint(req, ctx)) return [];
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

    // 2. banner blocks creative attribute 8 (Pop, IAB List 5.3) on a pop slot
    //    → contradictory: the slot wants pop traffic but battr forbids it. warn.
    if (imp.banner && Array.isArray(imp.banner.battr) && imp.banner.battr.includes(8)) {
      findings.push(
        F('imp.pop.battr_popup_blocked', LEVELS.WARNING, `${slot}.banner.battr`, { num }),
      );
    }

    // 3. interstitial flag on a pop slot → contradictory delivery model
    //    (interstitial = full-screen in-page; pop = separate window). warn.
    if (imp.instl === 1) {
      findings.push(F('imp.pop.instl_conflict', LEVELS.WARNING, `${slot}.instl`, { num }));
    }

    // 4. secure:1 + pop slot → info nudge about HTTP landing compat
    if (imp.secure === 1) {
      findings.push(F('imp.pop.secure_may_block_landing', LEVELS.INFO, `${slot}.secure`, { num }));
    }
  });

  return findings;
}

module.exports = {
  id: 'pop-request',
  description:
    'Request-side checks for pop / popunder / clickunder slots (fcap, battr:8, instl, secure).',
  appliesTo: ['ORTB_REQUEST'],
  validate,
  // exported for the test file
  _requestHasPopHint: requestHasPopHint,
  _impHasFcap: impHasFcap,
};
