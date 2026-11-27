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
const DEFAULT_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 30_000;

const { buildPersona } = require('./label-persona');

// Hard ceilings on what one call may put in the prompt. The route already
// bounds each field; these keep the prompt bounded for any other caller too,
// and cap a long key or MIME name the route admits as a single list entry.
const PROMPT_VALUE_MAX = 512;
const PROMPT_SIBLING_KEYS_MAX = 40;
const PROMPT_SIBLING_KEY_CHARS = 64;
const PROMPT_SKETCH_MAX = 2000;

/** @param {string} text @param {number} max */
function clip(text, max) {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

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
 * Labels the model may return: the twenty STORABLE_LABELS from the one
 * normative vocabulary (016 FR-024, ADR-015) — so a fallback suggestion can
 * name a role (identifier, pricing, delivery-control, …) instead of
 * collapsing it into ignore/informational. Constrained decoding makes any
 * other label unrepresentable in the output grammar.
 */
const { STORABLE_LABELS } = require('../packages/core/dialects/key-role-vocabulary');
const { applyCeilings } = require('./label-ceilings');

const LABELS = [...STORABLE_LABELS];

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
  const lines = [
    `${f.path}: ${clip(String(signalPath), 200)}`,
    `${f.value}: ${clip(String(JSON.stringify(signalValue)), PROMPT_VALUE_MAX)}`,
  ];
  if (Array.isArray(siblingKeys) && siblingKeys.length) {
    const keys = siblingKeys
      .slice(0, PROMPT_SIBLING_KEYS_MAX)
      .map((k) => clip(String(k), PROMPT_SIBLING_KEY_CHARS));
    lines.push(`${f.siblingKeys}: ${keys.join(', ')}`);
  }
  lines.push(
    impSketch
      ? `${f.impStructure}: ${clip(JSON.stringify(impSketch), PROMPT_SKETCH_MAX)}`
      : f.noImp,
  );

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

  // The persona's ceilings, enforced (005 T024): see lib/label-ceilings.js.
  const { confidence } = applyCeilings({
    signalPath,
    signalValue,
    label: parsed.label,
    confidence: parsed.confidence,
  });

  return {
    label: parsed.label,
    confidence,
    reason: String(parsed.reason || '').slice(0, 600),
    model: json.model || DEFAULT_MODEL,
    source: 'model',
  };
}

const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    rootCauses: { type: 'array', items: { type: 'string' } },
    fixHint: { type: 'string' },
  },
  required: ['summary', 'rootCauses', 'fixHint'],
};

const EXPLAIN_SYSTEM = {
  en:
    'You are a senior OpenRTB/AdTech troubleshooting assistant. Explain concisely why an ' +
    'SSP or DSP flagged these deterministic validation and crosscheck findings, and give a ' +
    'concrete fix hint. Base your explanation strictly on the supplied findings, crosscheck ' +
    'items, and impression structure — never invent OpenRTB spec rules or unobserved fields. ' +
    'Respond in English using JSON matching the schema.',
  uk:
    'Ви — старший інженер із налагодження OpenRTB/AdTech. Стисло поясніть, чому SSP або DSP ' +
    'позначили ці детерміновані зауваження валідації та кросчеку, і надайте конкретну підказку ' +
    'щодо виправлення. Спирайтеся лише на передані findings, crosscheck і структуру impression ' +
    '— не вигадуйте правил специфікації OpenRTB чи відсутніх полів. Відповідайте українською ' +
    'у форматі JSON згідно зі схемою.',
  ru:
    'Вы — старший инженер по отладке OpenRTB/AdTech. Кратко объясните, почему SSP или DSP ' +
    'выставили эти детерминированные замечания валидации и кросс-чека, и дайте конкретную ' +
    'подсказку по исправлению. Опирайтесь строго на переданные findings, crosscheck и структуру ' +
    'impression — не придумывайте правила спецификации OpenRTB или отсутствующие поля. ' +
    'Отвечайте по-русски в формате JSON согласно схеме.',
};

const EXPLAIN_LABELS = {
  en: {
    findings: 'Validation findings',
    crosscheck: 'Crosscheck findings',
    impStructure: 'Impression structure',
    noImp: 'No impression structure supplied.',
    none: '(none)',
  },
  uk: {
    findings: 'Зауваження валідації',
    crosscheck: 'Зауваження кросчеку',
    impStructure: 'Структура impression',
    noImp: 'Структура impression не передана.',
    none: '(немає)',
  },
  ru: {
    findings: 'Замечания валидации',
    crosscheck: 'Замечания кросс-чека',
    impStructure: 'Структура impression',
    noImp: 'Структура impression не передана.',
    none: '(нет)',
  },
};

/**
 * Send a structured chat completion request to the local Ollama model and
 * return the raw JSON content string.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {{schema?: object|string, temperature?: number, numPredict?: number, timeoutMs?: number}} [opts]
 * @returns {Promise<string>}
 */
async function chatJson(messages, opts = {}) {
  const json = await post(
    '/api/chat',
    {
      model: DEFAULT_MODEL,
      messages,
      stream: false,
      think: false,
      format: opts.schema || 'json',
      options: {
        temperature: opts.temperature ?? 0.2,
        num_predict: opts.numPredict ?? 1200,
      },
    },
    opts.timeoutMs || 45_000,
  );
  return String(json?.message?.content || '');
}

/**
 * @param {Array<{id?: string, level?: string, path?: string, message?: string}>} items
 * @returns {string}
 */
function formatFindingsForPrompt(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items
    .slice(0, 15)
    .map((item) => {
      const level = clip(String(item?.level || 'info'), 32);
      const id = clip(String(item?.id || 'unknown'), 80);
      const path = clip(String(item?.path || '(root)'), 200);
      const msg = clip(String(item?.message || ''), 240);
      return `- [${level}] ${id} @ ${path}: ${msg}`;
    })
    .join('\n');
}

/**
 * Explain deterministic OpenRTB validation and crosscheck findings using the
 * local model. Only redacted structural data and finding metadata are sent.
 *
 * @param {object} input
 * @param {Array<{id?: string, level?: string, path?: string, message?: string}>} [input.findings]
 * @param {Array<{id?: string, level?: string, path?: string, message?: string}>} [input.crosscheck]
 * @param {object|null} [input.impSketch]
 * @param {string} [input.locale='en']
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{summary: string, rootCauses: string[], fixHint: string, model: string, source: 'model'}>}
 */
async function explainFindings(
  { findings = [], crosscheck = [], impSketch = null, locale = 'en' },
  opts = {},
) {
  const lang = Object.prototype.hasOwnProperty.call(EXPLAIN_SYSTEM, locale) ? locale : 'en';
  const system = EXPLAIN_SYSTEM[lang];
  const labels = EXPLAIN_LABELS[lang];
  const findingsText = formatFindingsForPrompt(findings) || labels.none;
  const crosscheckText = formatFindingsForPrompt(crosscheck) || labels.none;
  const impLine = impSketch
    ? `${labels.impStructure}: ${clip(JSON.stringify(impSketch), PROMPT_SKETCH_MAX)}`
    : labels.noImp;

  const prompt = [
    `${labels.findings}:\n${findingsText}`,
    `${labels.crosscheck}:\n${crosscheckText}`,
    impLine,
  ].join('\n\n');

  const json = await post(
    '/api/generate',
    {
      model: DEFAULT_MODEL,
      system,
      prompt,
      stream: false,
      think: false,
      format: EXPLAIN_SCHEMA,
      options: { temperature: 0.1 },
    },
    opts.timeoutMs,
  );

  let parsed;
  try {
    parsed = JSON.parse(json.response);
  } catch (_) {
    throw codedError('Ollama returned unparseable JSON', 'bad_model_output');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.summary !== 'string' ||
    !Array.isArray(parsed.rootCauses) ||
    typeof parsed.fixHint !== 'string'
  ) {
    throw codedError('Ollama returned malformed explanation JSON', 'bad_model_output');
  }

  return {
    summary: parsed.summary.trim().slice(0, 1200),
    rootCauses: parsed.rootCauses
      .map((c) => String(c || '').trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((c) => c.slice(0, 400)),
    fixHint: parsed.fixHint.trim().slice(0, 1200),
    model: json.model || DEFAULT_MODEL,
    source: 'model',
  };
}

module.exports = {
  classifySignal,
  verifyPersona,
  chatJson,
  explainFindings,
  LABELS,
  EXPLAIN_SCHEMA,
  DEFAULT_MODEL,
  DEFAULT_URL,
  DEFAULT_TIMEOUT_MS,
  PROMPT_VALUE_MAX,
};
