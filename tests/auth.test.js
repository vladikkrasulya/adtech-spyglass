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

// ── resolveEmailLocale (feature 015: trilingual output parity) ─────────────
//
// modules/auth/handler.js's resolveEmailLocale() picks the language for a
// transactional email in this priority order: the account's saved
// preferred_locale, then the request's `kt-lang` cookie (read through the
// injected `readLocaleCookie` dependency), then 'en'. It is exercised here
// through the real /api/auth/forgot-password route rather than called
// directly, because the priority order is only meaningful in the context
// the route actually builds it in (a looked-up target user + the inbound
// request), and because the DI-missing case below only means anything when
// driven through createAuthRoutesModule's own guard.
//
// This mirrors a throwaway proof another session ran against the real
// server.js `readLocaleCookie` (kept for reference, not part of the suite,
// at the session's scratchpad path) — the stub below reimplements that
// same `kt-lang` contract (decode, restrict to en/uk/ru, else null) rather
// than importing behavior out of server.js, so this suite does not depend
// on server.js's internal source shape. The wiring itself — that server.js
// actually passes its real readLocaleCookie into createAuthRoutesModule —
// is what the source-text guard test below checks instead.

/** Mirrors server.js's readLocaleCookie() contract for `kt-lang`. */
function stubReadLocaleCookie(req) {
  const cookie = (req.headers && req.headers.cookie) || '';
  for (const part of cookie.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === 'kt-lang') {
      const decoded = decodeURIComponent(v || '').trim();
      if (decoded === 'en' || decoded === 'uk' || decoded === 'ru') return decoded;
    }
  }
  return null;
}

/**
 * Drive POST /api/auth/forgot-password through createAuthRoutesModule with a
 * full, minimal dep set (the handler destructures the whole deps object, so
 * a stub missing an unrelated key can fail somewhere other than what the
 * test targets) and report the locale sendResetEmail was called with.
 *
 * @param {{ wireCookieDep: boolean, cookie?: string, preferred_locale?: string }} opts
 * @returns {Promise<string>} the locale seen by sendResetEmail, or the
 *   sentinel 'NO-EMAIL-SENT' if it was never called.
 */
function runForgotPassword({ wireCookieDep, cookie, preferred_locale }) {
  return new Promise((resolve) => {
    let seenLocale = 'NO-EMAIL-SENT';
    const deps = {
      auth: { checkForgotPasswordLimit: () => true },
      Users: { getByEmail: () => ({ id: 1, email: 'u@x.com', preferred_locale }) },
      signToken: () => 'tok',
      verifyToken: () => ({}),
      TokenError: function TokenError() {},
      sendVerifyEmail: async () => ({}),
      sendResetEmail: async (_user, _token, _base, locale) => {
        seenLocale = String(locale);
        return {};
      },
      notifyAdmin: () => {},
      notifyEscape: (s) => s,
      publicUser: (u) => u,
      publicEncryption: (c) => c,
      getPublicBaseUrl: () => 'https://example.com',
      setLocaleCookie: () => {},
      VERIFY_TOKEN_TTL: 900,
      RESET_TOKEN_TTL: 900,
    };
    if (wireCookieDep) deps.readLocaleCookie = stubReadLocaleCookie;

    // The `wireCookieDep: false` case above deliberately omits
    // readLocaleCookie — that omission IS the test (see
    // 'missing readLocaleCookie dependency falls back to en' below).
    // modules/auth/handler.js's own JSDoc marks the dep as required, but its
    // implementation and doc comment both say it degrades gracefully when
    // absent ("If an older server.js wiring omits it, resolveEmailLocale()
    // degrades to preferred_locale -> 'en' instead of throwing" — see
    // modules/auth/handler.js around the `readLocaleCookie` destructure).
    // So this is a source-side JSDoc/runtime mismatch, not a stub bug; the
    // fix here is a narrow cast at the call site rather than always
    // supplying the dep, which would silently defeat the fallback test.
    const mod = createAuthRoutesModule(
      // Double cast: the two shapes don't structurally overlap (`deps`'s
      // inferred type has no `readLocaleCookie` slot at all in the
      // wireCookieDep:false branch), so TS wants the `unknown` bridge for
      // what is, at runtime, a deliberately-partial deps object.
      /** @type {Parameters<typeof createAuthRoutesModule>[0]} */ (/** @type {unknown} */ (deps)),
    );
    const route = mod.routes.find((r) => r.path === '/api/auth/forgot-password');

    // Fake IncomingMessage: an EventEmitter (for the 'data'/'end' events
    // readJson listens on) plus the two fields the route reads directly.
    const req = /** @type {EventEmitter & { method: string, headers: Record<string, string> }} */ (
      new EventEmitter()
    );
    req.method = 'POST';
    req.headers = { 'content-type': 'application/json', cookie: cookie || '' };
    const res = { writeHead() {}, setHeader() {}, getHeader() {}, end() {} };

    const handled = route.handler(req, res);
    req.emit('data', Buffer.from(JSON.stringify({ email: 'u@x.com' })));
    req.emit('end');

    // TRAP: handleForgotPassword does not await sendResetEmail — it fires
    // the send via `.catch()` and returns as soon as sendJson(200) is
    // queued. Reading `seenLocale` right after `handled` resolves races the
    // stub's own assignment; a setImmediate lets that microtask flush first.
    Promise.resolve(handled).then(() => setImmediate(() => resolve(seenLocale)));
  });
}

test('resolveEmailLocale: kt-lang cookie is used when no saved preference exists', async () => {
  const locale = await runForgotPassword({ wireCookieDep: true, cookie: 'kt-lang=ru; other=1' });
  assert.equal(locale, 'ru');
});

test('resolveEmailLocale: missing readLocaleCookie dependency falls back to en', () => {
  // This is the important case: it is the ONLY one of the four that goes
  // red if server.js's DI wiring for readLocaleCookie silently disappears.
  // Every other case here stays green even without that wiring, because
  // none of them depend on the cookie at all (a saved preferred_locale
  // wins first) or the cookie is absent anyway.
  return runForgotPassword({ wireCookieDep: false, cookie: 'kt-lang=ru; other=1' }).then((locale) =>
    assert.equal(locale, 'en'),
  );
});

test('resolveEmailLocale: a saved preferred_locale outranks the cookie', async () => {
  const locale = await runForgotPassword({
    wireCookieDep: true,
    cookie: 'kt-lang=ru; other=1',
    preferred_locale: 'uk',
  });
  assert.equal(locale, 'uk');
});

test('resolveEmailLocale: no cookie and no saved preference defaults to en', async () => {
  const locale = await runForgotPassword({ wireCookieDep: true, cookie: '' });
  assert.equal(locale, 'en');
});

test('server.js wires readLocaleCookie into createAuthRoutesModule (DI guard, source-text)', () => {
  // Per this repo's existing idiom (tests/docs-truth.test.js,
  // tests/spec-kit-contract.test.js): assert over source text rather than
  // refactor server.js to make the wiring independently testable. This is
  // the cheap guard against the one dependency the case above proves is
  // load-bearing quietly being dropped from the deps literal.
  const src = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
  const call = src.match(/createAuthRoutesModule\(\{[\s\S]*?\}\)/);
  assert.ok(call, 'could not find the createAuthRoutesModule({ ... }) call in server.js');
  assert.match(
    call[0],
    /\breadLocaleCookie\b/,
    'server.js must pass readLocaleCookie into createAuthRoutesModule — without it, ' +
      'resolveEmailLocale() silently falls back to "en" for every cookie-only case',
  );
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
