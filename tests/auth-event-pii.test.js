'use strict';

/**
 * tests/auth-event-pii.test.js — CP1A.1 auth-telemetry PII boundary (v1.2.1).
 *
 * Proves that component='auth' events can never carry PII:
 *   - ctx is reduced to a finite, value-validated allowlist;
 *   - top-level ip / user_id / method / path are zeroed;
 *   - the enforcement lives at the event-log boundary (defense in depth), so a
 *     regressed call site still cannot leak email/PII;
 *   - the rule is scoped to auth — http and every other component are untouched;
 *   - auth operations are never broken by a telemetry/insert failure.
 *
 * Strategy: contract tests on the exported sanitizer PLUS end-to-end tests that
 * assert the EXACT serialized ClickHouse insert body (global.fetch stubbed — no
 * real CH is contacted). All fixture addresses are synthetic example domains.
 */

// Enable the CH writer path BEFORE requiring the module (CH_ENABLED is computed
// at require time). No network is used — fetch is stubbed in beforeEach.
process.env.CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://ch.invalid:8123';
process.env.CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'test';
process.env.CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || 'x';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const eventLog = require('../lib/event-log');
const { sanitizeAuthCtx } = eventLog;

// Broad email-shaped detector for "does the serialized row contain an address".
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// ── Stub the CH insert so we can read the serialized body ───────────────────
let bodies = [];
let fetchMode = 'ok';
const realFetch = global.fetch;
beforeEach(() => {
  bodies = [];
  fetchMode = 'ok';
  global.fetch = async (_url, opts) => {
    bodies.push(opts && opts.body);
    if (fetchMode === 'throw') throw new Error('network down');
    // Minimal CH-insert response stub; cast since we only use `ok`/`status`.
    return /** @type {any} */ ({ ok: true, status: 200, text: async () => '' });
  };
});
afterEach(() => {
  global.fetch = realFetch;
});

async function flushAndCollect() {
  eventLog.flushNow();
  // postBatch is fire-and-forget; let its microtasks settle before asserting.
  await new Promise((r) => setImmediate(r));
  return bodies.filter(Boolean).join('\n');
}
function lastRow(body) {
  return JSON.parse(body.trim().split('\n').pop());
}

// ── Boundary contract: sanitizeAuthCtx ──────────────────────────────────────
test('explicit email key is dropped', () => {
  assert.deepEqual(sanitizeAuthCtx({ email: 'user@example.com', reason_code: 'ok' }), {
    reason_code: 'ok',
  });
});

test('alternate email-ish keys are dropped (userEmail/account/email_address)', () => {
  assert.deepEqual(
    sanitizeAuthCtx({
      userEmail: 'a@example.com',
      account: 'a@example.com',
      email_address: 'a@example.com',
      outcome: 'success',
    }),
    { outcome: 'success' },
  );
});

test('nested objects are dropped — allowlist builds a flat object', () => {
  const out = sanitizeAuthCtx({ user: { email: 'a@example.com' }, outcome: 'failure' });
  assert.deepEqual(out, { outcome: 'failure' });
  assert.equal(EMAIL_RE.test(JSON.stringify(out)), false);
});

test('email-shaped value under an ALLOWED key fails value validation', () => {
  // reason_code is allowlisted, but 'a@example.com' is not in the enum → dropped.
  assert.deepEqual(sanitizeAuthCtx({ reason_code: 'a@example.com', outcome: 'success' }), {
    outcome: 'success',
  });
});

test('raw error / token / session / password / recovery are dropped', () => {
  assert.deepEqual(
    sanitizeAuthCtx({
      error: 'bcrypt failed for a@example.com',
      token: 'abc.def.ghi',
      session_id: 'sid-1',
      password: 'hunter2',
      recovery_key: 'RK-1234',
      outcome: 'failure',
      reason_code: 'wrong_password',
    }),
    { outcome: 'failure', reason_code: 'wrong_password' },
  );
});

test('input ctx object is not mutated', () => {
  const input = { email: 'a@example.com', outcome: 'success' };
  const snapshot = JSON.stringify(input);
  sanitizeAuthCtx(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('allowed finite fields survive unchanged', () => {
  const input = {
    outcome: 'failure',
    reason_code: 'rate_limited',
    auth_action: 'login',
    locale: 'uk',
    status_code: 429,
    rate_limited: true,
  };
  assert.deepEqual(sanitizeAuthCtx(input), input);
});

test('unknown keys fail closed (all dropped)', () => {
  assert.deepEqual(sanitizeAuthCtx({ foo: 1, bar: 'x', whatever: true }), {});
});

test('invalid enum/type values fail closed; non-objects → {}', () => {
  assert.deepEqual(sanitizeAuthCtx({ outcome: 'maybe', reason_code: 123, locale: 'fr' }), {});
  assert.deepEqual(sanitizeAuthCtx(null), {});
  assert.deepEqual(sanitizeAuthCtx('email=a@example.com'), {});
  assert.deepEqual(sanitizeAuthCtx(['a@example.com']), {});
});

// ── End-to-end: serialized CH insert carries no PII ─────────────────────────
test('auth event → serialized insert has no email; ip/user_id/method/path zeroed', async () => {
  eventLog.record({
    level: 'info',
    component: 'auth',
    msg: 'login success',
    method: 'POST',
    path: '/api/auth/login',
    ip: '203.0.113.7',
    user_id: 42,
    ctx: { email: 'real.person@example.com', outcome: 'success', reason_code: 'ok' },
  });
  const body = await flushAndCollect();
  assert.ok(body.length > 0, 'expected a flushed insert body');
  assert.equal(EMAIL_RE.test(body), false, 'serialized insert must contain no email-shaped value');
  const row = lastRow(body);
  assert.equal(row.ip, '');
  assert.equal(row.user_id, 0);
  assert.equal(row.method, '');
  assert.equal(row.path, '');
  assert.deepEqual(JSON.parse(row.ctx), { outcome: 'success', reason_code: 'ok' });
});

test('auth event with a smuggled email under an arbitrary key never reaches the insert', async () => {
  eventLog.record({
    level: 'warn',
    component: 'auth',
    msg: 'login failed: invalid credentials',
    ctx: { email: 'a@example.com', note: 'contact a@example.com', reason_code: 'wrong_password' },
  });
  const body = await flushAndCollect();
  assert.equal(EMAIL_RE.test(body), false);
  assert.deepEqual(JSON.parse(lastRow(body).ctx), { reason_code: 'wrong_password' });
});

test('non-auth (http) events are unchanged — ctx, ip, user_id, path preserved', async () => {
  eventLog.record({
    level: 'info',
    component: 'http',
    msg: 'GET /api/health',
    method: 'GET',
    path: '/api/health',
    status: 200,
    user_id: 7,
    ip: '198.51.100.9',
    ctx: { sampled: true },
  });
  const row = lastRow(await flushAndCollect());
  assert.equal(row.ip, '198.51.100.9');
  assert.equal(row.user_id, 7);
  assert.equal(row.path, '/api/health');
  assert.deepEqual(JSON.parse(row.ctx), { sampled: true });
});

test('insert failure does not throw from record() or flush (non-blocking auth)', async () => {
  fetchMode = 'throw';
  assert.doesNotThrow(() => {
    eventLog.record({
      level: 'info',
      component: 'auth',
      msg: 'login success',
      ctx: { outcome: 'success', reason_code: 'ok' },
    });
  });
  await assert.doesNotReject(async () => {
    await flushAndCollect();
  });
});

test('this file uses only synthetic example-domain addresses (no real PII fixtures)', () => {
  const src = fs.readFileSync(__filename, 'utf8');
  // TLD-anchored so regex *definitions* in this file are not matched as emails.
  const found = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(?:com|org|net|io|co)\b/gi) || [];
  assert.ok(found.length > 0, 'sanity: fixtures should contain example addresses');
  for (const e of found) {
    assert.match(e, /@example\.(?:com|org|net)$/, `non-example email fixture: ${e}`);
  }
});
