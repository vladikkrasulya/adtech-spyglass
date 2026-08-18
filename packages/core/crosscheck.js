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

  // Both sides are read through a VIEW rather than directly. For a 2.x payload
  // the view is the payload itself plus the paths this file always used; for a
  // 3.0 envelope it is a projection of `openrtb.request.item[]` and
  // `openrtb.response.seatbid[].bid[]` into that same shape, carrying the real
  // 3.0 paths so every finding still points at what the user pasted. See
  // buildRequestView() at the bottom of this file for the why.
  const reqView = buildRequestView(req);
  if (!reqView) {
    return [C('crosscheck.no_request', false, CROSS_LEVELS.CRIT, 'req')];
  }
  const resView = buildResponseView(res);
  if (!resView) {
    return [C('crosscheck.no_response', false, CROSS_LEVELS.CRIT, 'res')];
  }
  // No-bid response (oRTB §3.3.1: just `id` + `nbr` reason code) still
  // carries the request id and that id MUST match — a no-bid for the
  // wrong request id is a real exchange bug. Run the id check FIRST,
  // then early-return on no-bid so the rest of crosscheck (bcat / badv /
  // floor compare) doesn't run against an absent seatbid.
  const idFinding =
    resView.id === reqView.id
      ? C('crosscheck.id_match', true, CROSS_LEVELS.OK, `${resView.base}id`, { id: reqView.id })
      : C('crosscheck.id_mismatch', false, CROSS_LEVELS.CRIT, `${resView.base}id`, {
          reqId: reqView.id,
          resId: resView.id,
        });

  const seatbid = resView.seatbid;
  if (typeof resView.nbr === 'number' && (!Array.isArray(seatbid) || !seatbid.length)) {
    return [idFinding];
  }
  if (!Array.isArray(seatbid) || !seatbid.length) {
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
  const reqCur = Array.isArray(reqView.cur) ? reqView.cur : ['USD'];
  const reqCurUp = reqCur.map((c) => (typeof c === 'string' ? c.toUpperCase() : c));
  const resCurUp = typeof resView.cur === 'string' ? resView.cur.toUpperCase() : resView.cur;
  if (resView.cur && !reqCurUp.includes(resCurUp)) {
    out.push(
      C('crosscheck.cur_not_in_request', false, CROSS_LEVELS.WARN, `${resView.base}cur`, {
        cur: resView.cur,
        allowed: JSON.stringify(reqCur),
      }),
    );
  } else if (resView.cur) {
    out.push(
      C('crosscheck.cur_allowed', true, CROSS_LEVELS.OK, `${resView.base}cur`, {
        cur: resView.cur,
      }),
    );
  } else if (Array.isArray(reqView.cur) && reqView.cur.length && !reqCurUp.includes('USD')) {
    out.push(
      C('crosscheck.cur_default_usd_mismatch', false, CROSS_LEVELS.WARN, `${reqView.base}cur`, {
        allowed: JSON.stringify(reqCur),
      }),
    );
  }

  // Index imp by id for O(1) bid.impid resolution.
  //
  // Keys are normalised with String() on BOTH sides. oRTB types `imp.id` and
  // `bid.impid` as strings, but numeric slot ids are common in real feeds, and
  // a Map keyed on the raw value then failed to match `1` against `"1"`. The
  // cost was not one missing finding: an unresolved impid skips the rest of
  // the per-bid block, so price↔floor, bcat, badv and size were never checked
  // and the auction summary reported 0 filled slots / 0.0000 top price for an
  // auction that really cleared. rules/price-floor already normalised with
  // String() at both ends, so the two engines gave opposite answers on the
  // same payload — this is the side that was wrong.
  //
  // `imp.id != null && imp.id !== ''` rather than a truthiness test: `imp.id`
  // of `0` is a perfectly addressable slot id that the old `if (imp && imp.id)`
  // dropped from the index entirely, which fell into the same silent hole.
  const impById = new Map();
  for (const imp of reqView.imp) {
    if (isObj(imp) && imp.id != null && imp.id !== '') impById.set(String(imp.id), imp);
  }

  const bcat = Array.isArray(reqView.bcat) ? new Set(reqView.bcat) : new Set();
  const badv = Array.isArray(reqView.badv) ? new Set(reqView.badv) : new Set();
  let totalBids = 0;
  let bidsAboveFloor = 0;
  const winningByImp = new Map();
  // Track imps for which we've already noted "no explicit floor" so we
  // emit at most one finding per slot regardless of how many bids hit it.
  const floorNoteEmitted = new Set();

  // One entry per real bid, already carrying its display path and the field
  // names to hang leaves off (2.x `impid`/`cat`/`adm` vs 3.0
  // `item`/`media.cat`/`media.display.adm`). The nested forEach that used to
  // live here is inside flattenBids() now, R4 null-tolerance included.
  for (const entry of flattenBids(resView)) {
    const bid = entry.bid;
    const bp = entry.path;
    const leaf = entry.leaf;
    totalBids++;
    const baseParams = { sNum: entry.sNum, bNum: entry.bNum };

    // 3a. impid resolution. Normalised through String() the same way the
    // index was built — see the comment there for what a missed match costs.
    const impKey = bid.impid == null ? null : String(bid.impid);
    const imp = impKey === null ? undefined : impById.get(impKey);
    if (!imp) {
      out.push(
        C('crosscheck.bid.impid_unresolved', false, CROSS_LEVELS.CRIT, `${bp}.${leaf.impid}`, {
          ...baseParams,
          impid: bid.impid,
        }),
      );
      continue;
    }
    out.push(
      C('crosscheck.bid.impid_resolved', true, CROSS_LEVELS.OK, `${bp}.${leaf.impid}`, {
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
    //
    // A floor counts as SET only when it is a finite number, which is the
    // same test rules/price-floor applies (`typeof imp.bidfloor === 'number'`)
    // and the same one `imp.bidfloor_invalid` fires on in rules-request.js.
    // The old test was "present and not empty-string", and everything after
    // it went through `Number(imp.bidfloor) || 0`. Both halves lied, in
    // opposite directions, on inputs that arrive in real feeds:
    //
    //   bidfloor: "1,50"  → not a number, so `|| 0` made it 0.0000, the
    //                       "no explicit floor" WARN was suppressed because
    //                       the field was present, and a 0.65 bid collected a
    //                       green "price 0.6500 ≥ floor 0.0000". We printed a
    //                       floor the request does not contain.
    //   bidfloor: true    → Number(true) is 1, so the bid was declared BELOW a
    //   bidfloor: [1.5]   → 1.0000 / 1.5000 floor that exists nowhere.
    //
    // Both now resolve to "no usable floor": the WARN fires (it is the honest
    // statement — no minimum is in force for this slot), and the numeric
    // verdict is skipped below rather than invented. The request-side
    // `imp.bidfloor_invalid` WARNING already names the malformed field, so
    // nothing is lost by not repeating the type complaint here; a dedicated
    // crosscheck id for it would need text in messages/*.json to render at
    // all, which is the same trade rules/price-floor documents for currency
    // codes.
    const floorRaw = imp.bidfloor;
    const floorPresent = floorRaw !== undefined && floorRaw !== null && floorRaw !== '';
    const hasExplicitFloor = typeof floorRaw === 'number' && Number.isFinite(floorRaw);
    // Present but unusable: distinct from absent, because "absent" has a
    // spec-defined meaning (no minimum = 0) that we CAN compare against,
    // while a garbage floor leaves us with no number at all.
    const floorUnusable = floorPresent && !hasExplicitFloor;
    if (!hasExplicitFloor && !floorNoteEmitted.has(impKey)) {
      const impIdx = reqView.imp.findIndex(
        (i) => isObj(i) && i.id != null && String(i.id) === impKey,
      );
      out.push(
        C(
          'crosscheck.bid.no_floor_set',
          false,
          CROSS_LEVELS.WARN,
          impIdx >= 0
            ? `${reqView.impBase}[${impIdx}].${reqView.floorLeaf}`
            : `${reqView.impBase}.${reqView.floorLeaf}`,
          { impid: bid.impid },
        ),
      );
      floorNoteEmitted.add(impKey);
    }
    const floor = hasExplicitFloor ? floorRaw : 0;
    const priceRaw = bid.price;
    const priceIsValid =
      priceRaw !== null && priceRaw !== undefined && Number.isFinite(Number(priceRaw));
    if (!priceIsValid) {
      out.push(
        C('crosscheck.bid.price_invalid', false, CROSS_LEVELS.CRIT, `${bp}.${leaf.price}`, {
          ...baseParams,
          raw: priceRaw === undefined ? 'undefined' : JSON.stringify(priceRaw),
        }),
      );
    } else if (floorUnusable) {
      // Nothing to compare against, and any number printed here would be one
      // the request does not contain — so no verdict, the same call the
      // currency-mismatch branch below makes for the same reason. The bid is
      // still a winning-bid contender; it just isn't ranked against a floor.
      const price = Number(priceRaw);
      const cur = winningByImp.get(impKey) || 0;
      if (price > cur) winningByImp.set(impKey, price);
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
      // Both `imp.bidfloorcur` and `BidResponse.cur` default to "USD" by
      // spec, independently of `BidRequest.cur` — which is only the list of
      // currencies the exchange ACCEPTS, not a statement about how either
      // figure was priced. Falling through `req.cur[0]` made two different
      // denominations look like one and produced a confident above/below
      // verdict on an incomparable pair. See resolveFloor() in
      // rules/price-floor for the same correction on the rules side.
      const floorCur =
        (typeof imp.bidfloorcur === 'string' ? imp.bidfloorcur.toUpperCase() : null) || 'USD';
      const bidCur = resCurUp || 'USD';
      if (hasExplicitFloor && floor > 0 && floorCur !== bidCur) {
        out.push(
          C(
            'crosscheck.bid.floor_currency_mismatch',
            false,
            CROSS_LEVELS.WARN,
            `${bp}.${leaf.price}`,
            {
              ...priceParams,
              bidCur: bidCur,
              floorCur: floorCur,
            },
          ),
        );
        // Can't rank against the floor, but the bid is still a winning-bid contender.
        const cur = winningByImp.get(impKey) || 0;
        if (price > cur) winningByImp.set(impKey, price);
      } else if (price >= floor) {
        bidsAboveFloor++;
        out.push(
          C(
            'crosscheck.bid.above_floor',
            true,
            CROSS_LEVELS.OK,
            `${bp}.${leaf.price}`,
            priceParams,
          ),
        );
        const cur = winningByImp.get(impKey) || 0;
        if (price > cur) winningByImp.set(impKey, price);
      } else {
        // WARN, not CRIT — see the same reasoning at the price-floor rule.
        // Bidding under the floor is a losing bid, not a broken response:
        // the exchange accepts and processes the payload, then declines to
        // select this bid. Marking it CRIT failed the whole crosscheck for
        // a document with nothing wrong in it.
        out.push(
          C(
            'crosscheck.bid.below_floor',
            false,
            CROSS_LEVELS.WARN,
            `${bp}.${leaf.price}`,
            priceParams,
          ),
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
          C('crosscheck.bid.cat_blocked', false, CROSS_LEVELS.CRIT, `${bp}.${leaf.cat}`, {
            ...baseParams,
            categories: JSON.stringify(violated),
          }),
        );
      } else {
        out.push(
          C('crosscheck.bid.cat_clean', true, CROSS_LEVELS.OK, `${bp}.${leaf.cat}`, baseParams),
        );
      }
    }

    // 3d. badv
    if (Array.isArray(bid.adomain) && badv.size) {
      const violated = bid.adomain.filter((d) => badv.has(d));
      if (violated.length) {
        out.push(
          C('crosscheck.bid.adomain_blocked', false, CROSS_LEVELS.CRIT, `${bp}.${leaf.adomain}`, {
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
              `${bp}.${leaf.adm}`,
              {
                ...baseParams,
                declared: JSON.stringify(adomainLc),
                landing: landingHost,
              },
            ),
          );
        } else {
          out.push(
            C(
              'crosscheck.bid.pop.adomain_landing_match',
              true,
              CROSS_LEVELS.OK,
              `${bp}.${leaf.adm}`,
              {
                ...baseParams,
                host: landingHost,
              },
            ),
          );
        }
      }
    }

    // 3e. banner size
    if (imp.banner && (bid.w || bid.h)) {
      const formatList = Array.isArray(imp.banner.format)
        ? imp.banner.format.filter(isObj) // R4: drop null entries in banner.format
        : [];
      const declared = imp.banner.w && imp.banner.h ? [{ w: imp.banner.w, h: imp.banner.h }] : [];
      const allSizes = [...declared, ...formatList];
      const fits = allSizes.some(
        (f) => isObj(f) && Number(f.w) === Number(bid.w) && Number(f.h) === Number(bid.h),
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
        out.push(C(cm.errorKey, false, CROSS_LEVELS.WARN, `${bp}.${leaf.adm}`, baseParams));
      } else {
        if (cm.missing.length) {
          out.push(
            C(
              'crosscheck.bid.native_missing_assets',
              false,
              CROSS_LEVELS.CRIT,
              `${bp}.${leaf.adm}`,
              {
                ...baseParams,
                missing: cm.missing.join(', '),
              },
              cm,
            ),
          );
        } else {
          // "Complete" only ever meant "the required ids are present". Say so
          // only when the assets under those ids are also usable — otherwise a
          // bid that renders blank collects a green tick.
          const fitness = nativeAssetFitness(imp.native, bid.adm);
          if (!fitness.length) {
            out.push(
              C(
                'crosscheck.bid.native_complete',
                true,
                CROSS_LEVELS.OK,
                `${bp}.${leaf.adm}`,
                {
                  ...baseParams,
                  count: cm.requiredIds.length,
                },
                cm,
              ),
            );
          }
          for (const issue of fitness) {
            out.push(
              C(
                `crosscheck.bid.native_${issue.code}`,
                false,
                issue.code === 'unsafe_scheme' ? CROSS_LEVELS.CRIT : CROSS_LEVELS.WARN,
                `${bp}.${leaf.adm}`,
                {
                  ...baseParams,
                  ...issue.params,
                  assetId: issue.id >= 0 ? issue.id : '',
                },
                issue,
              ),
            );
          }
        }
        if (cm.extra.length) {
          out.push(
            C(
              'crosscheck.bid.native_extra_assets',
              false,
              CROSS_LEVELS.WARN,
              `${bp}.${leaf.adm}`,
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
          `${bp}.${leaf.adm}`,
          baseParams,
        ),
      );
    }
  }

  // 4. summary
  const impsTotal = reqView.imp.length;
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

/* ── oRTB 3.0 views ──────────────────────────────────────────────────────────
 *
 * Crosscheck asks semantic questions — "does this response answer the request
 * it claims to answer, at a price the request would accept, with a creative the
 * request allows". Those questions are identical in 2.x and 3.0; only the
 * spelling changed. 3.0 wraps everything in an `openrtb` envelope, renames
 * `imp[]` to `request.item[]`, `bidfloor`/`bidfloorcur` to `flr`/`flrcu`,
 * `bid.impid` to `bid.item`, and moves the creative under `bid.media`.
 *
 * Pre-fix this file tested `Array.isArray(req.imp)` and nothing else, so a
 * valid 3.0 pair — both sides `clean` through validate(), which has routed 3.0
 * to its own rule set since v0.38 — came back as a single CRIT claiming no
 * BidRequest had been pasted, and every crosscheck the user actually came for
 * (id, currency, floor, bcat/badv, size) was silently skipped. Two failures in
 * one: a false statement about the input, and the absence of the analysis.
 *
 * Rather than teach each rule two field names, the envelope is projected ONCE
 * into the 2.x shape the rules already read. The view carries the display path
 * base and the leaf names alongside the values, so a 3.0 finding points at
 * `openrtb.response.seatbid[0].bid[0].media.display.adm` — where the data
 * really is — instead of at a 2.x path the pasted document does not contain.
 *
 * Deliberately NOT projected: native. AdCOM's `nativefmt`/`native` asset model
 * is a different shape from the 2.x `native.request` JSON string that
 * nativeAssetCrosscheck() parses, and a wrong mapping would produce confident
 * "missing required asset" CRITs on a correct payload. Silence beats a wrong
 * answer; a 3.0 native crosscheck is its own piece of work.
 *
 * Mixed pairs (3.0 request + 2.x response, or the reverse) are projected side
 * by side and compared anyway: that pairing is itself a bug worth seeing, and
 * the id/floor comparisons are what expose it.
 */

/** Leaf field names as 2.x spells them. Frozen: shared by every 2.x bid. */
const LEAF_2X = Object.freeze({
  impid: 'impid',
  price: 'price',
  cat: 'cat',
  adomain: 'adomain',
  adm: 'adm',
});

/**
 * The `openrtb.<key>` node of a 3.0 envelope, or null when the payload isn't
 * one. Mirrors detect.js's envelope test: presence of the envelope child is
 * what makes a payload 3.0, `ver` is not consulted (a broken `ver` is still a
 * 3.0 attempt, and validate() already reports it).
 */
function inner30(payload, key) {
  if (!isObj(payload) || !isObj(payload.openrtb)) return null;
  const node = payload.openrtb[key];
  return isObj(node) ? node : null;
}

/**
 * Request view, or null when there is no request to crosscheck against.
 *
 * @param {any} req
 * @returns {{id:unknown, cur:unknown, imp:Array<any>, base:string, impBase:string,
 *            floorLeaf:string, bcat:unknown, badv:unknown}|null}
 */
function buildRequestView(req) {
  if (!isObj(req)) return null;
  const r30 = inner30(req, 'request');
  if (r30 && Array.isArray(r30.item)) {
    // AdCOM puts the blocklists on `context.restrictions`; a few feeds hang the
    // same object off the request root. Read both — the alternative is silently
    // running bcat/badv against an empty set and reporting "cat_clean" on a bid
    // the publisher blocks.
    const restrictions =
      (isObj(r30.context) && isObj(r30.context.restrictions) && r30.context.restrictions) ||
      (isObj(r30.restrictions) && r30.restrictions) ||
      {};
    return {
      id: r30.id,
      cur: r30.cur,
      imp: r30.item.map(projectItem30),
      base: 'openrtb.request.',
      impBase: 'openrtb.request.item',
      floorLeaf: 'flr',
      bcat: restrictions.bcat,
      badv: restrictions.badv,
    };
  }
  if (!Array.isArray(req.imp)) return null;
  return {
    id: req.id,
    cur: req.cur,
    imp: req.imp,
    base: '',
    impBase: 'imp',
    floorLeaf: 'bidfloor',
    bcat: req.bcat,
    badv: req.badv,
  };
}

/**
 * One 3.0 `item` → the 2.x `imp` fields the rules below read.
 * Non-objects pass through untouched so the R4 null-tolerance downstream
 * (`isObj(imp)` in the index loop) still sees what it expects.
 */
function projectItem30(item) {
  if (!isObj(item)) return item;
  const spec = isObj(item.spec) ? item.spec : {};
  const placement = isObj(spec.placement) ? spec.placement : {};
  const out = { id: item.id, bidfloor: item.flr, bidfloorcur: item.flrcu };
  if (isObj(placement.display)) {
    // AdCOM DisplayPlacement carries one fixed w/h plus `displayfmt[]`
    // alternatives — the same split 2.x makes between banner.w/h and
    // banner.format[].
    const d = placement.display;
    out.banner = {
      w: d.w,
      h: d.h,
      format: Array.isArray(d.displayfmt) ? d.displayfmt : undefined,
    };
  }
  if (placement.video != null) out.video = placement.video;
  return out;
}

/**
 * Response view, or null when `res` is not an object at all. A missing or
 * empty `seatbid` is NOT null here: the caller distinguishes no-bid (with
 * `nbr`) from an empty response, and that decision stays where it was.
 *
 * @param {any} res
 * @returns {{id:unknown, nbr:unknown, cur:unknown, seatbid:unknown, base:string, v30:boolean}|null}
 */
function buildResponseView(res) {
  if (!isObj(res)) return null;
  const r30 = inner30(res, 'response');
  if (r30) {
    return {
      id: r30.id,
      nbr: r30.nbr,
      cur: r30.cur,
      seatbid: r30.seatbid,
      base: 'openrtb.response.',
      v30: true,
    };
  }
  return { id: res.id, nbr: res.nbr, cur: res.cur, seatbid: res.seatbid, base: '', v30: false };
}

/**
 * Flatten `seatbid[].bid[]` into one entry per REAL bid, each carrying the
 * display path of the bid and the leaf names to append to it. Skipping
 * non-objects here (R4: `seatbid:[null]`, `bid:[null]`) keeps the numbering
 * identical to the nested forEach this replaced — sNum/bNum are still the
 * array positions as written, so a payload with a null seat doesn't renumber
 * the seats after it.
 *
 * @param {{seatbid:any, base:string, v30:boolean}} view
 * @returns {Array<{bid:any, path:string, leaf:Object, sNum:number, bNum:number}>}
 */
function flattenBids(view) {
  const out = [];
  const seats = Array.isArray(view.seatbid) ? view.seatbid : [];
  seats.forEach((sb, sbi) => {
    if (!isObj(sb)) return;
    const bids = Array.isArray(sb.bid) ? sb.bid : [];
    bids.forEach((bid, bi) => {
      if (!isObj(bid)) return;
      const path = `${view.base}seatbid[${sbi}].bid[${bi}]`;
      const entry = view.v30
        ? projectBid30(bid, path)
        : { bid: bid, path: path, leaf: LEAF_2X, sNum: 0, bNum: 0 };
      entry.sNum = sbi + 1;
      entry.bNum = bi + 1;
      out.push(entry);
    });
  });
  return out;
}

/**
 * One 3.0 bid → the 2.x bid fields the rules read, plus the leaf names that
 * point back at where each of them actually lives.
 */
function projectBid30(bid, path) {
  // The 3.0 spec nests the AdCOM Ad object under `media.ad`; this repo's own
  // rules-response-30.js reads `media.adomain` / `media.display` straight off
  // media, which is what most real 3.0 traffic ships. Accept both, and record
  // which one was found so the finding path names the field the user pasted
  // rather than the one the spec would have preferred.
  const media = isObj(bid.media) ? bid.media : {};
  const wrapped = isObj(media.ad);
  const ad = wrapped ? media.ad : media;
  const mediaPath = wrapped ? 'media.ad' : 'media';
  const display = isObj(ad.display) ? ad.display : null;
  const video = isObj(ad.video) ? ad.video : null;
  // Which subobject the markup came from decides the adm path. Display first,
  // matching the order the 2.x rules resolve a creative in.
  const admFrom =
    display && typeof display.adm === 'string'
      ? 'display'
      : video && typeof video.adm === 'string'
        ? 'video'
        : null;
  const projected = {
    id: bid.id,
    impid: bid.item,
    price: bid.price,
    cat: ad.cat,
    adomain: ad.adomain,
    adm: admFrom === 'display' ? display.adm : admFrom === 'video' ? video.adm : undefined,
    w: display ? display.w : undefined,
    h: display ? display.h : undefined,
    ext: bid.ext,
  };
  return {
    bid: projected,
    path: path,
    leaf: {
      impid: 'item',
      price: 'price',
      cat: `${mediaPath}.cat`,
      adomain: `${mediaPath}.adomain`,
      adm: admFrom ? `${mediaPath}.${admFrom}.adm` : mediaPath,
    },
    sNum: 0,
    bNum: 0,
  };
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

/**
 * Which asset kind an entry declares, by the sub-object it carries.
 *
 * @param {Object} asset
 * @returns {string|null}
 */
function nativeAssetKind(asset) {
  if (!asset || typeof asset !== 'object') return null;
  for (const kind of ['title', 'img', 'video', 'data']) {
    if (asset[kind] && typeof asset[kind] === 'object') return kind;
  }
  return null;
}

/**
 * Only http(s) can be fetched or rendered. Anything else in a native URL is a
 * defect the renderer will happily interpolate into the markup.
 *
 * @param {unknown} url
 * @returns {string|null} The offending scheme, or null when acceptable.
 */
function unsafeNativeScheme(url) {
  if (typeof url !== 'string' || url.length === 0) return null;
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim());
  if (!match) return null;
  const scheme = `${match[1].toLowerCase()}:`;
  return scheme === 'http:' || scheme === 'https:' ? null : scheme;
}

/**
 * Compare each returned native asset against what the request asked for.
 *
 * `nativeAssetCrosscheck` answers "are the required ids present". That is the
 * whole of what Prebid checks too — measured across 9.53.5 through 11.29.0, its
 * `nativeBidIsValid` tests truthy `link.url` plus an id-set intersection and
 * nothing else. So a bid whose assets are bare ids with no payload passes every
 * check in the chain and renders as an empty unit, because the renderer
 * interpolates a missing value as `''`.
 *
 * These are the checks nobody performs, and all of them are answerable from the
 * request/response pair alone.
 *
 * @param {Object} impNative The request-side `imp[].native`.
 * @param {string|Object} adm The response-side markup.
 * @returns {Array<{ code: string, id: number, params: Object }>}
 */
function nativeAssetFitness(impNative, adm) {
  /** @type {Array<{ code: string, id: number, params: Object }>} */
  const issues = [];
  let reqInner;
  let resInner;
  try {
    const parsedReq =
      typeof impNative.request === 'string'
        ? tryParseNativePayload(impNative.request)
        : impNative.request;
    reqInner = (parsedReq && parsedReq.native) || parsedReq || {};
    const parsedRes = typeof adm === 'string' ? tryParseNativePayload(adm) : adm;
    resInner = (parsedRes && parsedRes.native) || parsedRes || {};
  } catch {
    // Parse failures are already reported by nativeAssetCrosscheck; saying it
    // twice would double every finding on a malformed payload.
    return issues;
  }

  const requested = new Map();
  for (const asset of Array.isArray(reqInner.assets) ? reqInner.assets : []) {
    if (asset && asset.id != null) requested.set(Number(asset.id), asset);
  }

  const linkScheme = unsafeNativeScheme(resInner.link && resInner.link.url);
  if (linkScheme) {
    issues.push({
      code: 'unsafe_scheme',
      id: -1,
      params: { field: 'link.url', scheme: linkScheme },
    });
  }

  for (const asset of Array.isArray(resInner.assets) ? resInner.assets : []) {
    if (!asset || asset.id == null) continue;
    const id = Number(asset.id);
    const want = requested.get(id);
    if (!want) continue;

    const wantKind = nativeAssetKind(want);
    const gotKind = nativeAssetKind(asset);

    if (gotKind === null) {
      // An id with no payload at all. Prebid accepts it; the renderer turns it
      // into an empty string and the unit ships blank.
      issues.push({ code: 'asset_empty', id, params: { kind: wantKind || 'unknown' } });
      continue;
    }
    if (wantKind && gotKind !== wantKind) {
      issues.push({ code: 'asset_kind', id, params: { requested: wantKind, returned: gotKind } });
      continue;
    }

    if (gotKind === 'title') {
      const text = asset.title.text;
      if (typeof text !== 'string' || text.length === 0) {
        issues.push({ code: 'asset_empty', id, params: { kind: 'title' } });
      } else if (Number.isFinite(want.title && want.title.len) && text.length > want.title.len) {
        issues.push({
          code: 'over_length',
          id,
          params: { kind: 'title', actual: text.length, limit: want.title.len },
        });
      }
    }

    if (gotKind === 'data') {
      const value = asset.data.value;
      if (typeof value !== 'string' || value.length === 0) {
        issues.push({ code: 'asset_empty', id, params: { kind: 'data' } });
      } else if (Number.isFinite(want.data && want.data.len) && value.length > want.data.len) {
        issues.push({
          code: 'over_length',
          id,
          params: { kind: 'data', actual: value.length, limit: want.data.len },
        });
      }
    }

    if (gotKind === 'img') {
      const url = asset.img.url;
      if (typeof url !== 'string' || url.length === 0) {
        issues.push({ code: 'asset_empty', id, params: { kind: 'img' } });
      } else {
        const scheme = unsafeNativeScheme(url);
        if (scheme) {
          issues.push({ code: 'unsafe_scheme', id, params: { field: 'img.url', scheme } });
        }
      }
      const wantImg = want.img || {};
      const gotW = Number(asset.img.w);
      const gotH = Number(asset.img.h);
      // Exact w/h is a demand, wmin/hmin a floor. Only compare what was asked.
      const tooSmall =
        (Number.isFinite(wantImg.w) && Number.isFinite(gotW) && gotW !== wantImg.w) ||
        (Number.isFinite(wantImg.h) && Number.isFinite(gotH) && gotH !== wantImg.h) ||
        (Number.isFinite(wantImg.wmin) && Number.isFinite(gotW) && gotW < wantImg.wmin) ||
        (Number.isFinite(wantImg.hmin) && Number.isFinite(gotH) && gotH < wantImg.hmin);
      if (tooSmall) {
        issues.push({
          code: 'img_size',
          id,
          params: {
            returned: `${Number.isFinite(gotW) ? gotW : '?'}x${Number.isFinite(gotH) ? gotH : '?'}`,
            requested: describeImgRequest(wantImg),
          },
        });
      }
    }
  }

  return issues;
}

/**
 * @param {Object} img Request-side img spec.
 * @returns {string}
 */
function describeImgRequest(img) {
  if (Number.isFinite(img.w) || Number.isFinite(img.h)) {
    return `${Number.isFinite(img.w) ? img.w : '?'}x${Number.isFinite(img.h) ? img.h : '?'}`;
  }
  return `min ${Number.isFinite(img.wmin) ? img.wmin : '?'}x${Number.isFinite(img.hmin) ? img.hmin : '?'}`;
}

module.exports = { crosscheck, nativeAssetCrosscheck, nativeAssetFitness };
