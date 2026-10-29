'use strict';

/**
 * Regression: unbounded storage growth (audit 2026-10-29).
 *
 * Anonymous share links and every library write accepted a body of up to 2 MiB
 * with no per-IP volume cap, no per-user cap and no write limiter, and
 * registration is open. One script could fill the disk that also holds the
 * SQLite account database. These tests pin the ceilings and the coded refusals.
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const TMP = mkdtempSync(join(tmpdir(), 'ortbtools-quota-'));
process.env.ORTBTOOLS_DATA_DIR = TMP;

const { createGistsModule } = require('../modules/gists/handler');
const { createSamplesModule } = require('../modules/samples/handler');
const { createPartnersModule } = require('../modules/partners/handler');
const { createCorpusModule } = require('../modules/corpus/handler');
const { createDialectsModule } = require('../modules/dialects/handler');

const ENV_KEYS = [
  'ORTBTOOLS_LIBRARY_MAX_SAMPLES',
  'ORTBTOOLS_LIBRARY_MAX_BYTES',
  'ORTBTOOLS_LIBRARY_MAX_PARTNERS',
  'ORTBTOOLS_LIBRARY_MAX_CORPUS',
  'ORTBTOOLS_LIBRARY_MAX_DIALECTS',
  'ORTBTOOLS_LIBRARY_MAX_MAPPINGS',
  'ORTBTOOLS_GIST_MAX_TOTAL_BYTES',
  'ORTBTOOLS_GIST_IP_DAILY_BYTES',
];

let db, Users, Samples, Partners, BehaviorCorpus, Gists;
let userA, userB;

before(() => {
  ({ db, Users, Samples, Partners, BehaviorCorpus, Gists } = require('../db'));
  userA = Users.create({ email: 'quota-a@example.test', password_hash: 'x' });
  userB = Users.create({ email: 'quota-b@example.test', password_hash: 'x' });
});

after(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  db.exec(
    'DELETE FROM samples; DELETE FROM partners; DELETE FROM behavior_corpus; DELETE FROM gists; DELETE FROM user_dialects;',
  );
});

const expectQuota = (fn) =>
  assert.throws(
    fn,
    (/** @type {any} */ e) => e.code === 'quota_exceeded' && e.status === 413,
    'quota_exceeded/413',
  );

// ── Model layer ─────────────────────────────────────────────────────────────

test('samples: the per-account row cap is enforced and is per user', () => {
  process.env.ORTBTOOLS_LIBRARY_MAX_SAMPLES = '3';
  for (let i = 0; i < 3; i++) Samples.create({ userId: userA.id, title: `s${i}` });
  expectQuota(() => Samples.create({ userId: userA.id, title: 'one too many' }));
  Samples.create({ userId: userB.id, title: 'other account is unaffected' });
});

test('samples: the byte cap counts content and blocks a single oversized save', () => {
  process.env.ORTBTOOLS_LIBRARY_MAX_BYTES = '1000';
  Samples.create({ userId: userA.id, title: 't', bid_req: 'a'.repeat(400) });
  expectQuota(() => Samples.create({ userId: userA.id, title: 't', bid_req: 'a'.repeat(700) }));
  Samples.create({ userId: userA.id, title: 't', bid_req: 'a'.repeat(300) });
});

test('samples: growing a row through update counts against the cap, shrinking does not', () => {
  process.env.ORTBTOOLS_LIBRARY_MAX_BYTES = '1000';
  const s = Samples.create({ userId: userA.id, title: 't', bid_req: 'a'.repeat(500) });
  expectQuota(() => Samples.update({ id: s.id, userId: userA.id, bid_req: 'a'.repeat(1500) }));
  const shrunk = Samples.update({ id: s.id, userId: userA.id, bid_req: 'a'.repeat(100) });
  assert.equal(shrunk.bid_req.length, 100);
});

test('partners: row cap and free-text bounds', () => {
  process.env.ORTBTOOLS_LIBRARY_MAX_PARTNERS = '2';
  const p = Partners.create({
    userId: userA.id,
    name: 'n'.repeat(5000),
    notes: 'x'.repeat(100000),
  });
  assert.equal(p.name.length, 200);
  assert.equal(p.notes.length, 4000);
  Partners.create({ userId: userA.id, name: 'second' });
  expectQuota(() => Partners.create({ userId: userA.id, name: 'third' }));
});

test('behavior corpus: row cap and the shared byte cap', () => {
  process.env.ORTBTOOLS_LIBRARY_MAX_CORPUS = '2';
  const ev = [{ kind: 'probe_ready' }];
  BehaviorCorpus.create({ userId: userA.id, label: 'fraud', events: ev });
  BehaviorCorpus.create({ userId: userA.id, label: 'fraud', events: ev });
  expectQuota(() => BehaviorCorpus.create({ userId: userA.id, label: 'fraud', events: ev }));
  delete process.env.ORTBTOOLS_LIBRARY_MAX_CORPUS;
  process.env.ORTBTOOLS_LIBRARY_MAX_BYTES = '50';
  expectQuota(() =>
    BehaviorCorpus.create({ userId: userB.id, label: 'fraud', events: [{ pad: 'x'.repeat(200) }] }),
  );
});

// ── HTTP layer ──────────────────────────────────────────────────────────────

function fakeRes() {
  return {
    statusCode: 0,
    body: '',
    setHeader() {},
    writeHead(s) {
      this.statusCode = s;
    },
    end(b) {
      if (b != null) this.body += b;
    },
  };
}

function fakeReq(body, { ip = '203.0.113.9', headers = {} } = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const handlers = {};
  const req = {
    headers: { 'user-agent': 'test', ...headers },
    socket: { remoteAddress: ip },
    on(event, cb) {
      handlers[event] = cb;
      if (event === 'end') {
        setImmediate(() => {
          if (handlers.data && payload) handlers.data(payload);
          handlers.end();
        });
      }
      return req;
    },
    destroy() {},
  };
  return req;
}

const handlerOf = (mod, method, path) =>
  mod.routes.find((r) => r.method === method && r.path === path).handler;
const json = (res) => JSON.parse(res.body);

test('samples HTTP: a capped account gets 413 quota_exceeded, not a generic 400', async () => {
  process.env.ORTBTOOLS_LIBRARY_MAX_SAMPLES = '1';
  const mod = createSamplesModule({ auth: { getCurrentUser: () => userA }, Samples });
  const create = handlerOf(mod, 'POST', '/api/samples');
  const ok = fakeRes();
  await create(fakeReq({ title: 'first' }), ok);
  assert.equal(ok.statusCode, 200);
  const over = fakeRes();
  await create(fakeReq({ title: 'second' }), over);
  assert.equal(over.statusCode, 413);
  assert.equal(json(over).code, 'quota_exceeded');
});

test('library writes are rate limited per user before the body is read', async () => {
  const seen = [];
  const limiter = (key) => {
    seen.push(key);
    return seen.length <= 2;
  };
  const mod = createPartnersModule({
    auth: { getCurrentUser: () => userA },
    Partners,
    libraryWriteLimiter: limiter,
  });
  const create = handlerOf(mod, 'POST', '/api/partners');
  const codes = [];
  for (let i = 0; i < 3; i++) {
    const res = fakeRes();
    await create(fakeReq({ name: `p${i}` }), res);
    codes.push(res.statusCode);
  }
  assert.deepEqual(codes, [200, 200, 429]);
  assert.ok(
    seen.every((k) => k === String(userA.id)),
    'keyed by user id',
  );
});

test('corpus HTTP: quota and write limiter', async () => {
  process.env.ORTBTOOLS_LIBRARY_MAX_CORPUS = '1';
  const mod = createCorpusModule({
    auth: { getCurrentUser: () => userA },
    BehaviorCorpus,
    computeCorpusMatrix: () => ({}),
    libraryWriteLimiter: () => true,
  });
  const save = handlerOf(mod, 'POST', '/api/behavior/corpus');
  const body = { label: 'fraud', events: [{ kind: 'probe_ready' }] };
  const first = fakeRes();
  await save(fakeReq(body), first);
  assert.equal(first.statusCode, 200);
  const second = fakeRes();
  await save(fakeReq(body), second);
  assert.equal(second.statusCode, 413);
  assert.equal(json(second).code, 'quota_exceeded');
});

test('dialects HTTP: dialect and mapping caps, import counts every mapping', async () => {
  process.env.ORTBTOOLS_LIBRARY_MAX_DIALECTS = '1';
  const mod = createDialectsModule({
    auth: { getCurrentUser: () => userA },
    db,
    libraryWriteLimiter: () => true,
  });
  const create = handlerOf(mod, 'POST', '/api/dialects');
  const a = fakeRes();
  await create(fakeReq({ name: 'one' }), a);
  assert.equal(a.statusCode, 200);
  const b = fakeRes();
  await create(fakeReq({ name: 'two' }), b);
  assert.equal(b.statusCode, 413);
  assert.equal(json(b).code, 'quota_exceeded');

  delete process.env.ORTBTOOLS_LIBRARY_MAX_DIALECTS;
  process.env.ORTBTOOLS_LIBRARY_MAX_MAPPINGS = '2';
  const imp = handlerOf(mod, 'POST', '/api/dialects/import');
  const mapping = (i) => ({
    match_scope: 'value',
    version: 1,
    signal_path: `ext.k${i}`,
    signal_value: `v${i}`,
    semantic_label: 'banner',
  });
  const tooMany = fakeRes();
  await imp(
    fakeReq({ schema_version: 2, name: 'big', mappings: [mapping(1), mapping(2), mapping(3)] }),
    tooMany,
  );
  assert.equal(tooMany.statusCode, 413, tooMany.body);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM user_dialects WHERE name LIKE ?').get('big%').n,
    0,
    'the refused import must leave nothing behind',
  );
});

// ── Gists ───────────────────────────────────────────────────────────────────

const B64 = (chars) => 'QUJD'.repeat(Math.ceil(chars / 4)).slice(0, chars - (chars % 4));
const GIST = (chars) => ({ ciphertext: B64(chars), iv: 'MDEyMzQ1Njc4OWFi', bundle_version: 1 });

function gistModule() {
  return createGistsModule({ Gists, gistWriteLimiter: () => true, readLimiter: () => true });
}

test('gists: liveBytes sums unexpired ciphertext only', () => {
  const now = Date.now();
  Gists.create({ ciphertext: B64(400), iv: 'AAAA', bundleVersion: 1, ttlMs: 60_000, now });
  Gists.create({
    ciphertext: B64(800),
    iv: 'AAAA',
    bundleVersion: 1,
    ttlMs: 60_000,
    now: now - 120_000,
  });
  assert.equal(Gists.liveBytes(now), 400);
});

test('gists: the global storage cap answers 507 and stores nothing', async () => {
  process.env.ORTBTOOLS_GIST_MAX_TOTAL_BYTES = '1000';
  const create = handlerOf(gistModule(), 'POST', '/api/v1/gists');
  const ok = fakeRes();
  await create(fakeReq(GIST(600), { ip: '198.51.100.1' }), ok);
  assert.equal(ok.statusCode, 201);
  const full = fakeRes();
  await create(fakeReq(GIST(600), { ip: '198.51.100.2' }), full);
  assert.equal(full.statusCode, 507);
  assert.equal(json(full).code, 'gist_storage_full');
  assert.equal(Gists.count(), 1);
});

test('gists: one address cannot spend more than its daily byte budget', async () => {
  process.env.ORTBTOOLS_GIST_IP_DAILY_BYTES = '1000';
  const create = handlerOf(gistModule(), 'POST', '/api/v1/gists');
  const first = fakeRes();
  await create(fakeReq(GIST(600), { ip: '198.51.100.7' }), first);
  assert.equal(first.statusCode, 201);
  const second = fakeRes();
  await create(fakeReq(GIST(600), { ip: '198.51.100.7' }), second);
  assert.equal(second.statusCode, 429);
  assert.equal(json(second).code, 'gist_quota_exceeded');
  const elsewhere = fakeRes();
  await create(fakeReq(GIST(600), { ip: '198.51.100.8' }), elsewhere);
  assert.equal(elsewhere.statusCode, 201, 'another address has its own budget');
});

test('gists: a refused (full) request does not spend the address budget', async () => {
  process.env.ORTBTOOLS_GIST_MAX_TOTAL_BYTES = '100';
  process.env.ORTBTOOLS_GIST_IP_DAILY_BYTES = '700';
  const create = handlerOf(gistModule(), 'POST', '/api/v1/gists');
  for (let i = 0; i < 3; i++) {
    const r = fakeRes();
    await create(fakeReq(GIST(600), { ip: '198.51.100.9' }), r);
    assert.equal(r.statusCode, 507, 'still the storage message, never the quota one');
  }
});
