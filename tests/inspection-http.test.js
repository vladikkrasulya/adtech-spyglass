'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { Router } = require('../lib/router');
const { createInspectionModule, readDeclaredContext } = require('../modules/inspection/handler');

async function fixture(t, overrides = {}) {
  const calls = [];
  const router = new Router();
  router.register(
    createInspectionModule({
      auth: { clientIp: () => 'synthetic-ip' },
      analyzeLimiter: () => true,
      readLimiter: () => true,
      inspectSchain: (input, opts) => {
        calls.push({ input, opts });
        return { kind: 'serialized', status: 'valid', copies: [], findings: [] };
      },
      listInspectionProfiles: () => [{ adapterId: 'synthetic', provenance: 'pinned-source' }],
      ...overrides,
    }),
  );
  const server = http.createServer((req, res) => {
    router.dispatch(req, res, new URL(req.url, 'http://localhost')).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  return {
    calls,
    get: () => fetch(`${base}/api/inspection/profiles`),
    post: (body) =>
      fetch(`${base}/api/inspection/schain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
  };
}

test('inspection HTTP forwards explicit input/context without fetching supplied URLs', async (t) => {
  const f = await fixture(t);
  const input = 'https://synthetic.invalid/collect?schain=1.0,1!seller.example,Account,1';
  const declaredSender = { asi: 'seller.example', sid: 'Account', provenance: 'declared' };
  const r = await f.post({ input, declaredSender, locale: 'uk' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await r.json()).inspection.status, 'valid');
  assert.deepEqual(f.calls, [{ input, opts: { locale: 'uk', declaredSender } }]);
  const profiles = await f.get();
  assert.equal(profiles.status, 200);
  assert.equal((await profiles.json()).profiles[0].provenance, 'pinned-source');
});

test('inspection rejects malformed bodies/contexts and transport overflow without invoking Core', async (t) => {
  const f = await fixture(t);
  for (const body of [
    null,
    [],
    {},
    { input: '' },
    { input: [] },
    { input: 'x', declaredSender: { asi: 'seller.example', sid: 'x' } },
    { input: 'x', declaredSender: { asi: 'a', sid: 1, provenance: 'declared' } },
    { input: 'x', declaredSender: { asi: 'a', sid: 'b', provenance: 'inferred' } },
    { input: 'x', declaredSender: { asi: 'a', sid: 'b', provenance: 'declared', extra: true } },
    '{"input":"PRIVATE-SYNTHETIC-UNFINISHED',
    { input: 'x'.repeat(300000) },
  ]) {
    const r = await f.post(body);
    assert.equal(r.status, 400);
    assert.ok(!(await r.text()).includes('PRIVATE-SYNTHETIC'));
  }
  assert.equal(f.calls.length, 0);
});

test('inspection shares bounded read/paste admission and never invokes Core after refusal', async (t) => {
  const f = await fixture(t, { analyzeLimiter: () => false, readLimiter: () => false });
  assert.equal((await f.post({ input: '1.0,1!a,b,1' })).status, 429);
  assert.equal((await f.get()).status, 429);
  assert.equal(f.calls.length, 0);
});

test('unexpected Core inspection/profile failures use a static server-failure envelope', async (t) => {
  for (const failure of [
    new Error('PRIVATE-SYNTHETIC-CORE-DETAIL'),
    Object.assign(new Error('PRIVATE-SYNTHETIC-CODED-DETAIL'), { code: 'invalid_input' }),
  ]) {
    const fail = () => {
      throw failure;
    };
    const f = await fixture(t, { inspectSchain: fail, listInspectionProfiles: fail });
    for (const response of [
      await f.post({ input: '1.0,1!seller.example,account,1' }),
      await f.get(),
    ]) {
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        success: false,
        error: 'Inspection could not complete. Try again shortly.',
        code: 'inspection_failed',
      });
    }
  }
});

test('declared route requires complete provenance and preserves unsupported values for unknown readback', () => {
  assert.deepEqual(readDeclaredContext({}), {});
  const declaredRoute = {
    adapterId: 'unlisted',
    direction: 'unsupported',
    revision: 'unlisted-revision',
    provenance: 'declared',
  };
  assert.deepEqual(readDeclaredContext({ declaredRoute }), { declaredRoute });
  for (const bad of [null, {}, [], 'logan', { ...declaredRoute, provenance: 'observed' }]) {
    assert.throws(() => readDeclaredContext({ declaredRoute: bad }), { code: 'invalid_input' });
  }
});
