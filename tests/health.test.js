'use strict';

/**
 * tests/health.test.js — modules/health/handler.js
 *
 * Anonymous callers get liveness only; authed callers get the operational
 * tier. Build SHA is in the anonymous tier so monitoring tools can pin
 * the deployed commit without authentication.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHealthModule } = require('../modules/health/handler');

function fakeRes() {
  const r = {
    /** @type {any} */ statusCode: 0,
    /** @type {any} */ body: null,
    /** @type {(s: number) => any} */ writeHead(s) {
      this.statusCode = s;
      return this;
    },
    /** @type {(s?: string|Buffer) => any} */ end(s) {
      if (s != null) this.body = s;
      return this;
    },
  };
  return r;
}

function fakeSendJson(res, status, body) {
  res.statusCode = status;
  res.body = body;
}

const fakeDb = { prepare: () => ({ get: () => ({ 1: 1 }) }) };

test('health: db OK → 200 with build.sha present', () => {
  const mod = createHealthModule({
    db: fakeDb,
    auth: { getCurrentUser: () => null },
    Users: { count: () => 0 },
    sendJson: fakeSendJson,
  });
  const handler = mod.routes[0].handler;
  const res = fakeRes();
  handler({ headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.checks.db, true);
  assert.ok(res.body.build, 'response should include build object');
  assert.equal(typeof res.body.build.sha, 'string', 'build.sha is a string');
  assert.ok(res.body.build.sha.length > 0, 'build.sha non-empty');
});

test('health: db failure → 503 with build.sha still present', () => {
  const mod = createHealthModule({
    db: {
      prepare: () => {
        throw new Error('boom');
      },
    },
    auth: { getCurrentUser: () => null },
    Users: { count: () => 0 },
    sendJson: fakeSendJson,
  });
  const handler = mod.routes[0].handler;
  const res = fakeRes();
  handler({ headers: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, false);
  assert.equal(res.body.status, 'degraded');
  assert.equal(res.body.checks.db, false);
  assert.ok(typeof res.body.build.sha === 'string');
});

test('health: anonymous does not see pid/node/users/sessions', () => {
  const mod = createHealthModule({
    db: fakeDb,
    auth: { getCurrentUser: () => null },
    Users: { count: () => 42 },
    sendJson: fakeSendJson,
  });
  const handler = mod.routes[0].handler;
  const res = fakeRes();
  handler({ headers: {} }, res);
  assert.equal(res.body.sessions, undefined);
  assert.equal(res.body.users, undefined);
  assert.equal(res.body.pid, undefined);
  assert.equal(res.body.node, undefined);
});

test('health: authed sees the operational tier', () => {
  const mod = createHealthModule({
    db: fakeDb,
    auth: {
      getCurrentUser: () => ({ id: 1, email: 'u@example.com' }),
      activeSessionCount: () => 3,
    },
    Users: { count: () => 7 },
    sendJson: fakeSendJson,
  });
  const handler = mod.routes[0].handler;
  const res = fakeRes();
  handler({ headers: {} }, res);
  assert.equal(res.body.sessions, 3);
  assert.equal(res.body.users, 7);
  assert.equal(typeof res.body.uptime, 'number');
  assert.equal(typeof res.body.pid, 'number');
  assert.equal(typeof res.body.node, 'string');
  // build still present in authed tier too
  assert.equal(typeof res.body.build.sha, 'string');
});

test('health: BUILD_SHA env value flows through to response', () => {
  const original = process.env.BUILD_SHA;
  try {
    process.env.BUILD_SHA = 'cafef00d';
    // Re-create module to pick up the new env (constant captured at construct).
    const mod = createHealthModule({
      db: fakeDb,
      auth: { getCurrentUser: () => null },
      Users: { count: () => 0 },
      sendJson: fakeSendJson,
    });
    const handler = mod.routes[0].handler;
    const res = fakeRes();
    handler({ headers: {} }, res);
    assert.equal(res.body.build.sha, 'cafef00d');
  } finally {
    if (original === undefined) delete process.env.BUILD_SHA;
    else process.env.BUILD_SHA = original;
  }
});
