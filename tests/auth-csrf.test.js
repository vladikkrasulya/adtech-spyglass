'use strict';

/**
 * Login CSRF guard on the state-changing /api/auth/* routes, and the truthful
 * verify-email answer when the mailer is in its dev-mode short-circuit
 * (audit 2026-10-29, P3 items 3 and 5).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const { crossSiteRejection } = require('../lib/http');
const { createAuthRoutesModule } = require('../modules/auth/handler');

const JSON_CT = 'application/json';
const BASE = 'https://ortbtools.test';

// ── crossSiteRejection (pure) ───────────────────────────────────────────────

test('crossSiteRejection: plain curl / server clients carry no browser signal and pass', () => {
  assert.equal(crossSiteRejection({ headers: {} }), null);
  assert.equal(
    crossSiteRejection({ headers: { 'content-type': JSON_CT, 'content-length': '9' } }),
    null,
  );
  assert.equal(crossSiteRejection({}), null);
});

test('crossSiteRejection: Sec-Fetch-Site must be same-origin (or none)', () => {
  for (const site of ['same-origin', 'none', 'SAME-ORIGIN']) {
    assert.equal(crossSiteRejection({ headers: { 'sec-fetch-site': site } }), null, site);
  }
  for (const site of ['cross-site', 'same-site']) {
    const r = crossSiteRejection({ headers: { 'sec-fetch-site': site } });
    assert.equal(r && r.status, 403, site);
    assert.equal(r && r.code, 'cross_site_request');
  }
});

test('crossSiteRejection: Origin must match Host, X-Forwarded-Host or the public base URL', () => {
  const ok = (headers, opts) => crossSiteRejection({ headers }, opts) === null;
  assert.ok(ok({ origin: 'https://ortbtools.com', host: 'ortbtools.com' }));
  assert.ok(ok({ origin: 'http://127.0.0.1:8090', host: '127.0.0.1:8090' }));
  assert.ok(
    ok(
      { origin: 'https://ortbtools.com', host: 'localhost:3000' },
      { publicBaseUrl: 'https://ortbtools.com' },
    ),
  );
  assert.ok(ok({ origin: 'https://ortbtools.com:443', host: 'ortbtools.com' }));
  assert.ok(
    ok({ origin: 'https://ortbtools.com', host: 'x:1', 'x-forwarded-host': 'ortbtools.com' }),
  );
  assert.ok(!ok({ origin: 'https://evil.example', host: 'ortbtools.com' }));
  assert.ok(!ok({ origin: 'https://ortbtools.com.evil.example', host: 'ortbtools.com' }));
  assert.ok(
    !ok({ origin: 'http://ortbtools.com:8080', host: 'ortbtools.com' }),
    'port is part of the origin',
  );
  assert.ok(!ok({ origin: 'null', host: 'ortbtools.com' }), 'sandboxed / redirected form posts');
  assert.ok(!ok({ origin: 'not a url', host: 'ortbtools.com' }));
});

test('crossSiteRejection: a request with a body must be application/json', () => {
  const withBody = (ct) => ({
    headers: { 'content-length': '20', ...(ct ? { 'content-type': ct } : {}) },
  });
  for (const ct of [JSON_CT, 'application/json; charset=utf-8', 'Application/JSON']) {
    assert.equal(crossSiteRejection(withBody(ct)), null, ct);
  }
  for (const ct of [
    'text/plain',
    'text/plain;charset=UTF-8',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    '',
  ]) {
    const r = crossSiteRejection(withBody(ct));
    assert.equal(r && r.status, 415, ct);
    assert.equal(r && r.code, 'unsupported_media_type');
  }
  const chunked = crossSiteRejection({
    headers: { 'transfer-encoding': 'chunked', 'content-type': 'text/plain' },
  });
  assert.equal(chunked && chunked.status, 415);
  // A body-less POST (logout, verify-email/request) needs no content type.
  assert.equal(crossSiteRejection({ headers: { 'content-length': '0' } }), null);
  assert.equal(crossSiteRejection({ headers: {} }), null);
});

// ── the auth routes ─────────────────────────────────────────────────────────

function makeModule(overrides = {}) {
  const calls = { login: 0, register: 0, logout: 0, forgot: 0, sent: 0 };
  const user = { id: 7, email: 'csrf@example.test' };
  const deps = {
    auth: {
      login: async () => {
        calls.login++;
        return user;
      },
      register: async () => {
        calls.register++;
        return user;
      },
      createSession: () => {},
      destroySession: () => {
        calls.logout++;
      },
      getCurrentUser: () => user,
      checkVerifyEmailLimit: () => true,
      checkForgotPasswordLimit: () => {
        calls.forgot++;
        return true;
      },
    },
    Users: { getByEmail: () => null, getCryptoState: () => null },
    signToken: () => 'tok',
    verifyToken: () => ({}),
    TokenError: function TokenError() {},
    sendVerifyEmail: async () => {
      calls.sent++;
      return { id: 'real' };
    },
    sendResetEmail: async () => ({}),
    notifyAdmin: () => {},
    notifyEscape: (s) => s,
    publicUser: (u) => u,
    publicEncryption: (s) => s,
    getPublicBaseUrl: () => BASE,
    setLocaleCookie: () => {},
    VERIFY_TOKEN_TTL: 900,
    RESET_TOKEN_TTL: 900,
    ...overrides,
  };
  return { mod: createAuthRoutesModule(deps), calls };
}

function post(mod, path, headers, body) {
  const route = mod.routes.find((r) => r.method === 'POST' && r.path === path);
  assert.ok(route, path);
  /** @type {any} */
  const req = new Readable({ read() {} });
  const payload = body === undefined ? '' : JSON.stringify(body);
  req.method = 'POST';
  req.headers = { ...(payload ? { 'content-length': String(payload.length) } : {}), ...headers };
  if (payload) req.push(payload);
  req.push(null);
  return new Promise((resolve) => {
    const res = {
      status: 0,
      headers: {},
      setHeader() {},
      getHeader() {},
      writeHead(code) {
        this.status = code;
      },
      end(b) {
        resolve({ status: this.status, body: b ? JSON.parse(b) : null });
      },
    };
    route.handler(req, res);
  });
}

const CREDS = { email: 'csrf@example.test', password: 'synthetic-password' };

test('login: text/plain cross-site form post is refused before auth runs (login CSRF)', async () => {
  const { mod, calls } = makeModule();
  // The exact probe from the audit: Origin evil + text/plain.
  const r = await post(
    mod,
    '/api/auth/login',
    { origin: 'https://evil.example', host: 'ortbtools.test', 'content-type': 'text/plain' },
    CREDS,
  );
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'cross_site_request');
  // Even without Origin (some form posts omit it), text/plain is not JSON.
  const noOrigin = await post(
    mod,
    '/api/auth/login',
    { 'content-type': 'text/plain;charset=UTF-8' },
    CREDS,
  );
  assert.equal(noOrigin.status, 415);
  assert.equal(noOrigin.body.code, 'unsupported_media_type');
  // A modern browser's cross-site signal alone is enough.
  const sfs = await post(
    mod,
    '/api/auth/login',
    { 'sec-fetch-site': 'cross-site', 'content-type': JSON_CT },
    CREDS,
  );
  assert.equal(sfs.status, 403);
  assert.equal(calls.login, 0, 'no credential check ran, no session was created');
});

test('every state-changing auth POST is guarded; GET routes are not', async () => {
  const { mod } = makeModule();
  const posts = mod.routes.filter((r) => r.method === 'POST');
  assert.equal(posts.length, 9);
  for (const route of posts) {
    const r = await post(mod, route.path, { 'sec-fetch-site': 'cross-site' }, {});
    assert.equal(r.status, 403, route.path);
    assert.equal(r.body.code, 'cross_site_request', route.path);
  }
  const confirm = mod.routes.find(
    (r) => r.method === 'GET' && r.path === '/api/auth/verify-email/confirm',
  );
  assert.ok(confirm, 'emailed link stays a plain GET');
});

test("the app's own forms still work: same-origin JSON login, register, logout", async () => {
  const { mod, calls } = makeModule();
  const same = {
    origin: BASE,
    host: 'ortbtools.test',
    'sec-fetch-site': 'same-origin',
    'content-type': JSON_CT,
  };
  const login = await post(mod, '/api/auth/login', same, CREDS);
  assert.equal(login.status, 200);
  assert.equal(login.body.success, true);
  const reg = await post(mod, '/api/auth/register', same, CREDS);
  assert.equal(reg.status, 200);
  // fetch('/api/auth/logout', { method: 'POST' }) sends no body and no content type.
  const logout = await post(mod, '/api/auth/logout', {
    origin: BASE,
    host: 'ortbtools.test',
    'sec-fetch-site': 'same-origin',
  });
  assert.equal(logout.status, 200);
  assert.deepEqual([calls.login, calls.register, calls.logout], [1, 1, 1]);
});

test('non-browser JSON clients (no Origin / Sec-Fetch-Site) keep working', async () => {
  const { mod, calls } = makeModule();
  const r = await post(mod, '/api/auth/login', { 'content-type': JSON_CT }, CREDS);
  assert.equal(r.status, 200);
  assert.equal(calls.login, 1);
});

// ── verify-email: do not claim delivery in dev-mode ─────────────────────────

test('verify-email/request: dev-mode short-circuit is reported as NOT sent', async () => {
  const { mod } = makeModule({
    sendVerifyEmail: async () => ({ dev: true, link: 'http://localhost/?verify=tok' }),
  });
  const r = await post(mod, '/api/auth/verify-email/request', { 'content-type': JSON_CT });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.email_sent, false, 'no mail left the server');
  assert.ok(r.body.email_error, 'user gets the generic "could not send" message');
  assert.doesNotMatch(JSON.stringify(r.body), /localhost|tok|dev/i, 'dev link must not leak');
});

test('verify-email/request: a real delivery still reports email_sent: true', async () => {
  const { mod, calls } = makeModule();
  const r = await post(mod, '/api/auth/verify-email/request', { 'content-type': JSON_CT });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, email_sent: true });
  assert.equal(calls.sent, 1);
});
