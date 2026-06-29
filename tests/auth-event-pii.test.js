'use strict';

/**
 * tests/auth-event-pii.test.js — auth-telemetry PII boundary (v1.2.1).
 *
 * Auth events (component='auth') are RECONSTRUCTED at the event-log boundary
 * from the minimal approved contract. These tests inspect the EXACT serialized
 * ClickHouse JSONEachRow body (global.fetch stubbed — no real CH is contacted)
 * and assert that nothing caller-controlled survives except the validated level
 * and the two finite ctx enums:
 *   - msg is derived internally from reason_code (never the caller's msg);
 *   - method/path/status/latency_ms/user_id/ip/request_id are zeroed;
 *   - ctx is exactly { outcome, reason_code } — all other keys dropped;
 *   - a malformed contract drops the event (fail closed);
 *   - non-auth events are byte-compatible with the previous behavior;
 *   - auth is never blocked by a dropped event or an insert failure.
 *
 * All fixture addresses/secrets are synthetic example-domain / sentinel values.
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
const { authContract } = eventLog;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Caller-controlled PII/secret sentinels we try to smuggle through every field.
const EMAIL = 'attacker@example.com';
const TOKEN = 'eyJhbGciOiJI.tok_SENTINEL.sig';
const PASSWORD = 'hunter2_SENTINEL';
const RECOVERY = 'RK-SENTINEL-1234';
const RAWERR = 'bcrypt failed for attacker@example.com';
const SESSION = 'sid_SENTINEL_9f';
const SENTINELS = [EMAIL, TOKEN, PASSWORD, RECOVERY, SESSION, 'SENTINEL', 'invalid credentials'];
// The only msg labels the boundary may ever emit for an auth event.
const FIXED_MSGS = new Set(['login success', 'login rate-limited', 'login failed']);

// ── Stub the CH insert so we can read the serialized rows ────────────────────
let bodies = [];
let fetchMode = 'ok';
const realFetch = global.fetch;
beforeEach(() => {
  bodies = [];
  fetchMode = 'ok';
  global.fetch = async (_url, opts) => {
    bodies.push(opts && opts.body);
    if (fetchMode === 'throw') throw new Error('network down');
    return /** @type {any} */ ({ ok: true, status: 200, text: async () => '' });
  };
});
afterEach(() => {
  global.fetch = realFetch;
});

// record() one entry and return the serialized rows it produced (parsed).
// Resets the capture buffer first so each call is isolated within a test.
async function recordRows(entry) {
  bodies = [];
  eventLog.record(entry);
  eventLog.flushNow();
  await new Promise((r) => setImmediate(r)); // let postBatch microtasks settle
  const joined = bodies.filter(Boolean).join('\n').trim();
  return joined ? joined.split('\n').map((l) => JSON.parse(l)) : [];
}
function authEntry(ctx, extra) {
  return { level: 'warn', component: 'auth', ctx, ...extra };
}

// ── authContract unit contract ──────────────────────────────────────────────
test('authContract accepts only both-valid enums; reduces to the two keys', () => {
  assert.deepEqual(authContract({ outcome: 'success', reason_code: 'ok', email: EMAIL }), {
    outcome: 'success',
    reason_code: 'ok',
  });
  assert.deepEqual(authContract({ outcome: 'failure', reason_code: 'wrong_password' }), {
    outcome: 'failure',
    reason_code: 'wrong_password',
  });
});
test('authContract fails closed on missing/invalid/non-object', () => {
  assert.equal(authContract({ reason_code: 'ok' }), null); // missing outcome
  assert.equal(authContract({ outcome: 'success' }), null); // missing reason_code
  assert.equal(authContract({ outcome: 'maybe', reason_code: 'ok' }), null);
  assert.equal(authContract({ outcome: 'success', reason_code: 'nope' }), null);
  assert.equal(authContract(null), null);
  assert.equal(authContract('outcome=success'), null);
  assert.equal(authContract([{ outcome: 'success', reason_code: 'ok' }]), null);
});

// ── 1 + 11. Caller msg cannot inject PII or alter the mapped label ──────────
test('caller msg containing an email never survives; msg is the fixed mapped label', async () => {
  const rows = await recordRows(
    authEntry({ outcome: 'failure', reason_code: 'rate_limited' }, { msg: `login for ${EMAIL}` }),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].msg, 'login rate-limited');
  assert.equal(EMAIL_RE.test(JSON.stringify(rows[0])), false);
});
test('reason_code → fixed msg mapping (success/rate-limited/failed×2)', async () => {
  const cases = [
    [{ outcome: 'success', reason_code: 'ok' }, 'login success'],
    [{ outcome: 'failure', reason_code: 'rate_limited' }, 'login rate-limited'],
    [{ outcome: 'failure', reason_code: 'wrong_password' }, 'login failed'],
    [{ outcome: 'failure', reason_code: 'no_such_user' }, 'login failed'],
  ];
  for (const [ctx, expected] of cases) {
    const rows = await recordRows(authEntry(ctx, { msg: 'ATTACKER CONTROLLED ' + EMAIL }));
    assert.equal(rows[0].msg, expected);
    assert.ok(FIXED_MSGS.has(rows[0].msg));
  }
});

// ── 2. Tokens / passwords / recovery keys / raw error in msg never survive ──
test('caller msg with token/password/recovery/raw-error never reaches the row', async () => {
  for (const secret of [TOKEN, PASSWORD, RECOVERY, RAWERR]) {
    const rows = await recordRows(
      authEntry({ outcome: 'failure', reason_code: 'wrong_password' }, { msg: secret }),
    );
    const blob = JSON.stringify(rows[0]);
    assert.equal(rows[0].msg, 'login failed');
    for (const s of SENTINELS) assert.equal(blob.includes(s), false, `leaked: ${s}`);
  }
});

// ── 3. request_id is a correlation id — always emptied ──────────────────────
test('caller request_id (even with email/session/token) is emptied', async () => {
  const rows = await recordRows(
    authEntry({ outcome: 'success', reason_code: 'ok' }, { request_id: `${SESSION}-${EMAIL}` }),
  );
  assert.equal(rows[0].request_id, '');
  assert.equal(EMAIL_RE.test(JSON.stringify(rows[0])), false);
});

// ── 4 + 5. status/latency/method/path/ip/user_id all zeroed ─────────────────
test('caller status/latency/method/path/ip/user_id do not survive', async () => {
  const rows = await recordRows(
    authEntry(
      { outcome: 'success', reason_code: 'ok' },
      {
        status: 200,
        latency_ms: 1234,
        method: 'POST',
        path: '/api/auth/login?u=' + EMAIL,
        ip: '203.0.113.7',
        user_id: 42,
        request_id: SESSION,
      },
    ),
  );
  const r = rows[0];
  assert.equal(r.status, 0);
  assert.equal(r.latency_ms, 0);
  assert.equal(r.method, '');
  assert.equal(r.path, '');
  assert.equal(r.ip, '');
  assert.equal(r.user_id, 0);
  assert.equal(r.request_id, '');
});

// ── 6 + 7. Unused ex-allowlist ctx fields dropped; valid enums survive ──────
test('auth_action/locale/status_code/rate_limited are dropped; ctx is exactly {outcome,reason_code}', async () => {
  const rows = await recordRows(
    authEntry({
      outcome: 'failure',
      reason_code: 'no_such_user',
      auth_action: 'login',
      locale: 'uk',
      status_code: 401,
      rate_limited: true,
      email: EMAIL,
      nested: { token: TOKEN },
    }),
  );
  assert.deepEqual(JSON.parse(rows[0].ctx), { outcome: 'failure', reason_code: 'no_such_user' });
});

// ── 8 + 9 + 10. Fail-closed: unknown/missing contract drops the event ───────
test('unknown reason_code drops the event (no row inserted)', async () => {
  assert.deepEqual(await recordRows(authEntry({ outcome: 'failure', reason_code: 'teapot' })), []);
});
test('missing outcome drops the event', async () => {
  assert.deepEqual(await recordRows(authEntry({ reason_code: 'ok' })), []);
});
test('missing reason_code drops the event', async () => {
  assert.deepEqual(await recordRows(authEntry({ outcome: 'success' })), []);
});
test('missing/non-object ctx drops the event', async () => {
  assert.deepEqual(await recordRows({ level: 'info', component: 'auth' }), []);
  assert.deepEqual(await recordRows({ level: 'info', component: 'auth', ctx: 'x' }), []);
});

// ── 12. Non-auth events remain byte-compatible ──────────────────────────────
test('non-auth (http) events preserve msg, ctx, ip, user_id, path, status, latency', async () => {
  const rows = await recordRows({
    level: 'info',
    component: 'http',
    msg: 'POST /api/analyze',
    method: 'POST',
    path: '/api/analyze',
    status: 200,
    latency_ms: 12,
    user_id: 7,
    ip: '198.51.100.9',
    request_id: 'abc123',
    ctx: { sampled: true },
  });
  const r = rows[0];
  assert.equal(r.msg, 'POST /api/analyze');
  assert.equal(r.method, 'POST');
  assert.equal(r.path, '/api/analyze');
  assert.equal(r.status, 200);
  assert.equal(r.latency_ms, 12);
  assert.equal(r.user_id, 7);
  assert.equal(r.ip, '198.51.100.9');
  assert.equal(r.request_id, 'abc123');
  assert.deepEqual(JSON.parse(r.ctx), { sampled: true });
});
test('non-auth empty msg is still dropped (unchanged behavior)', async () => {
  assert.deepEqual(await recordRows({ level: 'info', component: 'http', msg: '' }), []);
});

// ── 13. Auth stays non-blocking on insert failure and on drop ───────────────
test('insert failure / dropped event never throws from record() or flush', async () => {
  fetchMode = 'throw';
  await assert.doesNotReject(async () =>
    recordRows(authEntry({ outcome: 'success', reason_code: 'ok' })),
  );
  assert.doesNotThrow(() => eventLog.record(authEntry({ outcome: 'bad', reason_code: 'bad' })));
});

// ── 14. Exhaustive: the serialized auth row holds no caller free-form string ─
test('exhaustive smuggle attempt: serialized auth row contains only finite values', async () => {
  const rows = await recordRows(
    authEntry(
      { outcome: 'success', reason_code: 'ok', email: EMAIL, note: RAWERR, token: TOKEN },
      {
        msg: `${EMAIL} ${TOKEN} ${PASSWORD}`,
        method: EMAIL,
        path: EMAIL,
        ip: EMAIL,
        user_id: 99,
        status: 401,
        latency_ms: 7,
        request_id: `${SESSION} ${RECOVERY}`,
      },
    ),
  );
  const r = rows[0];
  const blob = JSON.stringify(r);
  for (const s of SENTINELS) assert.equal(blob.includes(s), false, `leaked sentinel: ${s}`);
  assert.equal(EMAIL_RE.test(blob), false);
  assert.equal(r.component, 'auth');
  assert.ok(['info', 'warn', 'error'].includes(r.level));
  assert.ok(FIXED_MSGS.has(r.msg));
  assert.deepEqual(JSON.parse(r.ctx), { outcome: 'success', reason_code: 'ok' });
  assert.equal(r.method === '' && r.path === '' && r.ip === '' && r.request_id === '', true);
  assert.equal(r.status === 0 && r.latency_ms === 0 && r.user_id === 0, true);
});

test('getter TOCTOU and wrapper-object outcome cannot smuggle a value', async () => {
  let reads = 0;
  const evil = {
    reason_code: 'ok',
    get outcome() {
      reads += 1;
      return reads === 1 ? 'success' : EMAIL; // flip after the validation read
    },
  };
  const rows = await recordRows({ level: 'info', component: 'auth', ctx: evil });
  if (rows.length) {
    assert.deepEqual(JSON.parse(rows[0].ctx), { outcome: 'success', reason_code: 'ok' });
    assert.equal(EMAIL_RE.test(JSON.stringify(rows[0])), false);
  }
  // A String wrapper object is not the primitive enum value → fail closed.
  const wrapped = await recordRows({
    level: 'info',
    component: 'auth',
    ctx: { outcome: Object('success'), reason_code: 'ok' },
  });
  assert.equal(wrapped.length, 0);
});

test('this file uses only synthetic example-domain addresses (no real PII fixtures)', () => {
  const src = fs.readFileSync(__filename, 'utf8');
  const found = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(?:com|org|net|io|co)\b/gi) || [];
  assert.ok(found.length > 0);
  for (const e of found) assert.match(e, /@example\.(?:com|org|net)$/, `non-example: ${e}`);
});
