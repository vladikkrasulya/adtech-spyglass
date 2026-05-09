'use strict';

/**
 * IAB OpenRTB 3.0 BidResponse validation — minimal envelope + per-bid shape.
 *
 * 3.0 BidResponse mirrors the request envelope:
 *   { openrtb: { ver: "3.0", response: { id, bidid?, seatbid: [...] } } }
 *
 * Like rules-request-30.js, this file ships STRUCTURAL validation only.
 * Deeper bid-shape validation (item-id alignment, AdCOM creative specs)
 * is deferred until production 3.0 traffic shows up.
 *
 * Spec: https://github.com/InteractiveAdvertisingBureau/openrtb/blob/main/3.0.md
 */

const { isObj, isStr, isNum } = require('./helpers');
const { LEVELS, makeFinding } = require('./findings');

const F = makeFinding;

/**
 * @param {object} payload — full response as received (with `openrtb` envelope)
 * @returns {Array<{id:string, level:string, path:string, params:object}>}
 */
function validateResponse30(payload) {
  const findings = [];

  if (!isObj(payload.openrtb)) {
    findings.push(F('response.30.envelope_required', LEVELS.ERROR, 'openrtb'));
    findings.push(F('response.30.deep_validation_limited', LEVELS.INFO, ''));
    return findings;
  }
  const env = payload.openrtb;

  if (!isStr(env.ver)) {
    findings.push(F('response.30.ver_required', LEVELS.ERROR, 'openrtb.ver'));
  } else if (!/^3\.\d+$/.test(env.ver)) {
    findings.push(
      F('response.30.ver_invalid', LEVELS.ERROR, 'openrtb.ver', { ver: env.ver }),
    );
  }

  if (!isObj(env.response)) {
    findings.push(F('response.30.response_required', LEVELS.ERROR, 'openrtb.response'));
    findings.push(F('response.30.deep_validation_limited', LEVELS.INFO, ''));
    return findings;
  }
  const resp = env.response;

  // R3. response.id — required, mirrors request.id (auction match key)
  if (!isStr(resp.id)) {
    findings.push(F('response.30.id_required', LEVELS.ERROR, 'openrtb.response.id'));
  }

  // R4. seatbid[] — same role as 2.x. Empty seatbid + nbr is no-bid.
  //     Both missing → ERROR (no signal at all).
  const hasSeatbid = Array.isArray(resp.seatbid);
  const hasNbr = isNum(resp.nbr);
  if (!hasSeatbid && !hasNbr) {
    findings.push(
      F('response.30.seatbid_or_nbr_required', LEVELS.ERROR, 'openrtb.response.seatbid'),
    );
  } else if (hasNbr && (!hasSeatbid || !resp.seatbid.length)) {
    findings.push(
      F('response.30.no_bid', LEVELS.INFO, 'openrtb.response.nbr', { nbr: resp.nbr }),
    );
  } else if (hasSeatbid && !resp.seatbid.length) {
    findings.push(
      F('response.30.seatbid_empty_no_nbr', LEVELS.ERROR, 'openrtb.response.seatbid'),
    );
  }

  // R5. Per-seatbid → per-bid structural checks (id + item ref + price).
  //     3.0 bids carry `item` (the request item id) instead of 2.x `impid`.
  (resp.seatbid || []).forEach((sb, i) => {
    const sNum = i + 1;
    const sp = `openrtb.response.seatbid[${i}]`;
    if (!isObj(sb)) return;
    if (!Array.isArray(sb.bid) || !sb.bid.length) {
      findings.push(F('response.30.seatbid.empty', LEVELS.ERROR, `${sp}.bid`, { num: sNum }));
      return;
    }
    sb.bid.forEach((b, j) => {
      const bNum = j + 1;
      const bp = `${sp}.bid[${j}]`;
      const params = { sNum, bNum };
      if (!isObj(b)) {
        findings.push(F('response.30.bid.invalid', LEVELS.ERROR, bp, params));
        return;
      }
      if (!isStr(b.id)) {
        findings.push(F('response.30.bid.id_required', LEVELS.ERROR, `${bp}.id`, params));
      }
      // 3.0 uses `item` (string) to reference the request's item.id.
      if (!isStr(b.item)) {
        findings.push(F('response.30.bid.item_required', LEVELS.ERROR, `${bp}.item`, params));
      }
      // price required (same as 2.x)
      if (!isNum(b.price)) {
        findings.push(F('response.30.bid.price_required', LEVELS.ERROR, `${bp}.price`, params));
      }
    });
  });

  findings.push(F('response.30.deep_validation_limited', LEVELS.INFO, ''));
  return findings;
}

module.exports = { validateResponse30 };
