'use strict';

/**
 * modules/intel/handler.js — POST /api/intel/* route module.
 *
 * Since 2026-07-22 the four intel endpoints run on the DETERMINISTIC rules
 * engine (lib/intel-rules.js) — no Ollama, no OpenRouter, no model at all:
 *   - /api/intel/suggest-name     → signature-based snake_case dialect name
 *   - /api/intel/suggest-partner  → domain/bundle → vendor map (auth-gated)
 *   - /api/intel/field-purpose    → path/charClass rule table
 *   - /api/intel/simulate-bids    → transparent floor/quality/strategy formulas
 *
 * Response shapes are unchanged from the LLM era, with one addition: every
 * suggestion carries `engine: "rules"` provenance. Same input → same output;
 * unknown stays "unknown" instead of a guess. The old 503 ollama_unavailable
 * and 502 unparseable failure modes no longer exist on these routes.
 *
 * The shared rate-limit bucket (30/min/IP) stays: the endpoints are public
 * and the limiter bounds abuse, not model cost.
 *
 * Wiring (in server.js):
 *   const { createIntelModule } = require('./modules/intel/handler');
 *   router.register(createIntelModule({
 *     intelLimiter, auth, intelRules, knowledgeBase,
 *   }));
 */

const { readJson, sendJson, sendError } = require('../../lib/http');

/**
 * @param {{
 *   intelLimiter: (key: string) => boolean,
 *   auth: {
 *     clientIp: (req: import('http').IncomingMessage) => string,
 *     getCurrentUser: (req: import('http').IncomingMessage) => object | null,
 *   },
 *   intelRules: {
 *     suggestName: Function,
 *     suggestPartner: Function,
 *     fieldPurpose: Function,
 *     simulateBids: Function,
 *   },
 *   knowledgeBase: { fewShotForFormat: Function },
 * }} deps
 */
function createIntelModule(deps) {
  const { intelLimiter, auth, intelRules, knowledgeBase } = deps;

  function handleIntelSuggestName(req, res) {
    if (!intelLimiter(auth.clientIp(req))) {
      return sendError(
        res,
        429,
        'rate_limited',
        'Intel rate limit reached. Try again in a minute.',
      );
    }
    readJson(req)
      .then(({ bucket, fields, format }) => {
        if (!Array.isArray(fields) || fields.length === 0) {
          return sendError(res, 400, 'invalid_input', 'fields[] is required');
        }
        // Sanitise: paths must be strings, cap count to bound signature size.
        const cleanFields = fields
          .filter((f) => typeof f === 'string' && f.length > 0 && f.length < 200)
          .slice(0, 50);
        if (cleanFields.length === 0) {
          return sendError(res, 400, 'invalid_input', 'no usable fields');
        }
        // KB few-shot context survives the LLM era: a strong field overlap
        // with a shipped sample deterministically adopts its format label.
        const cleanFormat = typeof format === 'string' ? format.replace(/[^a-z0-9-]/gi, '') : '';
        let fewShot = [];
        if (cleanFormat) {
          try {
            fewShot = knowledgeBase.fewShotForFormat(cleanFormat, { limit: 2 });
          } catch (/** @type {any} */ _e) {
            fewShot = [];
          }
        }
        const suggestion = intelRules.suggestName(bucket, cleanFields, { fewShot });
        if (!suggestion) {
          return sendError(res, 400, 'invalid_input', 'no usable fields');
        }
        sendJson(res, 200, { success: true, suggestion });
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  // Partner inference for the save-modal. Auth-gated because only signed-in
  // users save samples; the payload is theirs already.
  function handleIntelSuggestPartner(req, res) {
    if (!intelLimiter(auth.clientIp(req))) {
      return sendError(
        res,
        429,
        'rate_limited',
        'Intel rate limit reached. Try again in a minute.',
      );
    }
    if (!auth.getCurrentUser(req)) {
      return sendError(res, 401, 'unauthorized', 'Sign in first');
    }
    readJson(req)
      .then(({ bid_req, bid_res }) => {
        const MAX_BYTES = 250_000;
        let parsedReq = null;
        let parsedRes = null;
        try {
          if (typeof bid_req === 'string' && bid_req.length > 0 && bid_req.length < MAX_BYTES) {
            parsedReq = JSON.parse(bid_req);
          }
        } catch (_e) {
          parsedReq = null;
        }
        try {
          if (typeof bid_res === 'string' && bid_res.length > 0 && bid_res.length < MAX_BYTES) {
            parsedRes = JSON.parse(bid_res);
          }
        } catch (_e) {
          parsedRes = null;
        }
        if (!parsedReq && !parsedRes) {
          return sendError(res, 400, 'invalid_input', 'bid_req and/or bid_res JSON required');
        }
        const suggestion = intelRules.suggestPartner(parsedReq, parsedRes);
        // null is not an error — just no confident vendor signal in the payload.
        sendJson(res, 200, { success: true, suggestion: suggestion || null });
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  function handleIntelFieldPurpose(req, res) {
    if (!intelLimiter(auth.clientIp(req))) {
      return sendError(
        res,
        429,
        'rate_limited',
        'Intel rate limit reached. Try again in a minute.',
      );
    }
    readJson(req)
      .then(({ path, charClass, bucket }) => {
        if (typeof path !== 'string' || path.length === 0 || path.length > 200) {
          return sendError(res, 400, 'invalid_input', 'path is required (≤200 chars)');
        }
        // The rule table always answers; "unknown" is a valid, honest result.
        const purpose = intelRules.fieldPurpose(path, charClass, bucket);
        sendJson(res, 200, { success: true, purpose });
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  // ── /api/intel/simulate-bids — deterministic 3-strategy simulator ─────────
  // Body: { bid_req, locale? }. locale is validated against ['en','uk','ru']
  // here and passed through so intelRules.simulateBids() can localize the
  // per-strategy `reason` text; an unrecognised/missing locale falls back
  // to 'en'.
  function handleIntelSimulateBids(req, res) {
    if (!intelLimiter(auth.clientIp(req))) {
      return sendError(
        res,
        429,
        'rate_limited',
        'Intel rate limit reached. Try again in a minute.',
      );
    }
    readJson(req)
      .then(({ bid_req, locale }) => {
        const cleanLocale = ['en', 'uk', 'ru'].includes(locale) ? locale : 'en';
        let parsed = null;
        const MAX_BYTES = 250_000;
        try {
          if (typeof bid_req === 'string' && bid_req.length > 0 && bid_req.length < MAX_BYTES) {
            parsed = JSON.parse(bid_req);
          } else if (bid_req && typeof bid_req === 'object') {
            parsed = bid_req;
          }
        } catch (_e) {
          parsed = null;
        }
        if (!parsed) {
          return sendError(res, 400, 'invalid_input', 'bid_req JSON required');
        }
        // Shape guard: Simulate works on BidRequests (must have imp[]).
        const hasImp = Array.isArray(parsed.imp) && parsed.imp.length > 0;
        if (!hasImp) {
          if (Array.isArray(parsed.seatbid)) {
            return sendError(
              res,
              400,
              'wrong_shape',
              'This looks like a BidResponse (has seatbid[]). Simulate needs a BidRequest with imp[].',
            );
          }
          return sendError(
            res,
            400,
            'wrong_shape',
            'BidRequest must contain a non-empty imp[] array.',
          );
        }
        const results = intelRules.simulateBids(parsed, cleanLocale);
        if (!results) {
          return sendError(res, 400, 'invalid_input', 'bid_req must be an object');
        }
        sendJson(res, 200, { success: true, strategies: results });
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  return {
    id: 'intel',
    routes: [
      { method: 'POST', path: '/api/intel/suggest-name', handler: handleIntelSuggestName },
      { method: 'POST', path: '/api/intel/suggest-partner', handler: handleIntelSuggestPartner },
      { method: 'POST', path: '/api/intel/field-purpose', handler: handleIntelFieldPurpose },
      { method: 'POST', path: '/api/intel/simulate-bids', handler: handleIntelSimulateBids },
    ],
  };
}

module.exports = { createIntelModule };
