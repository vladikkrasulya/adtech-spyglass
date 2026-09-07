'use strict';

/**
 * Auth-module unit tests. The module is exercised in isolation against an
 * in-memory mock of the Users store — no HTTP, no real bcrypt rounds (we
 * don't go below 12 rounds though, so these tests aren't fast — about 1s
 * per password op).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');

// Auth module needs Users; we use the real one over a temp DB so we exercise
// the actual query path.
const TMP = mkdtempSync(join(tmpdir(), 'ortbtools-auth-test-'));
process.env.ORTBTOOLS_DATA_DIR = TMP;

const { Users } = require('../db');
const { createAuth } = require('../auth');
const { createAuthRoutesModule } = require('../modules/auth/handler');

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
  // Extract the ot_session=<token> piece for use as inbound Cookie header
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
  assert.match(setCookie, /ot_session=/);
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

test('invalidateUserSessions clears in-memory Map even when DB delete throws (P1-001 fix)', async () => {
  // v0.37.1 audit-finding P1-001: pre-fix, a DB throw skipped the Map
  // cleanup because the throw happened BEFORE the for-loop. A stolen
  // cookie that already resolved through the Map stayed live until
  // container restart. Post-fix: Map is cleared in a finally-shaped
  // path; DB error is rethrown afterward.
  //
  // Use the real Users store + a mock Sessions that throws on destroyForUser
  // so we exercise the auth module's in-memory `sessions` map without
  // touching the test DB's actual sessions table.
  const boomSessions = {
    create() {},
    destroy() {},
    destroyForUser() {
      throw new Error('SQLITE_BUSY (P1-001 synthetic)');
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
  // Register + create a session so the in-memory Map has an entry.
  const ipX = nextIp();
  const userX = await isolatedAuth.register(
    { email: 'p1001@example.com', password: 'longenough' },
    fakeReq({ ip: ipX }),
  );
  const resX = fakeRes();
  isolatedAuth.createSession(fakeReq({ ip: ipX }), resX, userX);
  const cookieX = cookieFromSetCookie(resX.getHeader('Set-Cookie'));
  // Confirm session live in Map
  assert.ok(isolatedAuth.getCurrentUser(fakeReq({ cookie: cookieX })));

  // Invalidate — DB throws but Map must still be cleared.
  assert.throws(
    () => isolatedAuth.invalidateUserSessions(userX.id),
    /SQLITE_BUSY \(P1-001 synthetic\)/,
  );
  // Map cleanup must have happened despite the DB throw.
  assert.equal(
    isolatedAuth.getCurrentUser(fakeReq({ cookie: cookieX })),
    null,
    'in-memory session must be gone even though DB call threw',
  );
});

test('checkForgotPasswordLimit: returns true under limit, false over', () => {
  const ip = '10.99.99.1';
  for (let i = 0; i < 5; i++) {
    assert.equal(auth.checkForgotPasswordLimit(fakeReq({ ip })), true, `attempt ${i + 1}`);
  }
  assert.equal(auth.checkForgotPasswordLimit(fakeReq({ ip })), false, '6th attempt blocked');
});

// ── Transactional email locale at each public entry point ────────────────

const { readLocaleCookie } = require('../lib/locale-routes');

/**
 * Invoke the real handler with synthetic user/email dependencies. Observe the
 * delivered locale and token purpose rather than the private resolver itself.
 *
 * @param {string} pathname
 * @param {{ preferred_locale?: string, cookie?: string, wireCookieDep?: boolean }} options
 */
async function runEmailRoute(pathname, { preferred_locale, cookie = '', wireCookieDep = true }) {
  const account = { id: 1, email: 'locale@example.test', preferred_locale };
  const sent = [];
  const tokens = [];
  let sessions = 0;
  let status;
  /** @type {{ success: boolean } | undefined} */
  let response;
  const deps = {
    auth: {
      register: async () => account,
      createSession: () => {
        sessions++;
      },
      getCurrentUser: () => account,
      checkVerifyEmailLimit: () => true,
      checkForgotPasswordLimit: () => true,
    },
    Users: { getByEmail: () => account },
    signToken: (claims) => {
      tokens.push(claims);
      return 'synthetic-token';
    },
    verifyToken: () => ({}),
    TokenError: function TokenError() {},
    sendVerifyEmail: async (user, token, base, locale) => {
      sent.push({ kind: 'verify', user, token, base, locale });
      return {};
    },
    sendResetEmail: async (user, token, base, locale) => {
      sent.push({ kind: 'reset', user, token, base, locale });
      return {};
    },
    notifyAdmin: () => {},
    notifyEscape: (s) => s,
    publicUser: (user) => user,
    publicEncryption: (state) => state,
    getPublicBaseUrl: () => 'https://example.test',
    setLocaleCookie: () => {},
    ...(wireCookieDep ? { readLocaleCookie } : {}),
    VERIFY_TOKEN_TTL: 900,
    RESET_TOKEN_TTL: 900,
  };
  const mod = createAuthRoutesModule(deps);
  const route = mod.routes.find((entry) => entry.path === pathname);
  assert.ok(route, pathname);
  const req = Object.assign(new EventEmitter(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
  });
  const res = {
    writeHead(code) {
      status = code;
    },
    setHeader() {},
    getHeader() {},
    end(body) {
      response = JSON.parse(body);
    },
  };
  const handled = route.handler(req, res);
  req.emit(
    'data',
    Buffer.from(JSON.stringify({ email: account.email, password: 'synthetic-password' })),
  );
  req.emit('end');
  await handled;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status, 200, pathname);
  assert.ok(response, 'handler returns JSON');
  assert.equal(response.success, true);
  assert.equal(sent.length, 1, 'exactly one transactional email');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].purpose, pathname.endsWith('forgot-password') ? 'reset' : 'verify');
  assert.equal(sent[0].kind, tokens[0].purpose);
  assert.equal(sent[0].user.email, account.email);
  assert.equal(sent[0].token, 'synthetic-token');
  assert.equal(sessions, pathname.endsWith('/register') ? 1 : 0);
  return sent[0].locale;
}

for (const pathname of [
  '/api/auth/register',
  '/api/auth/verify-email/request',
  '/api/auth/forgot-password',
]) {
  test(`email locale: ${pathname} preserves account → cookie → English precedence`, async (t) => {
    const cases = [
      {
        name: 'saved Ukrainian beats Russian cookie',
        preferred_locale: 'uk',
        cookie: 'kt-lang=ru',
        expected: 'uk',
      },
      {
        name: 'saved Russian beats English cookie',
        preferred_locale: 'ru',
        cookie: 'kt-lang=en',
        expected: 'ru',
      },
      {
        name: 'saved English beats Ukrainian cookie',
        preferred_locale: 'en',
        cookie: 'kt-lang=uk',
        expected: 'en',
      },
      { name: 'cookie-only Russian', cookie: 'other=1; kt-lang=ru', expected: 'ru' },
      { name: 'encoded supported cookie', cookie: 'kt-lang=%75%6b', expected: 'uk' },
      {
        name: 'unsupported preference uses cookie',
        preferred_locale: 'fr',
        cookie: 'kt-lang=uk',
        expected: 'uk',
      },
      {
        name: 'unsupported sources fall back',
        preferred_locale: 'fr',
        cookie: 'kt-lang=de',
        expected: 'en',
      },
      { name: 'missing sources fall back', expected: 'en' },
      { name: 'malformed cookie is ignored', cookie: 'kt-lang=%ZZ', expected: 'en' },
      {
        name: 'malformed cookie cannot override account',
        preferred_locale: 'ru',
        cookie: 'kt-lang=%ZZ',
        expected: 'ru',
      },
      {
        name: 'missing cookie dependency falls back',
        wireCookieDep: false,
        cookie: 'kt-lang=ru',
        expected: 'en',
      },
    ];
    for (const { name, expected, ...options } of cases) {
      await t.test(name, async () => {
        assert.equal(await runEmailRoute(pathname, options), expected);
      });
    }
  });
}

test('server wires the shared locale-cookie parser into auth email routes', () => {
  const src = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
  const call = src.match(/createAuthRoutesModule\(\{[\s\S]*?\}\)/);
  assert.ok(call, 'auth route factory wiring exists');
  assert.match(call[0], /\breadLocaleCookie\b/);
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
