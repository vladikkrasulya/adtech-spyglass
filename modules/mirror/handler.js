'use strict';

const log = require('../../lib/logger').child('mirror');

/**
 * modules/mirror/handler.js — POST /api/v1/mirror route module.
 *
 * Generates a canonical counterpart of a paste:
 *   { input: BidRequest }  → { output: BidResponse, ... }
 *   { input: BidResponse } → { output: BidRequest,  ... }
 * Self-test (validate + crosscheck against the original) is run inside
 * core's mirror() and the rolled-up counts are returned.
 *
 * Reuses the analyze rate limiter — generation is cheaper than full
 * validation but happens on the same human-paste cadence, so sharing
 * the bucket keeps fuzz-protection coherent (matches /api/analyze and
 * /api/v1/replay).
 *
 * Factory shape mirrors modules/replay/handler.js: server.js injects
 * the closure-scoped helpers (rate-limiter, auth, locale resolvers,
 * core mirror()) at boot so this module stays testable in isolation.
 *
 * Wiring (in server.js):
 *   const { createMirrorModule } = require('./modules/mirror/handler');
 *   router.register(createMirrorModule({
 *     analyzeLimiter, auth, ANALYZE_MAX_PER_WINDOW,
 *     resolveLocale, resolveDialect,
 *     mirror,
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
 *   mirror: Function,
 * }} deps
 */
function createMirrorModule(deps) {
  const { analyzeLimiter, auth, ANALYZE_MAX_PER_WINDOW, resolveLocale, resolveDialect, mirror } =
    deps;

  function handleMirror(req, res, parsed) {
    if (!analyzeLimiter(auth.clientIp(req))) {
      return sendError(
        res,
        429,
        'rate_limited',
        `Too many mirror calls. Try again shortly (limit: ${ANALYZE_MAX_PER_WINDOW}/min/IP).`,
      );
    }
    const locale = resolveLocale(parsed);
    const dialect = resolveDialect(parsed);
    readJson(req)
      .then((body) => {
        const input = body && body.input;
        if (!input || typeof input !== 'object') {
          return sendError(
            res,
            400,
            'empty_payload',
            'Provide an `input` object (BidRequest or BidResponse) in the request body',
          );
        }
        const mode = body && body.mode === 'best-practice' ? 'best-practice' : 'minimal';
        const result = mirror(input, { locale, dialect, mode });
        sendJson(res, 200, { success: true, result });
      })
      .catch((e) => {
        log.error({ err: e }, 'mirror failed');
        sendError(res, 400, 'invalid_json', e.message);
      });
  }

  return {
    id: 'mirror',
    routes: [{ method: 'POST', path: '/api/v1/mirror', handler: handleMirror }],
  };
}

module.exports = { createMirrorModule };
