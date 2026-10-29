'use strict';

/**
 * tests/account-delete.test.js — POST /api/auth/delete-account
 *
 * Real SQLite (temp dir), real auth (bcrypt, sessions, session recovery) and the
 * real auth route module; only the mailer and the ClickHouse purge are stubbed.
 * Covers: wrong/missing password, CSRF guard, rate limit, cascade, event_log
 * anonymisation, no session afterwards, recovery journal, ClickHouse failure
 * tolerance (route and lib/analytics-purge).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Readable } = require('node:stream');

const TMP = mkdtempSync(join(tmpdir(), 'ortbtools-account-delete-'));
process.env.ORTBTOOLS_DATA_DIR = TMP;

const { db, Users, Sessions, Partners, Samples, AnalyzeLog, BehaviorCorpus } = require('../db');
const { createAuth } = require('../auth');
const { createSessionRecovery } = require('../lib/session-recovery');
const { createAuthRoutesModule } = require('../modules/auth/handler');
const { purgeUserAnalytics, TABLES } = require('../lib/analytics-purge');

after(() => rmSync(TMP, { recursive: true, force: true }));

const BASE = 'https://ortbtools.test';
const SAME_ORIGIN = {
  origin: BASE,
  host: 'ortbtools.test',
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/json',
};
const PASSWORD = 'correct-horse-battery';

let ipCounter = 0;
const nextIp = () => `10.9.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

/** @param {{ purge?: (id: number) => any, withRecovery?: boolean }} [opts] */
function makeStack({ purge, withRecovery = true } = {}) {
  const dir = join(TMP, 'sr-' + ++ipCounter);
  const recovery = withRecovery
    ? createSessionRecovery({ directory: dir, store: Sessions })
    : undefined;
  const auth = createAuth({ Users, Sessions, recovery, logger: { info() {}, error() {} } });
  const purgeCalls = [];
  const mod = createAuthRoutesModule({
    auth,
    Users,
    signToken: () => 'tok',
    verifyToken: () => ({}),
    TokenError: function TokenError() {},
    sendVerifyEmail: async () => ({ dev: true }),
    sendResetEmail: async () => ({}),
    notifyAdmin: () => {},
    notifyEscape: (s) => s,
    publicUser: (u) => u,
    publicEncryption: (s) => s,
    getPublicBaseUrl: () => BASE,
    setLocaleCookie: () => {},
    VERIFY_TOKEN_TTL: 900,
    RESET_TOKEN_TTL: 900,
    purgeUserAnalytics:
      purge ||
      (async (id) => {
        purgeCalls.push(id);
      }),
  });
  return { auth, mod, recovery, dir, purgeCalls };
}

/** Register a user + a session; returns the cookie header value. */
async function signUp(auth, email, ip = nextIp()) {
  const req = { headers: { 'user-agent': 't', 'x-forwarded-for': ip }, socket: {}, connection: {} };
  const res = { setHeader(k, v) { this.cookie = v; } }; // prettier-ignore
  const user = await auth.register({ email, password: PASSWORD }, req);
  auth.createSession(req, res, user);
  const cookie = String(res.cookie).split(';')[0];
  return { user, cookie, ip };
}

function seed(userId) {
  const p = Partners.create(/** @type {any} */ ({ userId, name: 'Vendor-' + userId }));
  Samples.create(
    /** @type {any} */ ({ userId, partner_id: p.id, title: 's', bid_req: 'x', bid_res: 'y' }),
  );
  AnalyzeLog.record(/** @type {any} */ ({ userId, payloadType: 'both', status: 'clean' }));
  BehaviorCorpus.create({ userId, label: 'fraud', events: [{ kind: 'probe_ready' }] });
  const d = db
    .prepare('INSERT INTO user_dialects(user_id, name, created_at, updated_at) VALUES (?,?,?,?)')
    .run(userId, 'd', 1, 1).lastInsertRowid;
  db.prepare(
    `INSERT INTO dialect_mappings(dialect_id, signal_path, signal_value, semantic_label, created_at)
     VALUES (?,?,?,?,?)`,
  ).run(d, 'imp[].ext.t', 'v', 'banner', 1);
  for (let i = 0; i < 3; i++) {
    db.prepare(
      `INSERT INTO event_log(ts, level, component, msg, user_id, ip) VALUES (?,?,?,?,?,?)`,
    ).run(Date.now(), 'info', 'http', 'GET /api/x', userId, '203.0.113.' + userId);
  }
}

function counts(userId) {
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  return {
    users: n('SELECT count(*) n FROM users WHERE id = ?', userId),
    partners: n('SELECT count(*) n FROM partners WHERE user_id = ?', userId),
    samples: n('SELECT count(*) n FROM samples WHERE user_id = ?', userId),
    analyze: n('SELECT count(*) n FROM analyze_log WHERE user_id = ?', userId),
    corpus: n('SELECT count(*) n FROM behavior_corpus WHERE user_id = ?', userId),
    dialects: n('SELECT count(*) n FROM user_dialects WHERE user_id = ?', userId),
    mappings: n(
      `SELECT count(*) n FROM dialect_mappings
       WHERE dialect_id IN (SELECT id FROM user_dialects WHERE user_id = ?)`,
      userId,
    ),
    sessions: n('SELECT count(*) n FROM sessions WHERE user_id = ?', userId),
    events: n('SELECT count(*) n FROM event_log WHERE user_id = ?', userId),
  };
}

function call(mod, headers, body, path = '/api/auth/delete-account') {
  const route = mod.routes.find((r) => r.method === 'POST' && r.path === path);
  assert.ok(route, 'route registered: ' + path);
  const payload = body === undefined ? '' : JSON.stringify(body);
  /** @type {any} */
  const req = new Readable({ read() {} });
  req.method = 'POST';
  req.headers = { ...(payload ? { 'content-length': String(payload.length) } : {}), ...headers };
  req.socket = {};
  req.connection = {};
  if (payload) req.push(payload);
  req.push(null);
  return new Promise((resolve) => {
    const res = {
      status: 0,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      getHeader(k) {
        return this.headers[k];
      },
      writeHead(code) {
        this.status = code;
      },
      end(b) {
        resolve({ status: this.status, body: b ? JSON.parse(b) : null, headers: this.headers });
      },
    };
    route.handler(req, res);
  });
}

const authed = (cookie, ip) => ({ ...SAME_ORIGIN, cookie, 'x-forwarded-for': ip });

test('route is registered behind the CSRF guard', async () => {
  const { mod } = makeStack({ withRecovery: false });
  const r = await call(mod, { 'sec-fetch-site': 'cross-site' }, { password: PASSWORD });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'cross_site_request');
  const t = await call(mod, { 'content-type': 'text/plain' }, { password: PASSWORD });
  assert.equal(t.status, 415);
});

test('cross-site request with a valid session and password does not delete anything', async () => {
  const { auth, mod, purgeCalls } = makeStack();
  const { user, cookie, ip } = await signUp(auth, 'csrf-del@example.test');
  seed(user.id);
  const before = counts(user.id);
  const r = await call(
    mod,
    { ...authed(cookie, ip), origin: 'https://evil.example' },
    { password: PASSWORD },
  );
  assert.equal(r.status, 403);
  assert.deepEqual(counts(user.id), before);
  assert.equal(purgeCalls.length, 0);
});

test('anonymous caller gets 401', async () => {
  const { mod } = makeStack({ withRecovery: false });
  const r = await call(
    mod,
    { ...SAME_ORIGIN, 'x-forwarded-for': nextIp() },
    { password: PASSWORD },
  );
  assert.equal(r.status, 401);
});

test('missing or wrong password: 400 / 401 and nothing is deleted', async () => {
  const { auth, mod, purgeCalls } = makeStack();
  const { user, cookie, ip } = await signUp(auth, 'wrongpw@example.test');
  seed(user.id);
  const before = counts(user.id);

  const missing = await call(mod, authed(cookie, ip), {});
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'invalid_request');

  const wrong = await call(mod, authed(cookie, ip), { password: 'not-the-password' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, 'invalid_credentials');

  assert.deepEqual(counts(user.id), before, 'data untouched');
  assert.ok(auth.getCurrentUser({ headers: { cookie } }), 'session still valid');
  assert.equal(purgeCalls.length, 0);
});

test('password guesses are rate-limited (5 / 15 min per account)', async () => {
  const { auth, mod } = makeStack({ withRecovery: false });
  const { cookie, ip } = await signUp(auth, 'ratelimit@example.test');
  const codes = [];
  for (let i = 0; i < 6; i++) {
    codes.push((await call(mod, authed(cookie, ip), { password: 'nope-nope-nope' })).status);
  }
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
});

test('success: cascade, event_log anonymised, no session left, cookie expired, other users intact', async () => {
  const { auth, mod, recovery, dir, purgeCalls } = makeStack();
  const a = await signUp(auth, 'delete-me@example.test');
  const b = await signUp(auth, 'keep-me@example.test');
  seed(a.user.id);
  seed(b.user.id);
  const keepBefore = counts(b.user.id);
  const eventTotal = db.prepare('SELECT count(*) n FROM event_log').get().n;
  assert.equal(counts(a.user.id).sessions, 1);

  const r = await call(mod, authed(a.cookie, a.ip), { password: PASSWORD });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, deleted: true });

  // cascade
  assert.deepEqual(counts(a.user.id), {
    users: 0,
    partners: 0,
    samples: 0,
    analyze: 0,
    corpus: 0,
    dialects: 0,
    mappings: 0,
    sessions: 0,
    events: 0, // anonymised: no row points at the user any more
  });
  assert.equal(Users.getByEmail('delete-me@example.test'), undefined);

  // event_log: rows kept (aggregate counts), identity and IP gone
  assert.equal(db.prepare('SELECT count(*) n FROM event_log').get().n, eventTotal);
  const orphaned = db
    .prepare(`SELECT user_id, ip FROM event_log WHERE msg = 'GET /api/x' AND user_id IS NULL`)
    .all();
  assert.equal(orphaned.length, 3);
  assert.ok(orphaned.every((row) => row.ip === null));
  assert.equal(
    db.prepare(`SELECT count(*) n FROM event_log WHERE ip = ?`).get('203.0.113.' + a.user.id).n,
    0,
  );

  // another account is untouched
  assert.deepEqual(counts(b.user.id), keepBefore);
  assert.ok(auth.getCurrentUser({ headers: { cookie: b.cookie } }));

  // no session after deletion; cookie is expired in the response
  assert.equal(auth.getCurrentUser({ headers: { cookie: a.cookie } }), null);
  assert.match(String(r.headers['Set-Cookie']), /ot_session=; .*Max-Age=0/);
  const again = await call(mod, authed(a.cookie, a.ip), { password: PASSWORD });
  assert.equal(again.status, 401, 'old cookie is dead');

  // recovery journal records the revoked session (opaque ids only)
  assert.equal(recovery.stats().revocations, 1);
  const checkpoint = readFileSync(join(dir, 'checkpoint.json'), 'utf8');
  assert.doesNotMatch(checkpoint, /delete-me|@example|user_id|userId/);

  // ClickHouse purge requested for exactly this user
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(purgeCalls, [a.user.id]);
});

test('a failing ClickHouse purge never fails the request', async () => {
  const { auth, mod } = makeStack({
    withRecovery: false,
    purge: async () => {
      throw new Error('ClickHouse is down');
    },
  });
  const { user, cookie, ip } = await signUp(auth, 'ch-down@example.test');
  const r = await call(mod, authed(cookie, ip), { password: PASSWORD });
  assert.equal(r.status, 200);
  assert.equal(counts(user.id).users, 0);
  await new Promise((resolve) => setImmediate(resolve));
});

test('a synchronously throwing purge never fails the request', async () => {
  const { auth, mod } = makeStack({
    withRecovery: false,
    purge: () => {
      throw new Error('boom');
    },
  });
  const { user, cookie, ip } = await signUp(auth, 'ch-throw@example.test');
  const r = await call(mod, authed(cookie, ip), { password: PASSWORD });
  assert.equal(r.status, 200);
  assert.equal(counts(user.id).users, 0);
});

test('Users.deleteAccount is atomic: nothing changes when the user does not exist', () => {
  const eventTotal = db.prepare('SELECT count(*) n FROM event_log').get().n;
  const res = Users.deleteAccount(999999);
  assert.deepEqual(res, { deleted: false, eventLogAnonymised: 0 });
  assert.equal(db.prepare('SELECT count(*) n FROM event_log').get().n, eventTotal);
});

// ── lib/analytics-purge ──────────────────────────────────────────────

test('purgeUserAnalytics: lightweight DELETE on both user_id tables, flushing buffers first', async () => {
  const sql = [];
  const order = [];
  const r = await purgeUserAnalytics(42, {
    chExec: async (q) => {
      sql.push(q);
      order.push('delete');
    },
    isEnabled: () => true,
    flush: [() => order.push('flush-a'), () => order.push('flush-b')],
    settleMs: 0,
  });
  assert.deepEqual(sql, [
    'DELETE FROM analytics.ortbtools_events WHERE user_id = 42',
    'DELETE FROM analytics.ortbtools_product_events WHERE user_id = 42',
  ]);
  assert.deepEqual(TABLES, ['analytics.ortbtools_events', 'analytics.ortbtools_product_events']);
  assert.deepEqual(order, ['flush-a', 'flush-b', 'delete', 'delete']);
  assert.deepEqual(r.failed, []);
  assert.ok(!sql.some((q) => q.includes('validation_logs')), 'validation_logs has no user_id');
});

test('purgeUserAnalytics: ClickHouse errors are logged, not thrown; other table still tried', async () => {
  const warnings = [];
  const r = await purgeUserAnalytics(7, {
    chExec: async (q) => {
      if (q.includes('ortbtools_events')) throw new Error('ClickHouse 497: ACCESS_DENIED');
    },
    isEnabled: () => true,
    logger: { warn: (...a) => warnings.push(a) },
    settleMs: 0,
  });
  assert.deepEqual(r.failed, ['analytics.ortbtools_events']);
  assert.deepEqual(r.tables, ['analytics.ortbtools_product_events']);
  assert.equal(warnings.length, 1);
});

test('purgeUserAnalytics: disabled ClickHouse and bad ids are no-ops', async () => {
  let called = 0;
  const deps = {
    chExec: async () => {
      called++;
    },
    isEnabled: () => false,
    settleMs: 0,
  };
  assert.equal((await purgeUserAnalytics(5, deps)).attempted, false);
  for (const bad of [0, -1, 1.5, NaN, '5; DROP TABLE x', null, undefined]) {
    const r = await purgeUserAnalytics(/** @type {any} */ (bad), {
      ...deps,
      isEnabled: () => true,
    });
    assert.equal(r.attempted, false, String(bad));
  }
  assert.equal(called, 0);
});
