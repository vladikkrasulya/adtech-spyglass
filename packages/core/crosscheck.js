'use strict';

/**
 * Semantic crosscheck between BidRequest and BidResponse. Goes beyond schema
 * validation: id alignment, currency, impid resolution, price vs floor,
 * bcat/badv enforcement, banner size match, native asset back-reference,
 * VAST detection in adm. Also emits an auction summary.
 *
 * Findings carry { id, ok, level, path, params, detail? } per ARCHITECTURE
 * §3.2 — caller resolves localized text from `id`+`params` at presentation.
 */

const { isObj } = require('./helpers');
const { CROSS_LEVELS, makeCross } = require('./findings');
const { isVastShape } = require('./format-detect');
const { scanExtForFormatHints, isPopFormat, extractPopLandingHost } = require('./non-iab-formats');

const C = makeCross;

function crosscheck(req, res, _ctx) {
  // _ctx.dialect is reserved for future dialect-aware crosscheck rules
  // (e.g. vendor-specific bid.ext.bsection expectations). Today the rules
  // here are spec-agnostic; the param is accepted to keep the call shape
  // stable.
  const out = [];

  if (!isObj(req) || !Array.isArray(req.imp)) {
    return [C('crosscheck.no_request', false, CROSS_LEVELS.CRIT, 'req')];
  }
  if (!isObj(res)) {
    return [C('crosscheck.no_response', false, CROSS_LEVELS.CRIT, 'res')];
  }
  // No-bid response (oRTB §3.3.1: just `id` + `nbr` reason code) still
  // carries the request id and that id MUST match — a no-bid for the
  // wrong request id is a real exchange bug. Run the id check FIRST,
  // then early-return on no-bid so the rest of crosscheck (bcat / badv /
  // floor compare) doesn't run against an absent seatbid.
  const idFinding =
    res.id === req.id
      ? C('crosscheck.id_match', true, CROSS_LEVELS.OK, 'id', { id: req.id })
      : C('crosscheck.id_mismatch', false, CROSS_LEVELS.CRIT, 'id', {
          reqId: req.id,
          resId: res.id,
        });

  if (typeof res.nbr === 'number' && (!Array.isArray(res.seatbid) || !res.seatbid.length)) {
    return [idFinding];
  }
  if (!Array.isArray(res.seatbid) || !res.seatbid.length) {
    return [C('crosscheck.no_response', false, CROSS_LEVELS.CRIT, 'res')];
  }

  // 1. id match (already computed above, push now so order matches pre-fix)
  out.push(idFinding);

  // 2. currency
  // Per oRTB §3.3: response without `cur` defaults to USD. If the request
  // explicitly excludes USD, that default-fallback is a real mismatch — the
  // bid would settle in a currency the exchange refuses. Easy to miss when
  // the response is silent about it; surface explicitly.
  //
  // ISO 4217 codes are case-insensitive by spec. Real-world feeds sometimes
  // ship lowercase ("usd") — uppercase-normalize both sides before compare
  // so we don't fire a `cur_not_in_request` false-positive on the case alone.
  const reqCur = Array.isArray(req.cur) ? req.cur : ['USD'];
  const reqCurUp = reqCur.map((c) => (typeof c === 'string' ? c.toUpperCase() : c));
  const resCurUp = typeof res.cur === 'string' ? res.cur.toUpperCase() : res.cur;
  if (res.cur && !reqCurUp.includes(resCurUp)) {
    out.push(
      C('crosscheck.cur_not_in_request', false, CROSS_LEVELS.WARN, 'cur', {
        cur: res.cur,
        allowed: JSON.stringify(reqCur),
      }),
    );
  } else if (res.cur) {
    out.push(C('crosscheck.cur_allowed', true, CROSS_LEVELS.OK, 'cur', { cur: res.cur }));
  } else if (Array.isArray(req.cur) && req.cur.length && !reqCurUp.includes('USD')) {
    out.push(
      C('crosscheck.cur_default_usd_mismatch', false, CROSS_LEVELS.WARN, 'cur', {
        allowed: JSON.stringify(reqCur),
      }),
    );
  }

  // index imp by id for O(1) bid.impid resolution
  const impById = new Map();
  for (const imp of req.imp) if (imp && imp.id) impById.set(imp.id, imp);

  const bcat = Array.isArray(req.bcat) ? new Set(req.bcat) : new Set();
  const badv = Array.isArray(req.badv) ? new Set(req.badv) : new Set();
  let totalBids = 0;
  let bidsAboveFloor = 0;
  const winningByImp = new Map();
  // Track imps for which we've already noted "no explicit floor" so we
  // emit at most one finding per slot regardless of how many bids hit it.
  const floorNoteEmitted = new Set();

  res.seatbid.forEach((sb, sbi) => {
    const bids = Array.isArray(sb.bid) ? sb.bid : [];
    bids.forEach((bid, bi) => {
      totalBids++;
      const bp = `seatbid[${sbi}].bid[${bi}]`;
      const sNum = sbi + 1;
      const bNum = bi + 1;
      const baseParams = { sNum, bNum };

      // 3a. impid resolution
      const imp = impById.get(bid.impid);
      if (!imp) {
        out.push(
          C('crosscheck.bid.impid_unresolved', false, CROSS_LEVELS.CRIT, `${bp}.impid`, {
            ...baseParams,
            impid: bid.impid,
          }),
        );
        return;
      }
      out.push(
        C('crosscheck.bid.impid_resolved', true, CROSS_LEVELS.OK, `${bp}.impid`, {
          ...baseParams,
          impid: bid.impid,
        }),
      );

      // 3b. price vs floor
      // bid.price is REQUIRED per oRTB §3.2.5. Number(null|undefined|"abc")
      // collapses to NaN, then `|| 0` would silently make a broken bid LOOK
      // like 0 — which then false-positive passes a 0-floor and pollutes
      // bidsAboveFloor + topPrice. Surface invalid prices as their own CRIT
      // finding and skip the floor compare. bcat/badv/sizes still run.
      //
      // imp.bidfloor is OPTIONAL per spec — missing means "no minimum" (=0).
      // Spec-valid, but operationally a "no floor" auction means every bid
      // above 0 wins on price alone. Surface it as WARN once per imp so the
      // integrator sees that the price-vs-floor compare is degenerate.
      const hasExplicitFloor =
        imp.bidfloor !== undefined && imp.bidfloor !== null && imp.bidfloor !== '';
      if (!hasExplicitFloor && !floorNoteEmitted.has(bid.impid)) {
        const impIdx = req.imp.findIndex((i) => i && i.id === bid.impid);
        out.push(
          C(
            'crosscheck.bid.no_floor_set',
            false,
            CROSS_LEVELS.WARN,
            impIdx >= 0 ? `imp[${impIdx}].bidfloor` : 'imp.bidfloor',
            { impid: bid.impid },
          ),
        );
        floorNoteEmitted.add(bid.impid);
      }
      const floor = Number(imp.bidfloor) || 0;
      const priceRaw = bid.price;
      const priceIsValid =
        priceRaw !== null && priceRaw !== undefined && Number.isFinite(Number(priceRaw));
      if (!priceIsValid) {
        out.push(
          C('crosscheck.bid.price_invalid', false, CROSS_LEVELS.CRIT, `${bp}.price`, {
            ...baseParams,
            raw: priceRaw === undefined ? 'undefined' : JSON.stringify(priceRaw),
          }),
        );
      } else {
        const price = Number(priceRaw);
        const priceParams = {
          ...baseParams,
          price: price.toFixed(4),
          floor: floor.toFixed(4),
        };
        // Currency-safety: bid prices settle in the response currency, while the
        // floor is denominated in imp.bidfloorcur (default = request currency).
        // Comparing the raw numbers across currencies is meaningless without an
        // FX rate, so when they differ we flag the mismatch instead of emitting a
        // bogus above/below-floor verdict. (cur_not_in_request covers res.cur vs
        // req.cur separately; this catches the floor-vs-bid denomination.)
        const floorCur =
          (typeof imp.bidfloorcur === 'string' ? imp.bidfloorcur.toUpperCase() : null) ||
          reqCurUp[0] ||
          'USD';
        const bidCur = resCurUp || reqCurUp[0] || 'USD';
        if (hasExplicitFloor && floor > 0 && floorCur !== bidCur) {
          out.push(
            C('crosscheck.bid.floor_currency_mismatch', false, CROSS_LEVELS.WARN, `${bp}.price`, {
              ...priceParams,
              bidCur: bidCur,
              floorCur: floorCur,
            }),
          );
          // Can't rank against the floor, but the bid is still a winning-bid contender.
          const cur = winningByImp.get(bid.impid) || 0;
          if (price > cur) winningByImp.set(bid.impid, price);
        } else if (price >= floor) {
          bidsAboveFloor++;
          out.push(
            C('crosscheck.bid.above_floor', true, CROSS_LEVELS.OK, `${bp}.price`, priceParams),
          );
          const cur = winningByImp.get(bid.impid) || 0;
          if (price > cur) winningByImp.set(bid.impid, price);
        } else {
          out.push(
            C('crosscheck.bid.below_floor', false, CROSS_LEVELS.CRIT, `${bp}.price`, priceParams),
          );
        }
      }

      // 3c. bcat — hierarchical match.
      // IAB Content Taxonomy uses hyphen-separated hierarchy: in 1.x
      // "IAB1" is the top-level category and "IAB1-1" is a leaf under it;
      // in 2.x the equivalent is plain "1" and "1-7". A blocker that lists
      // a parent ("IAB1" or "1") must also reject any child whose id starts
      // with `<parent>-…`. Pre-v0.25.0 we did exact-string match only, so a
      // bid with cat=["IAB1-1"] could clear a bcat=["IAB1"] block (false
      // clean verdict). Strict prefix `${parent}-` prevents accidentally
      // matching siblings like "IAB10" against bcat=["IAB1"].
      if (Array.isArray(bid.cat) && bcat.size) {
        const violated = bid.cat.filter((c) => {
          if (typeof c !== 'string') return false;
          if (bcat.has(c)) return true;
          for (const blocked of bcat) {
            if (typeof blocked !== 'string') continue;
            if (c.startsWith(blocked + '-')) return true;
          }
          return false;
        });
        if (violated.length) {
          out.push(
            C('crosscheck.bid.cat_blocked', false, CROSS_LEVELS.CRIT, `${bp}.cat`, {
              ...baseParams,
              categories: JSON.stringify(violated),
            }),
          );
        } else {
          out.push(C('crosscheck.bid.cat_clean', true, CROSS_LEVELS.OK, `${bp}.cat`, baseParams));
        }
      }

      // 3d. badv
      if (Array.isArray(bid.adomain) && badv.size) {
        const violated = bid.adomain.filter((d) => badv.has(d));
        if (violated.length) {
          out.push(
            C('crosscheck.bid.adomain_blocked', false, CROSS_LEVELS.CRIT, `${bp}.adomain`, {
              ...baseParams,
              domains: JSON.stringify(violated),
            }),
          );
        }
      }

      // 3d-pop. adomain vs landing host for pop bids
      //
      // Pops bypass the publisher's anti-phishing list and the user only
      // sees the LANDING domain after the new tab opens. If bid.adomain
      // (= the advertiser the SSP/exchange thinks it's buying for) doesn't
      // match the host the adm actually navigates to, that's either a
      // mis-declared advertiser (operational) or an outright spoof
      // (security). Both deserve a CRIT.
      //
      // Heuristic match: exact eTLD+1 equality, OR landing host is a
      // subdomain of an adomain entry. ("ads.brand.com" ⊆ "brand.com" OK.)
      // Anything else → mismatch.
      const isPopBid =
        isObj(bid.ext) && scanExtForFormatHints(bid.ext, '').some((h) => isPopFormat(h.format));
      if (isPopBid && typeof bid.adm === 'string' && Array.isArray(bid.adomain)) {
        const landingHost = extractPopLandingHost(bid.adm);
        if (landingHost && bid.adomain.length) {
          const adomainLc = bid.adomain
            .filter((d) => typeof d === 'string')
            .map((d) =>
              d
                .toLowerCase()
                .replace(/^https?:\/\//, '')
                .replace(/\/.*$/, ''),
            );
          const matches = adomainLc.some(
            (ad) => landingHost === ad || landingHost.endsWith('.' + ad),
          );
          if (!matches) {
            out.push(
              C(
                'crosscheck.bid.pop.adomain_landing_mismatch',
                false,
                CROSS_LEVELS.CRIT,
                `${bp}.adm`,
                {
                  ...baseParams,
                  declared: JSON.stringify(adomainLc),
                  landing: landingHost,
                },
              ),
            );
          } else {
            out.push(
              C('crosscheck.bid.pop.adomain_landing_match', true, CROSS_LEVELS.OK, `${bp}.adm`, {
                ...baseParams,
                host: landingHost,
              }),
            );
          }
        }
      }

      // 3e. banner size
      if (imp.banner && (bid.w || bid.h)) {
        const formatList = Array.isArray(imp.banner.format) ? imp.banner.format : [];
        const declared = imp.banner.w && imp.banner.h ? [{ w: imp.banner.w, h: imp.banner.h }] : [];
        const allSizes = [...declared, ...formatList];
        const fits = allSizes.some(
          (f) => Number(f.w) === Number(bid.w) && Number(f.h) === Number(bid.h),
        );
        if (allSizes.length && !fits) {
          out.push(
            C('crosscheck.bid.size_mismatch', false, CROSS_LEVELS.WARN, `${bp}.size`, {
              ...baseParams,
              w: bid.w,
              h: bid.h,
              allowed: allSizes.map((f) => `${f.w}×${f.h}`).join(', '),
            }),
          );
        } else if (allSizes.length) {
          out.push(
            C('crosscheck.bid.size_match', true, CROSS_LEVELS.OK, `${bp}.size`, {
              ...baseParams,
              w: bid.w,
              h: bid.h,
            }),
          );
        }
      }

      // 3f. native asset crossmatch
      if (imp.native && bid.adm) {
        const cm = nativeAssetCrosscheck(imp.native, bid.adm);
        if (cm.errorKey) {
          out.push(C(cm.errorKey, false, CROSS_LEVELS.WARN, `${bp}.adm`, baseParams));
        } else {
          if (cm.missing.length) {
            out.push(
              C(
                'crosscheck.bid.native_missing_assets',
                false,
                CROSS_LEVELS.CRIT,
                `${bp}.adm`,
                {
                  ...baseParams,
                  missing: cm.missing.join(', '),
                },
                cm,
              ),
            );
          } else {
            out.push(
              C(
                'crosscheck.bid.native_complete',
                true,
                CROSS_LEVELS.OK,
                `${bp}.adm`,
                {
                  ...baseParams,
                  count: cm.requiredIds.length,
                },
                cm,
              ),
            );
          }
          if (cm.extra.length) {
            out.push(
              C(
                'crosscheck.bid.native_extra_assets',
                false,
                CROSS_LEVELS.WARN,
                `${bp}.adm`,
                {
                  ...baseParams,
                  extra: cm.extra.join(', '),
                },
                cm,
              ),
            );
          }
        }
      }

      // 3g. video VAST. Sniff via the canonical helper so this file and
      //     rules-vast.js share the same anchored regex.
      if (imp.video && bid.adm) {
        const isVast = isVastShape(String(bid.adm));
        out.push(
          C(
            isVast ? 'crosscheck.bid.video_vast' : 'crosscheck.bid.video_not_vast',
            isVast,
            isVast ? CROSS_LEVELS.OK : CROSS_LEVELS.WARN,
            `${bp}.adm`,
            baseParams,
          ),
        );
      }
    });
  });

  // 4. summary
  const impsTotal = req.imp.length;
  const impsFilled = winningByImp.size;
  // Math.max(0, ...arr) hits stack-arg limits on responses with many
  // thousand bids (spread copies each into call args). Reduce avoids it.
  let topPriceN = 0;
  for (const v of winningByImp.values()) if (v > topPriceN) topPriceN = v;
  const topPrice = topPriceN.toFixed(4);
  out.push(
    C('crosscheck.auction.summary', true, CROSS_LEVELS.OK, 'auction', {
      totalBids,
      bidsAboveFloor,
      impsFilled,
      impsTotal,
      topPrice,
    }),
  );

  return out;
}

// Try to parse a native payload that may be wrapped in 1-3 layers of
// base64. Some SSPs ship adm as `base64(JSON)`; a smaller subset double-
// or triple-wrap (Prebid passthrough, vendor obfuscation). Depth cap of
// 3 keeps malformed inputs from looping if every layer happens to look
// base64-ish.
function tryParseNativePayload(s) {
  if (typeof s !== 'string') return s;
  const isB64ish = (v) => /^[A-Za-z0-9+/=_-]+$/.test(v.replace(/\s+/g, ''));
  const b64decode = (v) =>
    typeof atob === 'function' ? atob(v) : Buffer.from(v, 'base64').toString('utf-8');
  let cur = s;
  let firstErr;
  for (let depth = 0; depth <= 3; depth++) {
    try {
      return JSON.parse(cur);
    } catch (e) {
      if (!firstErr) firstErr = e;
      if (!isB64ish(cur)) throw firstErr;
      try {
        cur = b64decode(cur);
      } catch {
        throw firstErr;
      }
    }
  }
  throw firstErr;
}

/**
 * Compare request native asset declaration against response native assets.
 * Returns { requiredIds, providedIds, missing, extra } or { errorKey } on parse failure.
 */
function nativeAssetCrosscheck(impNative, adm) {
  let nativeReq;
  try {
    nativeReq =
      typeof impNative.request === 'string'
        ? tryParseNativePayload(impNative.request)
        : impNative.request;
  } catch {
    return { errorKey: 'crosscheck.bid.native_invalid_request' };
  }
  // IAB Native 1.x allows both `{native:{assets}}` (wrapped) and bare
  // `{assets}` shapes — some SSPs strip the envelope. Accept either so a
  // bare-shape payload doesn't get its assets treated as empty (which
  // would false-positive every required asset as missing).
  const reqInner = (nativeReq && nativeReq.native) || nativeReq || {};
  const requestedAssets = Array.isArray(reqInner.assets) ? reqInner.assets : [];
  const requiredIds = requestedAssets
    .filter((a) => a && a.required === 1 && a.id != null)
    .map((a) => Number(a.id));
  const allRequestIds = requestedAssets.filter((a) => a && a.id != null).map((a) => Number(a.id));

  let nativeRes;
  try {
    nativeRes = typeof adm === 'string' ? tryParseNativePayload(adm) : adm;
  } catch {
    return { errorKey: 'crosscheck.bid.native_invalid_adm' };
  }
  const resInner = (nativeRes && nativeRes.native) || nativeRes || {};
  const responseAssets = Array.isArray(resInner.assets) ? resInner.assets : [];
  const providedIds = responseAssets.filter((a) => a && a.id != null).map((a) => Number(a.id));

  const provided = new Set(providedIds);
  const missing = requiredIds.filter((id) => !provided.has(id));
  const allReq = new Set(allRequestIds);
  const extra = providedIds.filter((id) => !allReq.has(id));

  return { requiredIds, providedIds, missing, extra };
}

module.exports = { crosscheck, nativeAssetCrosscheck };
