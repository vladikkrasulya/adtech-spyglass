'use strict';

/**
 * Format Detection Engine — Phase 10.
 *
 * Pure-data heuristics that tag a payload with its ad FORMAT, runtime
 * CONTEXT, and creative PROTOCOL family. Runs in browser AND Node;
 * intentionally has zero fs / network dependencies so it can fire on
 * every paste, before validation, before LLM, before anything.
 *
 * This is the third axis of detection in Spyglass core:
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

function isObj(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Tiny VAST helpers — exported so rule files share one anchored regex
 * instead of each inventing their own. The previous codebase had three
 * subtly different sniffers (this file, crosscheck.js, the UI). All
 * future code SHOULD reuse these.
 *
 * `isVastShape` is anchored at start (allowing whitespace) so a string
 * mentioning `<VAST` deep inside HTML doesn't false-positive. `detect`
 * returns the major.minor string from the version attribute, or null.
 */
function isVastShape(s) {
  if (typeof s !== 'string') return false;
  // Anchor on `<VAST` directly, OR `<?xml` prefix immediately followed by
  // `<VAST` (allowing the XML declaration). Pre-fix any `<?xml` prefix
  // matched, which false-positive'd on SVG / other XML-shaped creatives
  // (audit 2026-05-10 finding B-12). Now only an actual VAST root passes.
  return /^\s*(?:<\?xml[^?]*\?>\s*)?<VAST\b/i.test(s);
}

function detectVastVersion(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/<VAST\b[^>]*\sversion\s*=\s*["'](\d+(?:\.\d+)?)["']/i);
  return m ? m[1] : null;
}

/**
 * Single-object JSON-feed signatures. The push-materials feed and the
 * bid-redirect-style popunder have unique enough shapes that one or two
 * keys discriminate them. Inpage is a soft heuristic — the canonical
 * signal is server-side `ext.format` rather than shape.
 */
function detectFeedFormat(o, tags) {
  if (!isObj(o)) return;
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
          ...scanExtForFormatHints(imp.ext, '', userDialect),
          ...(imp.banner ? scanExtForFormatHints(imp.banner.ext, '', userDialect) : []),
          ...(imp.video ? scanExtForFormatHints(imp.video.ext, '', userDialect) : []),
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
          if (typeof bid.adm === 'string' && /<VAST\b/i.test(bid.adm)) {
            formats.add(FORMATS.VIDEO);
            const m = bid.adm.match(/<VAST[^>]*\bversion\s*=\s*"(\d)(?:\.(\d))?"/i);
            if (m) {
              const major = m[1];
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
          for (const hint of scanExtForFormatHints(bid.ext, '', userDialect)) {
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
