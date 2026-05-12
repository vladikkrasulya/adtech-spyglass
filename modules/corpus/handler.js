'use strict';

const log = require('../../lib/logger').child('corpus');

/**
 * modules/corpus/handler.js — /api/behavior/corpus route module.
 *
 * Labelled event-stream archive (Chapter B). Auth-gated, per-user:
 *   GET    /api/behavior/corpus         — list entries (optional ?label=)
 *   POST   /api/behavior/corpus         — save new entry from probe events
 *   DELETE /api/behavior/corpus/:id     — remove one entry
 *   GET    /api/behavior/corpus/matrix  — confusion-matrix runner
 *
 * Extracted from server.js handleBehaviorCorpus, which used an internal
 * method+path switch. We split it into 4 Router-registered routes.
 *
 * ROUTE-ORDER CONTRACT — the Router evaluates routes in registration order
 * and matchPath() treats ':id' as a single-segment placeholder, so
 * '/api/behavior/corpus/:id' would ALSO match '/api/behavior/corpus/matrix'
 * if the method were the same. The two collide only on shared method, but
 * to stay defensive we list /matrix first. The two routes also differ by
 * method (GET vs DELETE) which prevents collision today; the listing order
 * documents intent and guards against future method-overlap regressions.
 *
 * Factory shape mirrors modules/mirror/handler.js + modules/replay/handler.js:
 * server.js injects the closure-scoped deps (auth, BehaviorCorpus model,
 * computeCorpusMatrix runner) at boot so this module stays testable in
 * isolation.
 *
 * Wiring (in server.js):
 *   const { createCorpusModule } = require('./modules/corpus/handler');
 *   router.register(createCorpusModule({
 *     auth, BehaviorCorpus, computeCorpusMatrix,
 *   }));
 */

const { readJson, sendJson, sendError } = require('../../lib/http');

/**
 * @param {{
 *   auth: { getCurrentUser: (req: import('http').IncomingMessage) => ({id: number}|null) },
 *   BehaviorCorpus: {
 *     LABELS: string[],
 *     listForUser: (userId: number, opts?: {label?: string, limit?: number}) => Array,
 *     countsForUser: (userId: number) => object,
 *     create: (args: object) => {id: number},
 *     destroy: (id: number, userId: number) => boolean,
 *   },
 *   computeCorpusMatrix: (userId: number) => object,
 * }} deps
 */
function createCorpusModule(deps) {
  const { auth, BehaviorCorpus, computeCorpusMatrix } = deps;

  function requireUser(req, res) {
    const user = auth.getCurrentUser(req);
    if (!user) {
      sendError(res, 401, 'auth_required', 'Sign in to use the behavior corpus');
      return null;
    }
    return user;
  }

  function handleList(req, res, parsed) {
    const user = requireUser(req, res);
    if (!user) return;
    const label = parsed.searchParams.get('label') || undefined;
    try {
      const entries = BehaviorCorpus.listForUser(user.id, { label });
      const counts = BehaviorCorpus.countsForUser(user.id);
      sendJson(res, 200, { success: true, entries, counts });
    } catch (e) {
      log.error({ err: e }, 'corpus/list failed');
      sendError(res, 500, 'list_failed', e.message);
    }
  }

  function handleSave(req, res) {
    const user = requireUser(req, res);
    if (!user) return;
    readJson(req)
      .then((body) => {
        const events = body && body.events;
        const label = body && body.label;
        if (!Array.isArray(events) || !events.length) {
          return sendError(
            res,
            400,
            'events_required',
            'Provide an `events` array (output of behavior probe)',
          );
        }
        if (!BehaviorCorpus.LABELS.includes(label)) {
          return sendError(
            res,
            400,
            'label_invalid',
            'label must be one of: legitimate, fraud, ambiguous',
          );
        }
        try {
          const r = BehaviorCorpus.create({
            userId: user.id,
            label,
            events,
            sourceSampleId: body.sourceSampleId || null,
            notes: body.notes || '',
          });
          sendJson(res, 200, { success: true, id: r.id });
        } catch (e) {
          log.error({ err: e }, 'corpus/create failed');
          sendError(res, 400, 'create_failed', e.message);
        }
      })
      .catch((e) => sendError(res, 400, 'invalid_json', e.message));
  }

  function handleDelete(req, res, _parsed, match) {
    const user = requireUser(req, res);
    if (!user) return;
    const id = Number(match.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendError(res, 400, 'id_invalid', 'id must be a positive integer');
    }
    const ok = BehaviorCorpus.destroy(id, user.id);
    if (!ok) return sendError(res, 404, 'not_found', 'Corpus entry not found');
    sendJson(res, 200, { success: true });
  }

  function handleMatrix(req, res) {
    const user = requireUser(req, res);
    if (!user) return;
    try {
      const matrix = computeCorpusMatrix(user.id);
      sendJson(res, 200, { success: true, matrix });
    } catch (e) {
      log.error({ err: e }, 'corpus/matrix failed');
      sendError(res, 500, 'matrix_failed', e.message);
    }
  }

  return {
    id: 'corpus',
    routes: [
      // /matrix MUST be registered before /:id so the static path wins when
      // a future change converts /matrix into a method that overlaps with
      // DELETE. Today they only collide on GET, where /matrix is the static
      // route and no GET /:id exists — but the order encodes the invariant.
      { method: 'GET', path: '/api/behavior/corpus/matrix', handler: handleMatrix },
      { method: 'GET', path: '/api/behavior/corpus', handler: handleList },
      { method: 'POST', path: '/api/behavior/corpus', handler: handleSave },
      { method: 'DELETE', path: '/api/behavior/corpus/:id', handler: handleDelete },
    ],
  };
}

module.exports = { createCorpusModule };
