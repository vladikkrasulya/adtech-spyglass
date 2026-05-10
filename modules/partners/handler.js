'use strict';

/**
 * modules/partners/handler.js — /api/partners route module.
 *
 * Library partners (the "who supplied this sample?" facet). Auth-gated,
 * per-user CRUD plus a samples-count helper used by the delete-confirm
 * dialog:
 *   GET    /api/partners                         — list partners
 *   POST   /api/partners                         — create partner
 *   PATCH  /api/partners/:id                     — rename / update
 *   DELETE /api/partners/:id                     — delete
 *   GET    /api/partners/:id/samples-count       — count samples that
 *                                                  will become unassigned
 *
 * Extracted from server.js handleApi, which dispatched both /api/partners
 * and /api/samples through an internal method+path switch behind a single
 * `pathname.startsWith('/api/partners') || pathname.startsWith('/api/samples')`
 * gate in the top-level dispatcher. We split it into Router-registered
 * routes and moved the auth check into the module so the router itself
 * stays unaware of auth state.
 *
 * ROUTE-ORDER CONTRACT — the Router evaluates routes in registration
 * order; matchPath() treats ':id' as a single-segment placeholder, so
 * '/api/partners/:id' (3 segments) and '/api/partners/:id/samples-count'
 * (4 segments) never collide on path-length grounds. The static
 * '/samples-count' is still listed first to encode "more specific first"
 * as a defensive convention and to guard against future refactors that
 * might collapse path-length differences.
 *
 * Factory shape mirrors modules/corpus/handler.js: server.js injects the
 * closure-scoped deps (auth, Partners model) at boot so this module
 * stays testable in isolation.
 *
 * Wiring (in server.js):
 *   const { createPartnersModule } = require('./modules/partners/handler');
 *   router.register(createPartnersModule({ auth, Partners }));
 */

const { readJson, sendJson, sendError } = require('../../lib/http');

/**
 * @param {{
 *   auth: { getCurrentUser: (req: import('http').IncomingMessage) => ({id: number}|null) },
 *   Partners: {
 *     list: (args: {userId: number}) => Array,
 *     create: (args: object) => object,
 *     update: (args: object) => object|null,
 *     delete: (args: {id: number, userId: number}) => boolean,
 *     countSamples: (args: {id: number, userId: number}) => number,
 *   },
 * }} deps
 */
function createPartnersModule(deps) {
  const { auth, Partners } = deps;

  function requireUser(req, res) {
    const user = auth.getCurrentUser(req);
    if (!user) {
      sendError(res, 401, 'unauthorized', 'Sign in to access your library');
      return null;
    }
    return user;
  }

  function handleList(req, res) {
    const user = requireUser(req, res);
    if (!user) return;
    return sendJson(res, 200, { success: true, partners: Partners.list({ userId: user.id }) });
  }

  function handleCreate(req, res) {
    const user = requireUser(req, res);
    if (!user) return;
    return readJson(req)
      .then((b) => {
        if (!b.name || !String(b.name).trim()) {
          return sendError(res, 400, 'name_required', 'Partner name is required');
        }
        const p = Partners.create({ userId: user.id, ...b });
        sendJson(res, 200, { success: true, partner: p });
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }

  function handleUpdate(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = Number(match.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendError(res, 400, 'id_invalid', 'id must be a positive integer');
    }
    return readJson(req)
      .then((b) => {
        const p = Partners.update({ id, userId: user.id, ...b });
        if (!p) return sendError(res, 404, 'not_found', 'Partner not found');
        sendJson(res, 200, { success: true, partner: p });
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }

  function handleDelete(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = Number(match.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendError(res, 400, 'id_invalid', 'id must be a positive integer');
    }
    const ok = Partners.delete({ id, userId: user.id });
    return ok
      ? sendJson(res, 200, { success: true })
      : sendError(res, 404, 'not_found', 'Partner not found');
  }

  function handleSamplesCount(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = Number(match.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendError(res, 400, 'id_invalid', 'id must be a positive integer');
    }
    const count = Partners.countSamples({ id, userId: user.id });
    return sendJson(res, 200, { success: true, count });
  }

  return {
    id: 'partners',
    routes: [
      // /:id/samples-count is path-length-distinct from /:id today (4 vs 3
      // segments), so the Router can't confuse them. We still list the
      // more-specific path first as a defensive convention.
      {
        method: 'GET',
        path: '/api/partners/:id/samples-count',
        handler: handleSamplesCount,
      },
      { method: 'GET', path: '/api/partners', handler: handleList },
      { method: 'POST', path: '/api/partners', handler: handleCreate },
      { method: 'PATCH', path: '/api/partners/:id', handler: handleUpdate },
      { method: 'DELETE', path: '/api/partners/:id', handler: handleDelete },
    ],
  };
}

module.exports = { createPartnersModule };
