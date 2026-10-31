'use strict';

/**
 * modules/ai-label/handler.js — POST /api/dialects/suggest-label
 *
 * Answers one question: "this vendor ext signal is unknown to the engine —
 * what does it most likely mean?" It returns a SUGGESTION and nothing else.
 * It never writes to dialect_mappings; saving stays on the existing
 * POST /api/dialects/:id/mappings route, behind a human click.
 *
 * ── Why suggestion-only is architectural, not squeamish ──────────────────
 * A saved mapping is not a note. modules/dialects/handler.js clears the
 * runtime cache on write, and from the next analyse onward the mapping
 * silences that question and feeds scanExtForFormatHints in
 * non-iab-formats.js — so a wrong label doesn't just sit there being wrong,
 * it changes which RULES fire on every future payload the user pastes, in a
 * direction they can no longer see. Measured on this box, the bare base
 * model answered `native` with confidence 0.95 to `adtype: 8`, a numeric
 * vendor code that is unreadable by construction. A design where that
 * writes itself into the user's dialect is a design that quietly corrupts
 * their tooling. Hence: propose, never persist.
 *
 * ── Two-stage resolution ─────────────────────────────────────────────────
 *   1. packages/core/dialects/signal-lexicon.js — deterministic. Resolves
 *      the majority (format words corroborated by the impression, pop
 *      allow-flags, bookkeeping keys) with no model call at all.
 *   2. The local model (lib/ollama.js) — only for what the lexicon
 *      abstains on. Nothing leaves the host; see redactImp() below for
 *      what the model is even allowed to see.
 *
 * Response 200: { ok, suggestion: {label, confidence, reason, source, evidence?},
 *                 signal: {path, value} }
 *   `source` is 'lexicon' | 'model' and the UI must show which — a table
 *   lookup and a language model's guess do not deserve the same trust, and
 *   collapsing them into one badge is how the user stops checking.
 * Response 401: not signed in (mappings are user-scoped; a suggestion the
 *   user cannot save is a dead end, so the gate matches the save route).
 * Response 429: rate limited — the model call is GPU-bound.
 * Response 424: { code: 'labeller_timeout' | 'labeller_failed' | 'bad_model_output', error }
 *   — the local model was reached but failed. 424 rather than 502/504 because
 *   Cloudflare replaces an origin 502/504 with a plain-text `error code: 5xx`
 *   page and the UI would lose the machine-readable `code`.
 * Response 429: { code: 'labeller_busy', error } + Retry-After — the model is
 *   serving other requests and this one could not get a turn in time. A bounded
 *   queue sits in front of the model (lib/concurrency-gate.js) so a burst is
 *   answered promptly instead of timing out inside the runner's own queue.
 * Response 503: { code: 'labeller_unavailable', error } — Ollama unreachable
 *   or the model absent. The client must degrade to the manual builder, not
 *   pretend the feature is thinking. `code` is what the UI branches on;
 *   `error` is the human sentence (see lib/http.js sendError's argument
 *   order — they are easy to transpose).
 */

const { readJson, sendJson, sendError, alertOperator } = require('../../lib/http');
const { classifySignal } = require('../../packages/core/dialects/signal-lexicon');
const { lookupKeyRole } = require('../../packages/core/dialects/key-role-alphabet');
const { combine } = require('../../packages/core/dialects/resolve-precedence');
const {
  loadUserDialect,
  getDefaultDialectForUser,
} = require('../../packages/core/dialects/user-dialect-runtime');
const { STORABLE_LABELS } = require('../../packages/core/dialects/key-role-vocabulary');
const ollama = require('../../lib/ollama');
const { createGate } = require('../../lib/concurrency-gate');
const log = require('../../lib/logger').child('ai-label');

const SIGNAL_PATH_MAX = 200;
// Bounds the value as it will be written into the model prompt: for a string its
// length, for a number/boolean/object/array its JSON text. A string was already
// capped; an object or array was not, so one request could put megabytes into
// the prompt of a single-slot, CPU-bound model.
const SIGNAL_VALUE_MAX = 512;
// A real request is a path, a small value and one impression. The route redacts
// the impression to a few fields, so this only has to admit an unusually large
// impression the editor sends whole.
const BODY_MAX_BYTES = 256 * 1024;
// One model call at a time (the runner is single-slot), a short queue behind it,
// and a bounded wait: past that the caller is told to retry rather than left to
// time out inside the runner. Tunable for a faster box.
const MAX_CONCURRENT = Math.max(1, Number(process.env.AI_LABEL_MAX_CONCURRENT) || 1);
const MAX_QUEUE = Number.isFinite(Number(process.env.AI_LABEL_MAX_QUEUE))
  ? Math.max(0, Number(process.env.AI_LABEL_MAX_QUEUE))
  : 4;
const QUEUE_WAIT_MS = Number(process.env.AI_LABEL_QUEUE_WAIT_MS) || 12_000;
const BUSY_RETRY_AFTER_S = 5;
// Mirrors the ?locale= pattern documented in public/i18n.js and used by
// /api/analyze and /api/analyze-behavior — here it arrives in the JSON body
// instead of a query string because this route is a POST with a body
// already, and dialect-label.js's askAgent() is the one caller.
const SUPPORTED_LOCALES = ['en', 'uk', 'ru'];
// Mirrors SIGNAL_PATH_RX in modules/dialects/handler.js plus the bracket
// syntax findings use (`imp[0].ext.type`) — a path we would suggest for but
// the save route would reject is a broken round trip.
const SIGNAL_PATH_RX = /^[a-zA-Z_][a-zA-Z0-9_.[\]]*$/;

/**
 * Reduce an impression to the structure the classifier needs, dropping
 * everything else.
 *
 * The redaction is an ALLOWLIST, deliberately. A denylist ("strip ifa, strip
 * user ids…") fails open the first time a vendor invents a field, and this
 * object is about to be handed to a language model. Anything not named here
 * does not travel — including every string the publisher put in the payload.
 *
 * Sibling ext keys travel as NAMES ONLY. They are real evidence — an
 * `allowShock` next to the signal is what marks pop inventory — but their
 * values are vendor-private and carry no classification weight.
 *
 * @param {any} imp  raw, untrusted — every field access below is guarded
 * @returns {{sketch: any, siblingKeys: string[]}}
 */
function redactImp(imp) {
  if (!imp || typeof imp !== 'object' || Array.isArray(imp)) {
    return { sketch: null, siblingKeys: [] };
  }
  const sketch = {};

  if (imp.banner && typeof imp.banner === 'object') {
    sketch.banner = { w: numOrNull(imp.banner.w), h: numOrNull(imp.banner.h) };
    if (Array.isArray(imp.banner.format)) sketch.banner.formatCount = imp.banner.format.length;
  }
  if (imp.video && typeof imp.video === 'object') {
    sketch.video = {
      w: numOrNull(imp.video.w),
      h: numOrNull(imp.video.h),
      startdelay: numOrNull(imp.video.startdelay),
      placement: numOrNull(imp.video.placement),
      plcmt: numOrNull(imp.video.plcmt),
      linearity: numOrNull(imp.video.linearity),
      // mimes are a fixed IAB vocabulary, not user content.
      mimes: Array.isArray(imp.video.mimes) ? imp.video.mimes.slice(0, 6).map(String) : undefined,
    };
  }
  if (imp.audio && typeof imp.audio === 'object') {
    sketch.audio = {
      present: true,
      mimeCount: Array.isArray(imp.audio.mimes) ? imp.audio.mimes.length : 0,
    };
  }
  if (imp.native && typeof imp.native === 'object') {
    // native.request is a nested JSON string of the publisher's asset
    // layout — presence is the signal, contents are theirs.
    sketch.native = { present: true };
  }
  sketch.instl = numOrNull(imp.instl);
  sketch.secure = numOrNull(imp.secure);
  sketch.rwdd = numOrNull(imp.rwdd);
  sketch.bidfloor = numOrNull(imp.bidfloor);

  for (const k of Object.keys(sketch))
    if (sketch[k] === null || sketch[k] === undefined) delete sketch[k];

  const siblingKeys =
    imp.ext && typeof imp.ext === 'object' && !Array.isArray(imp.ext)
      ? Object.keys(imp.ext).slice(0, 40)
      : [];

  return { sketch: Object.keys(sketch).length ? sketch : null, siblingKeys };
}

/**
 * Length of the value as the prompt will carry it. Strings are measured as
 * they are; everything else as JSON text. A value JSON cannot represent
 * (undefined, a function) measures 0 and is harmless — the prompt writes `null`.
 * @param {unknown} v
 */
function signalValueLength(v) {
  if (typeof v === 'string') return v.length;
  try {
    const text = JSON.stringify(v);
    return typeof text === 'string' ? text.length : 0;
  } catch (_) {
    return Infinity;
  }
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {{auth?: any, aiLabelLimiter?: (key: string) => boolean, db?: any, gate?: {run: <T>(fn: () => Promise<T>) => Promise<T>}}} [deps]
 */
function createAiLabelModule({ auth, aiLabelLimiter, db, gate } = {}) {
  const modelGate =
    gate ||
    createGate({ maxActive: MAX_CONCURRENT, maxQueue: MAX_QUEUE, maxWaitMs: QUEUE_WAIT_MS });
  /**
   * R-11: the request carries no dialect ID, so the handler resolves the
   * saved mapping itself from the authenticated operator's DEFAULT dialect.
   * No default dialect => no saved-mapping precedence (null), and routing
   * proceeds at the next matrix row. Core performs no lookup — it has no
   * database (Principle IV).
   *
   * @param {number} userId
   * @param {string} normalizedPath  index-collapsed, e.g. 'imp[].ext.ad_type'
   * @param {unknown} value
   * @returns {object|null}
   */
  function resolveSavedMapping(userId, normalizedPath, value) {
    if (!db) return null;
    try {
      const dialectId = getDefaultDialectForUser(db, userId);
      if (!dialectId) return null;
      const dialect = loadUserDialect(db, dialectId);
      return dialect.lookupMapping(normalizedPath, value);
    } catch (_) {
      // A broken dialect must not take the suggestion route down with it.
      return null;
    }
  }
  async function handleSuggest(req, res) {
    const user = auth && auth.getCurrentUser(req);
    if (!user) {
      return sendError(res, 401, 'unauthorized', 'Sign in to use the labelling assistant');
    }
    if (aiLabelLimiter && !aiLabelLimiter(String(user.id))) {
      return sendError(res, 429, 'rate_limited', 'Too many labelling requests. Try again shortly.');
    }

    let body;
    try {
      body = await readJson(req, { maxBytes: BODY_MAX_BYTES });
    } catch (e) {
      return sendError(res, 400, 'bad_request', e.message);
    }
    // `null`, an array or a scalar parse as valid JSON but are not a request.
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendError(res, 400, 'bad_request', 'Body must be a JSON object');
    }

    const signalPath = typeof body.signal_path === 'string' ? body.signal_path.trim() : '';
    if (!signalPath || signalPath.length > SIGNAL_PATH_MAX || !SIGNAL_PATH_RX.test(signalPath)) {
      return sendError(res, 400, 'signal_path_invalid', 'signal_path missing or malformed');
    }
    if (!('signal_value' in body)) {
      return sendError(res, 400, 'signal_value_required', 'signal_value is required');
    }
    const signalValue = body.signal_value;
    if (signalValueLength(signalValue) > SIGNAL_VALUE_MAX) {
      return sendError(res, 400, 'signal_value_too_long', 'signal_value exceeds 512 chars');
    }
    const locale = SUPPORTED_LOCALES.includes(body.locale) ? body.locale : 'en';

    const { sketch, siblingKeys } = redactImp(body.imp);

    // ── Deterministic resolution: the FR-001 precedence matrix ────────
    // The legacy resolver is evaluated as classified evidence; the
    // exact-case role layer answers what it reviewed; combine() applies
    // the matrix. The model runs only when every deterministic source
    // abstains (016 §Resolver precedence).
    const normalizedPath = signalPath.replace(/\[\d+\]/g, '[]');
    const savedMapping = resolveSavedMapping(user.id, normalizedPath, signalValue);
    const legacy = classifySignal({ signalPath, signalValue, imp: body.imp, locale });
    const role = lookupKeyRole({ signalPath: normalizedPath, signalValue, locale });
    const combined = combine({ savedMapping, legacy, role });

    if (combined.outcome !== 'model') {
      return sendJson(res, 200, {
        ok: true,
        suggestion: combined.answer,
        signal: { path: signalPath, value: signalValue },
      });
    }

    // ── Model fallback: every deterministic source abstained ──────────
    // Track a caller that disconnects while it waits (for the health check or
    // for its turn at the model).
    let clientGone = false;
    if (typeof res.once === 'function') {
      res.once('close', () => {
        if (!res.writableEnded) clientGone = true;
      });
    }
    const health = await ollama.verifyPersona();
    if (clientGone) return undefined;
    if (!health.ok) {
      return sendError(
        res,
        503,
        'labeller_unavailable',
        health.reason === 'model_missing'
          ? `Model "${health.model}" is not available on this host.`
          : 'Local model service is unreachable.',
      );
    }

    try {
      const suggestion = await modelGate.run(() => {
        // The caller may have left while waiting for a turn; a call nobody will
        // read would only delay the people still waiting.
        if (clientGone) throw Object.assign(new Error('client gone'), { code: 'client_gone' });
        return ollama.classifySignal({
          signalPath,
          signalValue,
          impSketch: sketch,
          siblingKeys,
          locale,
        });
      });
      if (!STORABLE_LABELS.includes(suggestion.label)) {
        // Belt and braces: lib/ollama already checks its own enum, but the
        // set that matters is the one the SAVE route accepts — since
        // ADR-015 that is the twenty STORABLE_LABELS, not the legacy
        // eleven of SEMANTIC_LABELS.
        sendError(res, 424, 'bad_model_output', 'Model returned a label the store rejects');
        alertOperator(res, 424, 'bad_model_output', undefined, 'upstream');
        return;
      }
      return sendJson(res, 200, {
        ok: true,
        // Required routing evidence (016 §Public response compatibility):
        // without it the preserved-legacy and model variants cannot be told
        // apart in the SC-002 route counts.
        suggestion: { ...suggestion, routing: { roleLayer: role.state, legacy: legacy.kind } },
        signal: { path: signalPath, value: signalValue },
      });
    } catch (e) {
      if (e && e.code === 'client_gone') return undefined; // nobody is listening
      if (e && (e.code === 'gate_full' || e.code === 'gate_wait_timeout')) {
        // Not a model failure and not the caller's fault: the model is busy.
        // Say so plainly, with when to come back; do not page the operator.
        log.info({ code: e.code }, 'labeller busy');
        if (typeof res.setHeader === 'function') {
          res.setHeader('Retry-After', String(BUSY_RETRY_AFTER_S));
        }
        return sendError(
          res,
          429,
          'labeller_busy',
          'The local model is busy with other requests. Try again in a few seconds.',
        );
      }
      // Payload contents are never logged — only the shape of the failure.
      log.warn({ code: e.code, path: signalPath }, 'labeller call failed');
      const timedOut = e.name === 'AbortError';
      const failCode = timedOut ? 'labeller_timeout' : 'labeller_failed';
      sendError(
        res,
        424,
        failCode,
        timedOut ? 'The local model took too long to answer.' : 'The local model could not answer.',
      );
      // Still operator-actionable (ADR-012): 424 is not a 5xx, so sendError no
      // longer pages by itself.
      alertOperator(res, 424, failCode, undefined, 'upstream');
    }
  }

  return {
    id: 'ai-label',
    routes: [{ method: 'POST', path: '/api/dialects/suggest-label', handler: handleSuggest }],
  };
}

module.exports = { createAiLabelModule, redactImp };
