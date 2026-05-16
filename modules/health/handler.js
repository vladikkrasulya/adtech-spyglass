'use strict';

/**
 * modules/health/handler.js — GET /api/health
 *
 * First module extracted from server.js as part of the backend
 * modularization (lib/router.js narrow waist). Anonymous callers
 * (Docker healthcheck, Uptime Kuma, random probes) get only liveness
 * — no pid/node-version/user-count fingerprinting. Authed sessions
 * get the full operational view.
 *
 * Factory shape: createHealthModule({ db, auth, Users, sendJson })
 * returns { id, routes } per the Router contract. Deps injected so
 * the module stays testable without a live HTTP server.
 */

function createHealthModule({ db, auth, Users, sendJson, sentryReady }) {
  // Capture once at module load — BUILD_SHA is set at Docker build time
  // via ARG → ENV in the Dockerfile and never changes during a run. 'dev'
  // is the dev-image / dev-tree fallback so the field is always present.
  const buildSha = process.env.BUILD_SHA || 'dev';

  function handleHealth(req, res) {
    let dbOk = false;
    try {
      db.prepare('SELECT 1').get();
      dbOk = true;
    } catch {
      dbOk = false;
    }
    const status = dbOk ? 200 : 503;
    const body = {
      success: dbOk,
      status: dbOk ? 'ok' : 'degraded',
      checks: { db: dbOk },
      build: { sha: buildSha },
      // Anonymous tier surfaces only a boolean — fine for ops dashboards
      // and avoids leaking the DSN host or project id.
      sentry: { ready: typeof sentryReady === 'function' ? !!sentryReady() : false },
    };
    if (auth.getCurrentUser(req)) {
      body.sessions = auth.activeSessionCount();
      body.users = Users.count();
      body.uptime = Math.round(process.uptime());
      body.pid = process.pid;
      body.node = process.version;
    }
    sendJson(res, status, body);
  }

  return {
    id: 'health',
    routes: [{ method: 'GET', path: '/api/health', handler: handleHealth }],
  };
}

module.exports = { createHealthModule };
