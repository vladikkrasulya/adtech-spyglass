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
 * ── The persona travels with the request ─────────────────────────────────
 * The label semantics live in lib/label-persona.js and ship as the `system`
 * field on every call — see that file for why they are not baked into a
 * derived model. What MODEL means here is therefore just "some resident
 * gemma4", and `gemma4-prod` is the fleet's shared one: gpunode,
 * claude-usage-display, tg-llm-bot and the n8n workflows all name it, so it
 * is almost always already in VRAM. That is the entire point — with
 * OLLAMA_MAX_LOADED_MODELS=1 on this box, naming anything else would evict
 * whatever the other callers are using and make them pay ~6.4s to load it
 * back. Hardcoded rather than configurable because a per-deploy override is
 * how you'd silently reintroduce that eviction.
 *
 * Do NOT send `num_ctx` (or any other runner-level option) with a request:
 * changing a runner parameter forces ollama to reload the model, which is
 * the exact cost this arrangement exists to avoid. `temperature` is a
 * sampling option, not a runner one, and is safe.
 */

const DEFAULT_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = 'gemma4-prod';
// The shared runner is OLLAMA_NUM_PARALLEL=1, so a request can queue behind
// another caller's before its own ~2s of inference starts. The ceiling is
// generous for that reason, and tunable for when the fleet gets busier.
const DEFAULT_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 20_000;

const { buildPersona } = require('./label-persona');

/**
 * Structural field labels for the user-turn prompt below — NOT user-facing
 * text (the model reads these, a person never sees them), but they travel
 * with the persona so both are in the same language for the model's own
 * context window. See lib/label-persona.js buildPersona() for the persona
 * itself.
 */
const FIELD_LABELS = {
  en: {
    path: 'Path',
    value: 'Value',
    siblingKeys: 'Sibling keys in the same ext',
    impStructure: 'Impression structure',
    noImp: 'Request-level signal — no impression.',
  },
  uk: {
    path: 'Шлях',
    value: 'Значення',
    siblingKeys: 'Сусідні ключі в тому самому ext',
    impStructure: 'Структура impression',
    noImp: 'Сигнал на рівні запиту — impression відсутній.',
  },
  ru: {
    path: 'Путь',
    value: 'Значение',
    siblingKeys: 'Соседние ключи в том же ext',
    impStructure: 'Структура impression',
    noImp: 'Сигнал на уровне запроса — impression отсутствует.',
  },
};

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
 * Is the service reachable and the model we send the persona to present?
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
    if (!present) return { ok: false, reason: 'model_missing', model: DEFAULT_MODEL };
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
 * @param {string} [input.locale='en']  'en' | 'uk' | 'ru' — governs the persona's
 *   closing instruction (see lib/label-persona.js buildPersona()) and the
 *   structural field labels below ('Path:'/'Шлях:'/'Путь:' etc.). These are
 *   labels for the model's own context window, not user-facing text, but they
 *   travel with the persona so the two stay in the same language.
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{label:string, confidence:number, reason:string, model:string, source:'model'}>}
 */
async function classifySignal(
  { signalPath, signalValue, impSketch, siblingKeys, locale = 'en' },
  opts = {},
) {
  const f = FIELD_LABELS[locale] || FIELD_LABELS.en;
  const lines = [`${f.path}: ${signalPath}`, `${f.value}: ${JSON.stringify(signalValue)}`];
  if (Array.isArray(siblingKeys) && siblingKeys.length) {
    lines.push(`${f.siblingKeys}: ${siblingKeys.join(', ')}`);
  }
  lines.push(impSketch ? `${f.impStructure}: ${JSON.stringify(impSketch)}` : f.noImp);

  const json = await post(
    '/api/generate',
    {
      model: DEFAULT_MODEL,
      system: buildPersona(locale),
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
