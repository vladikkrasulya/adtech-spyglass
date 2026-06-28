'use strict';

/**
 * tests/stream-demand-gating.test.js — modules/stream/handler.js
 *
 * The synthetic stream generator is demand-gated: it starts on the first
 * /api/v1/stream (SSE) subscriber and stops when the last one disconnects.
 * These tests pin two invariants that keep it from either ticking for nobody
 * or stopping while a viewer is still attached:
 *
 *   1. start() fires once on the first subscriber, stop() once when the last
 *      leaves — and never while a viewer remains.
 *   2. cleanup is idempotent: `close` and `error` both firing on a single
 *      connection must not double-decrement the active-subscriber count
 *      (which would stop the generator out from under other viewers).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { createStreamModule } = require('../modules/stream/handler');

// Minimal fake generator: an EventEmitter that also tracks start/stop the way
// SyntheticGenerator does (both idempotent at the class level).
function makeFakeGenerator() {
  const gen = /** @type {any} */ (new EventEmitter());
  gen.setMaxListeners(0);
  gen.starts = 0;
  gen.stops = 0;
  gen.running = false;
  gen.start = () => {
    if (gen.running) return gen;
    gen.running = true;
    gen.starts += 1;
    return gen;
  };
  gen.stop = () => {
    if (!gen.running) return gen;
    gen.running = false;
    gen.stops += 1;
    return gen;
  };
  return gen;
}

// Minimal fake req/res for the SSE handler. req is an EventEmitter so the test
// can drive 'close'/'error'; res swallows all writes.
function makeReqRes(ip) {
  const req = /** @type {any} */ (new EventEmitter());
  req.headers = { 'x-forwarded-for': ip };
  req.socket = { remoteAddress: ip };
  const res = /** @type {any} */ ({ writeHead() {}, write() {}, end() {} });
  return { req, res };
}

function newModule() {
  const gen = makeFakeGenerator();
  const mod = createStreamModule({
    streamGenerator: gen,
    streamBuffer: [],
    STREAM_REPLAY_MAX: 0,
    STREAM_HEARTBEAT_MS: 1000000, // effectively no heartbeat tick during a test
    // no db → specimen store stays uninitialised (fail-open)
  });
  const handler = mod.routes.find((r) => r.path === '/api/v1/stream').handler;
  return { gen, handler };
}

test('stream: generator starts on the first subscriber, not before', () => {
  const { gen, handler } = newModule();
  assert.equal(gen.starts, 0);
  const a = makeReqRes('10.0.0.1');
  handler(a.req, a.res);
  assert.equal(gen.starts, 1, 'first subscriber starts the generator');
  assert.equal(gen.running, true);
  a.req.emit('close'); // drain so the heartbeat interval is cleared
});

test('stream: generator stays up across subscribers, stops only on the last', () => {
  const { gen, handler } = newModule();
  const a = makeReqRes('10.0.0.1');
  const b = makeReqRes('10.0.0.2');
  handler(a.req, a.res);
  handler(b.req, b.res);
  assert.equal(gen.starts, 1, 'second subscriber does not re-start');

  a.req.emit('close');
  assert.equal(gen.running, true, 'generator stays up while one viewer remains');
  assert.equal(gen.stops, 0);

  b.req.emit('close');
  assert.equal(gen.running, false, 'generator stops when the last viewer leaves');
  assert.equal(gen.stops, 1);
});

test('stream: cleanup is idempotent — close+error on one conn do not double-count', () => {
  const { gen, handler } = newModule();
  const a = makeReqRes('10.0.0.1');
  const b = makeReqRes('10.0.0.2');
  handler(a.req, a.res);
  handler(b.req, b.res);

  // Connection A fires BOTH error and close (abrupt reset). The second event
  // must be a no-op — it must not decrement the active count twice and stop
  // the generator while viewer B is still connected.
  a.req.emit('error', new Error('reset'));
  a.req.emit('close');
  assert.equal(gen.running, true, 'B still connected → generator stays up');
  assert.equal(gen.stops, 0, 'double cleanup on A must not stop the generator');

  b.req.emit('close');
  assert.equal(gen.running, false);
  assert.equal(gen.stops, 1, 'generator stops exactly once, on the true last leave');
});

test('stream: re-subscribe after a full drain re-starts the generator', () => {
  const { gen, handler } = newModule();
  const a = makeReqRes('10.0.0.1');
  handler(a.req, a.res);
  a.req.emit('close');
  assert.equal(gen.running, false);

  const b = makeReqRes('10.0.0.2');
  handler(b.req, b.res);
  assert.equal(gen.starts, 2, 'a fresh viewer after drain spins it back up');
  assert.equal(gen.running, true);
  b.req.emit('close');
});

test('stream: per-IP connection cap returns 429 without touching the generator', () => {
  const { gen, handler } = newModule();
  const cap = Number(process.env.STREAM_MAX_CONNS_PER_IP) || 8;
  const live = [];
  for (let i = 0; i < cap; i++) {
    const c = makeReqRes('10.0.0.9');
    handler(c.req, c.res);
    live.push(c);
  }
  assert.equal(gen.starts, 1, 'generator started once for the IP');
  // One past the cap: capture the status code and assert no extra sub is counted.
  const over = makeReqRes('10.0.0.9');
  let status = 0;
  over.res.writeHead = (code) => {
    status = code;
  };
  handler(over.req, over.res);
  assert.equal(status, 429, 'over-cap connection is rejected');

  // Drain all accepted connections; generator stops exactly once.
  for (const c of live) c.req.emit('close');
  assert.equal(gen.running, false);
  assert.equal(gen.stops, 1, 'rejected connection never inflated the active count');
});
