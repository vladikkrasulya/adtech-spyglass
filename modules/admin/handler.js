'use strict';

const log = require('../../lib/logger').child('admin');

/**
 * modules/admin/handler.js — GET /api/admin/stats
 *
 * Operator dashboard counters. Token-gated via Bearer
 * ADMIN_STATS_TOKEN — this is the only auth path that does NOT go
 * through session cookies. The token is loaded from env at handler
 * time (not factory time) so rotation via systemd/compose reload
 * picks up without a process restart.
 *
 * Returns: uptime, active sessions, and a `counts` block (users_total,
 * verified_users, partners_total, samples_total, samples_24h). Schema
 * is consumed by the kt portal homepage operator strip.
 *
 * Extracted from server.js as part of the backend modularization
 * (wave 2). Factory injects db + Users + auth so the module stays
 * testable in isolation. The ADMIN_STATS_TOKEN env read stays here
 * (not in factory deps) on purpose — it's an environmental switch,
 * not a wired dependency.
 *
 * Wiring (in server.js):
 *   const { createAdminModule } = require('./modules/admin/handler');
 *   router.register(createAdminModule({ db, Users, auth }));
 */

const { sendJson, sendError } = require('../../lib/http');

/**
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   Users: { count: () => number },
 *   auth: { activeSessionCount: () => number },
 * }} deps
 */
function createAdminModule(deps) {
  const { db, Users, auth } = deps;

  function handleAdminStats(req, res) {
    const expected = process.env.ADMIN_STATS_TOKEN;
    if (!expected) {
      return sendError(res, 503, 'admin_stats_disabled', 'ADMIN_STATS_TOKEN not configured');
    }
    const auth_h = req.headers['authorization'] || '';
    const provided = auth_h.startsWith('Bearer ') ? auth_h.slice(7) : '';
    if (!provided || provided !== expected) {
      return sendError(res, 401, 'unauthorized', 'Bearer token required');
    }
    try {
      const dayAgoMs = Date.now() - 24 * 3600 * 1000;
      const samples_total = db.prepare('SELECT COUNT(*) AS n FROM samples').get().n;
      const samples_24h = db
        .prepare('SELECT COUNT(*) AS n FROM samples WHERE created_at > ?')
        .get(dayAgoMs).n;
      const partners_total = db.prepare('SELECT COUNT(*) AS n FROM partners').get().n;
      const users_total = Users.count();
      const verified_users = db
        .prepare('SELECT COUNT(*) AS n FROM users WHERE email_verified_at IS NOT NULL')
        .get().n;
      sendJson(res, 200, {
        success: true,
        generated_at: Date.now(),
        uptime_sec: Math.round(process.uptime()),
        sessions: auth.activeSessionCount(),
        counts: {
          users_total,
          verified_users,
          partners_total,
          samples_total,
          samples_24h,
        },
      });
    } catch (e) {
      log.error({ err: e }, 'admin stats failed');
      sendError(res, 500, 'stats_failed', e.message);
    }
  }

  return {
    id: 'admin',
    routes: [{ method: 'GET', path: '/api/admin/stats', handler: handleAdminStats }],
  };
}

module.exports = { createAdminModule };
