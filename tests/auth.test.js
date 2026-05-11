'use strict';

/**
 * Auth-module unit tests. The module is exercised in isolation against an
 * in-memory mock of the Users store — no HTTP, no real bcrypt rounds (we
 * don't go below 12 rounds though, so these tests aren't fast — about 1s
 * per password op).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Auth module needs Users; we use the real one over a temp DB so we exercise
// the actual query path.
const TMP = mkdtempSync(join(tmpdir(), 'spyglass-auth-test-'));
process.env.SPYGLASS_DATA_DIR = TMP;

const { Users } = require('../db');
const { createAuth } = require('../auth');

const auth = createAuth({ Users, logger: { info: () => {} } });

// Fake req/res surfaces just enough for the cookie helpers.
// Each call gets a distinct synthetic IP so the per-IP rate-limiter (5
// registrations/hour) doesn't trip across unrelated test cases.
let _ipCounter = 0;
function nextIp() {
  _ipCounter++;
  return `10.0.${Math.floor(_ipCounter / 254)}.${(_ipCounter % 254) + 1}`;
}

/**
 * @param {{ cookie?: string, ip?: string, ua?: string }} [opts]
 */
function fakeReq({ cookie, ip, ua = 'test-agent' } = {}) {
  if (ip == null) ip = nextIp();
  return {
    headers: {
      cookie: cookie || '',
      'user-agent': ua,
      'x-forwarded-for': ip,
    },
    socket: { remoteAddress: ip },
    connection: {},
  };
}
function fakeRes() {
  const r = {};
  r.headers = {};
  r.setHeader = (k, v) => {
    r.headers[k] = v;
  };
  r.getHeader = (k) => r.headers[k];
  return r;
}

function cookieFromSetCookie(setCookieHeader) {
  // Extract the spy_session=<token> piece for use as inbound Cookie header
  if (!setCookieHeader) return '';
  const first = String(setCookieHeader).split(';')[0];
  return first;
}

// ── register ─────────────────────────────────────────────────────────────

test('register: creates user, hashes password (not stored plaintext)', async () => {
  const user = await auth.register({ email: 'reg@example.com', password: 'longenough' }, fakeReq());
  assert.equal(user.email, 'reg@example.com');
  const row = Users.getByEmail('reg@example.com');
  assert.notEqual(row.password_hash, 'longenough');
  assert.ok(row.password_hash.startsWith('$2b$'));
});

test('register: rejects invalid email', async () => {
  await assert.rejects(
    auth.register({ email: 'not-an-email', password: 'longenough' }, fakeReq()),
    /Invalid email/,
  );
});

test('register: rejects weak password', async () => {
  await assert.rejects(
    auth.register({ email: 'weak@example.com', password: 'short' }, fakeReq()),
    /at least/,
  );
});

test('register: rejects duplicate email (case-insensitive)', async () => {
  await auth.register({ email: 'dup@example.com', password: 'longenough' }, fakeReq());
  await assert.rejects(
    auth.register({ email: 'DUP@example.com', password: 'longenough' }, fakeReq()),
    /already registered/,
  );
});

// ── login ────────────────────────────────────────────────────────────────

test('login: works with correct password', async () => {
  await auth.register({ email: 'log@example.com', password: 'correctpass' }, fakeReq());
  const user = await auth.login({ email: 'log@example.com', password: 'correctpass' }, fakeReq());
  assert.equal(user.email, 'log@example.com');
});

test('login: rejects wrong password', async () => {
  await auth.register({ email: 'wrong@example.com', password: 'correctpass' }, fakeReq());
  await assert.rejects(
    auth.login({ email: 'wrong@example.com', password: 'WRONGpass' }, fakeReq()),
    /Wrong email or password/,
  );
});

test('login: rejects non-existent email with same generic error', async () => {
  await assert.rejects(
    auth.login({ email: 'nobody@example.com', password: 'whatever12' }, fakeReq()),
    /Wrong email or password/,
  );
});

// ── sessions ─────────────────────────────────────────────────────────────

test('createSession + getCurrentUser round-trip', async () => {
  const user = await auth.register(
    { email: 'sess@example.com', password: 'longenough' },
    fakeReq(),
  );
  const res = fakeRes();
  auth.createSession(fakeReq(), res, user);
  const setCookie = res.getHeader('Set-Cookie');
  assert.match(setCookie, /spy_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  // Round-trip: include the cookie in a fresh request, getCurrentUser should resolve
  const next = fakeReq({ cookie: cookieFromSetCookie(setCookie) });
  const cur = auth.getCurrentUser(next);
  assert.ok(cur);
  assert.equal(cur.email, 'sess@example.com');
});

test('destroySession clears the cookie and invalidates the token', async () => {
  const user = await auth.register(
    { email: 'logout@example.com', password: 'longenough' },
    fakeReq(),
  );
  const res1 = fakeRes();
  auth.createSession(fakeReq(), res1, user);
  const cookie = cookieFromSetCookie(res1.getHeader('Set-Cookie'));

  const res2 = fakeRes();
  auth.destroySession(fakeReq({ cookie }), res2);

  // Token from first session no longer valid
  const next = fakeReq({ cookie });
  assert.equal(auth.getCurrentUser(next), null);
});

test('getCurrentUser returns null with no cookie', () => {
  assert.equal(auth.getCurrentUser(fakeReq()), null);
});

// ── rate limit (light touch) ─────────────────────────────────────────────

test('login: rate limits after 10 attempts from same IP', async () => {
  await auth.register(
    { email: 'rl@example.com', password: 'longenough' },
    fakeReq({ ip: '10.0.0.99' }),
  );
  // 10 wrong attempts to use up the bucket
  for (let i = 0; i < 10; i++) {
    try {
      await auth.login(
        { email: 'rl@example.com', password: 'WRONG' },
        fakeReq({ ip: '10.0.0.99' }),
      );
    } catch {
      /* expected */
    }
  }
  await assert.rejects(
    auth.login({ email: 'rl@example.com', password: 'longenough' }, fakeReq({ ip: '10.0.0.99' })),
    /Too many login/,
  );
});

// ── Phase 8: hashPassword / verifyPassword / invalidateUserSessions ─────

test('hashPassword + verifyPassword round-trip', async () => {
  const hash = await auth.hashPassword('correctpassword');
  assert.ok(hash.startsWith('$2b$'), 'should be a bcrypt hash');
  assert.equal(await auth.verifyPassword('correctpassword', hash), true);
  assert.equal(await auth.verifyPassword('wrongpassword', hash), false);
});

test('hashPassword: rejects short password', async () => {
  await assert.rejects(auth.hashPassword('short'), /at least/);
});

test('verifyPassword: returns false for non-string inputs (no throw)', async () => {
  assert.equal(await auth.verifyPassword(null, '$2b$xxxx'), false);
  assert.equal(await auth.verifyPassword('x', null), false);
});

test('invalidateUserSessions drops only the target user sessions', async () => {
  const ipA = nextIp();
  const ipB = nextIp();
  const userA = await auth.register(
    { email: 'invalA@example.com', password: 'longenough' },
    fakeReq({ ip: ipA }),
  );
  const userB = await auth.register(
    { email: 'invalB@example.com', password: 'longenough' },
    fakeReq({ ip: ipB }),
  );
  const resA = fakeRes();
  auth.createSession(fakeReq({ ip: ipA }), resA, userA);
  const cookieA = cookieFromSetCookie(resA.getHeader('Set-Cookie'));

  const resB = fakeRes();
  auth.createSession(fakeReq({ ip: ipB }), resB, userB);
  const cookieB = cookieFromSetCookie(resB.getHeader('Set-Cookie'));

  // Both sessions valid before
  assert.ok(auth.getCurrentUser(fakeReq({ cookie: cookieA })));
  assert.ok(auth.getCurrentUser(fakeReq({ cookie: cookieB })));

  // Drop only A's
  const removed = auth.invalidateUserSessions(userA.id);
  assert.ok(removed >= 1, 'should remove at least one session');

  assert.equal(auth.getCurrentUser(fakeReq({ cookie: cookieA })), null);
  assert.ok(auth.getCurrentUser(fakeReq({ cookie: cookieB })), 'B unaffected');
});

test('invalidateUserSessions throws when DB-side delete fails', () => {
  // Build a synthetic auth with a Sessions mock that throws on destroyForUser.
  // The pre-v0.25.0 behavior was to swallow this and log — leaving stale
  // sessions in DB that would resurrect on next container restart. Now the
  // throw propagates so the caller (handleResetPassword) refuses to mint a
  // new session.
  const boomSessions = {
    create() {},
    destroy() {},
    destroyForUser() {
      throw new Error('SQLITE_BUSY (synthetic)');
    },
    loadActive() {
      return [];
    },
    purgeExpired() {
      return 0;
    },
  };
  const isolatedAuth = require('../auth').createAuth({
    Users,
    Sessions: boomSessions,
    logger: { info: () => {}, error: () => {} },
  });
  assert.throws(
    () => isolatedAuth.invalidateUserSessions(999999),
    /SQLITE_BUSY \(synthetic\)/,
    'DB-side error must propagate, not be swallowed',
  );
});

test('checkForgotPasswordLimit: returns true under limit, false over', () => {
  const ip = '10.99.99.1';
  for (let i = 0; i < 5; i++) {
    assert.equal(auth.checkForgotPasswordLimit(fakeReq({ ip })), true, `attempt ${i + 1}`);
  }
  assert.equal(auth.checkForgotPasswordLimit(fakeReq({ ip })), false, '6th attempt blocked');
});

// ── teardown ─────────────────────────────────────────────────────────────

process.on('exit', () => {
  try {
    auth.shutdown();
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
