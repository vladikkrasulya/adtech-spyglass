'use strict';

/**
 * modules/replay/handler.js — POST /api/v1/replay route module.
 *
 * Extracted from server.js as the first beat of the backend-module
 * migration described in lib/router.js. The HTTP handler is a thin
 * wrapper that:
 *   1. checks the analyze rate-limit bucket (shared with /api/analyze
 *      and /api/v1/mirror — keeps fuzz-protection coherent),
 *   2. resolves locale + dialect from the query string,
 *   3. reads + validates the {samples, opts?} body,
 *   4. delegates to lib/replay.js → replay() for the actual pipeline.
 *
 * The factory shape (createReplayModule(deps)) lets server.js inject the
 * closure-scoped helpers (rate-limiter, auth, locale resolvers, core
 * pipeline functions) at boot without making this module reach back into
 * server.js. lib/replay.js stays as the pure DI-style core function — we
 * just adapt request/response shape around it.
 *
 * Wiring (in server.js):
 *   const { createReplayModule } = require('./modules/replay/handler');
 *   router.register(createReplayModule({
 *     analyzeLimiter, auth, ANALYZE_MAX_PER_WINDOW,
 *     resolveLocale, resolveDialect,
 *     validate, crosscheck, analyzeBehavior,
 *     replay: _replay,
 *   }));
 */

const { readJson, sendJson, sendError } = require('../../lib/http');

/**
 * @param {{
 *   analyzeLimiter: (key: string) => boolean,
 *   auth: { clientIp: (req: import('http').IncomingMessage) => string },
 *   ANALYZE_MAX_PER_WINDOW: number,
 *   resolveLocale: (parsed: URL) => string,
 *   resolveDialect: (parsed: URL) => string,
 *   validate: Function,
 *   crosscheck: Function,
 *   analyzeBehavior: Function,
 *   replay: Function,
 * }} deps
 */
function createReplayModule(deps) {
  const {
    analyzeLimiter,
    auth,
    ANALYZE_MAX_PER_WINDOW,
    resolveLocale,
    resolveDialect,
    validate,
    crosscheck,
    analyzeBehavior,
    replay,
  } = deps;

  function handleReplay(req, res, parsed) {
    if (!analyzeLimiter(auth.clientIp(req))) {
      return sendError(
        res,
        429,
        'rate_limited',
        `Too many replay calls. Try again shortly (limit: ${ANALYZE_MAX_PER_WINDOW}/min/IP).`,
      );
    }
    const locale = resolveLocale(parsed);
    const dialect = resolveDialect(parsed);
    readJson(req)
      .then((body) => {
        const samples = body && body.samples;
        if (!Array.isArray(samples)) {
          return sendError(res, 400, 'samples_required', 'samples must be an array');
        }
        if (samples.length === 0) {
          return sendError(res, 400, 'samples_empty', 'samples array is empty');
        }
        const opts = body && body.opts ? body.opts : {};
        try {
          const out = replay(samples, {
            validate,
            crosscheck,
            analyzeBehavior,
            locale,
            dialect,
            topK: opts.topK,
            maxSamples: 100, // hard cap server-side regardless of client request
          });
          sendJson(res, 200, { success: true, ...out });
        } catch (e) {
          console.error('[replay] failed:', e.message);
          sendError(res, 400, 'replay_failed', e.message);
        }
      })
      .catch((e) => sendError(res, 400, 'invalid_json', e.message));
  }

  return {
    id: 'replay',
    routes: [{ method: 'POST', path: '/api/v1/replay', handler: handleReplay }],
  };
}

module.exports = { createReplayModule };
