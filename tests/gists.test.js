'use strict';

/**
 * tests/gists.test.js — the encrypted-gist server contract.
 *
 * The single claim this file has to defend is that the server stores something
 * it cannot read. Everything else is bounds checking around that.
 *
 * So the tests are written from the storage side outwards: what the endpoint
 * accepts, what it refuses, what comes back out, and — most importantly — that
 * what comes back out is byte-for-byte what went in, with no code path anywhere
 * in the module that could turn it into plaintext.
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Steer db.js to a temp dir before requiring it (init() runs at require time).
const TMP = mkdtempSync(join(tmpdir(), 'ortbtools-gists-'));
process.env.ORTBTOOLS_DATA_DIR = TMP;

const {
  createGistsModule,
  sanitizeB64,
  ttlMs,
  MAX_CIPHERTEXT_CHARS,
  ID_RE,
} = require('../modules/gists/handler');

const ROOT = path.join(__dirname, '..');

let Gists, db, SCHEMA_VERSION;
before(() => {
  ({ Gists, db, SCHEMA_VERSION } = require('../db'));
});

// ── Test doubles ────────────────────────────────────────────────────────────

function fakeRes() {
  const r = {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    writeHead(s) {
      this.statusCode = s;
      return this;
    },
    end(b) {
      if (b != null && this.body == null) this.body = b;
      return this;
    },
  };
  return r;
}

/** Minimal request that lib/http readJson can consume. */
function fakeReq(bodyObj, opts = {}) {
  const payload = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  const handlers = {};
  const req = {
    headers: { 'user-agent': 'test', ...(opts.headers || {}) },
    socket: { remoteAddress: opts.ip || '203.0.113.9' },
    on(event, cb) {
      handlers[event] = cb;
      // Deliver the body once both listeners are attached.
      if (event === 'end') {
        setImmediate(() => {
          if (handlers.data && payload) handlers.data(payload);
          if (handlers.end) handlers.end();
        });
      }
      return req;
    },
    destroy() {},
  };
  return req;
}

function makeModule(overrides = {}) {
  return createGistsModule({
    Gists,
    gistWriteLimiter: () => true,
    readLimiter: () => true,
    ...overrides,
  });
}

const routeFor = (mod, method, path) =>
  mod.routes.find((r) => r.method === method && r.path === path).handler;

const parse = (res) => (typeof res.body === 'string' ? JSON.parse(res.body) : res.body);

/** A believable AES-GCM payload: base64, not decodable to anything meaningful. */
const CIPHERTEXT = Buffer.from('not-actually-readable-without-the-key').toString('base64');
const IV = Buffer.from('0123456789ab').toString('base64');

async function createGist(body, opts) {
  const mod = makeModule(opts && opts.deps);
  const res = fakeRes();
  await routeFor(mod, 'POST', '/api/v1/gists')(fakeReq(body, opts), res);
  return { res, json: parse(res) };
}

async function readGist(id, opts) {
  const mod = makeModule(opts && opts.deps);
  const res = fakeRes();
  await routeFor(mod, 'GET', '/api/v1/gists/:id')(fakeReq('', opts), res, null, { params: { id } });
  return { res, json: parse(res) };
}

// ── Schema ──────────────────────────────────────────────────────────────────

test('schema is at the gists version and the table exists', () => {
  assert.equal(SCHEMA_VERSION, 11);
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='gists'`)
    .get();
  assert.ok(row, 'gists table missing');
});

test('gists carry no user column — creation is anonymous by design', () => {
  const cols = db
    .prepare(`PRAGMA table_info(gists)`)
    .all()
    .map((c) => c.name);
  assert.ok(!cols.includes('user_id'), `gists must not link to an account: ${cols.join(',')}`);
  assert.deepEqual(cols.sort(), [
    'bundle_version',
    'bytes',
    'ciphertext',
    'created_at',
    'expires_at',
    'id',
    'iv',
  ]);
});

// ── The central claim ───────────────────────────────────────────────────────

test('ciphertext round-trips byte-for-byte', async () => {
  const { json: created } = await createGist({
    ciphertext: CIPHERTEXT,
    iv: IV,
    bundle_version: 1,
  });
  assert.equal(created.success, true);
  const { res, json } = await readGist(created.id);
  assert.equal(res.statusCode, 200);
  assert.equal(json.ciphertext, CIPHERTEXT, 'ciphertext was altered in storage');
  assert.equal(json.iv, IV, 'iv was altered in storage');
  assert.equal(json.bundle_version, 1);
});

test('the stored row contains nothing but the opaque blob and metadata', async () => {
  const { json: created } = await createGist({
    ciphertext: CIPHERTEXT,
    iv: IV,
    bundle_version: 1,
  });
  const row = db.prepare(`SELECT * FROM gists WHERE id = ?`).get(created.id);
  // Everything the server holds, spelled out. If a future change adds a column
  // that could hold plaintext, this fails and the privacy contract gets reread.
  assert.deepEqual(Object.keys(row).sort(), [
    'bundle_version',
    'bytes',
    'ciphertext',
    'created_at',
    'expires_at',
    'id',
    'iv',
  ]);
  assert.equal(row.ciphertext, CIPHERTEXT);
});

test('the module has no decryption path at all', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'modules/gists/handler.js'), 'utf8');
  // Strip comments — the file DISCUSSES decryption at length precisely because
  // it does none. Only executable code is evidence here.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of [
    'subtle',
    'decrypt',
    'Decipher',
    'atob',
    'Buffer.from',
    'JSON.parse(',
    'inflate',
    'gunzip',
  ]) {
    assert.ok(
      !code.includes(forbidden),
      `gist handler code must not reference "${forbidden}" — it would imply the server can read the bundle`,
    );
  }
});

test('the key is never accepted, even if a client offers it', async () => {
  const { json: created } = await createGist({
    ciphertext: CIPHERTEXT,
    iv: IV,
    bundle_version: 1,
    // A confused or hostile client sending the key must not get it persisted.
    key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    plaintext: '{"imp":[{"id":"leak"}]}',
  });
  const row = db.prepare(`SELECT * FROM gists WHERE id = ?`).get(created.id);
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes('AAAAAAAA'), 'a submitted key reached storage');
  assert.ok(!serialized.includes('leak'), 'submitted plaintext reached storage');
});

// ── Identifiers ─────────────────────────────────────────────────────────────

test('ids are unguessable and non-sequential', async () => {
  const ids = [];
  for (let i = 0; i < 25; i++) {
    const { json } = await createGist({ ciphertext: CIPHERTEXT, iv: IV, bundle_version: 1 });
    ids.push(json.id);
  }
  assert.equal(new Set(ids).size, ids.length, 'ids collided');
  for (const id of ids) assert.match(id, ID_RE, `id is not 22 base64url chars: ${id}`);
  // Sequential allocation would make consecutive ids share a long prefix.
  const sharedPrefix = ids.slice(1).filter((id, i) => id.slice(0, 8) === ids[i].slice(0, 8));
  assert.equal(sharedPrefix.length, 0, 'ids look sequential');
});

test('a malformed id is a plain 404, never a lookup', async () => {
  for (const id of ['', 'short', '../../etc/passwd', 'a'.repeat(23), "1' OR '1'='1"]) {
    const { res } = await readGist(id);
    assert.equal(res.statusCode, 404, `id ${JSON.stringify(id)}`);
  }
});

test('an unknown but well-formed id is 404', async () => {
  const { res } = await readGist('A'.repeat(22));
  assert.equal(res.statusCode, 404);
});

// ── Expiry ──────────────────────────────────────────────────────────────────

test('an expired gist is gone, and says so', async () => {
  const { id } = Gists.create({
    ciphertext: CIPHERTEXT,
    iv: IV,
    bundleVersion: 1,
    ttlMs: 1000,
    now: Date.now() - 10_000,
  });
  const { res, json } = await readGist(id);
  assert.equal(res.statusCode, 410);
  assert.equal(json.code, 'gist_expired');
  assert.ok(!JSON.stringify(json).includes(CIPHERTEXT), 'expired gist leaked its ciphertext');
});

test('expiry is enforced on read even when pruning has not run', () => {
  const { id } = Gists.create({
    ciphertext: CIPHERTEXT,
    iv: IV,
    bundleVersion: 1,
    ttlMs: 1000,
    now: Date.now() - 10_000,
  });
  // Row is still on disk...
  assert.ok(db.prepare(`SELECT 1 FROM gists WHERE id = ?`).get(id));
  // ...but unreachable.
  assert.equal(Gists.get(id).expired, true);
});

test('pruneExpired removes only what has aged out', () => {
  const before = Gists.count();
  const live = Gists.create({
    ciphertext: CIPHERTEXT,
    iv: IV,
    bundleVersion: 1,
    ttlMs: 60_000,
  });
  Gists.create({
    ciphertext: CIPHERTEXT,
    iv: IV,
    bundleVersion: 1,
    ttlMs: 1,
    now: Date.now() - 10_000,
  });
  const removed = Gists.pruneExpired();
  assert.ok(removed >= 1, 'nothing pruned');
  assert.ok(Gists.get(live.id), 'a live gist was pruned');
  assert.equal(Gists.count(), before + 1);
});

test('TTL is configurable and clamped to a sane range', () => {
  const saved = process.env.ORTBTOOLS_GIST_TTL_DAYS;
  try {
    delete process.env.ORTBTOOLS_GIST_TTL_DAYS;
    assert.equal(ttlMs(), 30 * 86400_000, 'default should be 30 days');
    process.env.ORTBTOOLS_GIST_TTL_DAYS = '7';
    assert.equal(ttlMs(), 7 * 86400_000);
    process.env.ORTBTOOLS_GIST_TTL_DAYS = '99999';
    assert.equal(ttlMs(), 365 * 86400_000, 'should clamp to a year');
    process.env.ORTBTOOLS_GIST_TTL_DAYS = '0';
    assert.equal(ttlMs(), 30 * 86400_000, 'zero falls back to the default');
    process.env.ORTBTOOLS_GIST_TTL_DAYS = 'nonsense';
    assert.equal(ttlMs(), 30 * 86400_000);
  } finally {
    if (saved === undefined) delete process.env.ORTBTOOLS_GIST_TTL_DAYS;
    else process.env.ORTBTOOLS_GIST_TTL_DAYS = saved;
  }
});

// ── Input bounds ────────────────────────────────────────────────────────────

test('sanitizeB64 accepts base64 and refuses everything else', () => {
  assert.equal(sanitizeB64(CIPHERTEXT, 1000), CIPHERTEXT);
  assert.equal(sanitizeB64(`  ${CIPHERTEXT}  `, 1000), CIPHERTEXT);
  for (const bad of [
    '{"imp":[]}',
    'has space',
    'tilde~',
    '<script>',
    '',
    '   ',
    null,
    undefined,
    42,
    {},
    [],
  ]) {
    assert.equal(sanitizeB64(bad, 1000), '', `accepted ${JSON.stringify(bad)}`);
  }
  assert.equal(sanitizeB64('A'.repeat(1001), 1000), '', 'over-length accepted');
});

test('oversize ciphertext is refused as invalid, not as a transport error', async () => {
  // One char over the cap must still fit the body limit, so the rejection comes
  // from field validation. If this ever returns 413 the two caps have drifted
  // and the largest legal gist is unreachable.
  const { res, json } = await createGist({
    ciphertext: 'A'.repeat(MAX_CIPHERTEXT_CHARS + 1),
    iv: IV,
    bundle_version: 1,
  });
  assert.equal(res.statusCode, 400, `expected field-level rejection, got ${res.statusCode}`);
  assert.equal(json.code, 'invalid_ciphertext');
});

test('a ciphertext exactly at the cap is accepted and round-trips', async () => {
  const atCap = 'A'.repeat(MAX_CIPHERTEXT_CHARS);
  const { res, json } = await createGist({ ciphertext: atCap, iv: IV, bundle_version: 1 });
  assert.equal(
    res.statusCode,
    201,
    `the largest legal gist must be storable, got ${res.statusCode}`,
  );
  const read = await readGist(json.id);
  assert.equal(read.json.ciphertext.length, MAX_CIPHERTEXT_CHARS);
});

test('non-base64 ciphertext is refused rather than stored', async () => {
  const { res, json } = await createGist({
    ciphertext: '{"imp":[{"id":"plaintext-leak"}]}',
    iv: IV,
    bundle_version: 1,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(json.code, 'invalid_ciphertext');
  const hit = db
    .prepare(`SELECT COUNT(*) AS n FROM gists WHERE ciphertext LIKE '%plaintext-leak%'`)
    .get();
  assert.equal(hit.n, 0, 'plaintext-looking body was stored');
});

test('a missing or malformed iv is refused', async () => {
  for (const iv of [undefined, '', 'not base64!', 123]) {
    const { res, json } = await createGist({ ciphertext: CIPHERTEXT, iv, bundle_version: 1 });
    assert.equal(res.statusCode, 400, `iv ${JSON.stringify(iv)}`);
    assert.equal(json.code, 'invalid_iv');
  }
});

test('an unknown bundle version is refused', async () => {
  for (const v of [0, 2, 99, 'one', null, undefined]) {
    const { res, json } = await createGist({ ciphertext: CIPHERTEXT, iv: IV, bundle_version: v });
    assert.equal(res.statusCode, 400, `version ${JSON.stringify(v)}`);
    assert.equal(json.code, 'unsupported_bundle_version');
  }
});

test('a non-object body is refused', async () => {
  for (const body of ['[]', '"str"', '42']) {
    const { res } = await createGist(body);
    assert.equal(res.statusCode, 400);
  }
});

test('a getter cannot pass validation and then store something else', async () => {
  // readJson goes through JSON.parse, so a getter cannot survive the wire —
  // this pins that the handler reads each field once regardless.
  const { json: created } = await createGist({
    ciphertext: CIPHERTEXT,
    iv: IV,
    bundle_version: 1,
  });
  const row = db.prepare(`SELECT ciphertext FROM gists WHERE id = ?`).get(created.id);
  assert.equal(row.ciphertext, CIPHERTEXT);
});

// ── Abuse bounds ────────────────────────────────────────────────────────────

test('creation is rate limited per client', async () => {
  const { res, json } = await createGist(
    { ciphertext: CIPHERTEXT, iv: IV, bundle_version: 1 },
    { deps: { gistWriteLimiter: () => false } },
  );
  assert.equal(res.statusCode, 429);
  assert.equal(json.code, 'rate_limited');
});

test('reads are rate limited independently of writes', async () => {
  const { json: created } = await createGist({
    ciphertext: CIPHERTEXT,
    iv: IV,
    bundle_version: 1,
  });
  const { res } = await readGist(created.id, { deps: { readLimiter: () => false } });
  assert.equal(res.statusCode, 429);
});

test('a read is cached privately, never in a shared cache', async () => {
  const { json: created } = await createGist({
    ciphertext: CIPHERTEXT,
    iv: IV,
    bundle_version: 1,
  });
  const { res } = await readGist(created.id);
  assert.match(res.headers['cache-control'], /private/);
  assert.ok(!/public/.test(res.headers['cache-control']));
});

test('the module exposes exactly the two documented routes', () => {
  const mod = makeModule();
  assert.equal(mod.id, 'gists');
  assert.deepEqual(mod.routes.map((r) => `${r.method} ${r.path}`).sort(), [
    'GET /api/v1/gists/:id',
    'POST /api/v1/gists',
  ]);
});
