'use strict';

/**
 * Format Detection Engine — Phase 10.
 *
 * Pure-data heuristics that tag a payload with its ad FORMAT, runtime
 * CONTEXT, and creative PROTOCOL family. Runs in browser AND Node;
 * intentionally has zero fs / network dependencies so it can fire on
 * every paste, before validation, before LLM, before anything.
 *
 * This is the third axis of detection in ortbtools core:
 *   detectType()    — request / response / feed / unknown          (detect.js)
 *   detectVersion() — 2.5 / 2.6 / 3.0 / unknown                    (detect.js)
 *   detectFormat()  — banner / video / audio / native / push / …   (this file)
 *
 * Output shape (always-present fields, never null):
 *   {
 *     formats:   ['banner', 'video', …],   // non-overlapping ad-unit kinds
 *     contexts:  ['web', 'inapp', 'ctv'],  // device/runtime context
 *     protocols: ['vast-3', 'vast-4'],     // creative envelope/version
 *     tags:      [...formats, ...contexts, ...protocols],   // flat union for UI/LLM
 *     confidence: 1 | 0,                   // any positive hit = 1, else 0
 *   }
 *
 * Rules of restraint:
 *   - No false certainty. If a banner has `imp[].video` we tag both.
 *     Ambiguity is an honest answer.
 *   - JSON-feed detection is intentionally narrow (push / pops / inpage)
 *     and only fires when an obvious creative-shape signature matches.
 *     `rules-feed.js` already discriminates the vendor — we don't reach
 *     for that here.
 *   - VAST sniffing on response `adm` is a string-substring check, not
 *     an XML parse. We tag `vast-N` if the version attribute is plain
 *     to read; we don't try to repair malformed XML.
 */

const {
  scanExtForFormatHints,
  isPopFormat,
  isPushFormat,
  admLooksLikePop,
  normaliseFormatName,
} = require('./non-iab-formats');

const FORMATS = {
  BANNER: 'banner',
  VIDEO: 'video',
  AUDIO: 'audio',
  NATIVE: 'native',
  PUSH: 'push',
  POPS: 'pops',
  INPAGE: 'inpage',
};

const CONTEXTS = {
  WEB: 'web',
  INAPP: 'inapp',
  CTV: 'ctv',
  DOOH: 'dooh',
};

const PROTOCOLS = {
  VAST_2: 'vast-2',
  VAST_3: 'vast-3',
  VAST_4: 'vast-4',
  DAAST: 'daast',
};

// IAB OpenRTB 2.6 §5.8 (BidResponse mtype) — single-byte enum.
const MTYPE_TO_FORMAT = {
  1: FORMATS.BANNER,
  2: FORMATS.VIDEO,
  3: FORMATS.AUDIO,
  4: FORMATS.NATIVE,
};

// IAB OpenRTB 2.6 §5.8 (Video Bid Response Protocols).
//   2 = VAST 2.0,  3 = VAST 3.0, 4 = DAAST 1.0,  5 = VAST 2.0 wrapper,
//   6 = VAST 3.0 wrapper, 7 = VAST 4.0, 8 = VAST 4.0 wrapper,
//   9 = DAAST 1.0 wrapper, 10 = VAST 4.1, 11 = VAST 4.2.
function videoProtocolToFamily(p) {
  if (p === 2 || p === 5) return PROTOCOLS.VAST_2;
  if (p === 3 || p === 6) return PROTOCOLS.VAST_3;
  if (p === 7 || p === 8 || p === 10 || p === 11) return PROTOCOLS.VAST_4;
  if (p === 4 || p === 9) return PROTOCOLS.DAAST;
  return null;
}

// IAB OpenRTB 2.6 §5.21 (DeviceType): 3 = Connected TV, 7 = Connected Device.
function deviceTypeToContext(dt) {
  if (dt === 3 || dt === 7) return CONTEXTS.CTV;
  return null;
}

// AdCOM 1.0 List: Creative Subtypes — Audio/Video. This is `ctype` on a 3.0
// VideoPlacement / the Ad's video, and it is NOT the 2.x `protocols` list: the
// numbering differs from the first entry (AdCOM 1 = VAST 1.0, where oRTB 2.x
// 1 = VAST 1.0 but 2 = VAST 2.0 against AdCOM's 2 = VAST 2.0 … the two tables
// diverge from 4 onward, where AdCOM starts its wrapper block). Mapping 3.0
// `ctype` through `videoProtocolToFamily` would therefore report a VAST 4.0
// request as VAST 3.0 wrapper, which is why this is a separate table.
//   1 VAST 1.0   2 VAST 2.0   3 VAST 3.0
//   4 VAST 1.0 Wrapper   5 VAST 2.0 Wrapper   6 VAST 3.0 Wrapper
//   7 VAST 4.0   8 VAST 4.0 Wrapper
//   9 DAAST 1.0  10 DAAST 1.0 Wrapper
//   11 VAST 4.1  12 VAST 4.1 Wrapper   13 VAST 4.2   14 VAST 4.2 Wrapper
function adcomCtypeToFamily(c) {
  if (c === 2 || c === 5) return PROTOCOLS.VAST_2;
  if (c === 3 || c === 6) return PROTOCOLS.VAST_3;
  if (c === 7 || c === 8 || c === 11 || c === 12 || c === 13 || c === 14) return PROTOCOLS.VAST_4;
  if (c === 9 || c === 10) return PROTOCOLS.DAAST;
  return null;
}

function isObj(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function isPopFeedFormatName(value) {
  const n = normaliseFormatName(value);
  return n === 'cu' || n === 'pops' || isPopFormat(n);
}

function isCanonicalUrlRequest(o) {
  return (
    isObj(o) &&
    typeof o.variant === 'string' &&
    o.method === 'GET' &&
    isObj(o.meta) &&
    typeof o.meta.detectedVariant === 'string' &&
    isObj(o._raw)
  );
}

/**
 * Tiny VAST helpers — exported so rule files share one anchored regex
 * instead of each inventing their own. The previous codebase had three
 * subtly different sniffers (this file, crosscheck.js, the UI). All
 * future code SHOULD reuse these.
 *
 * They now live in `vast-shape.js` and are re-exported here unchanged: the
 * browser-side VAST timeline extractor needs them, and mirroring this file
 * would drag `non-iab-formats.js` along for no benefit. Callers of
 * `format-detect` are unaffected — importing from either place resolves to the
 * same one definition.
 */
const { isVastShape, detectVastVersion } = require('./vast-shape');

/**
 * Does an envelope-less payload look like the inner body of a 3.0 BidResponse?
 *
 * `bid.media` has no counterpart anywhere in 2.x, so one of them is enough.
 * Kept as a local five-liner rather than importing `detect.js`'s fuller
 * `detect30ResponseSignals`: this file's contract is zero dependencies beyond
 * the two pure helper modules it already pulls, so it can be bundled for the
 * browser and run on every keystroke.
 */
function hasAdComBidMedia(o) {
  if (!isObj(o) || !Array.isArray(o.seatbid)) return false;
  return o.seatbid.some(
    (sb) => isObj(sb) && Array.isArray(sb.bid) && sb.bid.some((b) => isObj(b) && isObj(b.media)),
  );
}

function hasPopBidRowShape(row) {
  return isObj(row) && 'url' in row && 'bid' in row;
}

function hasPopBidCollectionShape(value) {
  if (Array.isArray(value)) return value.some(hasPopBidRowShape);
  return hasPopBidRowShape(value);
}

/**
 * Single-object JSON-feed signatures. The push-materials feed and the
 * bid-redirect-style popunder have unique enough shapes that one or two
 * keys discriminate them. Inpage is a soft heuristic — the canonical
 * signal is server-side `ext.format` rather than shape.
 */
function detectFeedFormat(o, tags) {
  if (!isObj(o)) return;
  if (isObj(o.result)) {
    const r = o.result;
    if (hasPopBidCollectionShape(r.listing)) {
      tags.add(FORMATS.POPS);
      return;
    }
    if (hasPopBidCollectionShape(r.link)) {
      tags.add(FORMATS.POPS);
      return;
    }
    // A NOBID is a pop signal only when the wrapper ALSO carries the
    // clickunder/link-feed fingerprint (a `listing` or `link` key — empty on
    // a no-bid). A bare `{result:{status:'NOBID'}}` is too generic to claim:
    // NOBID is a normal auction outcome many vendor feeds report, so tagging
    // POPS on the status word alone would be a silent guess. Real pop traffic
    // is still tagged request-side by the clickunder decoder (analyze union).
    if (
      typeof r.status === 'string' &&
      r.status.toUpperCase() === 'NOBID' &&
      ('listing' in r || 'link' in r)
    ) {
      tags.add(FORMATS.POPS);
      return;
    }
  }
  const hasClick = 'clickurl' in o || 'clickUrl' in o || 'click_url' in o || 'redirectUrl' in o;
  const hasImage = 'image' in o || 'icon' in o;
  const hasTitle = 'title' in o || 'name' in o;
  const hasRedirect = 'redirecturl' in o || 'redirect_url' in o;

  if (hasRedirect && !hasImage && !hasTitle) {
    tags.add(FORMATS.POPS);
    return;
  }
  if (hasClick && hasImage && hasTitle) {
    // Two siblings disambiguate: in-page widgets typically declare a
    // widget_id or zone_id under ext, push payloads typically don't.
    const ext = isObj(o.ext) ? o.ext : null;
    if (ext && (ext.widget_id || ext.zone_id || ext.format === 'inpage')) {
      tags.add(FORMATS.INPAGE);
    } else {
      tags.add(FORMATS.PUSH);
    }
  }
}

/**
 * @param {unknown} payload
 * @param {{lookupMapping?: Function}|null} [userDialect] - optional user dialect; when present, dialect-mapped ext signals are recognised as format hints
 * @returns {{formats:string[], contexts:string[], protocols:string[], tags:string[], confidence:number}}
 */
function detectFormat(payload, userDialect) {
  const empty = { formats: [], contexts: [], protocols: [], tags: [], confidence: 0 };
  if (payload == null) return empty;

  const formats = new Set();
  const contexts = new Set();
  const protocols = new Set();

  // Array payloads → JSON-feed list (push-materials feed, etc.)
  if (Array.isArray(payload)) {
    for (const item of payload) detectFeedFormat(item, formats);
  } else if (typeof payload === 'object') {
    /** @type {any} */
    const p = payload;

    // URL-style ad request canonicalised by decoders/request/*. Clickunder
    // feeds have no oRTB `imp` slot to inspect, so the declared URL format
    // is the authoritative format signal.
    if (isCanonicalUrlRequest(p)) {
      const declared =
        p.format || p._raw.format || p._raw.ad_format || p._raw.type || p._raw.adtype || p.variant;
      if (isPopFeedFormatName(declared) || String(p.variant).includes('clickunder')) {
        formats.add(FORMATS.POPS);
      } else if (isPushFormat(declared)) {
        formats.add(FORMATS.PUSH);
      }
    }

    // ── BidRequest path
    if (Array.isArray(p.imp)) {
      // Scan top-level req.ext for non-IAB hints first — some vendors put
      // request-wide `ext.adtype = "popunder"` instead of per-imp.
      for (const hint of scanExtForFormatHints(p.ext, 'ext', userDialect)) {
        if (isPopFormat(hint.format)) formats.add(FORMATS.POPS);
        else if (isPushFormat(hint.format)) formats.add(FORMATS.PUSH);
      }
      for (const imp of p.imp) {
        if (!isObj(imp)) continue;
        if (imp.banner) formats.add(FORMATS.BANNER);
        if (imp.video) {
          formats.add(FORMATS.VIDEO);
          const v = imp.video;
          if (Array.isArray(v.protocols)) {
            for (const proto of v.protocols) {
              const fam = videoProtocolToFamily(proto);
              if (fam) protocols.add(fam);
            }
          }
        }
        if (imp.audio) formats.add(FORMATS.AUDIO);
        if (imp.native) formats.add(FORMATS.NATIVE);
        // Non-IAB format hints (pop / popunder / clickunder / push / pushunder)
        // in vendor extensions. Add the corresponding FORMATS tag so the UI
        // and downstream rules see the same picture detectNonStandardFormats
        // emits as an `imp.non_standard_format` INFO finding.
        const impExtHints = [
          ...scanExtForFormatHints(imp.ext, 'imp[].ext', userDialect),
          ...(imp.banner
            ? scanExtForFormatHints(imp.banner.ext, 'imp[].banner.ext', userDialect)
            : []),
          ...(imp.video
            ? scanExtForFormatHints(imp.video.ext, 'imp[].video.ext', userDialect)
            : []),
        ];
        for (const hint of impExtHints) {
          if (isPopFormat(hint.format)) formats.add(FORMATS.POPS);
          else if (isPushFormat(hint.format)) formats.add(FORMATS.PUSH);
        }
      }
    }

    // ── BidResponse path: derive format from mtype + adm sniffing
    if (Array.isArray(p.seatbid)) {
      for (const sb of p.seatbid) {
        if (!isObj(sb) || !Array.isArray(sb.bid)) continue;
        for (const bid of sb.bid) {
          if (!isObj(bid)) continue;
          const mt = MTYPE_TO_FORMAT[bid.mtype];
          if (mt) formats.add(mt);
          // Anchored sniff via the shared helpers above — this inline block
          // previously used a bare /<VAST\b/ substring test and its own
          // version regex, false-positive-ing on HTML creatives that merely
          // mention "<VAST" and drifting from detectVastVersion (the exact
          // divergence the helpers' doc-comment warns about).
          if (isVastShape(bid.adm)) {
            formats.add(FORMATS.VIDEO);
            const ver = detectVastVersion(bid.adm);
            if (ver) {
              const major = ver.split('.')[0];
              if (major === '2') protocols.add(PROTOCOLS.VAST_2);
              else if (major === '3') protocols.add(PROTOCOLS.VAST_3);
              else if (major === '4') protocols.add(PROTOCOLS.VAST_4);
            }
          }
          // Non-IAB hints on the bid itself: `bid.ext.adtype="popunder"` is
          // the most common shape after the request signals the slot. Also
          // sniff bid.adm — pop creatives ship a window.open / redirect URL,
          // not banner HTML — but only if the request side ALSO smelled
          // like pop, to avoid false-positive on banner clicktrackers.
          for (const hint of scanExtForFormatHints(bid.ext, 'bid[].ext', userDialect)) {
            if (isPopFormat(hint.format)) formats.add(FORMATS.POPS);
            else if (isPushFormat(hint.format)) formats.add(FORMATS.PUSH);
          }
          if (formats.has(FORMATS.POPS) && admLooksLikePop(bid.adm)) {
            // Already tagged from ext signal — admLooksLikePop here is a
            // confirmation, not a standalone trigger. Keeping the
            // double-check inline for clarity.
          } else if (admLooksLikePop(bid.adm) && !mt && !/<\w+\s/.test(bid.adm || '')) {
            // Standalone trigger: no mtype, no HTML tag-shape in adm, but adm
            // looks like a window.open / bare URL — most likely pop. Tag it.
            formats.add(FORMATS.POPS);
          }
        }
      }
    }

    // ── oRTB 3.0 / AdCOM path
    //
    // The third axis was written for 2.x shapes only and answered
    // `{formats:[],contexts:[],protocols:[],confidence:0}` — "nothing is
    // known" — for a perfectly readable 3.0 CTV video request. Nothing was
    // unknown about it: the slot is at `item[].spec.placement.video`, the
    // channel at `context.app`, the screen at `context.device`. Only the
    // addresses had changed, and the equivalent 2.5 payload answered
    // video + inapp + ctv with confidence 1.
    //
    // The output vocabulary stays the 2.x one on purpose. AdCOM says
    // "display" where oRTB 2.x says "banner", but this axis exists so the UI
    // and the LLM context can talk about a payload without first asking which
    // version wrote it; a version-dependent tag set would defeat that. So
    // AdCOM display → `banner`, and the version question stays where it
    // belongs, on `detectVersion`.
    const env30 = isObj(p.openrtb) ? p.openrtb : null;
    const req30 = env30 && isObj(env30.request) ? env30.request : Array.isArray(p.item) ? p : null;
    if (req30) {
      for (const it of Array.isArray(req30.item) ? req30.item : []) {
        if (!isObj(it) || !isObj(it.spec) || !isObj(it.spec.placement)) continue;
        const pm = it.spec.placement;
        if (pm.display) formats.add(FORMATS.BANNER);
        if (pm.audio) formats.add(FORMATS.AUDIO);
        if (pm.native) formats.add(FORMATS.NATIVE);
        if (pm.video) {
          formats.add(FORMATS.VIDEO);
          if (isObj(pm.video) && Array.isArray(pm.video.ctype)) {
            for (const c of pm.video.ctype) {
              const fam = adcomCtypeToFamily(c);
              if (fam) protocols.add(fam);
            }
          }
        }
      }
      const ctx30 = isObj(req30.context) ? req30.context : {};
      if (ctx30.app) contexts.add(CONTEXTS.INAPP);
      if (ctx30.site) contexts.add(CONTEXTS.WEB);
      if (ctx30.dooh) contexts.add(CONTEXTS.DOOH);
      if (isObj(ctx30.device)) {
        // AdCOM names the device kind `type`; 2.x calls it `devicetype`. The
        // enumerated list behind both is the same one, so accept either name
        // rather than deciding which spelling a sender "should" have used.
        const dev30 = ctx30.device;
        const dt = dev30.type != null ? dev30.type : dev30.devicetype;
        const ctxFromDt30 = deviceTypeToContext(dt);
        if (ctxFromDt30) contexts.add(ctxFromDt30);
      }
    }

    // 3.0 response. `bid.media` is AdCOM's Media, whose `ad` child is the Ad
    // object that actually owns display/video/audio/native — see
    // `resolveAdCom` in rules-response-30.js, which accepts the same two
    // shapes for the same reason (real senders and this repo's own samples
    // emit the flat one).
    const res30 = env30 && isObj(env30.response) ? env30.response : hasAdComBidMedia(p) ? p : null;
    if (res30) {
      for (const sb of Array.isArray(res30.seatbid) ? res30.seatbid : []) {
        if (!isObj(sb) || !Array.isArray(sb.bid)) continue;
        for (const bid of sb.bid) {
          if (!isObj(bid) || !isObj(bid.media)) continue;
          const ad = isObj(bid.media.ad) ? bid.media.ad : bid.media;
          if (ad.display) formats.add(FORMATS.BANNER);
          if (ad.audio) formats.add(FORMATS.AUDIO);
          if (ad.native) formats.add(FORMATS.NATIVE);
          if (ad.video) {
            formats.add(FORMATS.VIDEO);
            const adm = isObj(ad.video) ? ad.video.adm : null;
            if (isVastShape(adm)) {
              const ver = detectVastVersion(adm);
              const major = ver ? ver.split('.')[0] : null;
              if (major === '2') protocols.add(PROTOCOLS.VAST_2);
              else if (major === '3') protocols.add(PROTOCOLS.VAST_3);
              else if (major === '4') protocols.add(PROTOCOLS.VAST_4);
            }
          }
        }
      }
    }

    // ── Context (request side)
    if (p.app) contexts.add(CONTEXTS.INAPP);
    if (p.site) contexts.add(CONTEXTS.WEB);
    if (p.dooh) contexts.add(CONTEXTS.DOOH);
    if (isObj(p.device)) {
      const ctxFromDt = deviceTypeToContext(p.device.devicetype);
      if (ctxFromDt) contexts.add(ctxFromDt);
    }

    // ── Single-object JSON-feed (push / pops / inpage)
    if (!Array.isArray(p.imp) && !Array.isArray(p.seatbid) && !p.openrtb && !p.item) {
      detectFeedFormat(p, formats);
    }
  }

  const confidence = formats.size + contexts.size + protocols.size > 0 ? 1 : 0;
  return {
    formats: Array.from(formats),
    contexts: Array.from(contexts),
    protocols: Array.from(protocols),
    tags: [...formats, ...contexts, ...protocols],
    confidence,
  };
}

module.exports = { detectFormat, isVastShape, detectVastVersion, FORMATS, CONTEXTS, PROTOCOLS };
