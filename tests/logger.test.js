'use strict';

/**
 * tests/logger.test.js — lib/logger.js
 *
 * Smoke-test the pino-based logger: root + child instance, level
 * routing, std err serializer. We don't exercise transports here —
 * pino-pretty is dev-only and the prod JSON path is the library's
 * concern; we just verify our wrapper produces working logger objects
 * and the `child(component)` helper attaches the bindings.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { logger, child, captureException, flushSentry, sentryReady } = require('../lib/logger');

test('logger: root is a pino instance with the expected methods', () => {
  assert.equal(typeof logger.info, 'function');
  assert.equal(typeof logger.error, 'function');
  assert.equal(typeof logger.warn, 'function');
  assert.equal(typeof logger.fatal, 'function');
  assert.equal(typeof logger.child, 'function');
});

test('logger: child() returns a logger with the same shape', () => {
  const sub = child('test-component');
  assert.equal(typeof sub.info, 'function');
  assert.equal(typeof sub.error, 'function');
  assert.equal(typeof sub.child, 'function');
});

test('logger: child bindings attach to log records (via pino.bindings())', () => {
  const sub = child('test-component');
  // Pino exposes the bound fields via `.bindings()`.
  const bindings = sub.bindings();
  assert.equal(bindings.component, 'test-component');
});

test('logger: nested child preserves parent bindings + adds new ones', () => {
  const sub = child('parent');
  const nested = sub.child({ requestId: 'r-1' });
  const bindings = nested.bindings();
  assert.equal(bindings.component, 'parent');
  assert.equal(bindings.requestId, 'r-1');
});

test('logger: level reflects LOG_LEVEL env (silent in test runs)', () => {
  // The npm test script sets LOG_LEVEL=silent. Verify the root logger
  // picked it up — anything else would mean log calls leak to stdout
  // and pollute test output.
  assert.equal(logger.level, 'silent');
});

test('logger: call methods do not throw at any level (silent or not)', () => {
  const sub = child('safety-net');
  // Just call them with the shapes we use in production. None of these
  // should throw — pino swallows at silent level and serializes at
  // info+. The test is "no crash" not "wrote to stdout".
  assert.doesNotThrow(() => sub.info('hello'));
  assert.doesNotThrow(() => sub.info({ k: 'v' }, 'hello with meta'));
  assert.doesNotThrow(() => sub.warn({ err: new Error('boom') }, 'warn with err'));
  assert.doesNotThrow(() => sub.error({ err: new Error('crash') }, 'error with err'));
  assert.doesNotThrow(() => sub.fatal({ err: new Error('die') }, 'fatal with err'));
});

// ── Sentry / GlitchTip integration ─────────────────────────────────────────

test('sentry: not initialized in test env (no DSN configured)', () => {
  // npm test runs with NODE_ENV=test which forces the init path to skip
  // even if SENTRY_DSN happens to be set in the developer's shell. This
  // keeps the suite from POSTing envelopes to a live GlitchTip during
  // CI / local test runs.
  assert.equal(sentryReady(), false);
});

test('sentry: captureException is a safe no-op when Sentry is off', () => {
  // No DSN → no init → captureException should silently swallow. Never
  // throw, never block, never crash the caller. The whole observability
  // story has to fail-safe.
  assert.doesNotThrow(() => captureException(new Error('test')));
  assert.doesNotThrow(() => captureException(new Error('test'), { request: { url: '/x' } }));
  assert.doesNotThrow(() => captureException(undefined));
  assert.doesNotThrow(() => captureException(null));
  assert.doesNotThrow(() => captureException(new Error('test'), { tag: 42, obj: { a: 1 } }));
});

test('sentry: flushSentry resolves true when not initialized', async () => {
  // No flush to do → resolves true immediately. Critical for the
  // graceful-shutdown path in server.js: don't hang on a Sentry flush
  // when the SDK was never wired up.
  const result = await flushSentry(100);
  assert.equal(result, true);
});
