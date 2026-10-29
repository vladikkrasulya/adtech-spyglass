'use strict';

/**
 * lib/byte-budget.js and its wiring: the analysis endpoints are CPU-bound in
 * proportion to body size, so the per-address request COUNT alone let one
 * address monopolise the single event loop with maximal bodies.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createByteBudget, declaredBodyCost } = require('../lib/byte-budget');
const { MAX_BODY_BYTES } = require('../lib/http');
const { createAnalyzeModule } = require('../modules/analyze/handler');
const { createReplayModule } = require('../modules/replay/handler');
const { createMirrorModule } = require('../modules/mirror/handler');

test('the budget is per key, rolling, and charges nothing for a refused request', () => {
  const budget = createByteBudget({ windowMs: 60_000, maxBytes: 1000 });
  assert.equal(budget('a', 600), true);
  assert.equal(budget('a', 600), false, 'would exceed');
  assert.equal(budget('a', 400), true, 'a refusal must not have spent anything');
  assert.equal(budget('a', 1), false);
  assert.equal(budget('b', 1000), true, 'other keys have their own budget');
});

test('the window rolls over', async () => {
  const budget = createByteBudget({ windowMs: 30, maxBytes: 100 });
  assert.equal(budget('a', 100), true);
  assert.equal(budget('a', 1), false);
  await new Promise((r) => setTimeout(r, 45));
  assert.equal(budget('a', 100), true);
});

test('declaredBodyCost uses Content-Length, and the global cap when unknown or absurd', () => {
  assert.equal(declaredBodyCost({ headers: { 'content-length': '1234' } }), 1234);
  assert.equal(declaredBodyCost({ headers: { 'content-length': '0' } }), 1, 'never free');
  assert.equal(declaredBodyCost({ headers: { 'content-length': '999999999' } }), MAX_BODY_BYTES);
  for (const headers of [
    {},
    { 'content-length': 'abc' },
    { 'content-length': '-5' },
    { 'transfer-encoding': 'chunked' },
  ]) {
    assert.equal(declaredBodyCost({ headers }), MAX_BODY_BYTES, JSON.stringify(headers));
  }
  assert.equal(declaredBodyCost(/** @type {any} */ (undefined)), MAX_BODY_BYTES);
});

function res() {
  return {
    statusCode: 0,
    body: '',
    setHeader() {},
    writeHead(s) {
      this.statusCode = s;
    },
    end(b) {
      this.body += b || '';
    },
  };
}

/** @returns {any} */
function request(contentLength) {
  const req = new EventEmitter();
  Object.assign(req, {
    headers: { 'content-length': String(contentLength), 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.5' },
  });
  setImmediate(() => {
    req.emit('data', Buffer.from('{}'));
    req.emit('end');
  });
  return req;
}

const noop = () => ({});
const common = {
  analyzeLimiter: () => true,
  auth: { clientIp: () => '203.0.113.5', getCurrentUser: () => null },
  ANALYZE_MAX_PER_WINDOW: 60,
  resolveLocale: () => 'en',
  resolveDialect: () => 'iab',
};

test('analyze, replay and mirror answer 429 when the address has spent its byte budget', async () => {
  const budget = createByteBudget({ maxBytes: 5000 });
  const handlers = [
    createAnalyzeModule({
      ...common,
      analyzeBudget: budget,
      behaviorLimiter: () => true,
      BEHAVIOR_MAX_PER_WINDOW: 20,
      validate: noop,
      crosscheck: noop,
      analyzeBehavior: noop,
      extractAllCategories: noop,
      detectFormat: noop,
      unionFormat: noop,
      AnalyzeLog: { record: noop },
    }),
    createReplayModule({
      ...common,
      analyzeBudget: budget,
      validate: noop,
      crosscheck: noop,
      analyzeBehavior: noop,
      replay: noop,
    }),
    createMirrorModule({ ...common, analyzeBudget: budget, mirror: noop }),
  ].map((m) => m.routes[0].handler);

  const first = res();
  await handlers[0](request(4000), first, new URL('http://x/api/analyze'));
  assert.notEqual(first.statusCode, 429, 'the first request fits');
  for (const handler of handlers) {
    const r = res();
    await handler(request(4000), r, new URL('http://x/api/y'));
    assert.equal(r.statusCode, 429);
    assert.match(r.body, /rate_limited/);
  }
});
