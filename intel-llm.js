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
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
// Generation timeout: gemma3:4b on i7-7700 CPU emits ~10 tok/s, so a
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
 *   emit valid JSON. gemma3:4b respects this faithfully — no fenced
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
    'Bucket: ' + safeBucket,
    '',
    'Common purposes (pick one):',
    '  click_url, image_url, icon_url, tracker_pixel, title, description,',
    '  advertiser_domain, segment_id, macro_token, format_id, subscription_age,',
    '  zone_id, custom_extension, unknown',
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

module.exports = {
  suggestName,
  fieldPurpose,
  OllamaUnavailable,
  // Exposed for tests / inspection:
  callOllama,
  extractStructured,
  buildSuggestNamePrompt,
  buildFieldPurposePrompt,
  validateNameSuggestion,
  validatePurposeSuggestion,
  ALLOWED_PURPOSES,
  OLLAMA_URL,
  OLLAMA_MODEL,
};
