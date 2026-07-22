'use strict';

/**
 * lib/intel-rules.js — deterministic intelligence engine.
 *
 * Replaces the intel-llm.js Ollama/OpenRouter bridge for the four public
 * /api/intel/* features plus the news-moderator relevance score. Same
 * response shapes as the LLM path, plus `engine: 'rules'` provenance.
 *
 * Contract (why this exists — 2026-07-22 decision):
 *   - same input → same output, always; no randomness, no sampling;
 *   - no network: no Ollama, no OpenRouter, no cloud on these paths;
 *   - unknown stays "unknown" — the engine never guesses past its tables;
 *   - privacy posture unchanged: only field paths, char classes, domains
 *     and metadata summaries are inspected — never bid VALUES.
 */

// ── field purpose ───────────────────────────────────────────────────────────

const ALLOWED_PURPOSES = new Set([
  'click_url',
  'image_url',
  'icon_url',
  'tracker_pixel',
  'title',
  'description',
  'advertiser_domain',
  'segment_id',
  'macro_token',
  'format_id',
  'subscription_age',
  'zone_id',
  'custom_extension',
  'unknown',
]);

// Ordered: first match wins. Patterns run against the LAST path segment
// first (most specific), then the whole path. Confidence upgrades to
// 'high' when the charClass agrees with the purpose's expected shape.
const PURPOSE_RULES = [
  {
    re: /(^|_|\.)(click|clk|curl|landing|clickurl|click_url|dest|target)(_|\.|url|$)/i,
    purpose: 'click_url',
    shapes: ['url'],
  },
  { re: /(^|_|\.)(icon)(url|_|\.|$)/i, purpose: 'icon_url', shapes: ['url'] },
  {
    re: /(^|_|\.)(img|image|banner|creative|media|thumb)(url|_|\.|$)/i,
    purpose: 'image_url',
    shapes: ['url'],
  },
  {
    re: /(^|_|\.)(nurl|burl|lurl|purl|pixel|track|tracker|beacon|impression|viewurl|win)(_|\.|url|$)/i,
    purpose: 'tracker_pixel',
    shapes: ['url'],
  },
  { re: /(^|_|\.)(title|headline|head)$/i, purpose: 'title', shapes: ['mixed', 'alnum-mixed'] },
  {
    re: /(^|_|\.)(desc|description|body|text|summary)$/i,
    purpose: 'description',
    shapes: ['mixed'],
  },
  {
    re: /(^|_|\.)(adomain|advertiser_?domain|cdomain|brand_?domain)$/i,
    purpose: 'advertiser_domain',
    shapes: ['mixed', 'alnum-lower'],
  },
  {
    re: /(^|_|\.)(seg|segment|audience|cohort)(s|_?id|_|\.|$)/i,
    purpose: 'segment_id',
    shapes: ['digits', 'alnum-lower', 'alnum-mixed', 'hex'],
  },
  {
    re: /\{\{|\}\}|%%|\$\{|\[[A-Z_]+\]|(^|_|\.)(macro|placeholder)/i,
    purpose: 'macro_token',
    shapes: [],
  },
  {
    re: /(^|_|\.)(fmt|format|adtype|ad_?format|mimes?)(_?id)?$/i,
    purpose: 'format_id',
    shapes: ['digits', 'alnum-lower'],
  },
  {
    re: /(^|_|\.)(subage|sub(scription)?_?age)$/i,
    purpose: 'subscription_age',
    shapes: ['digits'],
  },
  {
    re: /(^|_|\.)((id)?zone|placement|spot|slot|tag|adunit|unit)(_?id)?$/i,
    purpose: 'zone_id',
    shapes: ['digits', 'alnum-lower', 'alnum-mixed'],
  },
];

/**
 * Deterministic field-purpose classification.
 * @returns {{purpose: string, confidence: 'high'|'medium'|'low', engine: 'rules'}}
 *          Always an object — "unknown" is a valid, honest answer.
 */
function fieldPurpose(path, charClass, _bucket) {
  const p = String(path || '').trim();
  if (!p) return { purpose: 'unknown', confidence: 'low', engine: 'rules' };
  const cc = typeof charClass === 'string' ? charClass : '';
  const segs = p.split('.');
  const last = segs[segs.length - 1] || '';

  // Macro shape in the VALUE dominates the path name.
  if (cc === 'macro' || /\{\{.*\}\}|%%[A-Z_]+%%|\$\{[^}]+\}/.test(p)) {
    return { purpose: 'macro_token', confidence: 'high', engine: 'rules' };
  }
  for (const rule of PURPOSE_RULES) {
    const hitLast = rule.re.test(last);
    const hitPath = hitLast || rule.re.test(p);
    if (!hitPath) continue;
    const shapeAgrees = rule.shapes.length === 0 || rule.shapes.includes(cc);
    const confidence = hitLast && shapeAgrees && cc ? 'high' : hitLast ? 'medium' : 'low';
    return { purpose: rule.purpose, confidence, engine: 'rules' };
  }
  // ext.* subtrees with no recognised name are custom extensions by definition.
  if (/(^|\.)ext(\.|$)/.test(p)) {
    return { purpose: 'custom_extension', confidence: 'medium', engine: 'rules' };
  }
  return { purpose: 'unknown', confidence: 'low', engine: 'rules' };
}

// ── cluster naming ──────────────────────────────────────────────────────────

const NAME_RE = /^[a-z][a-z0-9_]{0,29}$/;

/** @type {Array<[string, RegExp]>} */
const FORMAT_MARKERS = [
  ['video', /(^|\.)(video)(\.|$)|vast|mp4|vpaid/i],
  ['native', /(^|\.)(native)(\.|$)|assets\.|link\.url/i],
  ['audio', /(^|\.)(audio)(\.|$)|daast/i],
  ['push', /subage|idzone|push/i],
  ['pop', /(^|_|\.)pop(under|up)?(_|\.|$)/i],
  ['banner', /(^|\.)(banner)(\.|$)/i],
];
/** @type {Array<[string, RegExp]>} */
const TRAIT_MARKERS = [
  ['rewarded', /rewarded/i],
  ['ctv', /(^|\.|_)(ctv|connectedtv|smarttv)(\.|_|$)|devicetype.*(3|6|7)/i],
  ['skadn', /skadn|skoverlay/i],
  ['interstitial', /interstitial|instl/i],
  ['dooh', /(^|\.|_)dooh(\.|_|$)/i],
];

/**
 * Deterministic snake_case dialect name from the field signature.
 * @returns {{name: string, description: string, engine: 'rules'} | null}
 *          null only for empty/unusable input (same as the LLM contract).
 */
function suggestName(bucket, fields, opts) {
  const list = (Array.isArray(fields) ? fields : [])
    .filter((f) => typeof f === 'string' && f.length > 0)
    .slice(0, 50);
  if (list.length === 0) return null;
  const joined = list.join('\n');

  let format = null;
  for (const [name, re] of FORMAT_MARKERS) {
    if (re.test(joined)) {
      format = name;
      break;
    }
  }
  const traits = [];
  for (const [name, re] of TRAIT_MARKERS) {
    if (re.test(joined)) traits.push(name);
  }
  const surface = /(^|\.)app\./.test(joined) ? 'inapp' : /(^|\.)site\./.test(joined) ? 'web' : null;

  // Few-shot KB reference (deterministic reuse): if a shipped KB sample
  // shares >½ of its fields with ours, adopt its format label as ground.
  const o = opts || {};
  if (!format && Array.isArray(o.fewShot)) {
    for (const ex of o.fewShot) {
      if (!ex || !Array.isArray(ex.fields) || ex.fields.length === 0) continue;
      const ours = new Set(list);
      const overlap = ex.fields.filter((f) => ours.has(f)).length / ex.fields.length;
      if (overlap > 0.5 && typeof ex.format === 'string' && ex.format) {
        format = ex.format.toLowerCase().replace(/[^a-z0-9]/g, '');
        break;
      }
    }
  }

  const bucketTok =
    typeof bucket === 'string' && /^[a-z0-9_-]{2,20}$/i.test(bucket.trim())
      ? bucket.trim().toLowerCase().replace(/-/g, '_')
      : null;

  const parts = [];
  if (surface) parts.push(surface);
  if (format) parts.push(format);
  parts.push(...traits.slice(0, 2));
  if (parts.length === 0 && bucketTok) parts.push(bucketTok);
  if (parts.length === 0) {
    // No structural signal at all: honest generic name from the dominant
    // top-level namespace, not a guess at market vocabulary.
    const tops = new Map();
    for (const f of list) {
      const t = f
        .split('.')[0]
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
      if (t) tops.set(t, (tops.get(t) || 0) + 1);
    }
    const top = [...tops.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    parts.push(top ? top[0] : 'unknown');
    parts.push('dialect');
  }
  let name = parts
    .join('_')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_');
  name = name
    .replace(/^[^a-z]+/, '')
    .slice(0, 30)
    .replace(/_+$/, '');
  if (!NAME_RE.test(name)) name = 'unnamed_dialect';

  const descBits = [];
  if (format) descBits.push(`${format} inventory`);
  if (surface) descBits.push(surface === 'inapp' ? 'in-app traffic' : 'web traffic');
  if (traits.length) descBits.push(`markers: ${traits.join(', ')}`);
  const description = (
    descBits.length
      ? `Field signature suggests ${descBits.join(', ')}.`
      : `Named from the dominant field namespace (${name.replace(/_/g, ' ')}).`
  ).slice(0, 200);

  return { name, description, engine: 'rules' };
}

// ── partner detection ───────────────────────────────────────────────────────

// Normalised domain/bundle fragment → vendor brand. Fragments match against
// each collected hint with substring semantics on dot-boundaries.
const VENDOR_MAP = [
  ['doubleclick', 'Google'],
  ['googlesyndication', 'Google'],
  ['google.com', 'Google'],
  ['adnxs', 'Xandr'],
  ['appnexus', 'Xandr'],
  ['rubiconproject', 'Magnite'],
  ['magnite', 'Magnite'],
  ['pubmatic', 'PubMatic'],
  ['openx', 'OpenX'],
  ['criteo', 'Criteo'],
  ['smartadserver', 'Equativ'],
  ['sascdn', 'Equativ'],
  ['improvedigital', 'Improve Digital'],
  ['360yield', 'Improve Digital'],
  ['indexexchange', 'Index Exchange'],
  ['casalemedia', 'Index Exchange'],
  ['sovrn', 'Sovrn'],
  ['lijit', 'Sovrn'],
  ['triplelift', 'TripleLift'],
  ['3lift', 'TripleLift'],
  ['sharethrough', 'Sharethrough'],
  ['taboola', 'Taboola'],
  ['outbrain', 'Outbrain'],
  ['bidswitch', 'BidSwitch'],
  ['adform', 'Adform'],
  ['smaato', 'Smaato'],
  ['unityads', 'Unity Ads'],
  ['unity3d', 'Unity Ads'],
  ['applovin', 'AppLovin'],
  ['ironsrc', 'ironSource'],
  ['ironsource', 'ironSource'],
  ['vungle', 'Vungle'],
  ['chartboost', 'Chartboost'],
  ['mintegral', 'Mintegral'],
  ['inmobi', 'InMobi'],
  ['verve', 'Verve'],
  ['pubnative', 'Verve'],
  ['adtelligent', 'Adtelligent'],
  ['vidazoo', 'Vidazoo'],
  ['bidmatic', 'Bidmatic'],
  ['admixer', 'Admixer'],
  ['adkernel', 'AdKernel'],
  ['epom', 'Epom'],
  ['propellerads', 'PropellerAds'],
  ['adsterra', 'Adsterra'],
  ['exoclick', 'ExoClick'],
  ['yandex', 'Yandex Ads'],
  ['mgid', 'MGID'],
  ['revcontent', 'Revcontent'],
  ['amazon-adsystem', 'Amazon Ads'],
  ['aps.amazon', 'Amazon Ads'],
  ['spotx', 'SpotX'],
  ['spotxchange', 'SpotX'],
  ['freewheel', 'FreeWheel'],
  ['stickyadstv', 'FreeWheel'],
  ['teads', 'Teads'],
  ['seedtag', 'Seedtag'],
  ['ogury', 'Ogury'],
  ['loopme', 'LoopMe'],
  ['startapp', 'Start.io'],
  ['start.io', 'Start.io'],
  ['moloco', 'Moloco'],
  ['bigo', 'Bigo Ads'],
  ['pangle', 'Pangle'],
  ['tiktok', 'TikTok Ads'],
];

// Hosts that identify the PAGE, not the adtech vendor.
const GENERIC_HOST_RE =
  /(^|\.)(wordpress|blogspot|github|google-analytics|gstatic|cloudflare|cloudfront|akamai|fastly|jsdelivr|googleapis|gravatar|wp|medium|substack)\.(com|net|io|org)$|^(localhost|example\.(com|org|net))$/;

/** Walk a parsed JSON tree, collect distinct normalised domains/bundles. */
function extractPartnerHints(payloadObj, maxLen) {
  const cap = Math.max(1, maxLen || 30);
  const out = new Set();
  const URL_RE = /https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;

  function addDomain(d) {
    if (!d || typeof d !== 'string') return;
    const norm = d
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .replace(/^www\./, '')
      .trim();
    if (norm && norm.length < 80) out.add(norm);
  }

  function visit(node, depth) {
    if (depth > 8 || out.size >= cap) return;
    if (node == null) return;
    if (typeof node === 'string') {
      let m;
      URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(node)) !== null) {
        addDomain(m[1]);
        if (out.size >= cap) return;
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) {
        visit(v, depth + 1);
        if (out.size >= cap) return;
      }
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (
          (k === 'domain' || k === 'bundle' || k === 'cdomain' || k === 'storeurl') &&
          typeof v === 'string'
        ) {
          addDomain(v);
        }
        visit(v, depth + 1);
        if (out.size >= cap) return;
      }
    }
  }

  visit(payloadObj, 0);
  return Array.from(out);
}

function matchVendor(hint) {
  for (const [frag, brand] of VENDOR_MAP) {
    if (hint === frag || hint.includes(frag)) return brand;
  }
  return null;
}

/**
 * Deterministic vendor inference from domain hints.
 * @returns {{name: string, confidence: 'high'|'medium'|'low',
 *            hint_domains: string[], engine: 'rules'} | null}
 *          null = no confident vendor signal (same as the LLM contract).
 */
function suggestPartner(parsedReq, parsedRes) {
  const hints = new Set();
  for (const obj of [parsedReq, parsedRes]) {
    if (!obj) continue;
    for (const d of extractPartnerHints(obj, 25)) hints.add(d);
  }
  const domains = Array.from(hints);
  if (domains.length === 0) return null;

  const votes = new Map(); // brand → count
  for (const h of domains) {
    if (GENERIC_HOST_RE.test(h)) continue;
    const brand = matchVendor(h);
    if (brand) votes.set(brand, (votes.get(brand) || 0) + 1);
  }
  if (votes.size === 0) return null; // only publisher/generic domains → honest unknown

  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const [name, count] = ranked[0];
  const runnerUp = ranked[1] ? ranked[1][1] : 0;
  const confidence = count >= 2 && count > runnerUp ? 'high' : votes.size === 1 ? 'high' : 'medium';
  return { name, confidence, hint_domains: domains.slice(0, 10), engine: 'rules' };
}

// ── bid simulation ──────────────────────────────────────────────────────────

function summarizeRequestForSim(req) {
  const imps = Array.isArray(req.imp) ? req.imp : [];
  const formats = new Set();
  const sizes = new Set();
  let totalFloor = 0;
  let floorCount = 0;
  for (const imp of imps) {
    if (!imp) continue;
    if (imp.banner) {
      formats.add('banner');
      const b = imp.banner;
      if (b.w && b.h) sizes.add(`${b.w}x${b.h}`);
      if (Array.isArray(b.format))
        for (const f of b.format) if (f.w && f.h) sizes.add(`${f.w}x${f.h}`);
    }
    if (imp.video) formats.add('video');
    if (imp.native) formats.add('native');
    if (imp.audio) formats.add('audio');
    if (typeof imp.bidfloor === 'number') {
      totalFloor += imp.bidfloor;
      floorCount++;
    }
  }
  const avgFloor = floorCount ? totalFloor / floorCount : 0;
  const dev = req.device || {};
  return {
    impCount: imps.length,
    formats: Array.from(formats),
    sizes: Array.from(sizes).slice(0, 5),
    avgFloor: Number(avgFloor.toFixed(3)),
    currency: (Array.isArray(req.cur) && req.cur[0]) || 'USD',
    geoCountry: (dev.geo && dev.geo.country) || 'unknown',
    surface: req.app ? 'app' : req.site ? 'site' : 'unknown',
    appBundleOrDomain: (req.site && req.site.domain) || (req.app && req.app.bundle) || null,
    deviceType: dev.devicetype || null,
    auctionType: req.at || null,
  };
}

// Base CPM by richest available format, used only when the request carries
// no floor at all (a zero floor is common in test traffic).
const BASE_CPM = { video: 2.0, audio: 1.5, native: 0.8, banner: 0.5 };

/** Inventory quality score 0..1 from metadata completeness + shape. Pure. */
function qualityScore(s) {
  let q = 0;
  if (s.formats.includes('video')) q += 0.25;
  else if (s.formats.includes('native')) q += 0.15;
  else if (s.formats.length > 0) q += 0.1;
  if (s.surface !== 'unknown') q += 0.15;
  if (s.appBundleOrDomain) q += 0.15;
  if (s.geoCountry !== 'unknown') q += 0.15;
  if (s.sizes.length > 0 || s.formats.includes('video') || s.formats.includes('audio')) q += 0.1;
  if (s.deviceType != null) q += 0.1;
  if (s.impCount > 1) q += 0.1;
  return Number(Math.min(1, q).toFixed(2));
}

function refFloor(s) {
  if (s.avgFloor > 0) return s.avgFloor;
  const best = ['video', 'audio', 'native', 'banner'].find((f) => s.formats.includes(f));
  return BASE_CPM[best] || 0.5;
}

/**
 * Deterministic 3-strategy bid simulation. Transparent formulas:
 *   aggressive:   bids unless floor is absurd; price = floor × 1.40
 *   conservative: bids when quality ≥ 0.5 and floor ≤ 10; price = floor × 1.10
 *   quality:      bids when quality ≥ 0.65; price = floor × 1.65
 * A missing/zero floor falls back to a per-format base CPM.
 * @returns {Array<{strategy, label, bid, price, reason, engine}> | null}
 */
function simulateBids(bidReq) {
  if (!bidReq || typeof bidReq !== 'object') return null;
  const s = summarizeRequestForSim(bidReq);
  const q = qualityScore(s);
  const floor = refFloor(s);
  const fmt = s.formats.join('+') || 'no-format';
  const cur = s.currency;
  const out = [];

  // aggressive — max scale
  if (floor > 25) {
    out.push({
      strategy: 'aggressive',
      label: 'aggressive',
      bid: false,
      price: null,
      reason: `floor ${floor} ${cur} beyond scale budget (cap 25)`,
      engine: 'rules',
    });
  } else {
    out.push({
      strategy: 'aggressive',
      label: 'aggressive',
      bid: true,
      price: Number((floor * 1.4).toFixed(3)),
      reason: `scale play on ${fmt}: floor×1.40, quality ${q} acceptable at volume`,
      engine: 'rules',
    });
  }

  // conservative — protect ROAS
  if (q >= 0.5 && floor <= 10) {
    out.push({
      strategy: 'conservative',
      label: 'conservative',
      bid: true,
      price: Number((floor * 1.1).toFixed(3)),
      reason: `shape fits (quality ${q}, floor ${floor} ${cur}): floor×1.10 protects ROAS`,
      engine: 'rules',
    });
  } else {
    out.push({
      strategy: 'conservative',
      label: 'conservative',
      bid: false,
      price: null,
      reason:
        q < 0.5
          ? `metadata too thin (quality ${q} < 0.5) for a safe ROI call`
          : `floor ${floor} ${cur} above conservative ceiling (10)`,
      engine: 'rules',
    });
  }

  // quality — premium filter
  if (q >= 0.65) {
    out.push({
      strategy: 'quality',
      label: 'quality',
      bid: true,
      price: Number((floor * 1.65).toFixed(3)),
      reason: `premium signals (quality ${q}, ${s.surface}${s.appBundleOrDomain ? ' ' + String(s.appBundleOrDomain).slice(0, 30) : ''}): floor×1.65`,
      engine: 'rules',
    });
  } else {
    out.push({
      strategy: 'quality',
      label: 'quality',
      bid: false,
      price: null,
      reason: `premium bar not met (quality ${q} < 0.65): incomplete metadata or plain shape`,
      engine: 'rules',
    });
  }
  for (const r of out) if (r.reason.length > 140) r.reason = r.reason.slice(0, 137) + '…';
  return out;
}

// ── news relevance ──────────────────────────────────────────────────────────

// Weighted keyword tables. Scores are additive, clamped to 1..10.
// Calibration target mirrors the editorial bar the LLM was prompted with:
// core AdTech infrastructure ≈ 8-10, adjacent ≈ 4-7, unrelated ≈ 1-3.
const REL_CORE = [
  // +4 each (cap 8): two solid core hits alone must clear the publish bar
  /openrtb|ortb\b/i,
  /programmatic/i,
  /\bssp\b/i,
  /\bdsp\b/i,
  /header bidding|prebid/i,
  /ad ?exchange/i,
  /bid ?(request|response|stream|floor)/i,
  /supply.?path/i,
  /adtech|ad tech/i,
];
const REL_STRONG = [
  // +2 each (cap 4)
  /privacy sandbox/i,
  /\bidentity\b.*\b(ads?|advertising)\b|\b(ads?|advertising)\b.*\bidentity\b/i,
  /ad ?fraud|\bivt\b/i,
  /ads\.txt|sellers\.json|schain/i,
  /\bvast\b|\bvpaid\b/i,
  /\bctv\b|connected tv/i,
  /\bdooh\b/i,
  /curation/i,
  /retail media/i,
  /attribution/i,
  /\bcmp\b|consent string|tcf\b/i,
];
const REL_MEDIUM = [
  // +1 each (cap 2)
  /advertis/i,
  /monetiz/i,
  /publisher/i,
  /\bgdpr\b|\bccpa\b/i,
  /cookie/i,
  /auction/i,
];

/**
 * Deterministic 1..10 relevance score for an AdTech editorial draft.
 * @param {{title?: string, summary?: string}} draft
 * @returns {{score: number, engine: 'rules', hits: string[]}}
 */
function scoreRelevance(draft) {
  const text = `${(draft && draft.title) || ''}\n${(draft && draft.summary) || ''}`;
  const hits = [];
  let core = 0;
  for (const re of REL_CORE)
    if (re.test(text)) {
      core += 4;
      hits.push(re.source.slice(0, 20));
    }
  core = Math.min(8, core);
  let strong = 0;
  for (const re of REL_STRONG)
    if (re.test(text)) {
      strong += 2;
      hits.push(re.source.slice(0, 20));
    }
  strong = Math.min(4, strong);
  let medium = 0;
  for (const re of REL_MEDIUM)
    if (re.test(text)) {
      medium += 1;
      hits.push(re.source.slice(0, 20));
    }
  medium = Math.min(2, medium);

  let score = 1 + core + strong + medium;
  // An article with zero ad-ecosystem vocabulary cannot ride medium-only
  // generic words ("cookie" in a recipe) into publication.
  if (core === 0 && strong === 0) score = Math.min(score, 3);
  score = Math.max(1, Math.min(10, score));
  return { score, engine: 'rules', hits: hits.slice(0, 10) };
}

module.exports = {
  fieldPurpose,
  suggestName,
  suggestPartner,
  simulateBids,
  scoreRelevance,
  // pure internals, exported for tests:
  extractPartnerHints,
  summarizeRequestForSim,
  qualityScore,
  refFloor,
  matchVendor,
  ALLOWED_PURPOSES,
  VENDOR_MAP,
};
