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
const { resolveSignal, SEMANTIC_LABELS } = require('../../packages/core/dialects/signal-lexicon');
const ollama = require('../../lib/ollama');
const log = require('../../lib/logger').child('ai-label');

const SIGNAL_PATH_MAX = 200;
const SIGNAL_VALUE_MAX = 512;
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
 * @param {{auth?: any, aiLabelLimiter?: (key: string) => boolean}} [deps]
 */
function createAiLabelModule({ auth, aiLabelLimiter } = {}) {
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

    const { sketch, siblingKeys } = redactImp(body.imp);

    // ── Stage 1: deterministic ────────────────────────────────────────
    const fromLexicon = resolveSignal({ signalPath, signalValue, imp: body.imp });
    if (fromLexicon) {
      return sendJson(res, 200, {
        ok: true,
        suggestion: fromLexicon,
        signal: { path: signalPath, value: signalValue },
      });
    }

    // ── Stage 2: local persona ────────────────────────────────────────
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
      });
      if (!SEMANTIC_LABELS.includes(suggestion.label)) {
        // Belt and braces: lib/ollama already checks its own enum, but the
        // set that matters is the one the SAVE route accepts.
        return sendError(res, 502, 'bad_model_output', 'Model returned a label the store rejects');
      }
      return sendJson(res, 200, {
        ok: true,
        suggestion,
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
