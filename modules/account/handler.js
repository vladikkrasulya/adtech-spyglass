'use strict';

const log = require('../../lib/logger').child('account');

/**
 * modules/account/handler.js — GET /api/account/insights
 *
 * Personal cabinet aggregates. Auth-gated; anonymous → 401. Returns the
 * shape AnalyzeLog.insights() produces — see db.js for fields.
 *
 * Extracted from server.js as part of the backend modularization
 * (wave 2 — small one-off handlers). Stays tiny: one route, one
 * AnalyzeLog call, one auth gate. Factory matches the createXModule
 * shape used by health/mirror/replay/sample so wiring stays uniform.
 *
 * Wiring (in server.js):
 *   const { createAccountModule } = require('./modules/account/handler');
 *   router.register(createAccountModule({ auth, AnalyzeLog }));
 */

const { sendJson, sendError } = require('../../lib/http');

/**
 * @param {{
 *   auth: { getCurrentUser: (req: import('http').IncomingMessage) => any },
 *   AnalyzeLog: { insights: (userId: string|number) => any },
 * }} deps
 */
function createAccountModule(deps) {
  const { auth, AnalyzeLog } = deps;

  function handleAccountInsights(req, res) {
    const user = auth.getCurrentUser(req);
    if (!user) {
      return sendError(res, 401, 'auth_required', 'Sign in to view account insights');
    }
    try {
      const data = AnalyzeLog.insights(user.id);
      sendJson(res, 200, { success: true, insights: data });
    } catch (e) {
      log.error({ err: e }, 'account insights failed');
      sendError(res, 500, 'insights_failed', e.message);
    }
  }

  return {
    id: 'account',
    routes: [{ method: 'GET', path: '/api/account/insights', handler: handleAccountInsights }],
  };
}

module.exports = { createAccountModule };
