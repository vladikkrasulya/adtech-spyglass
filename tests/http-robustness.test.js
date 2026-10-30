'use strict';

/**
 * Regressions from the 2026-10-29 audit, at the HTTP boundary.
 *
 * - malformed percent-encoding / NUL bytes in a path used to throw out of the
 *   router or the static handler and answered 500 (plus an error report) to any
 *   anonymous caller;
 * - the operator token was compared with `!==` and could be guessed at full
 *   speed (200 wrong tries in a row all answered 401);
 * - a JSON body of `null`/`[]` crashed two authenticated handlers into 500;
 * - readJson counted UTF-16 units against a byte cap and decoded chunks one by
 *   one, corrupting a character split across two chunks.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'robustness-test-token-0123456789abcdef';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('net').AddressInfo} */ (srv.address());
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

let server;
let base;
let dataDir;

before(async () => {
  const port = await freePort();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-robust-'));
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      PORT: String(port),
      ORTBTOOLS_DATA_DIR: dataDir,
      NEWS_CRAWLER_DISABLED: '1',
      FX_DISABLED: '1',
      ADMIN_STATS_TOKEN: TOKEN,
      ORTBTOOLS_ANALYTICS_DISABLED: '1',
    },
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start within 20s')), 20000);
    const onData = (chunk) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        resolve(undefined);
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server && server.exitCode === null) {
    await new Promise((resolve) => {
      const force = setTimeout(() => server.kill('SIGKILL'), 2000);
      server.once('exit', () => {
        clearTimeout(force);
        resolve(undefined);
      });
      server.kill('SIGTERM');
    });
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Raw request so the path is sent byte-for-byte (fetch would normalise `%`). */
function rawGet(rawPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(base);
    const req = http.request(
      { host: url.hostname, port: url.port, path: rawPath, method: 'GET', headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('malformed percent-encoding in a path is a 400, never a 500', async () => {
  for (const p of [
    '/api/samples/%',
    '/api/samples/%E0%A4%A',
    '/api/v1/specimen/%ff',
    '/api/v1/gists/%',
    '/api/partners/%zz/samples-count',
    '/api/dialects/%/mappings',
    '/%',
    '/uk/%',
  ]) {
    const r = await rawGet(p);
    assert.ok(r.status >= 400 && r.status < 500, `${p} -> ${r.status}`);
  }
});

test('a NUL byte in the path is a 400, never a 500', async () => {
  const r = await rawGet('/%00');
  assert.equal(r.status, 400);
  assert.equal((await rawGet('/index%00.html')).status, 400);
});

test('operator token: constant-time gate with a failed-attempt lockout', async () => {
  const ip = '198.51.100.77';
  const call = (token, ipHeader = ip) =>
    rawGet('/api/admin/stats', {
      Authorization: `Bearer ${token}`,
      'CF-Connecting-IP': ipHeader,
    });
  assert.equal((await call(TOKEN, '198.51.100.70')).status, 200, 'right token works');
  for (let i = 0; i < 10; i++) {
    assert.equal((await call(`wrong-${i}`)).status, 401, `guess ${i}`);
  }
  assert.equal((await call('wrong-11')).status, 429, 'locked out after 10 failures');
  assert.equal((await call(TOKEN)).status, 429, 'a locked-out address stays locked, even if right');
  assert.equal((await call(TOKEN, '198.51.100.71')).status, 200, 'other addresses are unaffected');
  assert.equal(
    (await rawGet('/api/admin/stats?token=' + TOKEN)).status,
    401,
    'no query-string token',
  );
});

// ── readJson ────────────────────────────────────────────────────────────────

const { readJson } = require('../lib/http');

/** @returns {any} an IncomingMessage stand-in that emits the given chunks */
function fakeBodyReq(chunks) {
  const req = new EventEmitter();
  setImmediate(() => {
    for (const c of chunks) req.emit('data', c);
    req.emit('end');
  });
  return req;
}

test('readJson decodes a multi-byte character split across chunks', async () => {
  const bytes = Buffer.from(JSON.stringify({ text: 'é€😀' }), 'utf8');
  const cut = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
  const parsed = await readJson(fakeBodyReq([bytes.subarray(0, cut), bytes.subarray(cut)]));
  assert.deepEqual(parsed, { text: 'é€😀' });
});

test('readJson enforces its cap in bytes, not UTF-16 units', async () => {
  // 10 euro signs = 10 UTF-16 units but 30 bytes.
  const body = Buffer.from(JSON.stringify({ t: '€'.repeat(10) }), 'utf8'); // 38 bytes
  await assert.rejects(
    () => readJson(fakeBodyReq([body]), { maxBytes: 30 }),
    (/** @type {any} */ e) => e.code === 'payload_too_large',
  );
  assert.deepEqual(await readJson(fakeBodyReq([body]), { maxBytes: 64 }), { t: '€'.repeat(10) });
});

// ── null / non-object bodies on the two authenticated handlers ──────────────

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

test('creative-asset and suggest-label answer 400 to a JSON null / array body', async () => {
  const { createCreativeAssetModule } = require('../modules/creative-asset/handler');
  const { createAiLabelModule } = require('../modules/ai-label/handler');
  const user = { id: 1 };
  const asset = createCreativeAssetModule({
    auth: { getCurrentUser: () => user },
    assetLimiter: () => true,
  }).routes[0].handler;
  const label = createAiLabelModule({
    auth: { getCurrentUser: () => user },
    aiLabelLimiter: () => true,
    db: /** @type {any} */ ({}),
  }).routes[0].handler;
  /** @type {Array<[string, (req: any, res: any) => any]>} */
  const handlers = [
    ['asset', asset],
    ['label', label],
  ];
  for (const [name, handler] of handlers) {
    for (const raw of ['null', '[]', '1', '"x"']) {
      const res = fakeRes();
      const req = Object.assign(fakeBodyReq([Buffer.from(raw)]), {
        headers: {},
        socket: { remoteAddress: '203.0.113.9' },
      });
      await handler(req, res);
      assert.equal(res.statusCode, 400, `${name} ${raw}`);
    }
  }
});
