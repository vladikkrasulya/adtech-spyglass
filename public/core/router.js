/* ============================================================
   public/core/router.js — pathname → moduleId mapping (ES module).

   Tiny by design. Exact-match routes only for now; pattern routes
   (/r/:hash, /p/:slug) come when permalinks land in Phase B+.
   The route → id map is populated by registry.register() when a
   module declares `route: '/x'`; consumers read it via match().

   Phase B baseline keeps things synchronous and trivial. The point
   of having a separate file is so the pattern is in place when we
   need real routing logic (history-API integration, params, fall-
   back chain) without touching every consumer.
   ============================================================ */
'use strict';

const routes = new Map(); // pathname → moduleId

export function register(route, moduleId) {
  if (routes.has(route)) {
    throw new Error(
      'router.register: duplicate route "' +
        route +
        '" (already mapped to "' +
        routes.get(route) +
        '")',
    );
  }
  routes.set(route, moduleId);
}

export function unregister(route) {
  routes.delete(route);
}

/* Look up a module id for the given pathname. Tries exact match,
   then a trailing-slash-trimmed retry. Returns null on miss so
   callers can apply their own fallback (e.g. shell defaults). */
export function match(pathname) {
  if (routes.has(pathname)) return routes.get(pathname);
  if (pathname.endsWith('/') && routes.has(pathname.slice(0, -1))) {
    return routes.get(pathname.slice(0, -1));
  }
  return null;
}

/* Snapshot of all registered routes — for debug overlays / module
   directories later. */
export function list() {
  return Array.from(routes.entries());
}
