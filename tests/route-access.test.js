'use strict';

/**
 * Route access inventory.
 *
 * Every HTTP route the server registers must be declared in
 * tests/fixtures/route-access.json with WHO may call it (`access`) and HOW it is
 * limited (`limit`), and that declaration must be visible in the handler's code.
 * Lint, tsc and the rest of the suite cannot see a missing guard, so a new route
 * fails here until it declares both.
 *
 * The route table comes from the real server module (tests/fixtures/dump-routes.js
 * records what server.js registers), not from a text search of the sources, so
 * routes registered through helpers are covered too.
 *
 * Entry fields:
 *   access  public | user | admin-token | ingest | health
 *   limit   name of the limiter / check that appears in the handler source, or
 *           "none"
 *   reason  required when limit is "none": why no limit is needed
 *   evidence_file  file (relative to the repo root) to search instead of the
 *           handler source, for handlers wrapped by a generic helper
 *   limit_file     file in which the limiter name must appear (default: as above)
 *
 * Rules enforced:
 *   - registered routes and fixture entries match exactly;
 *   - `user` routes visibly reject anonymous callers, `admin-token` routes call
 *     the admin-token check, and a named limit is present in the code;
 *   - limit "none" always needs a reason.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const inventory = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'route-access.json'), 'utf8'),
);
delete inventory._readme;

const ACCESS = new Set(['public', 'user', 'admin-token', 'ingest', 'health']);
const GUARD = {
  user: /\brequireUser\(|\bgetCurrentUser\([^)]*\)[\s\S]{0,300}?\b401\b/,
  'admin-token': /\brequireAdmin(?:Token|Bearer)\(/,
};

function loadRoutes() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'route-access-')), 'routes.json');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-access-data-'));
  try {
    const run = spawnSync(
      process.execPath,
      ['-r', path.join(__dirname, 'fixtures', 'dump-routes.js'), path.join(ROOT, 'server.js')],
      {
        cwd: ROOT,
        timeout: 60_000,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          LOG_LEVEL: 'silent',
          ORTBTOOLS_DATA_DIR: dataDir,
          ROUTES_OUT: out,
          // Registers the optional ingest module so that route is inventoried too.
          GLITCHTIP_INGEST_HOST: 'ingest.invalid',
          CLICKHOUSE_URL: '',
          SENTRY_DSN: '',
        },
      },
    );
    assert.equal(run.status, 0, `route dump failed: ${run.stderr || run.error}`);
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

const routes = loadRoutes().map((r) => ({ ...r, key: `${r.method} ${r.path}` }));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('route discovery covers the whole server', () => {
  assert.ok(routes.length >= 70, `route discovery looks broken (${routes.length})`);
  assert.ok(routes.some((r) => r.key === 'POST /api/analyze'));
  assert.ok(
    routes.some((r) => r.key === 'POST /api/auth/login'),
    'helper-registered routes',
  );
});

test('every registered route is declared in tests/fixtures/route-access.json', () => {
  const undeclared = routes.filter((r) => !inventory[r.key]).map((r) => `${r.key} (${r.module})`);
  assert.deepEqual(undeclared, [], 'undeclared routes: add access + limit to the fixture');
  const gone = Object.keys(inventory).filter((k) => !routes.some((r) => r.key === k));
  assert.deepEqual(gone, [], 'fixture lists routes that are no longer registered');
});

test('every declaration is well formed', () => {
  const bad = [];
  for (const [key, d] of Object.entries(inventory)) {
    if (!ACCESS.has(d.access)) bad.push(`${key}: unknown access "${d.access}"`);
    if (typeof d.limit !== 'string' || !d.limit) bad.push(`${key}: limit is required`);
    if (d.limit === 'none' && !d.reason) bad.push(`${key}: limit "none" needs a reason`);
  }
  assert.deepEqual(bad, []);
});

test('the declared access and limit are visible in the handler code', () => {
  const bad = [];
  for (const r of routes) {
    const d = inventory[r.key];
    if (!d) continue;
    const evidence = d.evidence_file ? read(d.evidence_file) : r.source;
    const guard = GUARD[d.access];
    if (guard && !guard.test(evidence)) {
      bad.push(
        `${r.key}: declared ${d.access}, no matching guard in ${d.evidence_file || r.handler}`,
      );
    }
    if (d.limit !== 'none') {
      const where = d.limit_file ? read(d.limit_file) : evidence;
      if (!where.includes(d.limit)) {
        bad.push(
          `${r.key}: limit "${d.limit}" not found in ${d.limit_file || d.evidence_file || r.handler}`,
        );
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('admin-token failures are throttled by lib/admin-auth.js', () => {
  assert.match(read('lib/admin-auth.js'), /MAX_FAILURES[\s\S]*rate_limited/);
});
