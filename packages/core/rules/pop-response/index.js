'use strict';

/**
 * pop-response — response-side checks for pop-tagged bids.
 *
 * A pop bid does NOT ship banner HTML; it ships one of:
 *   - a bare landing URL (the SSP wraps it in window.open at render)
 *   - a `<script>window.open(URL)</script>` blob
 *   - a `location.href = URL` / `top.location = URL` redirect
 *
 * If the seller returns banner-shaped `bid.adm` for a pop slot the
 * impression won't render — the publisher loses revenue, the buyer
 * loses inventory, both sides are confused. That's an ERROR.
 *
 *   bid.pop.adm_not_redirect   error  seatbid[N].bid[M].adm
 *
 * Trigger condition: `bid.ext` carries one of the pop hints recognised
 * by non-iab-formats.js (adtype/format/type/ad_format/flag keys). If
 * ANY bid in the response declares pop intent, ALL bids in that
 * response are checked — pop traffic typically wins or loses as a
 * batch per SSP.
 *
 * False-positive guard: bare URLs containing the substring `<script>`
 * or `<iframe>` are rejected (they'd be banner HTML with a URL inside,
 * not a pop). The admLooksLikePop heuristic in non-iab-formats handles
 * that anchor.
 */

const { LEVELS, makeFinding } = require('../../findings');
const { scanExtForFormatHints, isPopFormat, admLooksLikePop } = require('../../non-iab-formats');

const F = makeFinding;

function responseHasPopHint(res) {
  if (!res || !Array.isArray(res.seatbid)) return false;
  for (const sb of res.seatbid) {
    if (!sb || !Array.isArray(sb.bid)) continue;
    for (const bid of sb.bid) {
      if (!bid || typeof bid !== 'object') continue;
      if (scanExtForFormatHints(bid.ext, '').some((h) => isPopFormat(h.format))) return true;
    }
  }
  return false;
}

function validate(res /*, ctx */) {
  if (!responseHasPopHint(res)) return [];
  const findings = [];
  const seatbids = Array.isArray(res.seatbid) ? res.seatbid : [];

  seatbids.forEach((sb, sbi) => {
    if (!sb || !Array.isArray(sb.bid)) return;
    sb.bid.forEach((bid, bi) => {
      if (!bid || typeof bid !== 'object') return;
      const sNum = sbi + 1;
      const bNum = bi + 1;
      const path = `seatbid[${sbi}].bid[${bi}]`;
      // Only flag bids that themselves declare pop intent. A response with
      // mixed inventory (one pop bid + one banner bid in different seatbids)
      // would otherwise generate noise on the banner side.
      if (!scanExtForFormatHints(bid.ext, '').some((h) => isPopFormat(h.format))) return;
      if (!admLooksLikePop(bid.adm)) {
        findings.push(F('bid.pop.adm_not_redirect', LEVELS.ERROR, `${path}.adm`, { sNum, bNum }));
      }
    });
  });

  return findings;
}

module.exports = {
  id: 'pop-response',
  description:
    'Response-side checks for pop bids (adm must be a redirect / window.open, not HTML).',
  appliesTo: ['ORTB_RESPONSE'],
  validate,
  _responseHasPopHint: responseHasPopHint,
};
