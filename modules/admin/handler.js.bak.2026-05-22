'use strict';

const log = require('../../lib/logger').child('admin');
const eventLog = require('../../lib/event-log');

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

  // Same Bearer-token auth as /api/admin/stats — read at request time so
  // env rotation doesn't require a restart.
  function requireAdminToken(req, res) {
    const expected = process.env.ADMIN_STATS_TOKEN;
    if (!expected) {
      sendError(res, 503, 'admin_disabled', 'ADMIN_STATS_TOKEN not configured');
      return false;
    }
    const auth_h = req.headers['authorization'] || '';
    const provided = auth_h.startsWith('Bearer ') ? auth_h.slice(7) : '';
    if (!provided || provided !== expected) {
      sendError(res, 401, 'unauthorized', 'Bearer token required');
      return false;
    }
    return true;
  }

  function parseIntOrNull(s) {
    if (s == null || s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * GET /api/admin/logs
   *
   * Query params (all optional):
   *   since=<unix-ms>          lower bound (inclusive)
   *   until=<unix-ms>          upper bound (exclusive)
   *   level=info|warn|error
   *   component=http|auth|intel|…
   *   user_id=<int>
   *   limit=<int>              default 200, max 1000
   *   offset=<int>
   *
   * Returns { success, items: [...], total, components: [...] }.
   * `components` is the distinct set currently in the table — feeds the
   * portal's filter dropdown so it stays in sync with what's actually
   * being recorded.
   */
  function handleAdminLogs(req, res, parsed) {
    if (!requireAdminToken(req, res)) return;
    try {
      const q = parsed.searchParams;
      const filters = {
        since: parseIntOrNull(q.get('since')),
        until: parseIntOrNull(q.get('until')),
        level: q.get('level') || undefined,
        component: q.get('component') || undefined,
        user_id: parseIntOrNull(q.get('user_id')),
        limit: parseIntOrNull(q.get('limit')) || undefined,
        offset: parseIntOrNull(q.get('offset')) || undefined,
      };
      const result = eventLog.query(filters);
      sendJson(res, 200, {
        success: true,
        generated_at: Date.now(),
        retention_days: eventLog.RETENTION_DAYS,
        components: eventLog.listComponents(),
        ...result,
      });
    } catch (e) {
      log.error({ err: e }, 'admin logs query failed');
      sendError(res, 500, 'logs_failed', e.message);
    }
  }

  return {
    id: 'admin',
    routes: [
      { method: 'GET', path: '/api/admin/stats', handler: handleAdminStats },
      { method: 'GET', path: '/api/admin/logs', handler: handleAdminLogs },
    ],
  };
}

module.exports = { createAdminModule };
