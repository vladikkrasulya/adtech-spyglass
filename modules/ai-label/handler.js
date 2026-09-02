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
 * Response 503: { code: 'labeller_unavailable', error } — Ollama unreachable
 *   or the model absent. The client must degrade to the manual builder, not
 *   pretend the feature is thinking. `code` is what the UI branches on;
 *   `error` is the human sentence (see lib/http.js sendError's argument
 *   order — they are easy to transpose).
 */

const { readJson, sendJson, sendError } = require('../../lib/http');
const { classifySignal } = require('../../packages/core/dialects/signal-lexicon');
const { lookupKeyRole } = require('../../packages/core/dialects/key-role-alphabet');
const { combine } = require('../../packages/core/dialects/resolve-precedence');
const {
  loadUserDialect,
  getDefaultDialectForUser,
} = require('../../packages/core/dialects/user-dialect-runtime');
const { STORABLE_LABELS } = require('../../packages/core/dialects/key-role-vocabulary');
const ollama = require('../../lib/ollama');
const log = require('../../lib/logger').child('ai-label');

const SIGNAL_PATH_MAX = 200;
const SIGNAL_VALUE_MAX = 512;
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

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {{auth?: any, aiLabelLimiter?: (key: string) => boolean, db?: any}} [deps]
 */
function createAiLabelModule({ auth, aiLabelLimiter, db } = {}) {
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
      body = await readJson(req);
    } catch (e) {
      return sendError(res, 400, 'bad_request', e.message);
    }

    const signalPath = typeof body.signal_path === 'string' ? body.signal_path.trim() : '';
    if (!signalPath || signalPath.length > SIGNAL_PATH_MAX || !SIGNAL_PATH_RX.test(signalPath)) {
      return sendError(res, 400, 'signal_path_invalid', 'signal_path missing or malformed');
    }
    if (!('signal_value' in body)) {
      return sendError(res, 400, 'signal_value_required', 'signal_value is required');
    }
    const signalValue = body.signal_value;
    if (typeof signalValue === 'string' && signalValue.length > SIGNAL_VALUE_MAX) {
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
    const health = await ollama.verifyPersona();
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
      const suggestion = await ollama.classifySignal({
        signalPath,
        signalValue,
        impSketch: sketch,
        siblingKeys,
        locale,
      });
      if (!STORABLE_LABELS.includes(suggestion.label)) {
        // Belt and braces: lib/ollama already checks its own enum, but the
        // set that matters is the one the SAVE route accepts — since
        // ADR-015 that is the twenty STORABLE_LABELS, not the legacy
        // eleven of SEMANTIC_LABELS.
        return sendError(res, 502, 'bad_model_output', 'Model returned a label the store rejects');
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
      // Payload contents are never logged — only the shape of the failure.
      log.warn({ code: e.code, path: signalPath }, 'labeller call failed');
      const timedOut = e.name === 'AbortError';
      return sendError(
        res,
        timedOut ? 504 : 502,
        timedOut ? 'labeller_timeout' : 'labeller_failed',
        timedOut ? 'The local model took too long to answer.' : 'The local model could not answer.',
      );
    }
  }

  return {
    id: 'ai-label',
    routes: [{ method: 'POST', path: '/api/dialects/suggest-label', handler: handleSuggest }],
  };
}

module.exports = { createAiLabelModule, redactImp };
