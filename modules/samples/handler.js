'use strict';

/**
 * modules/samples/handler.js — /api/samples route module.
 *
 * Library samples (the user's saved BidRequest/BidResponse paste corpus).
 * Auth-gated, per-user CRUD with an optional `partner_id` filter on the
 * collection GET (?partner_id=N or ?partner_id=unassigned):
 *   GET    /api/samples                  — list samples (optional ?partner_id=)
 *   POST   /api/samples                  — create sample
 *   GET    /api/samples/:id              — fetch one sample
 *   PATCH  /api/samples/:id              — update
 *   DELETE /api/samples/:id              — delete
 *
 * Extracted from server.js handleApi, which dispatched both /api/samples
 * and /api/partners through an internal method+path switch behind a
 * single `pathname.startsWith('/api/samples') || pathname.startsWith('/api/partners')`
 * gate in the top-level dispatcher. We split it into Router-registered
 * routes and moved the auth check into the module so the router itself
 * stays unaware of auth state.
 *
 * Factory shape mirrors modules/corpus/handler.js + modules/partners/handler.js:
 * server.js injects the closure-scoped deps (auth, Samples model) at boot
 * so this module stays testable in isolation.
 *
 * Wiring (in server.js):
 *   const { createSamplesModule } = require('./modules/samples/handler');
 *   router.register(createSamplesModule({ auth, Samples }));
 */

const { readJson, sendJson, sendError } = require('../../lib/http');

/**
 * @param {{
 *   auth: { getCurrentUser: (req: import('http').IncomingMessage) => ({id: number}|null) },
 *   Samples: {
 *     list: (args: {userId: number, partnerId?: number|'unassigned'}) => Array,
 *     get: (args: {id: number, userId: number}) => object|null,
 *     create: (args: object) => object,
 *     update: (args: object) => object|null,
 *     delete: (args: {id: number, userId: number}) => boolean,
 *   },
 * }} deps
 */
function createSamplesModule(deps) {
  const { auth, Samples } = deps;

  function requireUser(req, res) {
    const user = auth.getCurrentUser(req);
    if (!user) {
      sendError(res, 401, 'unauthorized', 'Sign in to access your library');
      return null;
    }
    return user;
  }

  function handleList(req, res, parsed) {
    const user = requireUser(req, res);
    if (!user) return;
    const pid = parsed.searchParams.get('partner_id');
    /** @type {number | 'unassigned' | undefined} */
    let partnerId;
    if (pid === 'unassigned') partnerId = 'unassigned';
    else if (pid != null && pid !== '') partnerId = Number(pid);
    return sendJson(res, 200, {
      success: true,
      samples: Samples.list({ userId: user.id, partnerId }),
    });
  }

  function handleCreate(req, res) {
    const user = requireUser(req, res);
    if (!user) return;
    return readJson(req)
      .then((b) => {
        if (!b.title || !String(b.title).trim()) {
          return sendError(res, 400, 'title_required', 'Sample title is required');
        }
        const s = Samples.create({ userId: user.id, ...b });
        sendJson(res, 200, { success: true, sample: s });
      })
      .catch((e) => sendError(res, 400, e.code || 'bad_request', e.message));
  }

  function handleGet(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = Number(match.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendError(res, 400, 'id_invalid', 'id must be a positive integer');
    }
    const s = Samples.get({ id, userId: user.id });
    if (!s) return sendError(res, 404, 'not_found', 'Sample not found');
    return sendJson(res, 200, { success: true, sample: s });
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
        const s = Samples.update({ id, userId: user.id, ...b });
        if (!s) return sendError(res, 404, 'not_found', 'Sample not found');
        sendJson(res, 200, { success: true, sample: s });
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
    const ok = Samples.delete({ id, userId: user.id });
    return ok
      ? sendJson(res, 200, { success: true })
      : sendError(res, 404, 'not_found', 'Sample not found');
  }

  return {
    id: 'samples',
    routes: [
      { method: 'GET', path: '/api/samples', handler: handleList },
      { method: 'POST', path: '/api/samples', handler: handleCreate },
      { method: 'GET', path: '/api/samples/:id', handler: handleGet },
      { method: 'PATCH', path: '/api/samples/:id', handler: handleUpdate },
      { method: 'DELETE', path: '/api/samples/:id', handler: handleDelete },
    ],
  };
}

module.exports = { createSamplesModule };
