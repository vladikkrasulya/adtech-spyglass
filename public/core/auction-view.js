/** Source-aware auction adapters. Pure, deterministic and shared with the browser.
 * Crosscheck defaults preserve its historical eligibility; the explicit UI adapter
 * also understands peeled 3.0 bodies. Projections never replace original handles.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrtbtoolsAuctionView = factory();
})(globalThis, function () {
  'use strict';
  const isObj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  /** @returns {value is Record<string, any>} */
  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Browser copy of the hardened OpenRTB 3.0 envelope mechanism in
   * packages/core/detect.js. An empty `openrtb` key does not outweigh explicit
   * 2.x root markers; a genuine wrapper or version marker does.
   */
  function looksLike30Envelope(payload) {
    const has2x = Array.isArray(payload.imp) || Array.isArray(payload.seatbid);
    const envelope = payload.openrtb;
    if (isRecord(envelope)) {
      if (isRecord(envelope.request) || isRecord(envelope.response) || envelope.ver != null) {
        return true;
      }
      return !has2x;
    }

    // A peeled 3.0 request keeps item[]. Primitive items are too generic to
    // claim, while an empty array is a valid structural signal.
    return (
      Array.isArray(payload.item) &&
      !payload.item.some((item) => item != null && !isRecord(item)) &&
      !has2x
    );
  }

  /**
   * A peeled 3.0 response still has seatbid[], but its bids use `item` and
   * `media` instead of 2.x `impid` / `adm`. Any impid vetoes the 3.0 claim.
   */
  function looksLike30ResponseBody(payload) {
    if (!Array.isArray(payload.seatbid)) return false;
    let found30Signal = false;
    for (const seat of payload.seatbid) {
      if (!isRecord(seat) || !Array.isArray(seat.bid)) continue;
      for (const bid of seat.bid) {
        if (!isRecord(bid)) continue;
        if (bid.impid != null) return false;
        if (typeof bid.item === 'string' || typeof bid.item === 'number') found30Signal = true;
        if (isRecord(bid.media)) found30Signal = true;
      }
    }
    return found30Signal;
  }

  /**
   * @param {unknown} payload
   * @returns {{ kind: 'req' | 'res' | 'unknown', body: object, version: '3.0' | null }}
   */
  function classifyAuctionPayload(payload) {
    if (!isRecord(payload)) return { kind: 'unknown', body: {}, version: null };

    if (looksLike30Envelope(payload)) {
      const envelope = isRecord(payload.openrtb) ? payload.openrtb : null;
      if (!envelope) return { kind: 'req', body: payload, version: '3.0' };

      const hasRequest = isRecord(envelope.request);
      const hasResponse = isRecord(envelope.response);

      if (hasRequest !== hasResponse) {
        return {
          kind: hasRequest ? 'req' : 'res',
          body: hasRequest ? envelope.request : envelope.response,
          version: '3.0',
        };
      }

      // An empty or contradictory 3.0 envelope is still recognisably 3.0,
      // but choosing an auction side would be a guess.
      return { kind: 'unknown', body: envelope, version: '3.0' };
    }

    const hasRequest = Array.isArray(payload.imp);
    const hasResponse = Array.isArray(payload.seatbid);
    const has30ResponseBody = looksLike30ResponseBody(payload);

    // A root that declares both auction sides is contradictory. Preserve the
    // 3.0 version signal when its bids carry one, but do not let that choose a
    // side — the same no-guess policy used for a wrapper with both children.
    if (hasRequest && hasResponse) {
      return {
        kind: 'unknown',
        body: payload,
        version: has30ResponseBody ? '3.0' : null,
      };
    }

    if (has30ResponseBody) {
      return { kind: 'res', body: payload, version: '3.0' };
    }

    if (hasRequest !== hasResponse) {
      return {
        kind: hasRequest ? 'req' : 'res',
        body: payload,
        version: null,
      };
    }

    return { kind: 'unknown', body: payload, version: null };
  }

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
   *            floorLeaf:string, bcat:unknown, badv:unknown, wseat?:unknown, bseat?:unknown}|null}
   */
  function crosscheckRequestView(req) {
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
      wseat: req.wseat,
      bseat: req.bseat,
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
    // AdCOM/OpenRTB 3.0 spells the currency field `flrcur`, not `flrcu`
    // (openrtb-3.0-FINAL.md:517, 586). The old typo read `item.flrcu`, which no
    // conforming Item ever carries, so floorCur silently defaulted to 'USD' for
    // every 3.0 payload regardless of the real value — feature 022 / DEF-105.
    const out = { id: item.id, bidfloor: item.flr, bidfloorcur: item.flrcur };
    if (isObj(placement.display)) {
      // AdCOM DisplayPlacement carries one fixed w/h plus `displayfmt[]`
      // alternatives — the same split 2.x makes between banner.w/h and
      // banner.format[].
      const d = placement.display;
      if (d.nativefmt !== undefined) {
        const nativefmt = d.nativefmt;
        out.native = {
          request: isObj(nativefmt)
            ? {
                assets: Array.isArray(nativefmt.asset)
                  ? nativefmt.asset.map((asset) =>
                      isObj(asset) ? { ...asset, required: asset.req } : asset,
                    )
                  : nativefmt.asset,
              }
            : nativefmt,
        };
      }
      // A Native-only display placement has no banner alternative. Keep the
      // alternative when the sender actually supplies banner dimensions/formats.
      if (
        d.nativefmt === undefined ||
        d.displayfmt !== undefined ||
        d.w !== undefined ||
        d.h !== undefined
      ) {
        out.banner = {
          w: d.w,
          h: d.h,
          format: Array.isArray(d.displayfmt) ? d.displayfmt : undefined,
        };
      }
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
  function crosscheckResponseView(res) {
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
   * @returns {Array<{raw:any, bid:any, path:string, leaf:Object, sNum:number, bNum:number}>}
   */
  function flattenBids(view) {
    const out = [];
    if (!view) return out;
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
        entry.raw = bid;
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
    if (display && display.native !== undefined) {
      const native = display.native;
      projected.native = isObj(native)
        ? {
            ...native,
            assets: Array.isArray(native.asset)
              ? native.asset.map((asset) =>
                  isObj(asset)
                    ? { ...asset, ...(asset.image !== undefined ? { img: asset.image } : {}) }
                    : asset,
                )
              : native.asset,
          }
        : native;
    }
    return {
      bid: projected,
      path: path,
      leaf: {
        impid: 'item',
        price: 'price',
        cat: `${mediaPath}.cat`,
        adomain: `${mediaPath}.adomain`,
        adm:
          display && display.native !== undefined
            ? mediaPath
            : admFrom
              ? `${mediaPath}.${admFrom}.adm`
              : mediaPath,
      },
      sNum: 0,
      bNum: 0,
    };
  }

  function buildRequestView(original, options) {
    const shape = classifyAuctionPayload(original);
    const ui = options && options.consumer === 'ui';
    if (ui && shape.kind !== 'req') return null;
    const peeled30 = ui && shape.version === '3.0' && !inner30(original, 'request');
    const view = crosscheckRequestView(peeled30 ? { openrtb: { request: shape.body } } : original);
    if (!view) return null;
    if (peeled30) {
      view.base = '';
      view.impBase = 'item';
    }
    // Metadata follows the selected adapter. An incomplete 3.0 child can
    // coexist with the valid 2.x imp[] fallback without supplying its items.
    const version = view.floorLeaf === 'flr' ? '3.0' : null;
    const body = version === '3.0' ? inner30(original, 'request') || original : original;
    const context = version === '3.0' ? (isObj(body.context) ? body.context : {}) : body;
    const rawItems = version === '3.0' ? body.item : body.imp;
    if (ui && version === '3.0') {
      const projectedItems = projectRequestForRules(body).payload.imp;
      view.imp = view.imp.map((imp, index) => {
        if (!isObj(imp)) return imp;
        const fields = projectedItems[index];
        const out = { ...imp };
        for (const key of ['secure', 'instl', 'ext']) {
          if (fields[key] !== undefined) out[key] = fields[key];
        }
        // UI facts do not activate extra crosschecks. Preserve Native-only
        // display eligibility and existing banner alternatives/dimensions.
        for (const kind of ['video', 'audio']) {
          if (isObj(fields[kind]))
            out[kind] = { ...(isObj(imp[kind]) ? imp[kind] : {}), ...fields[kind] };
        }
        return out;
      });
    }

    const items = view.imp.map((imp, index) => ({
      raw: rawItems[index],
      imp,
      index,
      path: `${view.impBase}[${index}]`,
    }));
    return { ...view, original, body, version, context, items };
  }

  function buildResponseView(original, options) {
    const shape = classifyAuctionPayload(original);
    const ui = options && options.consumer === 'ui';
    if (ui && shape.kind !== 'res') return null;
    const view = crosscheckResponseView(original);
    if (!view) return null;
    if (ui && shape.version === '3.0') view.v30 = true;
    return {
      ...view,
      original,
      body: inner30(original, 'response') || original,
      version: view.v30 ? '3.0' : null,
    };
  }

  // AdCOM 1.0, pinned by feature 032:
  // https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/26c59ba1b235cd8d938c9877409e506f1b8d3f0c/AdCOM%20v1.0%20FINAL.md Only semantically equivalent facts enter
  // request plugins. Device, site/app, seat flags and restriction battr stay out.
  function projectRequestForRules(req30) {
    const payload = {};
    /** @type {Record<string,string>} */
    const pathMap = {};
    const copy = (target, key, value, from, to) => {
      if (value !== undefined) target[key] = value;
      pathMap[to] = from;
    };
    for (const key of ['id', 'test', 'at', 'tmax', 'cur', 'source', 'ext'])
      copy(payload, key, req30[key], key, key);
    const context = isObj(req30.context) ? req30.context : {};
    for (const key of ['regs', 'user']) copy(payload, key, context[key], `context.${key}`, key);
    if (Array.isArray(req30.item)) {
      pathMap.imp = 'item';
      payload.imp = req30.item.map((item, i) => {
        if (!isObj(item)) return item;
        const out = {};
        const from = `item[${i}]`,
          to = `imp[${i}]`;
        pathMap[to] = from;
        for (const key of ['id', 'ext'])
          copy(out, key, item[key], `${from}.${key}`, `${to}.${key}`);
        const p = isObj(item.spec) && isObj(item.spec.placement) ? item.spec.placement : {};
        const pp = `${from}.spec.placement`;
        copy(out, 'secure', p.secure, `${pp}.secure`, `${to}.secure`);
        if (isObj(p.display)) {
          copy(out, 'instl', p.display.instl, `${pp}.display.instl`, `${to}.instl`);
          out.banner = {};
          pathMap[`${to}.banner`] = `${pp}.display`;
          for (const key of ['w', 'h'])
            copy(out.banner, key, p.display[key], `${pp}.display.${key}`, `${to}.banner.${key}`);
        }
        for (const kind of ['video', 'audio']) {
          if (!isObj(p[kind])) continue;
          out[kind] = {};
          pathMap[`${to}.${kind}`] = `${pp}.${kind}`;
          const aliases = {
            minduration: 'mindur',
            maxduration: 'maxdur',
            mimes: 'mime',
            protocols: 'ctype',
            poddur: 'poddur',
            maxseq: 'maxseq',
            podseq: 'podseq',
            rqddurs: 'rqddurs',
          };
          for (const [key, source] of Object.entries(aliases))
            copy(
              out[kind],
              key,
              p[kind][source],
              `${pp}.${kind}.${source}`,
              `${to}.${kind}.${key}`,
            );
          // AdCOM podid is an integer, whereas the 2.x plugin also accepts strings.
          // This adapter adds no 3.0 podid validation.
        }
        return out;
      });
    }
    return { payload, pathMap };
  }

  function projectResponsePairRequest(pairReq) {
    const request = inner30(pairReq, 'request');
    return request ? { cur: request.cur } : pairReq || null;
  }

  return {
    classifyAuctionPayload,
    buildRequestView,
    buildResponseView,
    flattenBids,
    projectRequestForRules,
    projectResponsePairRequest,
  };
});
