'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const { createSessionRecovery, MAX_BYTES } = require('../lib/session-recovery');
const { createAuth } = require('../auth');

function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-recovery-unit-'));
  const leases = [];
  let rows = [];
  let resets = 0;
  const store = {
    pruneExpired() {},
    loadActive: () => rows.slice(),
    destroyAll() {
      rows = [];
      resets++;
    },
    create(row) {
      rows.push(row);
    },
    destroy(id) {
      rows = rows.filter((row) => row.token !== id);
    },
    destroyForUser(id) {
      rows = rows.filter((row) => row.userId !== id);
    },
  };
  t.after(() => {
    for (const lease of leases) lease.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    store,
    file: path.join(directory, 'checkpoint.json'),
    resets: () => resets,
    open(options = {}) {
      const lease = createSessionRecovery({ directory, store, ...options });
      leases.push(lease);
      return lease;
    },
  };
}
const raw = 'a'.repeat(64);
const req = (cookie = '') => ({ headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } });
const res = () => ({
  headers: {},
  setHeader(key, value) {
    this.headers[key] = value;
  },
});

/** @type {Array<[string, (state:any)=>string]>} */
const corruptionCases = [
  ['malformed JSON', () => '{'],
  ['unknown version', (s) => JSON.stringify({ ...s, version: 99 })],
  ['missing key', (s) => JSON.stringify({ ...s, key: undefined })],
  ['invalid clean marker', (s) => JSON.stringify({ ...s, clean: 'true' })],
  [
    'invalid intent',
    (s) => JSON.stringify({ ...s, revocations: [{ id: 'invalid', expiresAt: 1 }] }),
  ],
];
for (const [name, corrupt] of corruptionCases) {
  test('untrusted checkpoint cannot hydrate stored identities: ' + name, (t) => {
    const h = harness(t);
    const first = h.open();
    const identity = first.lookup(raw);
    h.store.create({ token: identity, userId: 1, expiresAt: Date.now() + 60_000 });
    assert.equal(first.close({ clean: true }), true);
    const before = JSON.parse(fs.readFileSync(h.file, 'utf8'));
    fs.writeFileSync(h.file, corrupt(before));
    const second = h.open();
    assert.equal(second.activeRows.length, 0);
    assert.equal(h.resets(), 2);
    assert.notEqual(second.lookup(raw), identity, 'uncertain recovery rotates the lookup key');
  });
}

test('oversized checkpoint is rejected before reading or JSON parsing it', (t) => {
  const h = harness(t);
  const first = h.open();
  first.close({ clean: true });
  fs.writeFileSync(h.file, Buffer.alloc(MAX_BYTES + 1, 32));
  let reads = 0;
  const io = {
    ...fs,
    readFileSync() {
      reads++;
      throw new Error('must not read oversized file');
    },
  };
  const second = h.open({ io });
  assert.equal(reads, 0);
  assert.equal(second.activeRows.length, 0);
  assert.equal(h.resets(), 2);
});

test('a read failure or missing checkpoint cannot preserve old session rows', (t) => {
  const h = harness(t);
  const first = h.open();
  h.store.create({ token: first.lookup(raw), userId: 1, expiresAt: Date.now() + 60_000 });
  first.close({ clean: true });
  const second = h.open({
    io: {
      ...fs,
      readFileSync() {
        throw new Error('synthetic read failure');
      },
    },
  });
  assert.equal(second.activeRows.length, 0);
  second.close({ clean: true });
  fs.unlinkSync(h.file);
  assert.equal(h.open().activeRows.length, 0);
  assert.equal(h.resets(), 3);
});

test('restored legacy raw-cookie rows invalidate even a previously trusted checkpoint', (t) => {
  const h = harness(t);
  const first = h.open();
  first.close({ clean: true });
  h.store.create({ token: raw, userId: 1, expiresAt: Date.now() + 60_000 });
  assert.equal(h.open().activeRows.length, 0);
  assert.equal(h.store.loadActive().length, 0);
});

test('private keyed identities cannot authenticate through the legacy raw-cookie hydration path', (t) => {
  const h = harness(t);
  const first = h.open();
  const identity = first.lookup(raw);
  const state = JSON.parse(fs.readFileSync(h.file, 'utf8'));
  assert.equal(
    identity,
    'sr1:' + crypto.createHmac('sha256', Buffer.from(state.key, 'hex')).update(raw).digest('hex'),
  );
  assert.notEqual(identity, 'sr1:' + crypto.createHash('sha256').update(raw).digest('hex'));
  assert.equal(fs.statSync(h.directory).mode & 0o777, 0o700);
  for (const name of ['checkpoint.json', 'owner.sqlite'])
    assert.equal(fs.statSync(path.join(h.directory, name)).mode & 0o777, 0o600);
  h.store.create({ token: identity, userId: 1, expiresAt: Date.now() + 60_000 });
  first.close({ clean: true });
  // The no-recovery adapter retains the earlier image's DB hydration and
  // raw-cookie Map lookup. It must not recognize a new cookie after rollback.
  const legacy = createAuth({
    Users: { get: () => ({ id: 1 }) },
    Sessions: h.store,
    logger: { info() {}, error() {} },
  });
  t.after(() => legacy.shutdown());
  assert.equal(legacy.getCurrentUser(req('ot_session=' + raw)), null);
});

test('a failed session-store read cannot return an owner or hydrate a partial account set', (t) => {
  const h = harness(t);
  assert.throws(
    () =>
      h.open({
        store: {
          ...h.store,
          loadActive() {
            throw new Error('private DB details');
          },
        },
      }),
    /session_recovery_unavailable/,
  );
  assert.equal(h.open().activeRows.length, 0, 'the failed reader releases ownership');
});

test('unexpected journal exceptions still clear hot auth and prevent clean certification', (t) => {
  const h = harness(t);
  const recovery = h.open();
  const Users = {
    get: () => ({ id: 1, email: 'fault@example.test' }),
    getByEmail: () => ({ password_hash: 'synthetic' }),
  };
  const auth = createAuth({
    Users,
    Sessions: {
      ...h.store,
      destroy() {
        throw new Error('private delete details');
      },
    },
    recovery: {
      ...recovery,
      revoke() {
        throw new Error('private journal details');
      },
    },
    logger: { info() {}, error() {} },
  });
  t.after(() => auth.shutdown());
  const minted = res();
  auth.createSession(req(), minted, auth.sessionUser(1));
  const cookie = minted.headers['Set-Cookie'].split(';')[0];
  const expired = res();
  assert.throws(() => auth.destroySession(req(cookie), expired), /session_persistence_failed/);
  assert.equal(auth.getCurrentUser(req(cookie)), null);
  assert.match(expired.headers['Set-Cookie'], /Max-Age=0/);
  auth.beginShutdown();
  assert.equal(auth.shutdown({ clean: true }), false);
  assert.equal(h.open().activeRows.length, 0);
});

test('serialized write cap fails closed independently of the entry cap', (t) => {
  const h = harness(t);
  const recovery = h.open({ maxBytes: 160 });
  assert.equal(
    recovery.revoke([{ id: recovery.lookup(raw), expiresAt: Date.now() + 60_000 }]),
    false,
  );
  assert.equal(recovery.stats().uncertain, true);
  assert.equal(recovery.close({ clean: true }), false);
});

for (const failedSync of [1, 2]) {
  test('revocation sync failure keeps dirty recovery: sync ' + failedSync, (t) => {
    const h = harness(t);
    let armed = false;
    let count = 0;
    const io = {
      ...fs,
      fsyncSync(fd) {
        if (armed && ++count === failedSync) throw new Error('private synthetic details');
        return fs.fsyncSync(fd);
      },
    };
    const first = h.open({ io });
    const id = first.lookup(raw);
    h.store.create({ token: id, userId: 1, expiresAt: Date.now() + 60_000 });
    armed = true;
    assert.equal(first.revoke([{ id, expiresAt: Date.now() + 60_000 }]), false);
    assert.equal(first.stats().uncertain, true);
    assert.equal(first.close({ clean: true }), false);
    const second = h.open();
    assert.equal(second.activeRows.length, 0);
  });
}

test('startup fsync failure cannot return an authentication owner or private exception', (t) => {
  const h = harness(t);
  assert.throws(
    () =>
      h.open({
        io: {
          ...fs,
          fsyncSync() {
            throw new Error('private synthetic details');
          },
        },
      }),
    (e) =>
      e instanceof Error &&
      'code' in e &&
      e.code === 'session_recovery_unavailable' &&
      !e.message.includes('private'),
  );
  assert.equal(h.open().activeRows.length, 0, 'the failed opener released ownership');
});

test('an expired intent can be pruned, but unexpired entries and serialized byte caps cannot be bypassed', (t) => {
  const h = harness(t);
  let time = 100;
  const recovery = h.open({ now: () => time, maxEntries: 1, maxBytes: 260 });
  const first = recovery.lookup(raw);
  assert.equal(recovery.revoke([{ id: first, expiresAt: 150 }]), true);
  time = 151;
  assert.equal(recovery.revoke([{ id: recovery.lookup('b'.repeat(64)), expiresAt: 200 }]), true);
  assert.equal(recovery.stats().revocations, 1);
  assert.equal(recovery.revoke([{ id: recovery.lookup('c'.repeat(64)), expiresAt: 200 }]), false);
  assert.equal(recovery.close({ clean: true }), false);
  assert.throws(() => h.open({ maxBytes: MAX_BYTES + 1 }), /session_recovery_unavailable/);
});

test('malformed and unknown cookies create neither journal entries nor DB writes', (t) => {
  const h = harness(t);
  const recovery = h.open();
  let deletes = 0;
  const auth = createAuth({
    Users: {},
    Sessions: {
      ...h.store,
      destroy() {
        deletes++;
      },
    },
    recovery,
    logger: { info() {}, error() {} },
  });
  t.after(() => auth.shutdown());
  const digest = () => crypto.createHash('sha256').update(fs.readFileSync(h.file)).digest('hex');
  const before = digest();
  for (let i = 0; i < 200; i++)
    auth.destroySession(req('ot_session=' + i.toString(16).padStart(64, '0')), res());
  for (const cookie of ['', 'ot_session=wrong', 'ot_session=' + 'x'.repeat(5000)])
    auth.destroySession(req(cookie), res());
  assert.equal(recovery.stats().revocations, 0);
  assert.equal(deletes, 0);
  assert.equal(digest(), before);
});

for (const changed of ['password', 'account invalidation']) {
  test(
    'a credential proof started before ' + changed + ' cannot mint a later session',
    async (t) => {
      const h = harness(t);
      let hash = 'synthetic-before';
      const user = { id: 1, email: 'proof@example.test', created_at: 0 };
      const Users = {
        get: () => ({ ...user }),
        getByEmail: () => ({ ...user, password_hash: hash }),
      };
      /** @type {(value:boolean)=>void} */
      let release;
      const comparison = new Promise((resolve) => {
        release = resolve;
      });
      t.mock.method(bcrypt, 'compare', () => comparison);
      const recovery = h.open();
      const auth = createAuth({
        Users,
        Sessions: h.store,
        recovery,
        logger: { info() {}, error() {} },
      });
      t.after(() => auth.shutdown());
      const pending = auth.login({ email: user.email, password: 'synthetic' }, req());
      if (changed === 'password') hash = 'synthetic-after';
      else auth.invalidateUserSessions(user.id);
      release(true);
      const proof = await pending;
      const out = res();
      assert.throws(
        () => auth.createSession(req(), out, proof),
        (e) => e instanceof Error && 'code' in e && e.code === 'session_state_changed',
      );
      assert.equal(out.headers['Set-Cookie'], undefined);
      assert.equal(h.store.loadActive().length, 0);
      const fresh = auth.sessionUser(user.id);
      auth.createSession(req(), res(), fresh);
      assert.equal(h.store.loadActive().length, 1, 'a fresh authorized proof still works');
    },
  );
}

test('shutdown fences an in-flight login before mint and cannot mark clean without explicit drain', async (t) => {
  const h = harness(t);
  const user = { id: 1, email: 'drain@example.test', password_hash: 'synthetic' };
  const Users = { get: () => ({ ...user }), getByEmail: () => ({ ...user }) };
  /** @type {(value:boolean)=>void} */
  let release;
  t.mock.method(
    bcrypt,
    'compare',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const recovery = h.open();
  const auth = createAuth({
    Users,
    Sessions: h.store,
    recovery,
    logger: { info() {}, error() {} },
  });
  const pending = auth.login({ email: user.email, password: 'synthetic' }, req());
  auth.beginShutdown();
  assert.equal(JSON.parse(fs.readFileSync(h.file, 'utf8')).clean, false);
  release(true);
  const proof = await pending;
  assert.throws(
    () => auth.createSession(req(), res(), proof),
    (e) => e instanceof Error && 'code' in e && e.code === 'auth_unavailable',
  );
  assert.equal(h.store.loadActive().length, 0);
  assert.equal(auth.shutdown({ clean: true }), true);
  assert.equal(JSON.parse(fs.readFileSync(h.file, 'utf8')).clean, true);
});
