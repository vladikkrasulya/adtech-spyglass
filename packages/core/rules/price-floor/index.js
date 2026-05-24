'use strict';

/**
 * Bid price validation — price > 0 and price >= matching imp.bidfloor.
 *
 * Response-side rule that walks every seatbid[].bid[]:
 *   - bid.price must be a positive finite number (> 0)
 *   - When ctx.req is available, finds the matching imp by bid.impid === imp.id
 *     and enforces bid.price >= imp.bidfloor when bidfloor is set.
 *
 * Rules:
 *   err-bid-price-negative    — bid.price is missing, zero, negative, NaN,
 *                               or not a number
 *   err-bid-price-below-floor — bid.price < matching imp.bidfloor
 */

const { LEVELS, makeFinding } = require('../../findings');

const F = makeFinding;

function validate(payload, ctx) {
  const findings = [];
  if (!payload || typeof payload !== 'object') return findings;
  if (!Array.isArray(payload.seatbid)) return findings;

  // Build imp lookup from paired request (if available)
  const req = ctx && ctx.req;
  const impMap = new Map();
  if (req && Array.isArray(req.imp)) {
    req.imp.forEach((imp) => {
      if (imp && imp.id != null) impMap.set(String(imp.id), imp);
    });
  }

  payload.seatbid.forEach((sb, si) => {
    if (!sb || !Array.isArray(sb.bid)) return;
    sb.bid.forEach((bid, bi) => {
      if (!bid) return;
      const path = `seatbid[${si}].bid[${bi}]`;

      // price must be a positive finite number
      if (typeof bid.price !== 'number' || !Number.isFinite(bid.price) || bid.price <= 0) {
        findings.push(F('err-bid-price-negative', LEVELS.ERROR, path + '.price', {
          val: String(bid.price ?? 'missing'),
          si,
          bi,
        }));
        return; // no floor check if price itself is invalid
      }

      // floor crosscheck (only when paired request is available)
      if (impMap.size > 0 && bid.impid != null) {
        const imp = impMap.get(String(bid.impid));
        if (imp && typeof imp.bidfloor === 'number' && imp.bidfloor > 0) {
          if (bid.price < imp.bidfloor) {
            findings.push(F('err-bid-price-below-floor', LEVELS.ERROR, path + '.price', {
              price: bid.price,
              floor: imp.bidfloor,
              impid: String(bid.impid),
              si,
              bi,
            }));
          }
        }
      }
    });
  });

  return findings;
}

module.exports = {
  id: 'price-floor',
  description: 'Validates bid.price > 0 and bid.price >= matching imp.bidfloor when paired request is available.',
  appliesTo: ['ORTB_RESPONSE'],
  validate,
};
