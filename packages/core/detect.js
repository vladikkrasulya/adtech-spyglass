'use strict';

/**
 * Payload type + OpenRTB version detection.
 *
 * `detectType()` answers the four-way question: is this a BidRequest, a
 * BidResponse, a vendor feed, or a JSON Feed.
 *
 * `detectVersion()` answers "which OpenRTB version produced this?" by walking
 * the payload for **field-presence signals** that only exist in particular
 * versions. Per ARCHITECTURE §3.3, the canonical X-Openrtb-Version header is
 * unavailable when the payload is pasted into the UI — field signals are the
 * only thing we can rely on.
 *
 * Scope here is three buckets: '2.5', '2.6', '3.0', plus 'unknown' fallback.
 * Future minor-revision detection (2.6-202211 / 202309 / 202505) is a follow-
 * up — the signal table extends without API changes.
 */

const { isObj } = require('./helpers');

const TYPES = {
  ORTB_REQUEST: 'oRTB BidRequest',
  ORTB_RESPONSE: 'oRTB BidResponse',
  VENDOR_FEED: 'Vendor Feed Response',
  JSON_FEED: 'JSON Feed 1.1',
  // URL-style ad request (clickunder/teaser/pop GETs that take params in the
  // query-string instead of an oRTB JSON body). Decoded by
  // `decoders/request/<variant>/` into a canonical request shape. Added
  // 2026-05-21 alongside url-linkfeed as the first decoder.
  URL_REQUEST: 'URL Request',
  UNKNOWN: 'unknown',
};

const VERSIONS = {
  V_2_5: '2.5',
  V_2_6: '2.6',
  V_3_0: '3.0',
  UNKNOWN: 'unknown',
};

// Signals that mean "this payload is at least 2.6". Any one of these is
// a definitive marker — they didn't exist in 2.5 or earlier.
//
// Path syntax:
//   'a.b'      — object key
//   'a[].b'    — array element's b (matches if ANY element has b set)
const SIGNALS_2_6 = [
  // BidRequest
  'imp[].rwdd',
  'imp[].ssai',
  'imp[].qty',
  'device.sua',
  'regs.gpp',
  'regs.gpp_sid',
  'site.cattax',
  'app.cattax',
  'site.publisher.cattax',
  'app.publisher.cattax',
  'site.langb',
  'app.langb',
  'imp[].video.plcmt',
  'imp[].video.poddedupe',
  'imp[].refresh',
  'acat',
  'dooh',
  // BidResponse
  'seatbid[].bid[].mtype',
  'seatbid[].bid[].apis',
  'seatbid[].bid[].cattax',
];

// Signals that confirm "at least 2.5" (but don't elevate to 2.6).
// Used as the floor when no 2.6 markers are seen.
const SIGNALS_2_5 = [
  'source',
  'bseat',
  'wlang',
  'imp[].metric',
  'imp[].banner.vcm',
  'imp[].video.placement',
  'imp[].video.playbackend',
  'device.mccmnc',
  'seatbid[].bid[].burl',
  'seatbid[].bid[].lurl',
  'seatbid[].bid[].tactic',
  'seatbid[].bid[].language',
  'seatbid[].bid[].wratio',
];

// Path traversal that handles 'a.b' and 'a[].b'.
// Returns true if any reachable value at the path is non-null/undefined.
function pathExists(obj, path) {
  const parts = path.split('.');
  /** @type {any[]} */
  let cur = [obj];
  for (const part of parts) {
    if (!cur.length) return false;
    if (part.endsWith('[]')) {
      const key = part.slice(0, -2);
      const next = [];
      for (const c of cur) {
        if (c && Array.isArray(c[key])) {
          for (const item of c[key]) if (item != null) next.push(item);
        }
      }
      cur = next;
    } else {
      const next = [];
      for (const c of cur) {
        if (c && c[part] != null) next.push(c[part]);
      }
      cur = next;
    }
  }
  return cur.length > 0;
}

function collectMatches(payload, paths) {
  const hits = [];
  for (const p of paths) {
    if (pathExists(payload, p)) hits.push(p);
  }
  return hits;
}

// Single-object signatures for non-RTB JSON feeds. These formats return one
// bid as a top-level object (not an array, not wrapped in seatbid). Each has
// a small set of keys unique enough to discriminate from oRTB/RTB-envelope.
//   Value-feed     — `clickUrl` (camelCase) or `value` + `nUrl`
//   Bid-price feed — `notification_url` or `bid_price` + `link`
//   Bid-redirect   — `redirecturl` + `bid` (small object, ≤6 keys)
function looksLikeJsonFeedSingle(o) {
  // Each predicate uses a key unique enough that no other format we care
  // about ships it. `bid` / `link` alone are too generic — those check that
  // they appear *together* with a vendor-specific neighbour.
  if ('clickUrl' in o) return true; // value-feed (camelCase is unique)
  if ('notification_url' in o) return true; // bid-price feed
  if ('bid_price' in o) return true; // bid-price feed
  if ('redirecturl' in o) return true; // bid-redirect feed
  return false;
}

// Lazy-load to avoid a require cycle: decoders/request/index.js pulls
// `logger`, which is fine, but keeping the require inside the function
// also matches how downstream callers may stub detect.js in tests.
let _decodeRequest = null;
function decodeRequestLazy(text) {
  if (_decodeRequest === null) {
    try {
      _decodeRequest = require('./decoders/request').decodeRequest;
    } catch {
      _decodeRequest = () => null;
    }
  }
  return _decodeRequest(text);
}

function detectType(obj) {
  // String inputs are URL-style requests (clickunder/teaser/pop GETs). The
  // analyze pipeline passes pasted text verbatim when JSON.parse fails — we
  // claim it here if any request-decoder recognizes the URL signature.
  if (typeof obj === 'string') {
    const decoded = decodeRequestLazy(obj);
    if (decoded && decoded.variant) return TYPES.URL_REQUEST;
    return TYPES.UNKNOWN;
  }
  // Arrays are push-materials feed responses (list of materials).
  if (Array.isArray(obj)) return TYPES.VENDOR_FEED;
  if (!isObj(obj)) return TYPES.UNKNOWN;

  // 3.0 envelope check (the only structurally-distinct shape).
  // Detect on PRESENCE of `openrtb` object (regardless of ver value) —
  // a broken envelope is still a 3.0 attempt; we want 3.0-specific
  // findings, not generic "unknown_type".
  //
  // Discriminate request vs response by which child the envelope carries:
  //   openrtb.request → BidRequest  (or openrtb.openrtb_request via legacy)
  //   openrtb.response → BidResponse
  // If the envelope has neither (broken), default to REQUEST so the user
  // gets the request-side rules (request.30.request_required will fire).
  if (Array.isArray(obj.item) || isObj(obj.openrtb)) {
    if (isObj(obj.openrtb) && isObj(obj.openrtb.response)) {
      return TYPES.ORTB_RESPONSE;
    }
    return TYPES.ORTB_REQUEST;
  }

  // Structural markers — the canonical array decides the type.
  if (Array.isArray(obj.imp)) return TYPES.ORTB_REQUEST;
  if (Array.isArray(obj.seatbid)) return TYPES.ORTB_RESPONSE;
  // Clickunder XML-engine response. Three observed shapes:
  //   { result: { status: "BID",   listing: { …creative } } }  (single object — real prod shape)
  //   { result: { status: "BID",   listing: [{ … }, …] } }      (array — multi-creative variant)
  //   { result: { status: "NOBID" } }                            (no-bid, listing absent)
  // Pre-2026-05-12 only the array form was detected; the single-object and
  // NOBID shapes fell through to `unknown_type` despite being canonical real
  // responses accepted in production.
  if (isObj(obj.result)) {
    const r = obj.result;
    if (Array.isArray(r.listing) || isObj(r.listing)) return TYPES.VENDOR_FEED;
    // Link-feed shape: `result.link[]` with { bid, url, seat } per row.
    // Same family as clickunder (XML-engine response wrapped in
    // `result`), different key. Routed through VENDOR_FEED
    // so rules-feed dispatch can discriminate by key → validateLinkFeed.
    if (Array.isArray(r.link) || isObj(r.link)) return TYPES.VENDOR_FEED;
    if (typeof r.status === 'string' && r.status.toUpperCase() === 'NOBID') return TYPES.VENDOR_FEED;
  }
  if (obj.version && obj.items) return TYPES.JSON_FEED;

  // Single-bid JSON-feed responses (value-feed, bid-price, bid-redirect, …).
  // Get routed through the same VENDOR_FEED type — the rules-feed dispatcher
  // discriminates the actual format and returns a format-named result type.
  if (looksLikeJsonFeedSingle(obj)) return TYPES.VENDOR_FEED;

  // Heuristics for malformed payloads.
  if (obj.site || obj.app || obj.device) return TYPES.ORTB_REQUEST;
  if (typeof obj.id === 'string' && (obj.cur != null || obj.bidid != null || obj.nbr != null)) {
    return TYPES.ORTB_RESPONSE;
  }
  return TYPES.UNKNOWN;
}

/**
 * Detect OpenRTB version from payload field signals.
 * Returns { version, confidence, signals }.
 *
 *   confidence = 1   any 2.6 marker found
 *   confidence = 1   3.0 envelope detected
 *   confidence = 0.7 only 2.5 markers found (might still be 2.6 with no 2.6-only fields populated)
 *   confidence = 0.3 no markers at all (defaulted to 2.5)
 *   confidence = 0   non-object / can't tell
 *
 * @param {unknown} payload
 * @returns {{ version: string, confidence: number, signals: string[] }}
 */
function detectVersion(payload) {
  if (!payload || (typeof payload !== 'object' && !Array.isArray(payload))) {
    return { version: VERSIONS.UNKNOWN, confidence: 0, signals: [] };
  }
  /** @type {any} */
  const p = payload;

  // 3.0 — distinct top-level shape. Same loosened detection as
  // detectType() above: presence of `openrtb` object OR top-level
  // `item[]` is enough. Catches broken envelopes (ver="" / no
  // request) so the user sees 3.0-specific structural findings
  // instead of "looks like 2.5 with low confidence".
  if (Array.isArray(p.item) || isObj(p.openrtb)) {
    const signals = [];
    if (Array.isArray(p.item)) signals.push('item[]');
    if (isObj(p.openrtb)) signals.push('openrtb');
    return { version: VERSIONS.V_3_0, confidence: 1, signals };
  }

  const sig26 = collectMatches(payload, SIGNALS_2_6);
  if (sig26.length) {
    return { version: VERSIONS.V_2_6, confidence: 1, signals: sig26 };
  }

  const sig25 = collectMatches(payload, SIGNALS_2_5);
  if (sig25.length) {
    return { version: VERSIONS.V_2_5, confidence: 0.7, signals: sig25 };
  }

  // No markers — assume 2.5 (the lowest-friction default; fields used by the
  // current rule set are all in 2.5 baseline).
  return { version: VERSIONS.V_2_5, confidence: 0.3, signals: [] };
}

module.exports = { detectType, detectVersion, TYPES, VERSIONS };
