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

const C = makeCross;

function crosscheck(req, res, _ctx) {
  // _ctx.dialect is reserved for future dialect-aware crosscheck rules
  // (e.g. Kadam-specific bid.ext.bsection expectations). Today the rules
  // here are spec-agnostic; the param is accepted to keep the call shape
  // stable.
  const out = [];

  if (!isObj(req) || !Array.isArray(req.imp)) {
    return [C('crosscheck.no_request', false, CROSS_LEVELS.CRIT, 'req')];
  }
  if (!isObj(res)) {
    return [C('crosscheck.no_response', false, CROSS_LEVELS.CRIT, 'res')];
  }
  // No-bid response (oRTB §3.3.1: just `id` + `nbr` reason code) is a valid
  // shape; crosscheck has nothing to do. rules-response surfaces the INFO
  // finding for the no-bid case so users still see *why* there's no bid.
  if (typeof res.nbr === 'number' && (!Array.isArray(res.seatbid) || !res.seatbid.length)) {
    return [];
  }
  if (!Array.isArray(res.seatbid) || !res.seatbid.length) {
    return [C('crosscheck.no_response', false, CROSS_LEVELS.CRIT, 'res')];
  }

  // 1. id match
  if (res.id === req.id) {
    out.push(C('crosscheck.id_match', true, CROSS_LEVELS.OK, 'id', { id: req.id }));
  } else {
    out.push(
      C('crosscheck.id_mismatch', false, CROSS_LEVELS.CRIT, 'id', {
        reqId: req.id,
        resId: res.id,
      }),
    );
  }

  // 2. currency
  // Per oRTB §3.3: response without `cur` defaults to USD. If the request
  // explicitly excludes USD, that default-fallback is a real mismatch — the
  // bid would settle in a currency the exchange refuses. Easy to miss when
  // the response is silent about it; surface explicitly.
  const reqCur = Array.isArray(req.cur) ? req.cur : ['USD'];
  if (res.cur && !reqCur.includes(res.cur)) {
    out.push(
      C('crosscheck.cur_not_in_request', false, CROSS_LEVELS.WARN, 'cur', {
        cur: res.cur,
        allowed: JSON.stringify(reqCur),
      }),
    );
  } else if (res.cur) {
    out.push(C('crosscheck.cur_allowed', true, CROSS_LEVELS.OK, 'cur', { cur: res.cur }));
  } else if (Array.isArray(req.cur) && req.cur.length && !req.cur.includes('USD')) {
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
        if (price >= floor) {
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

      // 3c. bcat
      if (Array.isArray(bid.cat) && bcat.size) {
        const violated = bid.cat.filter((c) => bcat.has(c));
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
  const topPrice = Math.max(0, ...winningByImp.values()).toFixed(4);
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

/**
 * Compare request native asset declaration against response native assets.
 * Returns { requiredIds, providedIds, missing, extra } or { errorKey } on parse failure.
 */
function nativeAssetCrosscheck(impNative, adm) {
  let nativeReq;
  try {
    nativeReq =
      typeof impNative.request === 'string' ? JSON.parse(impNative.request) : impNative.request;
  } catch {
    return { errorKey: 'crosscheck.bid.native_invalid_request' };
  }
  const requestedAssets =
    nativeReq && nativeReq.native && Array.isArray(nativeReq.native.assets)
      ? nativeReq.native.assets
      : [];
  const requiredIds = requestedAssets
    .filter((a) => a && a.required === 1 && a.id != null)
    .map((a) => Number(a.id));
  const allRequestIds = requestedAssets.filter((a) => a && a.id != null).map((a) => Number(a.id));

  let nativeRes;
  try {
    nativeRes = typeof adm === 'string' ? JSON.parse(adm) : adm;
  } catch {
    return { errorKey: 'crosscheck.bid.native_invalid_adm' };
  }
  const responseAssets =
    nativeRes && nativeRes.native && Array.isArray(nativeRes.native.assets)
      ? nativeRes.native.assets
      : [];
  const providedIds = responseAssets.filter((a) => a && a.id != null).map((a) => Number(a.id));

  const provided = new Set(providedIds);
  const missing = requiredIds.filter((id) => !provided.has(id));
  const allReq = new Set(allRequestIds);
  const extra = providedIds.filter((id) => !allReq.has(id));

  return { requiredIds, providedIds, missing, extra };
}

module.exports = { crosscheck, nativeAssetCrosscheck };
