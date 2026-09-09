'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const bcrypt = require('bcrypt');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-reset-recovery-'));
process.env.ORTBTOOLS_DATA_DIR = temporary;
process.env.ORTBTOOLS_ANALYTICS_DISABLED = '1';
const { db, Users, Sessions } = require('../db');
const { createAuth } = require('../auth');
const { createSessionRecovery } = require('../lib/session-recovery');
const { createAuthRoutesModule } = require('../modules/auth/handler');
const originalHash = bcrypt.hashSync('synthetic-original', 12);
after(() => {
  db.close();
  fs.rmSync(temporary, { recursive: true, force: true });
});

function response() {
  return {
    headers: {},
    status: 0,
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    writeHead(status, headers) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    end(body) {
      this.body = JSON.parse(body);
    },
  };
}
function request(cookie = '') {
  return { headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } };
}
function setup(t, name) {
  const directory = path.join(temporary, name);
  const store = {
    ...Sessions,
    destroyForUser() {
      throw new Error('synthetic defensive deletion fault');
    },
  };
  let recovery = createSessionRecovery({ directory, store });
  const a = Users.create({ email: name + '-a@example.test', password_hash: originalHash });
  const b = Users.create({ email: name + '-b@example.test', password_hash: originalHash });
  const logger = { info() {}, error() {} };
  let auth = createAuth({ Users, Sessions: store, recovery, logger });
  t.after(() => auth.shutdown());
  const mint = (user) => {
    const out = response();
    auth.createSession(request(), out, auth.sessionUser(user.id));
    return out.headers['Set-Cookie'].split(';')[0];
  };
  const oldA = mint(a),
    oldB = mint(b);
  const module = createAuthRoutesModule({
    auth,
    Users,
    verifyToken: () => ({ user_id: a.id, email: a.email }),
    TokenError: Error,
    signToken() {},
    sendVerifyEmail() {},
    sendResetEmail() {},
    notifyAdmin() {},
    notifyEscape: String,
    publicUser: (user) => user,
    publicEncryption: (state) => state,
    getPublicBaseUrl: () => 'http://example.test',
    setLocaleCookie() {},
    VERIFY_TOKEN_TTL: 1,
    RESET_TOKEN_TTL: 1,
  });
  return {
    a,
    b,
    oldA,
    oldB,
    auth,
    authenticated: (cookie) => !!auth.getCurrentUser(request(cookie)),
    async reset(mode) {
      const body = {
        mode,
        token: 'synthetic-reset-proof',
        oldPassword: 'synthetic-original',
        newPassword: 'synthetic-replacement',
        new_kdf_salt: 'synthetic-salt',
        new_dek_wrapped: 'synthetic-wrap',
        new_dek_iv: 'synthetic-iv',
      };
      const req = Object.assign(Readable.from([JSON.stringify(body)]), request());
      const out = response();
      await module.routes
        .find((route) => route.path === '/api/auth/reset-password')
        .handler(req, out);
      return out;
    },
    restart() {
      auth.beginShutdown();
      assert.equal(auth.shutdown({ clean: true }), true);
      recovery = createSessionRecovery({ directory, store });
      auth = createAuth({ Users, Sessions: store, recovery, logger });
    },
  };
}

test('registration/login public shapes and cookies remain stable with keyed persistence', async (t) => {
  const h = setup(t, 'public-shape');
  const credentials = { email: 'new-public@example.test', password: 'synthetic-original' };
  const registered = await h.auth.register(credentials, request());
  assert.deepEqual(Object.keys(registered).sort(), [
    'created_at',
    'email',
    'email_verified_at',
    'id',
    'preferred_locale',
  ]);
  const registeredResponse = response();
  h.auth.createSession(request(), registeredResponse, registered);
  assert.match(
    registeredResponse.headers['Set-Cookie'],
    /^ot_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/,
  );
  const signedIn = await h.auth.login(credentials, request());
  assert.deepEqual(Object.keys(signedIn).sort(), ['created_at', 'email', 'id']);
  const loginResponse = response();
  h.auth.createSession(request(), loginResponse, signedIn);
  const cookie = loginResponse.headers['Set-Cookie'].split(';')[0];
  assert.equal(h.authenticated(cookie), true);
  h.auth.destroySession(request(cookie), response());
  assert.equal(h.authenticated(cookie), false);
  h.restart();
  assert.equal(h.authenticated(cookie), false);
  assert.equal(h.authenticated(registeredResponse.headers['Set-Cookie'].split(';')[0]), true);
});

for (const mode of ['rotate', 'recover', 'wipe']) {
  test(
    'reset ' + mode + ' keeps atomic DB work and journaled revocation through restart',
    async (t) => {
      const h = setup(t, mode);
      const out = await h.reset(mode);
      assert.equal(out.status, 200);
      assert.equal(out.body.success, true);
      assert.notEqual(Users.getByEmail(h.a.email).password_hash, originalHash);
      const fresh = out.headers['Set-Cookie'].split(';')[0];
      assert.equal(h.authenticated(h.oldA), false);
      assert.equal(h.authenticated(h.oldB), true);
      assert.equal(h.authenticated(fresh), true);
      h.restart();
      assert.equal(h.authenticated(h.oldA), false);
      assert.equal(h.authenticated(h.oldB), true);
      assert.equal(h.authenticated(fresh), true);
      if (mode === 'wipe') assert.equal(Users.getCryptoState(h.a.id).kdf_salt, null);
    },
  );
}

test('a rotate proof cannot overwrite a password changed while hashing was in flight', async (t) => {
  const h = setup(t, 'rotate-race');
  h.auth.hashPassword = async () => {
    Users.updatePasswordAndCrypto(h.a.id, 'concurrent-reset-hash', {
      kdf_salt: 'x',
      dek_wrapped: 'x',
      dek_iv: 'x',
    });
    h.auth.invalidateUserSessions(h.a.id);
    return 'stale-reset-hash';
  };
  const out = await h.reset('rotate');
  assert.equal(out.status, 401);
  assert.equal(out.body.code, 'session_state_changed');
  assert.equal(Users.getByEmail(h.a.email).password_hash, 'concurrent-reset-hash');
  assert.equal(out.headers['Set-Cookie'], undefined);
  assert.equal(h.authenticated(h.oldA), false);
  assert.equal(h.authenticated(h.oldB), true);
});

for (const mode of ['rotate', 'recover', 'wipe']) {
  test(
    'shutdown fences reset ' + mode + ' before its awaited hash can mutate the account',
    async (t) => {
      const h = setup(t, 'drain-' + mode);
      h.auth.hashPassword = async () => {
        h.auth.beginShutdown();
        return 'must-not-be-written';
      };
      const out = await h.reset(mode);
      assert.equal(out.status, 503);
      assert.equal(out.body.code, 'auth_unavailable');
      assert.equal(Users.getByEmail(h.a.email).password_hash, originalHash);
      assert.equal(out.headers['Set-Cookie'], undefined);
    },
  );
}
