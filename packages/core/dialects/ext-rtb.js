'use strict';

/**
 * Extended RTB dialect overlay. Adds rules that are NOT in the IAB base spec
 * but matter for ext-rtb-routed traffic:
 *
 *   - ext.bsection / ext.btags (vendor blocking taxonomies, must be int arrays)
 *   - ext.subage* and site.ext.idzone — push-traffic detection
 *   - macro support — only AUCTION_PRICE/CURRENCY/LOSS are honored
 *
 * Stays SEPARATE from rules-request.js / rules-response.js so the default IAB
 * dialect never surfaces ext-rtb-only "warnings" that aren't in the spec.
 */

const { LEVELS, makeFinding } = require('../findings');

const F = makeFinding;

const SUPPORTED_MACROS = new Set(['AUCTION_PRICE', 'AUCTION_CURRENCY', 'AUCTION_LOSS']);

function validateRequest(req) {
  const findings = [];

  const ext = req.ext || {};
  if (ext.bsection && !Array.isArray(ext.bsection)) {
    findings.push(F('extrtb.ext.bsection_invalid', LEVELS.WARNING, 'ext.bsection'));
  }
  if (ext.btags && !Array.isArray(ext.btags)) {
    findings.push(F('extrtb.ext.btags_invalid', LEVELS.WARNING, 'ext.btags'));
  }

  let isPush = false;
  (req.imp || []).forEach((imp, i) => {
    const num = i + 1;
    const p = `imp[${i}]`;
    const impExt = imp.ext || {};
    const sitePush =
      req.site && req.site.ext && req.site.ext.idzone ? String(req.site.ext.idzone) : '';
    const isLikelyPush = !!(
      impExt.subage != null ||
      impExt.subage0 != null ||
      impExt.subage_dt ||
      impExt.subage_ts ||
      /push|sub/i.test(sitePush)
    );
    if (isLikelyPush) {
      isPush = true;
      if (impExt.subage == null) {
        findings.push(F('extrtb.imp.subage_missing', LEVELS.WARNING, `${p}.ext.subage`, { num }));
      }
    }
  });

  if (isPush) {
    findings.push(F('extrtb.push_detected', LEVELS.INFO, 'imp.ext'));
  }

  return findings;
}

function validateResponse(res) {
  const findings = [];
  const macroRe = /\$\{(\w+)\}/g;

  (res.seatbid || []).forEach((sb, sbi) => {
    (sb.bid || []).forEach((bid, bi) => {
      const sNum = sbi + 1;
      const bNum = bi + 1;
      const bp = `seatbid[${sbi}].bid[${bi}]`;
      const seen = new Set();
      ['nurl', 'burl', 'lurl', 'adm'].forEach((k) => {
        const v = bid[k];
        if (typeof v !== 'string') return;
        let m;
        while ((m = macroRe.exec(v))) seen.add(m[1]);
        macroRe.lastIndex = 0;
      });
      seen.forEach((macro) => {
        if (!SUPPORTED_MACROS.has(macro)) {
          findings.push(
            F('extrtb.bid.macro_unsupported', LEVELS.WARNING, bp, { sNum, bNum, macro }),
          );
        }
      });
    });
  });

  return findings;
}

module.exports = { name: 'ext-rtb', validateRequest, validateResponse };
