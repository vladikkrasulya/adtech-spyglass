'use strict';

/**
 * Spyglass Intelligence — LLM bridge.
 *
 * Phase 7c. Server-side helper that calls a locally-hosted Ollama
 * instance (`http://ollama:11434/api/generate`) for two narrow
 * tasks: cluster naming + per-field purpose detection.
 *
 * Design constraints (from Phase 7 R&D + acoustic-budget decision):
 *   - LLM calls are user-triggered, not automatic. Each endpoint
 *     handles ONE explicit action — naming a cluster or labeling
 *     one field.
 *   - Every call has a hard timeout. A hung Ollama can't pile up
 *     pending requests.
 *   - Response parsing tolerates the LLM going off-script: we
 *     accept JSON, fenced JSON, or trailing prose, and fail open
 *     (return null suggestion) rather than crashing the endpoint.
 *   - Prompts never contain bid VALUES — only field paths,
 *     bucket names, and char-class hints. The privacy posture
 *     mirrors the rest of the Discovery layer.
 *
 * Failure modes:
 *   - Ollama unreachable (DNS / connection refused / timeout) →
 *     callOllama() throws OllamaUnavailable. Endpoint maps to 503.
 *   - LLM returned invalid JSON → extractStructured() returns null.
 *     Endpoint maps to 502 with reason='unparseable'.
 *   - LLM returned valid JSON but semantically empty / wrong shape →
 *     endpoint validates and returns 502 with reason='empty'.
 *
 * The frontend treats anything non-200 as "LLM unavailable" and
 * silently hides the AI affordances — no toast, no broken UI.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
// Generation timeout: qwen2.5:3b on i7-7700 CPU emits ~10 tok/s, so a
// 100-token JSON response takes ~10 sec wall-clock. Add headroom for
// prompt-eval (8B+ models can be slow on first warm-up), cap at 30s.
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 30_000;

class OllamaUnavailable extends Error {
  constructor(message, cause) {
    super(message);
    this.code = 'ollama_unavailable';
    this.cause = cause;
  }
}

/**
 * POST a generate request to Ollama and return the parsed top-level
 * response payload. Caller is responsible for extracting structured
 * fields out of `payload.response`.
 *
 * Why `format: 'json'`:
 *   Ollama supports a JSON mode where the model is constrained to
 *   emit valid JSON. qwen2.5:3b respects this faithfully — no fenced
 *   blocks, no preamble. Falls back gracefully if the response still
 *   isn't parseable (extractStructured handles it).
 */
async function callOllama(prompt, opts) {
  const o = opts || {};
  const url = OLLAMA_URL.replace(/\/+$/, '') + '/api/generate';
  const body = JSON.stringify({
    model: o.model || OLLAMA_MODEL,
    prompt: prompt,
    stream: false,
    format: 'json',
    options: {
      // Fewer threads = quieter fan; higher = faster. Server-side
      // override via OLLAMA_NUM_THREAD env if user tuned ollama
      // container. Default left to Ollama's auto-detection (matches
      // the acoustic profile measured during Phase 7 acoustic test).
      num_predict: o.numPredict || 200,
      // Low temperature for naming tasks — we want deterministic,
      // structured output, not creative exploration.
      temperature: typeof o.temperature === 'number' ? o.temperature : 0.2,
    },
  });

  // AbortController gives us a HARD timeout, separate from any per-
  // socket timeouts. Without this, fetch can hang indefinitely if
  // Ollama is alive but the worker thread is stuck.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      signal: controller.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new OllamaUnavailable('timeout after ' + OLLAMA_TIMEOUT_MS + 'ms');
    }
    throw new OllamaUnavailable('fetch failed: ' + (e && e.message ? e.message : 'unknown'), e);
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    throw new OllamaUnavailable('ollama responded ' + resp.status);
  }
  let json;
  try {
    json = await resp.json();
  } catch (e) {
    throw new OllamaUnavailable('ollama returned non-JSON envelope', e);
  }
  return json;
}

/**
 * Extract structured JSON from an Ollama response payload. Tolerates
 * model wrapping the JSON in fenced blocks or adding stray prose
 * around it (rare with format:'json' but cheap insurance).
 *
 * Returns null on any parse failure — caller decides whether that's
 * a 502 or a graceful empty.
 */
function extractStructured(ollamaResp) {
  if (!ollamaResp || typeof ollamaResp.response !== 'string') return null;
  let s = ollamaResp.response.trim();
  // Strip ```json … ``` fences if the model added them anyway.
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // Best-effort: find the outermost {...} block if there's leading prose.
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

// ── Prompt templates ─────────────────────────────────────────────

/**
 * Sanitise a path string for safe interpolation into a prompt. Field
 * paths come from the discovery walker and have already passed the
 * PII denylist, so they're well-formed by construction. We strip
 * non-ASCII anyway as defense in depth — a path with control chars
 * could plausibly steer an LLM in unexpected directions.
 */
function sanitisePath(p) {
  return String(p || '')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, 120);
}

/**
 * Sanitise a few-shot example for prompt injection. Examples come
 * from the curated `knowledge_base` (source of truth is local disk),
 * but we still strip non-ASCII and cap each field name as defense
 * in depth — a future ingestion script could land bad entries and
 * we don't want them to steer the model.
 */
function sanitiseExample(ex) {
  if (!ex || typeof ex !== 'object') return null;
  const format = String(ex.format || '')
    .replace(/[^a-z0-9-]/gi, '')
    .slice(0, 24);
  if (!format) return null;
  const fields = Array.isArray(ex.fields)
    ? ex.fields
        .map((f) => sanitisePath(f))
        .filter((f) => f.length > 0)
        .slice(0, 12)
    : [];
  if (fields.length === 0) return null;
  return { format, fields };
}

function buildSuggestNamePrompt(bucket, fields, opts) {
  const o = opts || {};
  const safeBucket = String(bucket || 'display')
    .replace(/[^a-z]/gi, '')
    .slice(0, 16);
  const fieldList = (fields || [])
    .slice(0, 50)
    .map((f) => '  - ' + sanitisePath(f))
    .join('\n');

  // Phase 10b — Few-Shot context. When the caller supplies anonymized
  // examples from the knowledge base, we include 1–2 reference rows so
  // the model can ground its naming choice in real-format vocabulary
  // rather than priors. Examples carry only field NAMES — never values.
  // When no examples are supplied, the prompt collapses to the original
  // Phase 7c zero-shot form (graceful fallback).
  const fewShot = Array.isArray(o.fewShot)
    ? o.fewShot.map(sanitiseExample).filter((x) => x != null)
    : [];

  const lines = [
    'You are an AdTech taxonomy expert. Given these field paths from a clean RTB',
    'bid stream, suggest a short snake_case dialect name and a one-sentence',
    'description of what kind of inventory the dialect represents. Output STRICT',
    'JSON only — no prose, no markdown fences.',
    '',
  ];

  if (fewShot.length > 0) {
    lines.push('Reference examples from canonical RTB streams (FORMAT — typical fields):');
    for (const ex of fewShot) {
      lines.push('  ' + ex.format + ' — ' + ex.fields.join(', '));
    }
    lines.push('');
    lines.push('Now name the NEW cluster below. Stay grounded in real-market vocabulary.');
    lines.push('');
  }

  lines.push('Bucket: ' + safeBucket);
  lines.push('Fields:');
  lines.push(fieldList);
  lines.push('');
  lines.push('Output schema:');
  lines.push(
    '{"name": "<snake_case, max 30 chars>", "description": "<one sentence, max 120 chars>"}',
  );

  return lines.join('\n');
}

function buildFieldPurposePrompt(path, charClass, bucket) {
  const safePath = sanitisePath(path);
  const safeClass = String(charClass || 'unknown')
    .replace(/[^a-z0-9-]/gi, '')
    .slice(0, 24);
  const safeBucket = String(bucket || 'display')
    .replace(/[^a-z]/gi, '')
    .slice(0, 16);
  return [
    'Identify the AdTech purpose of this RTB extension field. Output STRICT JSON.',
    '',
    'Field path: ' + safePath,
    'Char class: ' + safeClass,
    '  (alphabet of typical values: ascii / numeric / mixed / cyrillic / hex / base64)',
    'Bucket: ' + safeBucket,
    '  (ad inventory family: display / video / native / audio / pop / push)',
    '',
    'Common purposes (pick one):',
    '  click_url, image_url, icon_url, tracker_pixel, title, description,',
    '  advertiser_domain, segment_id, macro_token, format_id, subscription_age,',
    '  zone_id, custom_extension, unknown',
    '',
    "Prefer 'unknown' over guessing when the path and char class don't strongly imply a purpose.",
    '',
    'Output: {"purpose": "<one purpose from list>", "confidence": "high"|"medium"|"low"}',
  ].join('\n');
}

// ── Validation of LLM output ─────────────────────────────────────

const NAME_RE = /^[a-z][a-z0-9_]{0,29}$/;
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

function validateNameSuggestion(obj) {
  if (!obj || typeof obj !== 'object') return null;
  let name = typeof obj.name === 'string' ? obj.name.trim().toLowerCase() : '';
  // Coerce to snake_case if model returned spaces or hyphens.
  name = name.replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!NAME_RE.test(name)) return null;
  const description =
    typeof obj.description === 'string' ? obj.description.trim().slice(0, 200) : '';
  return { name, description };
}

function validatePurposeSuggestion(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const purpose = typeof obj.purpose === 'string' ? obj.purpose.trim().toLowerCase() : '';
  if (!ALLOWED_PURPOSES.has(purpose)) return null;
  const confidence =
    obj.confidence === 'high' || obj.confidence === 'medium' || obj.confidence === 'low'
      ? obj.confidence
      : 'medium';
  return { purpose, confidence };
}

// ── Partner inference (Phase C-1) ────────────────────────────────

// Walk a parsed JSON tree, collect distinct domains from URL-shaped
// strings + explicit domain fields. Caller passes payloadObj (already
// JSON.parse'd) and a maxLen cap.
function extractPartnerHints(payloadObj, maxLen) {
  const cap = Math.max(1, maxLen || 30);
  const out = new Set();
  // Common adtech fields where a vendor brand surfaces. URL parsing is
  // intentionally loose — we're extracting hints, not validating links.
  const URL_RE = /https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;

  function addDomain(d) {
    if (!d || typeof d !== 'string') return;
    const norm = d
      .toLowerCase()
      .replace(/^www\./, '')
      .trim();
    if (norm && norm.length < 80) out.add(norm);
  }

  function visit(node, depth) {
    if (depth > 8 || out.size >= cap) return;
    if (node == null) return;
    if (typeof node === 'string') {
      // Pull every URL out of the string and harvest its host.
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
        // Explicit domain-bearing fields (oRTB conventions).
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

function buildPartnerHintPrompt(domains) {
  return [
    'You are an adtech vendor identifier. Given a list of domains',
    'extracted from a bid payload, name the most likely SSP / DSP /',
    'ad-network the payload originated from. Use the SHORT brand name',
    "(1-3 words) as it appears in industry reporting. If you can't tell",
    "or domains look generic (just publisher sites), return 'unknown'.",
    '',
    'Domains:',
    ...domains.slice(0, 30).map((d) => '  - ' + d),
    '',
    'Output STRICT JSON, no commentary, no markdown:',
    '{"name": "<vendor short name, max 40 chars, OR \\"unknown\\">", "confidence": "high"|"medium"|"low"}',
  ].join('\n');
}

const PARTNER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,38}$/;

function validatePartnerSuggestion(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const raw = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!raw || raw.toLowerCase() === 'unknown') return null;
  if (!PARTNER_NAME_RE.test(raw)) return null;
  const confidence =
    obj.confidence === 'high' || obj.confidence === 'medium' || obj.confidence === 'low'
      ? obj.confidence
      : 'medium';
  return { name: raw, confidence };
}

// ── Public API ───────────────────────────────────────────────────

async function suggestName(bucket, fields, opts) {
  const prompt = buildSuggestNamePrompt(bucket, fields, opts);
  const resp = await callOllama(prompt, { numPredict: 120, temperature: 0.2 });
  const parsed = extractStructured(resp);
  return validateNameSuggestion(parsed);
}

async function fieldPurpose(path, charClass, bucket) {
  const prompt = buildFieldPurposePrompt(path, charClass, bucket);
  const resp = await callOllama(prompt, { numPredict: 60, temperature: 0.1 });
  const parsed = extractStructured(resp);
  return validatePurposeSuggestion(parsed);
}

/**
 * Infer a partner / vendor name from a parsed bid payload (request +/-
 * response). The caller passes pre-parsed JSON; we only walk the tree
 * for URL-shaped strings and known domain fields, never the bid VALUES.
 *
 * @param {object} parsedReq — JSON.parse'd BidRequest, may be null
 * @param {object} parsedRes — JSON.parse'd BidResponse, may be null
 * @returns {Promise<{name: string, confidence: 'high'|'medium'|'low', hint_domains: string[]} | null>}
 */
async function suggestPartner(parsedReq, parsedRes) {
  const hints = new Set();
  for (const obj of [parsedReq, parsedRes]) {
    if (!obj) continue;
    for (const d of extractPartnerHints(obj, 25)) hints.add(d);
  }
  const domains = Array.from(hints);
  if (domains.length === 0) return null;
  const prompt = buildPartnerHintPrompt(domains);
  const resp = await callOllama(prompt, { numPredict: 60, temperature: 0.1 });
  const parsed = extractStructured(resp);
  const validated = validatePartnerSuggestion(parsed);
  if (!validated) return null;
  return { ...validated, hint_domains: domains.slice(0, 10) };
}

/**
 * Simulate three DSP bidding strategies for a given BidRequest. Each
 * strategy gets its own prompt that asks the LLM to (a) decide whether to
 * bid, (b) at what price, (c) why — in plain language. Output is a
 * compact array we render as a "what would 3 different DSPs do?" panel.
 *
 * Privacy posture: we strip the request to a metadata-only summary
 * (slot count, formats, sizes, geo country, app vs site, currency,
 * floor) before prompting. Bid VALUES never reach the LLM.
 *
 * @param {object} bidReq — parsed BidRequest
 * @returns {Promise<Array<{strategy:string, label:string, bid:boolean,
 *                          price:number|null, reason:string}>>}
 */
async function simulateBids(bidReq) {
  if (!bidReq || typeof bidReq !== 'object') return null;
  const summary = summarizeRequestForSim(bidReq);
  // Three strategies, runs in parallel. Each call is isolated so a
  // single timeout / parse failure doesn't drop the whole batch.
  const strategies = [
    {
      key: 'aggressive',
      label: 'aggressive',
      hint: 'You bid hard on every impression you can fill. Push price 30-50% above floor. Goal: max scale.',
    },
    {
      key: 'conservative',
      label: 'conservative',
      hint: 'You only bid when ROI is obvious. Bid 5-15% above floor when shape fits, abstain otherwise. Goal: protect ROAS.',
    },
    {
      key: 'quality',
      label: 'quality',
      hint: 'You filter for premium inventory: brand-safe domain, modern device, complete metadata. Bid 50-80% above floor when those align, skip otherwise.',
    },
  ];

  const results = await Promise.all(
    strategies.map(async (s) => {
      try {
        const prompt = buildBidSimPrompt(summary, s);
        // num_predict tuned 2026-05-11: response is `{"bid": …, "price": …,
        // "reason": "…"}` — ~30-50 tokens. 100 leaves comfortable headroom
        // and shaves ~30% off wall-time vs the prior 200-budget.
        const resp = await callOllama(prompt, { numPredict: 100, temperature: 0.4 });
        const parsed = extractStructured(resp);
        const v = validateBidSim(parsed, s);
        return { strategy: s.key, label: s.label, ...v };
      } catch (e) {
        // One strategy fails → other two still ship. Caller can render
        // the available ones with a "1 of 3 strategies failed" note.
        return {
          strategy: s.key,
          label: s.label,
          bid: false,
          price: null,
          reason: 'simulation_failed',
        };
      }
    }),
  );
  return results;
}

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

function buildBidSimPrompt(summary, strategy) {
  return `You are a DSP bidder running the "${strategy.label}" strategy.
${strategy.hint}

BidRequest summary (metadata only, no personally identifiable data):
- imp_count: ${summary.impCount}
- formats: ${summary.formats.join(', ') || 'none'}
- sizes: ${summary.sizes.join(', ') || 'unspecified'}
- avg_floor: ${summary.avgFloor} ${summary.currency}
- geo: ${summary.geoCountry}
- surface: ${summary.surface}${summary.appBundleOrDomain ? ' (' + summary.appBundleOrDomain + ')' : ''}
- device_type: ${summary.deviceType || 'unspecified'}
- auction_type: ${summary.auctionType || 'unspecified'}

Decide whether to bid and at what price. Output STRICT JSON in this exact shape:
  - bid: boolean
  - price: number (when bid=true) or null (when bid=false)
  - reason: short string, max 140 chars, no emojis

Example bid:  {"bid": true, "price": 1.42, "reason": "premium video on app, geo fits brief"}
Example pass: {"bid": false, "price": null, "reason": "floor above ROI threshold for this shape"}

Rules:
- price is in ${summary.currency} per impression, must be > 0 when bid=true
- price must be >= avg_floor when bid=true (otherwise the bid won't clear)
- if abstaining, set bid=false and price=null and explain briefly in reason`;
}

function validateBidSim(parsed, strategy) {
  if (!parsed || typeof parsed !== 'object') {
    return { bid: false, price: null, reason: 'unparseable' };
  }
  const bid = parsed.bid === true;
  let price = null;
  if (
    bid &&
    typeof parsed.price === 'number' &&
    parsed.price > 0 &&
    Number.isFinite(parsed.price)
  ) {
    price = Number(parsed.price.toFixed(3));
  } else if (bid) {
    return { bid: false, price: null, reason: 'price_invalid' };
  }
  let reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
  if (reason.length > 140) reason = reason.slice(0, 137) + '…';
  if (!reason) reason = bid ? 'bid' : 'pass';
  return { bid, price, reason };
}

module.exports = {
  suggestName,
  fieldPurpose,
  suggestPartner,
  simulateBids,
  OllamaUnavailable,
  // Exposed for tests / inspection:
  callOllama,
  extractStructured,
  buildSuggestNamePrompt,
  buildFieldPurposePrompt,
  buildPartnerHintPrompt,
  extractPartnerHints,
  validateNameSuggestion,
  validatePurposeSuggestion,
  validatePartnerSuggestion,
  validateBidSim,
  buildBidSimPrompt,
  summarizeRequestForSim,
  ALLOWED_PURPOSES,
  OLLAMA_URL,
  OLLAMA_MODEL,
};
