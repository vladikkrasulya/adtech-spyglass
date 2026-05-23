'use strict';

const log = require('../../lib/logger').child('intel');

/**
 * modules/intel/handler.js — POST /api/intel/* route module.
 *
 * Bundles the four Phase 7c/10b LLM-bridge endpoints that hit a locally
 * hosted Ollama (gemma3:4b) instance via http://ollama:11434:
 *   - /api/intel/suggest-name     → cluster-name suggestion (few-shot when format known)
 *   - /api/intel/suggest-partner  → vendor brand inference from bid_req/bid_res (auth-gated)
 *   - /api/intel/field-purpose    → one-line purpose hint for a single field path
 *   - /api/intel/simulate-bids    → 3-strategy bid-simulator demo (3× LLM calls/request)
 *
 * All four share a single rate-limit bucket (30/min/IP via intelLimiter),
 * separate from the analyze/replay/mirror limiter so heavy LLM traffic
 * doesn't starve the validation path (and vice versa). Both fire only on
 * an explicit user gesture and the browser caches results in IndexedDB
 * for 30 days, so the modest cap is intentional.
 *
 * Fail-open contract: when Ollama is unreachable, intel-llm throws
 * OllamaUnavailable; we surface a 503 so the frontend can silently hide
 * the AI affordance (per Phase 7 R&D doc graceful-degradation rule).
 *
 * Factory shape matches modules/mirror/handler.js: server.js injects the
 * closure-scoped helpers (rate-limiter, auth, intel-llm, knowledge-base)
 * at boot so this module stays testable in isolation.
 *
 * Wiring (in server.js):
 *   const { createIntelModule } = require('./modules/intel/handler');
 *   router.register(createIntelModule({
 *     intelLimiter, auth, intelLlm, knowledgeBase,
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
 *   intelLlm: {
 *     suggestName: Function,
 *     suggestPartner: Function,
 *     fieldPurpose: Function,
 *     simulateBids: Function,
 *     OllamaUnavailable: Function,
 *   },
 *   knowledgeBase: { fewShotForFormat: Function },
 * }} deps
 */
function createIntelModule(deps) {
  const { intelLimiter, auth, intelLlm, knowledgeBase } = deps;

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
      .then(async ({ bucket, fields, format }) => {
        if (!Array.isArray(fields) || fields.length === 0) {
          return sendError(res, 400, 'invalid_input', 'fields[] is required');
        }
        // Sanitise: paths must be strings, cap count to bound prompt size.
        const cleanFields = fields
          .filter((f) => typeof f === 'string' && f.length > 0 && f.length < 200)
          .slice(0, 50);
        if (cleanFields.length === 0) {
          return sendError(res, 400, 'invalid_input', 'no usable fields');
        }
        // Phase 10b — few-shot context: when the caller passes a recognised
        // format ("banner" / "video" / "push" / …) we look up 1–2 shipped KB
        // samples for that format and pass their anonymized field-name lists
        // to the LLM. When the format is unknown / missing / yields no KB
        // hits, fewShot is an empty array and the call degrades to Phase 7c
        // zero-shot behaviour silently.
        const cleanFormat = typeof format === 'string' ? format.replace(/[^a-z0-9-]/gi, '') : '';
        let fewShot = [];
        if (cleanFormat) {
          try {
            fewShot = knowledgeBase.fewShotForFormat(cleanFormat, { limit: 2 });
          } catch (/** @type {any} */ _e) {
            fewShot = [];
          }
        }
        try {
          const suggestion = await intelLlm.suggestName(bucket, cleanFields, { fewShot });
          if (!suggestion) {
            return sendError(res, 502, 'unparseable', 'LLM returned an unusable suggestion');
          }
          sendJson(res, 200, { success: true, suggestion });
        } catch (/** @type {any} */ e) {
          if (e instanceof intelLlm.OllamaUnavailable) {
            const msg = /** @type {Error} */ (e).message;
            log.warn({ reason: msg }, 'Ollama unavailable');
            return sendError(res, 503, 'ollama_unavailable', msg);
          }
          throw e;
        }
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  // Phase C-1 — partner inference for the save-modal. Caller is the
  // in-app save flow: sends the raw bid_req / bid_res JSON strings and
  // expects a short vendor brand name + confidence. Auth-gated because
  // only signed-in users save samples; the payload is theirs already.
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
      .then(async ({ bid_req, bid_res }) => {
        // Strict caps so a noisy payload can't blow up our prompt budget.
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
        try {
          const suggestion = await intelLlm.suggestPartner(parsedReq, parsedRes);
          if (!suggestion) {
            // Not an error — just no confident vendor signal in the payload.
            return sendJson(res, 200, { success: true, suggestion: null });
          }
          sendJson(res, 200, { success: true, suggestion });
        } catch (/** @type {any} */ e) {
          if (e instanceof intelLlm.OllamaUnavailable) {
            const msg = /** @type {Error} */ (e).message;
            log.warn({ reason: msg }, 'Ollama unavailable');
            return sendError(res, 503, 'ollama_unavailable', msg);
          }
          throw e;
        }
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
      .then(async ({ path, charClass, bucket }) => {
        if (typeof path !== 'string' || path.length === 0 || path.length > 200) {
          return sendError(res, 400, 'invalid_input', 'path is required (≤200 chars)');
        }
        try {
          const purpose = await intelLlm.fieldPurpose(path, charClass, bucket);
          if (!purpose) {
            return sendError(res, 502, 'unparseable', 'LLM returned an unusable suggestion');
          }
          sendJson(res, 200, { success: true, purpose });
        } catch (/** @type {any} */ e) {
          if (e instanceof intelLlm.OllamaUnavailable) {
            const msg = /** @type {Error} */ (e).message;
            log.warn({ reason: msg }, 'Ollama unavailable');
            return sendError(res, 503, 'ollama_unavailable', msg);
          }
          throw e;
        }
      })
      .catch((e) => sendError(res, e.status || 400, e.code || 'bad_request', e.message));
  }

  // ── /api/intel/simulate-bids — Bid simulator demo ─────────────────────────
  //
  // Given a parsed BidRequest, fan out 3 strategies (aggressive /
  // conservative / quality) to gemma3:4b in parallel. Each strategy gets a
  // metadata-only summary (no bid VALUES) and decides bid yes/no, price,
  // and a one-sentence rationale. Demonstrates the AI-bridge as more than
  // just naming/classification — it's also useful for "what would
  // different bidders do?" intuition.
  //
  // Public — no auth — to match other intel endpoints. Rate-limited to
  // 30/min/IP via the shared intelLimiter. Heavy: 3 LLM calls per request.
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
      .then(async ({ bid_req }) => {
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
        // A common mistake is pasting a BidResponse (has seatbid[]) — without
        // this check the LLM gets an empty metadata summary and dutifully
        // returns 3x SKIP, wasting ~21s of CPU and confusing the user.
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
        try {
          const results = await intelLlm.simulateBids(parsed);
          if (!results) {
            return sendError(res, 400, 'invalid_input', 'bid_req must be an object');
          }
          sendJson(res, 200, { success: true, strategies: results });
        } catch (/** @type {any} */ e) {
          if (e instanceof intelLlm.OllamaUnavailable) {
            const msg = /** @type {Error} */ (e).message;
            log.warn({ reason: msg }, 'Ollama unavailable');
            return sendError(res, 503, 'ollama_unavailable', msg);
          }
          throw e;
        }
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
