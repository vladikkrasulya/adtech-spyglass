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

// IAB OpenRTB 2.6 §5.8 (Creative Subtypes - Audio/Video Protocols).
//   1 = VAST 1.0, 2 = VAST 2.0, 3 = VAST 3.0, 4 = VAST 1.0 wrapper,
//   5 = VAST 2.0 wrapper, 6 = VAST 3.0 wrapper, 7 = VAST 4.0,
//   8 = VAST 4.0 wrapper, 9 = DAAST 1.0, 10 = DAAST 1.0 wrapper,
//   11 = VAST 4.1, 12 = VAST 4.1 wrapper, 13 = VAST 4.2, 14 = VAST 4.2 wrapper.
function videoProtocolToFamily(p) {
  if (p === 2 || p === 5) return PROTOCOLS.VAST_2;
  if (p === 3 || p === 6) return PROTOCOLS.VAST_3;
  if (p === 7 || p === 8 || p === 11 || p === 12 || p === 13 || p === 14) return PROTOCOLS.VAST_4;
  if (p === 9 || p === 10) return PROTOCOLS.DAAST;
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
const { isVastShape, detectVastVersion, isDaastShape } = require('./vast-shape');

/**
 * Does a `bid.adm` string carry a Native 1.x creative? The body is JSON with a
 * `native` wrapper (or a bare native root) that carries an `assets` array or an
 * `assetsurl` pointer. Values are never inspected; a parse failure or any other
 * shape is not native. Mirrors the Inspector's own creative classifier so the
 * detected format matches what the browser renders.
 *
 * @param {unknown} adm
 * @returns {boolean}
 */
function admLooksLikeNative(adm) {
  if (typeof adm !== 'string') return false;
  const s = adm.trim();
  if (!s.startsWith('{')) return false;
  let parsed;
  try {
    parsed = JSON.parse(s);
  } catch {
    return false;
  }
  if (!isObj(parsed)) return false;
  const n = isObj(parsed.native) ? parsed.native : parsed;
  return Array.isArray(n.assets) || typeof n.assetsurl === 'string';
}

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
  // `link` joined 013's baseline push shape (owner ruling 2026-08-26): alone
  // it is too generic to claim anything, but here it only ever combines with
  // the image+title bar below, same as the other click spellings.
  const hasClick =
    'clickurl' in o || 'clickUrl' in o || 'click_url' in o || 'redirectUrl' in o || 'link' in o;
  // Accept the image_url/icon_url aliases the push-material validator already
  // honours (Kadam contract), so a material recognized and cleanly validated
  // under those alias names also earns its format tag rather than none.
  const hasImage = 'image' in o || 'icon' in o || 'image_url' in o || 'icon_url' in o;
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
 * Skip a DOCTYPE, including quoted values, comments and processing instructions
 * in its internal subset. No entity resolution or external reads.
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function skipDocType(s, i) {
  const n = s.length;
  let bracket = -1;
  let close = -1;
  let quote = '';
  for (let j = i + 9; j < n; j++) {
    const ch = s[j];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[') {
      bracket = j;
      break;
    }
    if (ch === '>') {
      close = j;
      break;
    }
  }

  if (close >= 0) {
    return close + 1;
  }
  if (bracket < 0) {
    const after = s.indexOf('>', i + 9);
    return after < 0 ? n : after + 1;
  }

  let j = bracket + 1;
  while (j < n) {
    if (s.startsWith('<!--', j)) {
      const end = s.indexOf('-->', j + 4);
      if (end < 0) return n;
      j = end + 3;
      continue;
    }
    if (s.startsWith('<?', j)) {
      const end = s.indexOf('?>', j + 2);
      if (end < 0) return n;
      j = end + 2;
      continue;
    }
    const ch = s[j];
    if (ch === '"' || ch === "'") {
      const end = s.indexOf(ch, j + 1);
      if (end < 0) return n;
      j = end + 1;
      continue;
    }
    if (ch === ']') {
      const after = s.indexOf('>', j + 1);
      return after < 0 ? n : after + 1;
    }
    j++;
  }
  return n;
}

/**
 * Read complete quoted attributes, stopping on an invalid/incomplete token.
 * Every iteration consumes a complete attribute or exits.
 * @param {string} tagContent
 * @param {number} nameEnd
 * @returns {{name: string, value: string}[]}
 */
function parseTagAttributes(tagContent, nameEnd) {
  const attrs = [];
  const n = tagContent.length;
  let i = nameEnd;
  while (i < n) {
    while (i < n && /[ \t\n\r]/.test(tagContent[i])) i++;
    if (i >= n || tagContent[i] === '/') break;
    const nameStart = i;
    while (i < n && !/[= \t\n\r/>'"<]/.test(tagContent[i])) i++;
    // A stray quoted '>' used to leave i unchanged and grow attrs forever.
    if (i === nameStart) break;
    const name = tagContent.slice(nameStart, i);
    while (i < n && /[ \t\n\r]/.test(tagContent[i])) i++;
    if (tagContent[i] !== '=') break;
    i++;
    while (i < n && /[ \t\n\r]/.test(tagContent[i])) i++;
    const quote = tagContent[i];
    if (quote !== '"' && quote !== "'") break;
    const valueStart = ++i;
    while (i < n && tagContent[i] !== quote) i++;
    if (i >= n) break;
    attrs.push({ name, value: tagContent.slice(valueStart, i) });
    i++;
  }
  return attrs;
}

/**
 * Scan VAST media evidence linearly, ignoring comments, CDATA, declarations and
 * vendor extension subtrees. This is not a general XML conformance validator.
 * @param {unknown} s
 * @returns {{ hasAudioMedia: boolean, hasVideoMedia: boolean, adTypeAudio: boolean, adTypeVideo: boolean }}
 */
function inspectVastCreative(s) {
  if (typeof s !== 'string') {
    return { hasAudioMedia: false, hasVideoMedia: false, adTypeAudio: false, adTypeVideo: false };
  }
  let hasAudioMedia = false;
  let hasVideoMedia = false;
  let adTypeAudio = false;
  let adTypeVideo = false;
  let extensionDepth = 0;

  const n = s.length;
  let i = 0;
  while (i < n) {
    const nextLt = s.indexOf('<', i);
    if (nextLt < 0) break;
    i = nextLt;

    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end < 0) break;
      i = end + 2;
      continue;
    }
    if (/^<!DOCTYPE/i.test(s.slice(i, i + 9))) {
      i = skipDocType(s, i);
      continue;
    }
    if (s.startsWith('</', i)) {
      if (extensionDepth > 0) extensionDepth--;
      const end = s.indexOf('>', i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }

    let quote = '';
    let tagEnd = -1;
    for (let j = i + 1; j < n; j++) {
      const ch = s[j];
      if (quote) {
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '>') {
        tagEnd = j;
        break;
      }
    }
    if (tagEnd < 0) break;

    const tagContent = s.slice(i + 1, tagEnd);
    i = tagEnd + 1;

    const mName = /^([A-Za-z_][A-Za-z0-9_.-]*:)?([A-Za-z0-9_.-]+)/.exec(tagContent);
    if (!mName) continue;
    const localName = mName[2].toLowerCase();
    const selfClosing = /\/\s*$/.test(tagContent);
    if (extensionDepth > 0) {
      if (!selfClosing) extensionDepth++;
      continue;
    }
    if (
      ['extensions', 'extension', 'creativeextensions', 'creativeextension'].includes(localName)
    ) {
      if (!selfClosing) extensionDepth = 1;
      continue;
    }

    if (localName === 'mediafile') {
      const attrs = parseTagAttributes(tagContent, mName[0].length);
      for (const attr of attrs) {
        if (attr.name.toLowerCase() === 'type') {
          const mime = attr.value.trim().toLowerCase();
          if (mime.startsWith('audio/')) hasAudioMedia = true;
          else if (mime.startsWith('video/')) hasVideoMedia = true;
        }
      }
    } else if (localName === 'ad' || localName === 'vast') {
      const attrs = parseTagAttributes(tagContent, mName[0].length);
      for (const attr of attrs) {
        if (attr.name.toLowerCase() === 'adtype') {
          const val = attr.value.trim().toLowerCase();
          if (val === 'audio') adTypeAudio = true;
          else if (val === 'video') adTypeVideo = true;
        }
      }
    }
  }

  return { hasAudioMedia, hasVideoMedia, adTypeAudio, adTypeVideo };
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
        if (imp.audio) {
          formats.add(FORMATS.AUDIO);
          if (Array.isArray(imp.audio.protocols)) {
            for (const proto of imp.audio.protocols) {
              const fam = videoProtocolToFamily(proto);
              if (fam) protocols.add(fam);
            }
          }
        }
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
          // Standalone Native detection: a Native 1.x `adm` JSON body carries
          // its own format identity even when the optional 2.6 `mtype` hint is
          // absent. Gated on `!mt` so a bid that declared its media type keeps
          // exactly its prior tags; generic JSON without a native carrier
          // stays unclassified.
          if (!mt && admLooksLikeNative(bid.adm)) formats.add(FORMATS.NATIVE);
          // Anchored sniff via the shared helpers above — this inline block
          // previously used a bare /<VAST\b/ substring test and its own
          // version regex, false-positive-ing on HTML creatives that merely
          // mention "<VAST" and drifting from detectVastVersion (the exact
          // divergence the helpers' doc-comment warns about).
          if (bid.protocol != null) {
            const fam = videoProtocolToFamily(bid.protocol);
            if (fam) protocols.add(fam);
          }
          if (isDaastShape(bid.adm)) {
            formats.add(FORMATS.AUDIO);
            protocols.add(PROTOCOLS.DAAST);
          }
          if (isVastShape(bid.adm)) {
            const vastMedia = inspectVastCreative(bid.adm);
            if (vastMedia.hasAudioMedia) formats.add(FORMATS.AUDIO);
            if (vastMedia.hasVideoMedia) formats.add(FORMATS.VIDEO);

            if (!vastMedia.hasAudioMedia && !vastMedia.hasVideoMedia) {
              if (vastMedia.adTypeAudio) formats.add(FORMATS.AUDIO);
              if (vastMedia.adTypeVideo) formats.add(FORMATS.VIDEO);

              if (!vastMedia.adTypeAudio && !vastMedia.adTypeVideo) {
                if (mt === FORMATS.AUDIO) {
                  formats.add(FORMATS.AUDIO);
                } else if (mt === FORMATS.VIDEO) {
                  formats.add(FORMATS.VIDEO);
                } else {
                  formats.add(FORMATS.VIDEO);
                }
              }
            }
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
        if (pm.audio) {
          formats.add(FORMATS.AUDIO);
          if (isObj(pm.audio) && Array.isArray(pm.audio.ctype)) {
            for (const c of pm.audio.ctype) {
              const fam = adcomCtypeToFamily(c);
              if (fam) protocols.add(fam);
            }
          }
        }
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
          if (ad.audio) {
            formats.add(FORMATS.AUDIO);
            if (isObj(ad.audio)) {
              if (typeof ad.audio.ctype === 'number') {
                const fam = adcomCtypeToFamily(ad.audio.ctype);
                if (fam) protocols.add(fam);
              }
              const adm = ad.audio.adm;
              if (isDaastShape(adm)) {
                protocols.add(PROTOCOLS.DAAST);
              } else if (isVastShape(adm)) {
                const ver = detectVastVersion(adm);
                const major = ver ? ver.split('.')[0] : null;
                if (major === '2') protocols.add(PROTOCOLS.VAST_2);
                else if (major === '3') protocols.add(PROTOCOLS.VAST_3);
                else if (major === '4') protocols.add(PROTOCOLS.VAST_4);
              }
            }
          }
          if (ad.native) formats.add(FORMATS.NATIVE);
          if (ad.video) {
            formats.add(FORMATS.VIDEO);
            if (isObj(ad.video)) {
              if (typeof ad.video.ctype === 'number') {
                const fam = adcomCtypeToFamily(ad.video.ctype);
                if (fam) protocols.add(fam);
              }
              const adm = ad.video.adm;
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

module.exports = {
  detectFormat,
  isVastShape,
  isDaastShape,
  detectVastVersion,
  FORMATS,
  CONTEXTS,
  PROTOCOLS,
};
