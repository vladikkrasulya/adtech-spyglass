'use strict';

/**
 * IAB OpenRTB 2.x BidResponse validation rules. Pure spec — dialect-specific
 * macro/header/seat rules layer on top via ctx.dialect.validateResponse.
 */

const { isObj, isStr, isNum } = require('./helpers');
const { isValidDomain } = require('./utils/domain');
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
// Pop sniff: lets us skip static creative scan on bare-URL pop adm where
// the obfuscation/entropy heuristics produce false positives on b64-laden
// query strings.
const { admLooksLikePop } = require('./non-iab-formats');

const F = makeFinding;

// Win/billing/loss notices are optional, but when present OpenRTB defines
// them as URLs. Treat malformed values as WARNING rather than ERROR: a bidder
// can still clear the price auction while the exchange ignores a broken
// callback (exactly the operational distinction the Inspector needs to make).
//
// Replace macro templates before parsing so standard forms such as
// `https://dsp.example/win?p=${AUCTION_PRICE}` remain valid. Exact CDATA
// wrappers are tolerated because they are common at XML/JSON adapter
// boundaries even though the parsed OpenRTB value normally has no wrapper.
const NOTICE_FIELDS = ['nurl', 'burl', 'lurl'];
const NOTICE_MACRO_RE = /\$\{[A-Za-z0-9_]+(?::[A-Za-z0-9_]+)?\}/g;

function isValidNoticeUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  let candidate = value;
  if (candidate.startsWith('<![CDATA[') && candidate.endsWith(']]>')) {
    // Trim inside the wrapper: an XML boundary is exactly where the value
    // arrives newline-padded (`<![CDATA[ https://… ]]>`), and this product's
    // own macro evaluator (cleanRawUrl) accepts that form. Without the trim
    // the surviving whitespace hit the guard below and the only CDATA shape
    // real adapters emit was the one shape this tolerance failed to cover.
    candidate = candidate.slice(9, -3).trim();
  }
  // URL() helpfully percent-encodes raw markup/whitespace. Notice fields are
  // wire templates, so accepting those characters would hide adapter
  // concatenation bugs (for example an iframe accidentally appended to burl).
  const hasControl = Array.from(candidate).some((ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (!candidate || hasControl || /[\s<>"'`]/.test(candidate)) return false;
  candidate = candidate.replace(NOTICE_MACRO_RE, '0');
  try {
    const parsed = new URL(candidate);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
  } catch {
    return false;
  }
}

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

  // Array.isArray, not `|| []` — on both `seatbid` and `bid` below.
  //
  // The `|| []` form defends against null and undefined and against nothing
  // else: a bare object passes it untouched and then `({}).forEach` throws a
  // TypeError. Both fields arrive as bare objects from adapters that emit a
  // single element without its wrapper (`seatbid: {seat, bid: […]}`,
  // `bid: {id, impid, price}`), which is precisely the "field is present,
  // type is wrong" class this validator exists to name.
  //
  // Nothing between here and the HTTP layer catches that throw — core's
  // validate() has no try around validateResponse — so the operator's
  // answer was an HTTP 400 whose body read "(sb.bid || []).forEach is not a
  // function": no verdict, no findings, and a message about our source code
  // rather than their payload.
  //
  // Both malformed shapes are already reported by the checks above and just
  // below (seatbid_or_nbr_required for a non-array seatbid, seatbid.empty for
  // a non-array bid), so the loops need no new finding — only to stop
  // destroying the response that carries them. This mirrors the `seatbid:
  // [null]` / `bid: [null]` coercions already inside the loops: same class of
  // defect, one level further out.
  const seats = Array.isArray(res.seatbid) ? res.seatbid : [];
  seats.forEach((sb, i) => {
    const sNum = i + 1;
    const sp = `seatbid[${i}]`;
    // R4: tolerate `seatbid:[null]` — coerce so `.bid` checks fire instead of throwing.
    if (!isObj(sb)) sb = {};
    if (!Array.isArray(sb.bid) || !sb.bid.length) {
      findings.push(F('response.seatbid.empty', LEVELS.ERROR, `${sp}.bid`, { num: sNum }));
    }

    const bids = Array.isArray(sb.bid) ? sb.bid : [];
    bids.forEach((b, j) => {
      const bNum = j + 1;
      const bp = `${sp}.bid[${j}]`;
      const params = { sNum, bNum };

      // R4: tolerate `bid:[null]` — coerce so id/impid/price checks fire instead of throwing.
      if (!isObj(b)) b = {};
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
        // shape (e.g. In-Page Push carries the creative in
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
      for (const field of NOTICE_FIELDS) {
        if (b[field] != null && !isValidNoticeUrl(b[field])) {
          findings.push(
            F('response.bid.notice_url_invalid', LEVELS.WARNING, `${bp}.${field}`, {
              ...params,
              field,
            }),
          );
        }
      }
      if (!Array.isArray(b.adomain) || !b.adomain.length) {
        findings.push(F('response.bid.adomain_missing', LEVELS.WARNING, `${bp}.adomain`, params));
      } else {
        b.adomain.forEach((domain, k) => {
          if (!isValidDomain(domain)) {
            findings.push(
              F('response.bid.adomain_invalid', LEVELS.ERROR, `${bp}.adomain[${k}]`, {
                ...params,
                domain: domain == null ? '' : String(domain),
              }),
            );
          }
        });
      }

      if (isStr(b.adm) && b.adm.length) {
        // Static creative scan — fires obfuscation / miner / XSS-marker /
        // high-entropy-blob findings on the adm string. Previously these
        // only showed up under the runtime Behavior tab; surfacing them on
        // the static validate path means a user pasting just a malicious
        // BidResponse gets the right verdict in the same panel as IAB
        // findings, no probe required.
        //
        // Skip ONLY pop adm — bare landing URL, not HTML/JS, so the
        // entropy-and-eval heuristics don't apply and would only produce
        // false-positive obfuscation findings on base64-laden query
        // strings. VAST adm IS still scanned because VAST XML can carry
        // malicious tracking-pixel JS or eval blobs in payload that
        // validateVast doesn't check.
        if (!admLooksLikePop(b.adm)) {
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

  // Dialect overlay (e.g. vendor macro support check)
  if (dialect && typeof dialect.validateResponse === 'function') {
    findings.push(...dialect.validateResponse(res));
  }

  return findings;
}

module.exports = { validateResponse };
