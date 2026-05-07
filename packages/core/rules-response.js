'use strict';

/**
 * IAB OpenRTB 2.x BidResponse validation rules. Pure spec — dialect-specific
 * macro/header/seat rules layer on top via ctx.dialect.validateResponse.
 */

const { isStr, isNum } = require('./helpers');
const { LEVELS, makeFinding } = require('./findings');

const F = makeFinding;

function validateResponse(res, ctx) {
  const findings = [];
  const dialect = (ctx && ctx.dialect) || null;

  if (!isStr(res.id)) findings.push(F('response.id_required', LEVELS.ERROR, 'id'));
  if (!Array.isArray(res.seatbid)) {
    findings.push(F('response.seatbid_required', LEVELS.ERROR, 'seatbid'));
  }

  (res.seatbid || []).forEach((sb, i) => {
    const sNum = i + 1;
    const sp = `seatbid[${i}]`;
    if (!Array.isArray(sb.bid) || !sb.bid.length) {
      findings.push(F('response.seatbid.empty', LEVELS.ERROR, `${sp}.bid`, { num: sNum }));
    }

    (sb.bid || []).forEach((b, j) => {
      const bNum = j + 1;
      const bp = `${sp}.bid[${j}]`;
      const params = { sNum, bNum };

      if (!isStr(b.id))
        findings.push(F('response.bid.id_required', LEVELS.ERROR, `${bp}.id`, params));
      if (!isStr(b.impid)) {
        findings.push(F('response.bid.impid_required', LEVELS.ERROR, `${bp}.impid`, params));
      }
      if (!isNum(b.price)) {
        findings.push(F('response.bid.price_required', LEVELS.ERROR, `${bp}.price`, params));
      }
      if (!isStr(b.adm) && !isStr(b.nurl)) {
        // Vendor dialects can declare that they "claim" bids of a custom
        // shape (e.g. Kadam In-Page Push carries the creative in
        // bid.ext.{title,image,url} instead of adm/nurl). When a dialect
        // claims the bid, skip the IAB payload-missing rule — the dialect's
        // own validateResponse will assert the correct shape and we'd
        // otherwise drown the real findings in noise. Default IAB dialect
        // exposes no claimsBid → check always fires.
        const claimed = dialect && typeof dialect.claimsBid === 'function' && dialect.claimsBid(b);
        if (!claimed) {
          findings.push(F('response.bid.payload_missing', LEVELS.WARNING, `${bp}.adm`, params));
        }
      }
      if (!Array.isArray(b.adomain) || !b.adomain.length) {
        findings.push(F('response.bid.adomain_missing', LEVELS.WARNING, `${bp}.adomain`, params));
      }
    });
  });

  // Dialect overlay (e.g. Kadam macro support check)
  if (dialect && typeof dialect.validateResponse === 'function') {
    findings.push(...dialect.validateResponse(res));
  }

  return findings;
}

module.exports = { validateResponse };
