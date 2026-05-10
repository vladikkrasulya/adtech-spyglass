'use strict';

/**
 * Mirror generator — produce a canonical counterpart of a paste:
 *   BidRequest  → minimal-valid BidResponse that satisfies crosscheck
 *   BidResponse → minimal-valid BidRequest that the response would fit
 *
 * Rule-based, deterministic. The output is then run back through
 * validate() + crosscheck() as a self-test; any residual finding is
 * surfaced in the result so the caller sees what couldn't be auto-fit.
 *
 * Scope (v0):
 *   - oRTB 2.5/2.6 only (3.0 envelope produces a not_supported note)
 *   - mode 'minimal' only ('best-practice' / 'mirror-shape' deferred)
 *   - VAST emitted as a 4.0 InLine template; native adm built from
 *     declared assets; banner sizes copied from format[] / w+h.
 *   - When a native asset declaration cannot be parsed, the mirror
 *     skips the native body but still emits a banner fallback.
 *
 * Notes are i18n-neutral (id + params); caller resolves text the same
 * way it does for findings.
 */

const { isObj, isStr } = require('./helpers');
const { detectType, TYPES, detectVersion, VERSIONS } = require('./detect');

const DEFAULT_CUR = 'USD';
const DEFAULT_DOMAIN = 'example.com';
const DEFAULT_ADV_DOMAIN = 'advertiser.example';
const DEFAULT_IP = '203.0.113.1';
const DEFAULT_UA = 'Mozilla/5.0 (compatible; Spyglass-Mirror/1.0)';
const DEFAULT_LANG = 'en';
const DEFAULT_TMAX = 500;

const PRICE_BUMP = 0.10; // bid.price = floor + PRICE_BUMP, always above
const FLOOR_FROM_PRICE_RATIO = 0.5; // when going response→request

/**
 * Generate the counterpart of a paste.
 *
 * @param {unknown} input
 * @param {{mode?: string, dialect?: string}} [opts]
 * @returns {{
 *   ok: boolean,
 *   direction: string,        // 'response_from_request' | 'request_from_response' | 'unsupported'
 *   inputType: string,
 *   output: object|null,
 *   notes: Array<{id:string, params:object}>,
 *   selfTest: {
 *     validate: { status:string, errorCount:number, warningCount:number },
 *     crosscheck: { critCount:number, warnCount:number, okCount:number }
 *   }|null
 * }}
 */
function mirror(input, opts) {
  const o = opts || {};
  const mode = o.mode === 'best-practice' ? 'best-practice' : 'minimal';
  const notes = [];

  if (!isObj(input)) {
    return unsupported('mirror.error.input_not_object', notes);
  }

  const t = detectType(input);
  const v = detectVersion(input);

  // 3.0 envelope produces an explicit "not yet" note. Mirror v0 is
  // deliberately 2.x-only — generating valid 3.0 placement specs is a
  // separate chapter (Chapter C / AdCOM 1.0). Surfacing this honestly
  // beats producing a half-baked 3.0 carcass that fails its own validate.
  if (v && v.version === VERSIONS.V_3_0) {
    notes.push({ id: 'mirror.note.ortb_30_not_supported', params: {} });
    return {
      ok: false,
      direction: 'unsupported',
      inputType: t,
      output: null,
      notes,
      selfTest: null,
    };
  }

  if (t === TYPES.ORTB_REQUEST) {
    let output = responseFromRequest(input, notes);
    if (mode === 'best-practice') {
      output = enrichResponseBestPractice(output, input, notes);
    }
    return {
      ok: true,
      direction: 'response_from_request',
      inputType: t,
      output,
      notes,
      mode,
      selfTest: null, // filled in by index.js wrapper
    };
  }
  if (t === TYPES.ORTB_RESPONSE) {
    let output = requestFromResponse(input, notes);
    if (mode === 'best-practice') {
      output = enrichRequestBestPractice(output, input, notes);
    }
    return {
      ok: true,
      direction: 'request_from_response',
      inputType: t,
      output,
      notes,
      mode,
      selfTest: null,
    };
  }

  return unsupported('mirror.error.type_not_supported', notes, { type: t });
}

function unsupported(noteId, notes, params) {
  notes.push({ id: noteId, params: params || {} });
  return {
    ok: false,
    direction: 'unsupported',
    inputType: 'unknown',
    output: null,
    notes,
    selfTest: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// REQUEST → RESPONSE
// ─────────────────────────────────────────────────────────────────────

function responseFromRequest(req, notes) {
  const cur = pickCur(req, notes);
  const seatbid = [];
  const bids = [];

  const imps = Array.isArray(req.imp) ? req.imp : [];
  imps.forEach((imp, i) => {
    if (!isObj(imp)) return;
    const impId = isStr(imp.id) ? imp.id : `imp-${i + 1}`;
    const floor = Number(imp.bidfloor);
    const safeFloor = Number.isFinite(floor) && floor >= 0 ? floor : 0;
    const price = round2(safeFloor + PRICE_BUMP);

    const bid = {
      id: `bid-${i + 1}`,
      impid: impId,
      price,
      adomain: [DEFAULT_ADV_DOMAIN],
    };

    if (isObj(imp.banner)) {
      const size = pickBannerSize(imp.banner);
      if (size) {
        bid.w = size.w;
        bid.h = size.h;
        bid.adm = bannerHtml(size.w, size.h);
        notes.push({
          id: 'mirror.note.banner_size_copied',
          params: { num: i + 1, w: size.w, h: size.h },
        });
      } else {
        // No size declared anywhere — emit a generic 300×250 fallback.
        bid.w = 300;
        bid.h = 250;
        bid.adm = bannerHtml(300, 250);
        notes.push({ id: 'mirror.note.banner_size_default', params: { num: i + 1 } });
      }
    } else if (isObj(imp.video)) {
      bid.adm = vastTemplate(imp.video);
      notes.push({ id: 'mirror.note.video_vast_emitted', params: { num: i + 1 } });
    } else if (isObj(imp.native)) {
      const nativeAdm = nativeAdmFromRequest(imp.native);
      if (nativeAdm) {
        bid.adm = nativeAdm;
        notes.push({ id: 'mirror.note.native_adm_emitted', params: { num: i + 1 } });
      } else {
        // Couldn't parse the native asset declaration — fall back to a
        // banner placeholder so the bid is at least structurally valid.
        bid.w = 300;
        bid.h = 250;
        bid.adm = bannerHtml(300, 250);
        notes.push({ id: 'mirror.note.native_unparseable_fallback', params: { num: i + 1 } });
      }
    } else if (isObj(imp.audio)) {
      bid.adm = vastTemplate(imp.audio); // VAST is also valid for audio
      notes.push({ id: 'mirror.note.audio_vast_emitted', params: { num: i + 1 } });
    } else {
      bid.w = 300;
      bid.h = 250;
      bid.adm = bannerHtml(300, 250);
      notes.push({ id: 'mirror.note.imp_format_unknown_banner_fallback', params: { num: i + 1 } });
    }

    if (Number.isFinite(floor)) {
      notes.push({
        id: 'mirror.note.bid_price_above_floor',
        params: { num: i + 1, floor: safeFloor.toFixed(2), price: price.toFixed(2) },
      });
    }
    bids.push(bid);
  });

  if (bids.length) seatbid.push({ bid: bids });

  const out = {
    id: isStr(req.id) ? req.id : 'mirror-bid-1',
    cur,
    seatbid,
  };
  if (!seatbid.length) {
    notes.push({ id: 'mirror.note.no_imps_no_bids', params: {} });
  }
  return out;
}

function pickCur(req, notes) {
  if (Array.isArray(req.cur) && req.cur.length && isStr(req.cur[0])) {
    notes.push({ id: 'mirror.note.cur_inferred_from_request', params: { cur: req.cur[0] } });
    return req.cur[0];
  }
  return DEFAULT_CUR;
}

function pickBannerSize(banner) {
  if (Number.isFinite(Number(banner.w)) && Number.isFinite(Number(banner.h))) {
    return { w: Number(banner.w), h: Number(banner.h) };
  }
  if (Array.isArray(banner.format) && banner.format.length) {
    const first = banner.format[0];
    if (first && Number.isFinite(Number(first.w)) && Number.isFinite(Number(first.h))) {
      return { w: Number(first.w), h: Number(first.h) };
    }
  }
  return null;
}

function bannerHtml(w, h) {
  return `<a href="https://${DEFAULT_ADV_DOMAIN}"><img src="https://cdn.${DEFAULT_ADV_DOMAIN}/creative-${w}x${h}.png" width="${w}" height="${h}" alt="Spyglass Mirror creative ${w}x${h}"/></a>`;
}

function vastTemplate(video) {
  const dur = Math.max(5, Math.min(30, Number(video && video.maxduration) || 15));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<VAST version="4.0">',
    '  <Ad id="mirror-ad-1">',
    '    <InLine>',
    `      <AdSystem>Spyglass Mirror</AdSystem>`,
    '      <AdTitle>Mirror Demo Ad</AdTitle>',
    '      <Impression><![CDATA[https://' +
      DEFAULT_ADV_DOMAIN +
      '/imp]]></Impression>',
    '      <Creatives>',
    '        <Creative id="mirror-creative-1">',
    '          <Linear>',
    `            <Duration>00:00:${pad2(dur)}</Duration>`,
    '            <MediaFiles>',
    `              <MediaFile delivery="progressive" type="video/mp4" width="640" height="360"><![CDATA[https://${DEFAULT_ADV_DOMAIN}/creative.mp4]]></MediaFile>`,
    '            </MediaFiles>',
    '          </Linear>',
    '        </Creative>',
    '      </Creatives>',
    '    </InLine>',
    '  </Ad>',
    '</VAST>',
  ].join('\n');
}

function nativeAdmFromRequest(impNative) {
  let parsed;
  try {
    parsed =
      typeof impNative.request === 'string'
        ? JSON.parse(impNative.request)
        : impNative.request;
  } catch {
    return null;
  }
  if (!isObj(parsed) || !isObj(parsed.native) || !Array.isArray(parsed.native.assets)) {
    return null;
  }
  const responseAssets = parsed.native.assets
    .filter((a) => a && a.id != null)
    .map((a) => buildNativeResponseAsset(a))
    .filter(Boolean);

  return JSON.stringify({
    native: {
      assets: responseAssets,
      link: { url: `https://${DEFAULT_ADV_DOMAIN}` },
    },
  });
}

function buildNativeResponseAsset(req) {
  const id = Number(req.id);
  if (!Number.isFinite(id)) return null;
  if (isObj(req.title)) {
    return { id, title: { text: 'Mirror headline' } };
  }
  if (isObj(req.img)) {
    const w = Number(req.img.w) || 300;
    const h = Number(req.img.h) || 250;
    return {
      id,
      img: {
        url: `https://cdn.${DEFAULT_ADV_DOMAIN}/native-${w}x${h}.png`,
        w,
        h,
      },
    };
  }
  if (isObj(req.data)) {
    return { id, data: { value: 'Mirror body text' } };
  }
  if (isObj(req.video)) {
    return { id, video: { vasttag: vastTemplate({ maxduration: 15 }) } };
  }
  return { id, data: { value: 'Mirror placeholder' } };
}

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────
// RESPONSE → REQUEST
// ─────────────────────────────────────────────────────────────────────

function requestFromResponse(res, notes) {
  const cur = isStr(res.cur) ? res.cur : DEFAULT_CUR;
  if (isStr(res.cur)) {
    notes.push({ id: 'mirror.note.cur_inferred_from_response', params: { cur } });
  }

  const imps = [];
  const seenImpIds = new Set();
  const seatbid = Array.isArray(res.seatbid) ? res.seatbid : [];
  let bidNum = 0;

  for (const sb of seatbid) {
    const bids = isObj(sb) && Array.isArray(sb.bid) ? sb.bid : [];
    for (const bid of bids) {
      bidNum++;
      if (!isObj(bid)) continue;
      const impId = isStr(bid.impid) ? bid.impid : `imp-${bidNum}`;
      if (seenImpIds.has(impId)) continue;
      seenImpIds.add(impId);

      const imp = inferImpFromBid(bid, impId, cur, notes);
      imps.push(imp);
    }
  }

  if (!imps.length) {
    // No-bid response or all-malformed bids — emit one default banner imp
    // so the result is at least a structurally valid request.
    imps.push({
      id: 'imp-1',
      bidfloor: 0.05,
      bidfloorcur: cur,
      banner: { w: 300, h: 250 },
    });
    notes.push({ id: 'mirror.note.no_bids_default_banner_imp', params: {} });
  }

  return {
    id: isStr(res.id) ? res.id : 'mirror-req-1',
    at: 2,
    tmax: DEFAULT_TMAX,
    cur: [cur],
    imp: imps,
    site: { domain: DEFAULT_DOMAIN },
    device: {
      ip: DEFAULT_IP,
      ua: DEFAULT_UA,
      language: DEFAULT_LANG,
      geo: { country: 'USA' },
    },
  };
}

function inferImpFromBid(bid, impId, cur, notes) {
  const priceNum = Number(bid.price);
  const safePrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : 0.10;
  // Floor at 50% of bid so the mirror request would always accept its own
  // partner response. Floor of 0 is allowed but boring; halving keeps it
  // realistic for read-as-example use.
  const floor = round2(Math.max(0.01, safePrice * FLOOR_FROM_PRICE_RATIO));

  const imp = {
    id: impId,
    bidfloor: floor,
    bidfloorcur: cur,
  };

  const adm = isStr(bid.adm) ? bid.adm : '';
  // Order matters: VAST first (XML-shape), then JSON-native, then HTML banner.
  if (admIsVast(adm)) {
    const dur = Math.max(15, Math.min(60, vastDurationGuess(adm) + 5));
    imp.video = {
      mimes: ['video/mp4'],
      minduration: 5,
      maxduration: dur,
      protocols: [3, 7], // VAST 3.0 + 4.0 InLine
      w: 640,
      h: 360,
    };
    notes.push({ id: 'mirror.note.imp_video_inferred_from_vast', params: { num: imp.id } });
  } else if (admIsNative(adm)) {
    imp.native = nativeRequestFromAdm(adm);
    notes.push({ id: 'mirror.note.imp_native_inferred_from_adm', params: { num: imp.id } });
  } else {
    const w = Number(bid.w);
    const h = Number(bid.h);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      imp.banner = { w, h };
      notes.push({
        id: 'mirror.note.imp_banner_size_from_bid',
        params: { num: imp.id, w, h },
      });
    } else {
      imp.banner = { w: 300, h: 250 };
      notes.push({ id: 'mirror.note.imp_banner_default_size', params: { num: imp.id } });
    }
  }
  return imp;
}

function admIsVast(adm) {
  return /^\s*<(?:\?xml[^?]*\?>\s*)?<?\s*VAST[\s>]/i.test(adm) || /<VAST[\s>]/i.test(adm);
}

function admIsNative(adm) {
  if (!adm || adm[0] !== '{') return false;
  try {
    const o = JSON.parse(adm);
    return isObj(o) && isObj(o.native);
  } catch {
    return false;
  }
}

function vastDurationGuess(adm) {
  const m = adm.match(/<Duration>\s*(\d+):(\d+):(\d+)\s*<\/Duration>/i);
  if (!m) return 30;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function nativeRequestFromAdm(adm) {
  let parsed;
  try {
    parsed = JSON.parse(adm);
  } catch {
    return { ver: '1.2', request: '{"native":{"assets":[]}}' };
  }
  const responseAssets =
    isObj(parsed) && isObj(parsed.native) && Array.isArray(parsed.native.assets)
      ? parsed.native.assets
      : [];
  const reqAssets = responseAssets
    .filter((a) => a && a.id != null)
    .map((a) => buildNativeRequestAsset(a))
    .filter(Boolean);

  return {
    ver: '1.2',
    request: JSON.stringify({ native: { assets: reqAssets } }),
  };
}

function buildNativeRequestAsset(resAsset) {
  const id = Number(resAsset.id);
  if (!Number.isFinite(id)) return null;
  if (isObj(resAsset.title)) {
    return { id, required: 1, title: { len: 90 } };
  }
  if (isObj(resAsset.img)) {
    const w = Number(resAsset.img.w) || 300;
    const h = Number(resAsset.img.h) || 250;
    return { id, required: 1, img: { type: 3, w, h } };
  }
  if (isObj(resAsset.data)) {
    return { id, required: 0, data: { type: 2 } };
  }
  if (isObj(resAsset.video)) {
    return {
      id,
      required: 1,
      video: { mimes: ['video/mp4'], minduration: 5, maxduration: 30, protocols: [3, 7] },
    };
  }
  return { id, required: 0, data: { type: 2 } };
}

// ─────────────────────────────────────────────────────────────────────
// BEST-PRACTICE ENRICHERS — only fire when mode === 'best-practice'.
// Add recommended-not-required IAB fields so the mirror reads as
// "this is what a good integration looks like", not just "this is the
// spec minimum". Keep additive only — never overwrite something the
// minimal generator already set.
// ─────────────────────────────────────────────────────────────────────

function enrichResponseBestPractice(out, _req, notes) {
  // Top-level: bidid (BidResponse-level identifier, distinct from bid.id)
  if (!isStr(out.bidid)) {
    out.bidid = 'mirror-bidid-1';
  }
  // Per-bid: crid/cid/cattax/lurl + DSA bidext for EU eligibility.
  for (const sb of out.seatbid || []) {
    if (!isObj(sb)) continue;
    if (!isStr(sb.seat)) sb.seat = 'mirror-seat';
    for (const b of sb.bid || []) {
      if (!isObj(b)) continue;
      if (!isStr(b.crid)) b.crid = `creative-${b.id || 'x'}`;
      if (!isStr(b.cid)) b.cid = 'campaign-mirror';
      if (b.cattax == null) b.cattax = 6; // IAB Content Taxonomy 3.0
      if (!Array.isArray(b.cat) || !b.cat.length) b.cat = ['IAB3-1'];
      if (!isStr(b.lurl)) b.lurl = 'https://advertiser.example/loss?reason=${AUCTION_LOSS}';
      if (!isStr(b.nurl)) {
        b.nurl = 'https://advertiser.example/win?price=${AUCTION_PRICE}';
      }
      if (b.language == null) b.language = 'en';
      if (!isObj(b.ext)) b.ext = {};
      // DSA Transparency (EU regulation, IAB extension since 2024)
      if (!isObj(b.ext.dsa)) {
        b.ext.dsa = {
          behalf: 'advertiser.example',
          paid: 'advertiser.example',
          adrender: 1,
        };
      }
    }
  }
  notes.push({ id: 'mirror.note.bestpractice_response_enriched', params: {} });
  return out;
}

function enrichRequestBestPractice(out, _res, notes) {
  // Source: schain (sellers.json + ads.txt enforcement)
  if (!isObj(out.source)) out.source = {};
  if (!isObj(out.source.ext)) out.source.ext = {};
  if (!isObj(out.source.ext.schain)) {
    out.source.ext.schain = {
      ver: '1.0',
      complete: 1,
      nodes: [
        { asi: 'mirror-ssp.example', sid: 'pub-1', hp: 1 },
      ],
    };
  }
  // Regulatory: GDPR + GPP signals so EU bidders don't refuse on principle
  if (!isObj(out.regs)) out.regs = {};
  if (out.regs.coppa == null) out.regs.coppa = 0;
  if (!isObj(out.regs.ext)) out.regs.ext = {};
  if (out.regs.ext.gdpr == null) out.regs.ext.gdpr = 0;
  if (!isObj(out.user)) out.user = {};
  if (!isObj(out.user.ext)) out.user.ext = {};
  if (!isStr(out.user.ext.consent)) {
    // Empty TCF consent ("CP..." TCFv2 string would be more realistic but
    // generating one requires base64 encoding the full TCF binary; this
    // placeholder is enough to satisfy "field is present" lint rules).
    out.user.ext.consent = '';
  }
  // Device.sua (Structured User-Agent, oRTB 2.6 — strongly recommended
  // post Chrome UA freeze)
  if (isObj(out.device) && !isObj(out.device.sua)) {
    out.device.sua = {
      browsers: [{ brand: 'Chromium', version: ['122'] }],
      platform: { brand: 'Windows', version: ['10'] },
      mobile: 0,
    };
  }
  // tmax — already set by minimal, but keep belt-and-braces.
  if (out.tmax == null) out.tmax = 500;
  notes.push({ id: 'mirror.note.bestpractice_request_enriched', params: {} });
  return out;
}

module.exports = { mirror };
