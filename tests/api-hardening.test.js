'use strict';

/**
 * HTTP-level contract for the API's response hygiene and request guards, against
 * a real server process:
 *
 *   - HEAD answers like GET (without a body) on API routes;
 *   - API responses are not cacheable unless a handler says so;
 *   - every 429 says when to retry;
 *   - the saved-library write routes refuse cross-site browser requests;
 *   - a password-reset token works once;
 *   - /.well-known/security.txt is served.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SECRET = 'api-hardening-test-secret-api-hardening-00';
process.env.EMAIL_TOKEN_SECRET = SECRET;
const { signToken } = require('../tokens');

/** @type {import('node:child_process').ChildProcess} */
let proc;
let base = '';
let dataDir = '';
let output = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (s.address());
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-hardening-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      ORTBTOOLS_DATA_DIR: dataDir,
      EMAIL_TOKEN_SECRET: SECRET,
      ORTBTOOLS_ANALYTICS_DISABLED: '1',
      NEWS_CRAWLER_DISABLED: '1',
      FX_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes('listening')) {
        clearTimeout(timer);
        resolve(undefined);
      }
    };
    /** @type {any} */ (proc).stdout.on('data', onData);
    /** @type {any} */ (proc).stderr.on('data', onData);
    proc.once('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
  // From here on keep collecting output (the dev-mode mailer logs reset links).
  /** @type {any} */ (proc).stdout.on('data', (c) => (output += c.toString()));
  /** @type {any} */ (proc).stderr.on('data', (c) => (output += c.toString()));
});

after(async () => {
  if (proc && proc.exitCode === null) {
    await new Promise((resolve) => {
      proc.once('exit', resolve);
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 3000).unref();
    });
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const JSON_HEADERS = { 'content-type': 'application/json' };

async function register(email) {
  const r = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password: 'Correct-Horse-Battery-9' }),
  });
  assert.equal(r.status, 200, 'register');
  const cookie = (r.headers.getSetCookie()[0] || '').split(';')[0];
  const body = /** @type {any} */ (await r.json());
  return { cookie, id: body.user.id };
}

// ── HEAD ───────────────────────────────────────────────────────────────────

test('HEAD on an API route answers like GET, without a body', async () => {
  const get = await fetch(base + '/api/health');
  const head = await fetch(base + '/api/health', { method: 'HEAD' });
  assert.equal(get.status, 200);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const missing = await fetch(base + '/api/no-such-route', { method: 'HEAD' });
  assert.equal(missing.status, 404);
});

// ── Cache-Control ──────────────────────────────────────────────────────────

test('API responses are no-store by default; handlers that cache keep their own policy', async () => {
  const { cookie } = await register('cache-probe@example.test');
  for (const p of [
    '/api/health',
    '/api/auth/me',
    '/api/samples',
    '/api/partners',
    '/api/dialects',
  ]) {
    const r = await fetch(base + p, { headers: { cookie } });
    assert.equal(r.headers.get('cache-control'), 'no-store', p);
  }
  const anon = await fetch(base + '/api/samples');
  assert.equal(anon.status, 401);
  assert.equal(anon.headers.get('cache-control'), 'no-store');
  const catalog = await fetch(base + '/api/v1/finding-catalog');
  assert.match(catalog.headers.get('cache-control') || '', /max-age=300/u);
});

// ── Retry-After ────────────────────────────────────────────────────────────

test('a throttled login says how long to wait', async () => {
  let last;
  for (let i = 0; i < 12; i++) {
    last = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'nobody@example.test', password: 'x' }),
    });
    if (last.status === 429) break;
  }
  assert.ok(last);
  assert.equal(last.status, 429);
  assert.equal(last.headers.get('retry-after'), String(15 * 60));
});

test('sendError supplies Retry-After for any 429 and honours one that is already set', () => {
  const { sendError, setRetryAfter } = require('../lib/http');
  const make = () => {
    const headers = {};
    return {
      headers,
      setHeader: (k, v) => (headers[k.toLowerCase()] = v),
      hasHeader: (k) => k.toLowerCase() in headers,
      writeHead() {},
      end() {},
    };
  };
  const a = make();
  sendError(a, 429, 'rate_limited', 'slow down');
  assert.equal(a.headers['retry-after'], '60');
  const b = make();
  setRetryAfter(b, 900);
  sendError(b, 429, 'rate_limited', 'slow down');
  assert.equal(b.headers['retry-after'], '900');
  const c = make();
  sendError(c, 400, 'bad_request', 'nope');
  assert.equal('retry-after' in c.headers, false);
});

// ── Cross-site guard on the saved library ──────────────────────────────────

test('library writes refuse a request a foreign page caused the browser to send', async () => {
  const { cookie } = await register('csrf-probe@example.test');
  const evil = { cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };

  // Cross-site with a CORS-simple content type: refused before any parsing.
  for (const [method, p] of [
    ['POST', '/api/partners'],
    ['POST', '/api/samples'],
    ['POST', '/api/dialects'],
    ['POST', '/api/dialects/import'],
    ['POST', '/api/behavior/corpus'],
    ['PATCH', '/api/partners/1'],
    ['DELETE', '/api/samples/1'],
    ['DELETE', '/api/behavior/corpus/1'],
  ]) {
    const r = await fetch(base + p, {
      method,
      headers: { ...evil, 'content-type': 'text/plain' },
      body: method === 'DELETE' ? undefined : '{"name":"x"}',
    });
    assert.equal(r.status, 403, `${method} ${p}`);
    assert.equal(/** @type {any} */ (await r.json()).code, 'cross_site_request');
  }
  // Nothing was created.
  const list = await fetch(base + '/api/partners', { headers: { cookie } });
  assert.deepEqual(/** @type {any} */ (await list.json()).partners, []);

  // A same-origin JSON request still works.
  const ok = await fetch(base + '/api/partners', {
    method: 'POST',
    headers: { cookie, ...JSON_HEADERS, origin: base, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ name: 'Same Origin Partner' }),
  });
  assert.equal(ok.status, 200);
  // Routes with :params still receive their route match through the guard.
  const created = /** @type {any} */ (await ok.json()).partner;
  const sameOrigin = { cookie, ...JSON_HEADERS, origin: base, 'sec-fetch-site': 'same-origin' };
  const patched = await fetch(base + '/api/partners/' + created.id, {
    method: 'PATCH',
    headers: sameOrigin,
    body: JSON.stringify({ name: 'Renamed Partner' }),
  });
  assert.equal(patched.status, 200);
  const dialect = await fetch(base + '/api/dialects', {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({ name: 'guard-dialect', is_default: false }),
  });
  assert.equal(dialect.status, 200);
  const dialectId = /** @type {any} */ (await dialect.json()).dialect.id;
  const mapping = await fetch(base + '/api/dialects/' + dialectId + '/mappings', {
    method: 'POST',
    headers: sameOrigin,
    body: JSON.stringify({
      signal_path: 'imp[].ext.guard_probe',
      signal_value: 'v',
      semantic_label: 'identifier',
    }),
  });
  assert.notEqual(mapping.status, 500, 'a guarded route with :params must still run');
  const removed = await fetch(base + '/api/partners/' + created.id, {
    method: 'DELETE',
    headers: sameOrigin,
  });
  assert.equal(removed.status, 200);
  // A body that is not declared JSON is refused even without browser signals.
  const wrongType = await fetch(base + '/api/partners', {
    method: 'POST',
    headers: { cookie, 'content-type': 'text/plain' },
    body: '{"name":"x"}',
  });
  assert.equal(wrongType.status, 415);
  // Reads are not affected by a foreign Origin.
  const read = await fetch(base + '/api/partners', { headers: evil });
  assert.notEqual(read.status, 403);
});

// ── Reset token is single-use ──────────────────────────────────────────────

function resetTokenFor(email, sinceIndex) {
  const tail = output.slice(sinceIndex);
  const re = /reset=([A-Za-z0-9_.-]+)/gu;
  let last = null;
  for (let m = re.exec(tail); m; m = re.exec(tail)) {
    // The dev-mode log line names the recipient next to the link.
    const lineStart = tail.lastIndexOf('\n', m.index);
    const lineEnd = tail.indexOf('\n', m.index);
    const around = tail.slice(
      Math.max(0, lineStart - 400),
      lineEnd < 0 ? undefined : lineEnd + 400,
    );
    if (around.includes(email)) last = m[1];
  }
  return last;
}

async function forgot(email) {
  const mark = output.length;
  const r = await fetch(base + '/api/auth/forgot-password', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email }),
  });
  assert.equal(r.status, 200);
  for (let i = 0; i < 50; i++) {
    const t = resetTokenFor(email, mark);
    if (t) return t;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('no reset link was logged for ' + email);
}

const reset = (token, password) =>
  fetch(base + '/api/auth/reset-password', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ token, mode: 'wipe', newPassword: password }),
  });

test('a reset token works once, and using it retires every other outstanding token', async () => {
  const email = 'reset-once@example.test';
  await register(email);
  const first = await forgot(email);
  // Tokens carry second-resolution timestamps; make the second one distinct.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const second = await forgot(email);
  assert.notEqual(first, second);

  const used = await reset(first, 'Brand-New-Password-1');
  assert.equal(used.status, 200);

  const again = await reset(first, 'Attacker-Chosen-Password-2');
  assert.equal(again.status, 400);
  assert.equal(/** @type {any} */ (await again.json()).code, 'stale_token');
  const other = await reset(second, 'Attacker-Chosen-Password-3');
  assert.equal(other.status, 400, 'the second link was issued against the old password');

  // The state lookup refuses the spent token too.
  const state = await fetch(base + '/api/auth/reset-password/state', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ token: first }),
  });
  assert.equal(state.status, 400);

  // The password that was set is the one that works.
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password: 'Brand-New-Password-1' }),
  });
  assert.equal(login.status, 200);
});

test('a token issued before password binding is accepted until it expires', async () => {
  const email = 'reset-legacy@example.test';
  const { id } = await register(email);
  const legacy = signToken({ purpose: 'reset', user_id: id, email, expirySeconds: 60 });
  const r = await reset(legacy, 'Legacy-Token-Password-1');
  assert.equal(r.status, 200);
});

// ── security.txt ───────────────────────────────────────────────────────────

test('/.well-known/security.txt is served and current', async () => {
  const r = await fetch(base + '/.well-known/security.txt');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /^text\/plain; charset=utf-8/u);
  const text = await r.text();
  assert.match(text, /^Contact: mailto:\S+@\S+$/mu);
  assert.match(text, /^Canonical: https:\/\/ortbtools\.com\/\.well-known\/security\.txt$/mu);
  const expires = /^Expires: (\S+)$/mu.exec(text);
  assert.ok(expires, 'RFC 9116 requires Expires');
  const when = Date.parse(expires[1]);
  assert.ok(Number.isFinite(when), 'Expires must be a date');
  // Deliberate: this fails once the file is stale, which is the point of Expires.
  // Renew the date in public/.well-known/security.txt (RFC 9116 caps it at a year).
  assert.ok(when > Date.now(), 'security.txt has expired; renew its Expires field');
  assert.ok(when < Date.now() + 366 * 24 * 3600 * 1000, 'Expires must be within a year');
});
