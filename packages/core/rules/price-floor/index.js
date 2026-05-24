'use strict';

/**
 * Bid price validation — price >= 0 and price >= matching imp.bidfloor.
 *
 * Response-side rule that walks every seatbid[].bid[]:
 *   - bid.price must be a non-negative finite number (>= 0). Negative prices
 *     are spec violations; zero is allowed per IAB §4.3.1 (second-price).
 *   - When ctx.req is available, finds the matching imp by bid.impid === imp.id
 *     and enforces bid.price >= floor:
 *       * PMP: if bid.dealid matches imp.pmp.deals[].dealid and that deal has
 *         its own bidfloor, the deal floor wins over imp-level floor.
 *       * Currency: if bidCur (bid.cur || res.cur || USD) differs from
 *         floorCur (imp.bidfloorcur || req.cur[0] || USD) → emit
 *         warn-currency-conversion-needed and SKIP the numeric compare.
 *
 * Rules:
 *   err-bid-price-negative         — bid.price < 0, NaN, Infinity, or not a number
 *   err-bid-price-below-floor      — bid.price < matching floor (same currency)
 *   warn-currency-conversion-needed — bidCur != floorCur (no numeric compare done)
 */

const { LEVELS, makeFinding } = require('../../findings');

const F = makeFinding;

/**
 * Find the effective floor for a bid against an imp.
 * Returns { floor, floorCur, source } or null if no floor is set.
 */
function resolveFloor(bid, imp, req) {
  const reqCur0 = req && Array.isArray(req.cur) && req.cur.length > 0 ? req.cur[0] : 'USD';

  // PMP deal floor — check if bid.dealid matches a deal on imp.pmp.deals[]
  if (bid.dealid && imp.pmp && Array.isArray(imp.pmp.deals)) {
    const deal = imp.pmp.deals.find((d) => d && d.dealid === bid.dealid);
    if (deal && typeof deal.bidfloor === 'number' && Number.isFinite(deal.bidfloor)) {
      return {
        floor: deal.bidfloor,
        floorCur: deal.bidfloorcur || reqCur0,
        source: 'deal',
      };
    }
  }

  // imp-level floor
  if (typeof imp.bidfloor === 'number' && Number.isFinite(imp.bidfloor) && imp.bidfloor > 0) {
    return {
      floor: imp.bidfloor,
      floorCur: imp.bidfloorcur || reqCur0,
      source: 'imp',
    };
  }

  return null;
}

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

  // Determine response-level currency (default USD)
  const resCur = typeof payload.cur === 'string' && payload.cur.length > 0 ? payload.cur : 'USD';

  payload.seatbid.forEach((sb, si) => {
    if (!sb || !Array.isArray(sb.bid)) return;
    sb.bid.forEach((bid, bi) => {
      if (!bid) return;
      const path = `seatbid[${si}].bid[${bi}]`;

      // price must be a non-negative finite number (>= 0 is valid per IAB §4.3.1)
      if (typeof bid.price !== 'number' || !Number.isFinite(bid.price) || bid.price < 0) {
        findings.push(
          F('err-bid-price-negative', LEVELS.ERROR, path + '.price', {
            val: String(bid.price ?? 'missing'),
            si,
            bi,
          }),
        );
        return; // no floor check if price itself is invalid
      }

      // floor crosscheck (only when paired request is available)
      if (impMap.size > 0 && bid.impid != null) {
        const imp = impMap.get(String(bid.impid));
        if (!imp) return;

        const floorInfo = resolveFloor(bid, imp, req);
        if (!floorInfo) return;

        const { floor, floorCur } = floorInfo;

        // Determine bid currency
        const bidCur = typeof bid.cur === 'string' && bid.cur.length > 0 ? bid.cur : resCur;

        // Currency mismatch → warn and skip numeric compare
        if (bidCur !== floorCur) {
          findings.push(
            F('warn-currency-conversion-needed', LEVELS.WARNING, path + '.price', {
              bidCur,
              floorCur,
              impid: String(bid.impid),
              si,
              bi,
            }),
          );
          return;
        }

        // Same currency — do the numeric compare
        if (bid.price < floor) {
          findings.push(
            F('err-bid-price-below-floor', LEVELS.ERROR, path + '.price', {
              price: bid.price,
              floor,
              impid: String(bid.impid),
              si,
              bi,
            }),
          );
        }
      }
    });
  });

  return findings;
}

module.exports = {
  id: 'price-floor',
  description:
    'Validates bid.price >= 0 (zero is valid per IAB §4.3.1) and bid.price >= effective floor (deal or imp), with currency-aware mismatch warnings.',
  appliesTo: ['ORTB_RESPONSE'],
  validate,
};
