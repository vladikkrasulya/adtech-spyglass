'use strict';

/**
 * Preload for tests/route-access.test.js: `node -r tests/fixtures/dump-routes.js server.js`.
 * Records every route registered with the Router, writes them as JSON to
 * $ROUTES_OUT and exits at the moment server.js would start listening, so
 * nothing is served and no timers or background jobs start.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { Router } = require(path.join(__dirname, '..', '..', 'lib', 'router'));

const routes = [];
const register = Router.prototype.register;
Router.prototype.register = function (modules) {
  for (const m of Array.isArray(modules) ? modules : [modules]) {
    for (const r of (m && m.routes) || []) {
      routes.push({
        module: m.id,
        method: r.method,
        path: r.path,
        handler: r.handler.name,
        source: String(r.handler),
      });
    }
  }
  return register.call(this, modules);
};

http.Server.prototype.listen = function () {
  fs.writeFileSync(String(process.env.ROUTES_OUT), JSON.stringify(routes));
  process.exit(0);
};
