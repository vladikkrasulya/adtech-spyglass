'use strict';

/**
 * IAB OpenRTB 2.x BidResponse validation rules. Pure spec — dialect-specific
 * macro/header/seat rules layer on top via ctx.dialect.validateResponse.
 */

const { isStr, isNum } = require('./helpers');
const { LEVELS, makeFinding } = require('./findings');
// Static creative scan — the same engine that fires `behavior.static.*` from
// the runtime probe also runs purely from string adm. Plumbed in 2026-05-09:
// previously a user pasting just a BidResponse with `eval(atob('...'))` in
// adm got 0 findings here (the malware engine only ran via the iframe
// behavior tab). Now obfuscation/miner/XSS/high-entropy fire on the
// validate-response path too.
const staticRules = require('./behavior/rules/static');
const { scanCreative } = staticRules;
// VAST XML rules — fire when bid.adm is VAST-shaped. Sniff is the same
// helper used by format-detect.js + crosscheck.js (one anchored regex,
// not three near-duplicates).
const { validateVast, isVastShape } = require('./rules-vast');

const F = makeFinding;

function validateResponse(res, ctx) {
  const findings = [];
  const dialect = (ctx && ctx.dialect) || null;

  if (!isStr(res.id)) findings.push(F('response.id_required', LEVELS.ERROR, 'id'));

  // oRTB §3.3.1 — a no-bid response is `{ id, nbr }` (no seatbid). It is
  // a perfectly valid shape and used in production whenever the exchange
  // can't or won't bid. Surface as INFO with the human-readable reason.
  // If both seatbid AND nbr are absent, that's still ERROR
  // (response.seatbid_or_nbr_required).
  const nbrPresent = isNum(res.nbr);
  const seatbidArr = Array.isArray(res.seatbid);
  if (!seatbidArr && !nbrPresent) {
    findings.push(F('response.seatbid_or_nbr_required', LEVELS.ERROR, 'seatbid'));
  } else if (nbrPresent && (!seatbidArr || !res.seatbid.length)) {
    findings.push(F('response.no_bid', LEVELS.INFO, 'nbr', { nbr: res.nbr }));
  } else if (seatbidArr && !res.seatbid.length) {
    // Empty seatbid array WITHOUT nbr is structurally invalid — the spec
    // says "use nbr to signal no-bid", an empty array is a bug.
    findings.push(F('response.seatbid_empty_no_nbr', LEVELS.ERROR, 'seatbid'));
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

      // Static creative scan — fires obfuscation / miner / XSS-marker /
      // high-entropy-blob findings on the adm string. Previously these
      // only showed up under the runtime Behavior tab; surfacing them on
      // the static validate path means a user pasting just a malicious
      // BidResponse gets the right verdict in the same panel as IAB
      // findings, no probe required.
      if (isStr(b.adm) && b.adm.length) {
        const events = scanCreative(b.adm);
        if (events.length) {
          for (const rule of staticRules) {
            const ruleFindings = rule(events);
            for (const f of ruleFindings) {
              f.path = `${bp}.adm`;
              f.params = Object.assign({ sNum, bNum }, f.params || {});
              findings.push(f);
            }
          }
        }

        // VAST XML rules — fire ONLY when adm is VAST-shaped (anchored
        // sniff). Banner / native HTML adm strings skip this entirely.
        if (isVastShape(b.adm)) {
          const vastFindings = validateVast(b.adm, `${bp}.adm`);
          for (const f of vastFindings) {
            f.params = Object.assign({ sNum, bNum }, f.params || {});
            findings.push(f);
          }
        }
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
