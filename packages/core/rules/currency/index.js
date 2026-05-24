'use strict';

/**
 * Currency validation — ISO-4217 format check on req.cur / res.cur / bid.cur.
 *
 * Request-side: validates each entry in req.cur against ISO-4217
 * (exactly 3 uppercase ASCII letters).
 *
 * Response-side: validates res.cur and every seatbid[].bid[].cur for ISO-4217
 * format AND checks that the currency is in the allowed set from the paired
 * request (req.cur || ["USD"]). Mismatch check is gated on ctx.req being
 * available (paired context). When only a response is pasted standalone,
 * only format validation runs.
 *
 * The crosscheck module already handles the high-level cur_not_in_request
 * finding for the top-level res.cur vs req.cur comparison. This rule focuses
 * on ISO-4217 format validity and per-bid currency mismatch.
 *
 * Rules:
 *   err-bid-currency-invalid  — a currency value is not valid ISO-4217
 *   err-bid-currency-mismatch — a bid/response currency is not in allowed set
 */

const { LEVELS, makeFinding } = require('../../findings');

const F = makeFinding;

// ISO-4217: exactly 3 uppercase ASCII letters
const ISO4217_RE = /^[A-Z]{3}$/;

function isValidCurrency(v) {
  return typeof v === 'string' && ISO4217_RE.test(v);
}

function validate(payload, ctx) {
  const findings = [];
  if (!payload || typeof payload !== 'object') return findings;

  const type = (ctx && ctx.type) || 'ORTB_REQUEST';

  if (type === 'ORTB_REQUEST') {
    // Validate req.cur entries for ISO-4217 format
    if (Array.isArray(payload.cur)) {
      payload.cur.forEach((c, i) => {
        if (!isValidCurrency(c)) {
          findings.push(F('err-bid-currency-invalid', LEVELS.ERROR, `cur[${i}]`, { val: String(c), context: 'request' }));
        }
      });
    }
    return findings;
  }

  if (type === 'ORTB_RESPONSE') {
    // Determine allowed currencies from paired request (if available)
    const req = ctx && ctx.req;
    const allowedRaw = (req && Array.isArray(req.cur) && req.cur.length > 0) ? req.cur : null;
    const allowedSet = allowedRaw ? new Set(allowedRaw.filter(isValidCurrency)) : null;

    // Validate top-level res.cur
    if (payload.cur != null) {
      if (!isValidCurrency(payload.cur)) {
        findings.push(F('err-bid-currency-invalid', LEVELS.ERROR, 'cur', { val: String(payload.cur), context: 'response' }));
      } else if (allowedSet && !allowedSet.has(payload.cur)) {
        findings.push(F('err-bid-currency-mismatch', LEVELS.ERROR, 'cur', {
          val: payload.cur,
          allowed: JSON.stringify(allowedRaw),
        }));
      }
    }

    // Validate per-bid cur fields
    if (Array.isArray(payload.seatbid)) {
      payload.seatbid.forEach((sb, si) => {
        if (!sb || !Array.isArray(sb.bid)) return;
        sb.bid.forEach((bid, bi) => {
          if (!bid || bid.cur == null) return;
          const path = `seatbid[${si}].bid[${bi}].cur`;
          if (!isValidCurrency(bid.cur)) {
            findings.push(F('err-bid-currency-invalid', LEVELS.ERROR, path, { val: String(bid.cur), context: 'bid' }));
          } else if (allowedSet && !allowedSet.has(bid.cur)) {
            findings.push(F('err-bid-currency-mismatch', LEVELS.ERROR, path, {
              val: bid.cur,
              allowed: JSON.stringify(allowedRaw),
            }));
          }
        });
      });
    }
  }

  return findings;
}

module.exports = {
  id: 'currency',
  description: 'Validates ISO-4217 format of req.cur / res.cur / bid.cur and checks response currencies are in the request-allowed set.',
  appliesTo: ['ORTB_REQUEST', 'ORTB_RESPONSE'],
  validate,
  // Expose for tests
  _isValidCurrency: isValidCurrency,
};
