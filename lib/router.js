'use strict';

/**
 * lib/router.js — pattern-based HTTP route dispatcher.
 *
 * Backend module migration's narrow waist: each module under modules/
 * exports { id, routes: [{method, path, handler, opts?}] } and registers
 * with the Router. The dispatcher matches incoming requests against
 * registered routes and invokes the handler.
 *
 * Path patterns supported:
 *   /api/health            — exact match
 *   /api/samples/:id       — single-segment placeholder, captured to match.params.id
 *   /api/behavior/corpus*  — trailing-star prefix match, rest stored in match.rest
 *
 * Routes are evaluated in registration order. First match wins. If no
 * route matches, dispatch returns null and the caller falls through to
 * the static-file path (or 404).
 *
 * Handlers signature: (req, res, parsed, match) → void|Promise<void>
 *   - req, res: standard http
 *   - parsed: pre-built `new URL(req.url, 'http://localhost')`
 *   - match: { params: {...}, rest?: string } from path-match captures
 *
 * Module shape:
 *   module.exports = {
 *     id: 'replay',
 *     routes: [
 *       { method: 'POST', path: '/api/v1/replay', handler: handleReplay },
 *     ],
 *   };
 *
 * Why this exists: pre-Phase-A server.js had 30+ inline `if (pathname ===
 * '/api/foo' && method === 'POST') return handleFoo(...)` lines stacked
 * in the dispatcher. Each module migration moves one or more of those
 * into modules/<tool>/handler.js + a Router.register call. server.js
 * shrinks from "monolith with embedded routing table" to "thin bootstrap
 * that registers modules then listens".
 */

class Router {
  constructor() {
    this.routes = [];
  }

  /**
   * Register a single module or an array of modules.
   * Each module must have { routes: [{method, path, handler}, …] }.
   */
  register(modules) {
    const list = Array.isArray(modules) ? modules : [modules];
    for (const m of list) {
      if (!m || !Array.isArray(m.routes)) continue;
      for (const r of m.routes) {
        if (!r.method || !r.path || typeof r.handler !== 'function') {
          throw new Error(
            `[router] invalid route in module ${m.id || 'unknown'}: ${JSON.stringify(r)}`,
          );
        }
        this.routes.push({ ...r, moduleId: m.id });
      }
    }
  }

  /**
   * Match a (method, pathname) against registered routes.
   * Returns { handler, match } on hit, null on miss.
   * match contains { params: {...}, rest?: '...' }.
   */
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = matchPath(r.path, pathname);
      if (m) return { handler: r.handler, match: m, moduleId: r.moduleId };
    }
    return null;
  }

  /**
   * Convenience: match + invoke. Returns true if a route handled the
   * request, false otherwise. Callers fall through to static-file or
   * 404 on false.
   */
  async dispatch(req, res, parsed) {
    const hit = this.match(req.method, parsed.pathname);
    if (!hit) return false;
    await hit.handler(req, res, parsed, hit.match);
    return true;
  }
}

function matchPath(pattern, pathname) {
  // Trailing-star: /api/behavior/corpus* → prefix match
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    if (pathname.startsWith(prefix)) {
      return { params: {}, rest: pathname.slice(prefix.length) };
    }
    return null;
  }

  // No placeholder: exact match
  if (!pattern.includes(':')) {
    return pattern === pathname ? { params: {} } : null;
  }

  // Placeholder: split + match segment-by-segment
  const patSegs = pattern.split('/');
  const pathSegs = pathname.split('/');
  if (patSegs.length !== pathSegs.length) return null;
  const params = {};
  for (let i = 0; i < patSegs.length; i++) {
    if (patSegs[i].startsWith(':')) {
      params[patSegs[i].slice(1)] = decodeURIComponent(pathSegs[i]);
    } else if (patSegs[i] !== pathSegs[i]) {
      return null;
    }
  }
  return { params };
}

module.exports = { Router, matchPath };
