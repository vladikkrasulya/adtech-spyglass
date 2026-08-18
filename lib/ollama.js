'use strict';

/**
 * lib/ollama.js — minimal Ollama chat client for the dialect signal labeller.
 * Dependency-free, same shape as lib/openrouter.js so the two read alike.
 *
 * Why a LOCAL model and not the OpenRouter client that already exists:
 * the labeller's input is a fragment of a payload the user pasted — real
 * bidstream traffic. docs/PRIVACY.md promises that payloads do not leave
 * the box, and the news moderator's OpenRouter path (translating our own
 * blog posts) never touches user data. Sending imp fragments to a third
 * party would quietly break that promise for the one feature most likely
 * to see sensitive inventory. Ollama runs on the same host; nothing exits.
 *
 * ── Constrained decoding ─────────────────────────────────────────────────
 * `format` carries a JSON Schema, and Ollama constrains token sampling to
 * it. This is not a request to the model to behave — an invalid label is
 * unrepresentable in the output grammar. That guarantee is why the caller
 * can trust `label` without re-validating it against SEMANTIC_LABELS
 * (it does anyway, cheaply, because a model swap could change the enum).
 *
 * ── The persona ──────────────────────────────────────────────────────────
 * OLLAMA_LABEL_MODEL points at a derived model (see docs/AI-LABELLER.md for
 * the Modelfile) whose SYSTEM prompt carries the label semantics, the
 * "numeric codes are unreadable without a vendor dictionary" rule, and the
 * confidence scale. Measured against the bare base model, the persona is
 * what turns a confidently-wrong `native` at confidence 0.95 on `adtype: 8` into an
 * honest `custom` at 0.2. Point this at the base model and the calibration
 * is gone — the endpoint still works, and its answers stop being worth
 * showing. `verifyPersona()` exists so a misconfigured deploy says so.
 */

const DEFAULT_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_LABEL_MODEL || 'ortb-labeler';
const DEFAULT_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 20_000;

/**
 * Labels the model may return. Must equal SEMANTIC_LABELS in
 * packages/core/dialects/signal-lexicon.js — asserted in tests.
 */
const LABELS = [
  'pop',
  'native',
  'banner',
  'video',
  'audio',
  'in-page-push',
  'push',
  'interstitial-banner',
  'ignore',
  'informational',
  'custom',
];

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', enum: LABELS },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['label', 'confidence', 'reason'],
};

/**
 * Error carrying a machine-readable `code`, so the handler can map a failure
 * to an HTTP status without matching on message text. Built through a helper
 * because `checkJs` is on and a bare `err.code = …` on an Error is a type
 * error under the project's tsconfig.
 *
 * @param {string} message
 * @param {string} code
 * @returns {Error & {code: string}}
 */
function codedError(message, code) {
  return Object.assign(new Error(message), { code });
}

/**
 * POST to the Ollama HTTP API with a timeout.
 * @returns {Promise<any>} parsed response body
 */
async function post(path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(DEFAULT_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw codedError(
        `Ollama ${resp.status}: ${text.slice(0, 200)}`,
        resp.status === 404 ? 'model_not_found' : 'ollama_error',
      );
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is the service reachable and the configured persona present?
 * Cheap enough to call per request; the caller uses it to answer 503 with a
 * specific reason instead of letting a generate call hang out to timeout.
 *
 * @returns {Promise<{ok: boolean, reason: string|null, model: string}>}
 */
async function verifyPersona() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    let tags;
    try {
      const r = await fetch(DEFAULT_URL + '/api/tags', { signal: controller.signal });
      if (!r.ok) return { ok: false, reason: 'ollama_unreachable', model: DEFAULT_MODEL };
      tags = await r.json();
    } finally {
      clearTimeout(timer);
    }
    const names = (tags.models || []).map((m) => m.name || m.model || '');
    // Ollama reports `name:tag`; config may omit the tag.
    const present = names.some(
      (n) => n === DEFAULT_MODEL || n.split(':')[0] === DEFAULT_MODEL.split(':')[0],
    );
    if (!present) return { ok: false, reason: 'persona_missing', model: DEFAULT_MODEL };
    return { ok: true, reason: null, model: DEFAULT_MODEL };
  } catch (_) {
    return { ok: false, reason: 'ollama_unreachable', model: DEFAULT_MODEL };
  }
}

/**
 * Ask the model to label one vendor ext signal.
 *
 * The prompt carries ONLY what the caller redacted: the signal path, its
 * value, and a structural sketch of the impression. Assembling the prompt
 * here rather than in the handler keeps the "what leaves the process"
 * decision in one file.
 *
 * @param {object} input
 * @param {string} input.signalPath
 * @param {unknown} input.signalValue
 * @param {object|null} input.impSketch  redacted structure — see handler's redactImp()
 * @param {string[]} [input.siblingKeys] other ext key names on the same object
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{label:string, confidence:number, reason:string, model:string, source:'model'}>}
 */
async function classifySignal({ signalPath, signalValue, impSketch, siblingKeys }, opts = {}) {
  const lines = [`Шлях: ${signalPath}`, `Значення: ${JSON.stringify(signalValue)}`];
  if (Array.isArray(siblingKeys) && siblingKeys.length) {
    lines.push(`Сусідні ключі в тому самому ext: ${siblingKeys.join(', ')}`);
  }
  lines.push(
    impSketch
      ? `Структура impression: ${JSON.stringify(impSketch)}`
      : 'Сигнал на рівні запиту — impression відсутній.',
  );

  const json = await post(
    '/api/generate',
    {
      model: DEFAULT_MODEL,
      prompt: lines.join('\n'),
      stream: false,
      think: false,
      format: RESPONSE_SCHEMA,
      options: { temperature: 0 },
    },
    opts.timeoutMs,
  );

  let parsed;
  try {
    parsed = JSON.parse(json.response);
  } catch (_) {
    throw codedError('Ollama returned unparseable JSON', 'bad_model_output');
  }

  // Constrained decoding should make this unreachable. Kept because the
  // guarantee belongs to the model server, not to us — a version bump or a
  // model swap is exactly when a silent contract break would land.
  if (!LABELS.includes(parsed.label)) {
    throw codedError(`Ollama returned unknown label: ${parsed.label}`, 'bad_model_output');
  }

  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    label: parsed.label,
    confidence,
    reason: String(parsed.reason || '').slice(0, 600),
    model: json.model || DEFAULT_MODEL,
    source: 'model',
  };
}

module.exports = { classifySignal, verifyPersona, LABELS, DEFAULT_MODEL, DEFAULT_URL };
