'use strict';

/**
 * The labelling route under load and against oversized input.
 *
 * Three guarantees: the model is never given an unbounded prompt, a burst is
 * answered with a prompt, explicit "busy" instead of timing out, and the gate
 * keeps the model from running more than the configured number of calls at once.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const { createGate } = require('../lib/concurrency-gate');
const ollama = require('../lib/ollama');
const { createAiLabelModule } = require('../modules/ai-label/handler');

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    payload: null,
    setHeader(k, v) {
      res.headers[k.toLowerCase()] = v;
    },
    writeHead(code, headers) {
      res.statusCode = code;
      for (const [k, v] of Object.entries(headers || {})) res.headers[k.toLowerCase()] = v;
    },
    end(text) {
      res.payload = text ? JSON.parse(text) : null;
    },
  };
  return res;
}

function call(mod, body) {
  const route = mod.routes.find((r) => r.path === '/api/dialects/suggest-label');
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const res = makeRes();
  return route.handler(Readable.from([raw]), res).then(() => res);
}

const authed = { getCurrentUser: () => ({ id: 'u1' }) };
// A signal the deterministic stages cannot resolve, so the model path is taken.
const unknown = (extra) => ({
  signal_path: 'imp[0].ext.zzqx_unknown',
  signal_value: 'abc',
  ...extra,
});

function withStubbedModel(fn) {
  const realVerify = ollama.verifyPersona;
  const realClassify = ollama.classifySignal;
  ollama.verifyPersona = async () => ({ ok: true, reason: null, model: 'stub' });
  return Promise.resolve(fn((impl) => (ollama.classifySignal = impl))).finally(() => {
    ollama.verifyPersona = realVerify;
    ollama.classifySignal = realClassify;
  });
}

test('gate: runs up to maxActive, queues up to maxQueue, refuses the rest at once', async () => {
  const gate = createGate({ maxActive: 1, maxQueue: 1, maxWaitMs: 5000 });
  /** @type {(v?: any) => void} */
  let release = () => {};
  const first = gate.run(() => new Promise((r) => (release = r)));
  const second = gate.run(async () => 'second');
  await assert.rejects(
    () => gate.run(async () => 'third'),
    (e) => /** @type {any} */ (e).code === 'gate_full',
  );
  assert.deepEqual(gate.stats(), {
    active: 1,
    queued: 1,
    maxActive: 1,
    maxQueue: 1,
    maxWaitMs: 5000,
  });
  release('first');
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  assert.equal(gate.stats().active, 0);
});

test('gate: a waiter that does not get a turn in time is released with gate_wait_timeout', async () => {
  const gate = createGate({ maxActive: 1, maxQueue: 2, maxWaitMs: 30 });
  /** @type {(v?: any) => void} */
  let release = () => {};
  const held = gate.run(() => new Promise((r) => (release = r)));
  await assert.rejects(
    () => gate.run(async () => 'late'),
    (e) => /** @type {any} */ (e).code === 'gate_wait_timeout',
  );
  assert.equal(gate.stats().queued, 0);
  release();
  await held;
});

test('gate: a failing call frees its slot', async () => {
  const gate = createGate({ maxActive: 1, maxQueue: 0 });
  await assert.rejects(() => gate.run(async () => Promise.reject(new Error('boom'))), /boom/);
  assert.equal(await gate.run(async () => 'ok'), 'ok');
});

test('route: a burst gets 429 labeller_busy with Retry-After, never more than one model call at once', async () => {
  await withStubbedModel(async (stub) => {
    let inFlight = 0;
    let peak = 0;
    stub(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight -= 1;
      return { label: 'ignore', confidence: 0.5, reason: 'stub', model: 'stub', source: 'model' };
    });
    const mod = createAiLabelModule({
      auth: authed,
      gate: createGate({ maxActive: 1, maxQueue: 1, maxWaitMs: 2000 }),
    });
    const results = await Promise.all(Array.from({ length: 5 }, () => call(mod, unknown())));
    const statuses = results.map((r) => r.statusCode).sort();
    assert.deepEqual(statuses, [200, 200, 429, 429, 429]);
    assert.equal(peak, 1, 'the model must never see parallel calls');
    for (const r of results.filter((x) => x.statusCode === 429)) {
      assert.equal(r.payload.code, 'labeller_busy');
      assert.ok(Number(r.headers['retry-after']) > 0, 'a busy answer says when to come back');
    }
  });
});

test('route: an object or array signal_value is bounded like a string one', async () => {
  const mod = createAiLabelModule({ auth: authed });
  for (const value of [
    { a: 'x'.repeat(600) },
    ['y'.repeat(300), 'z'.repeat(300)],
    'q'.repeat(513),
  ]) {
    const res = await call(mod, unknown({ signal_value: value }));
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'signal_value_too_long');
  }
});

test('route: a multi-megabyte body is refused before it is parsed into a prompt', async () => {
  const mod = createAiLabelModule({ auth: authed });
  const res = await call(mod, unknown({ signal_value: { blob: 'x'.repeat(2_700_000) } }));
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /byte limit/);
});

test('prompt: whatever a caller passes, the model prompt stays small', async () => {
  const realFetch = global.fetch;
  /** @type {any} */
  let sent = null;
  global.fetch = /** @type {any} */ (
    async (/** @type {any} */ _url, /** @type {any} */ init) => {
      sent = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          response: JSON.stringify({ label: 'ignore', confidence: 0.4, reason: 'x' }),
          model: 'stub',
        }),
      };
    }
  );
  try {
    await ollama.classifySignal({
      signalPath: 'imp[0].ext.k',
      signalValue: { big: 'v'.repeat(5_000_000) },
      impSketch: { banner: { w: 1, h: 1 }, pad: 'p'.repeat(100_000) },
      siblingKeys: Array.from({ length: 500 }, () => 'k'.repeat(10_000)),
    });
  } finally {
    global.fetch = realFetch;
  }
  assert.ok(sent, 'the model was called');
  assert.ok(sent.prompt.length < 8000, `prompt is ${sent.prompt.length} chars`);
});
