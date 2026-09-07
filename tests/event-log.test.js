'use strict';

/**
 * Current ClickHouse HTTP contract with synthetic JSONEachRow responses.
 * Fixtures inspect requests and supply explicit service replies; they neither
 * interpret SQL nor claim to exercise a live ClickHouse server. Auth privacy
 * retains its separate, unchanged auth-event-pii.test.js coverage.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const NOW = Date.parse('2026-09-07T12:34:56.789Z');
const INSERT = 'INSERT INTO analytics.ortbtools_events FORMAT JSONEachRow';
const settle = () => new Promise((resolve) => setImmediate(resolve));

function harness(t, env = {}) {
  const environment = {
    CLICKHOUSE_URL: 'http://clickhouse.example.invalid:8123///',
    CLICKHOUSE_USER: 'synthetic-event-log',
    CLICKHOUSE_PASSWORD: 'synthetic-key',
    ORTBTOOLS_ANALYTICS_DISABLED: '0',
    ...env,
  };
  const originalEnv = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  const modulePaths = ['../lib/event-log', '../lib/logger', '../lib/analytics-enabled'].map(
    (name) => require.resolve(name),
  );
  const originalModules = modulePaths.map((name) => require.cache[name]);
  const signals = ['SIGTERM', 'SIGINT', 'beforeExit'];
  const originalListeners = new Map(
    signals.map((signal) => [signal, process.rawListeners(signal)]),
  );
  const originalFetch = global.fetch;
  const requests = [];
  const responses = [];
  const unexpected = [];
  const releases = [];
  const messages = [];

  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  t.after(async () => {
    try {
      // Finish any pending work before restoring the real transport. Held
      // replies are released; requests awaiting their deadline are aborted.
      eventLog?.flushNow();
      releases.forEach((release) => release());
      t.mock.timers.tick(5000);
      await settle();
      assert.deepEqual(unexpected, [], 'an HTTP request had no explicit fixture');
      assert.equal(responses.length, 0, 'a supplied HTTP response was never requested');
    } finally {
      for (const signal of signals) {
        for (const listener of process.rawListeners(signal)) {
          if (!originalListeners.get(signal).includes(listener))
            process.removeListener(signal, listener);
        }
      }
      global.fetch = originalFetch;
      modulePaths.forEach((name, index) => {
        if (originalModules[index]) require.cache[name] = originalModules[index];
        else delete require.cache[name];
      });
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      t.mock.timers.reset();
      for (const signal of signals)
        assert.deepEqual(process.rawListeners(signal), originalListeners.get(signal));
    }
  });
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const name of modulePaths) delete require.cache[name];
  // Capture expected failures without loading real logging transports or
  // inheriting an error-reporting destination from the host environment.
  require.cache[modulePaths[1]] = /** @type {any} */ ({
    exports: {
      child: () => ({
        warn: (fields, msg) => messages.push({ level: 'warn', fields, msg }),
        error: (fields, msg) => messages.push({ level: 'error', fields, msg }),
      }),
    },
  });
  global.fetch = async (input, options = {}) => {
    const request = {
      url: new URL(String(input)),
      method: options.method,
      headers: Object.fromEntries(new Headers(options.headers)),
      body: String(options.body || ''),
      signal: options.signal,
    };
    requests.push(request);
    const respond = responses.shift();
    if (!respond) {
      unexpected.push(request.body);
      throw new Error('Unexpected synthetic HTTP request');
    }
    return respond(request);
  };
  const eventLog = require('../lib/event-log');
  return {
    log: eventLog,
    requests,
    messages,
    reply(body = '', status = 200) {
      responses.push(() => new Response(body, { status }));
    },
    fail() {
      responses.push(() => Promise.reject(new Error('synthetic network failure')));
    },
    hold(body) {
      /** @type {() => void} */
      let release;
      const gate = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      releases.push(release);
      responses.push(async () => {
        await gate;
        return new Response(body);
      });
      return release;
    },
    timeout() {
      responses.push(
        ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      );
    },
  };
}

function rows(request) {
  assert.equal(request.url.searchParams.get('query'), INSERT);
  return request.body.split('\n').map((line) => JSON.parse(line));
}

test('event-log: synchronous records become one authenticated JSONEachRow batch', async (t) => {
  const h = harness(t);
  h.reply();
  assert.equal(h.log.record({ level: 'info', component: 'worker', msg: 'first' }), undefined);
  h.log.record({ level: 'warn', component: 'worker', msg: 'second' });
  assert.equal(h.requests.length, 0, 'record should buffer before a timer or explicit flush');
  assert.equal(h.log.flushNow(), undefined, 'flush remains fire-and-forget');
  await settle();
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.url.origin, 'http://clickhouse.example.invalid:8123');
  assert.equal(request.url.pathname, '/');
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.headers, {
    'content-type': 'application/json',
    'x-clickhouse-user': 'synthetic-event-log',
    'x-clickhouse-key': 'synthetic-key',
  });
  assert.deepEqual(
    rows(request),
    ['first', 'second'].map((msg, index) => ({
      ts: '2026-09-07T12:34:56.789',
      level: index === 0 ? 'info' : 'warn',
      component: 'worker',
      msg,
      method: '',
      path: '',
      status: 0,
      latency_ms: 0,
      user_id: 0,
      ip: '',
      request_id: '',
      ctx: '',
    })),
  );
  h.log.flushNow();
  t.mock.timers.tick(5000);
  assert.equal(h.requests.length, 1, 'a drained batch must not be sent twice');
  assert.equal(request.signal.aborted, false, 'a completed request clears its timeout');
});

test('event-log: timer flushes at 500ms and 100 buffered rows trigger an earlier batch', async (t) => {
  const h = harness(t);
  h.reply();
  h.log.record({ level: 'info', component: 'timer', msg: 'timed' });
  t.mock.timers.tick(499);
  assert.equal(h.requests.length, 0);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(
    rows(h.requests[0]).map((row) => row.msg),
    ['timed'],
  );
  h.reply();
  for (let i = 0; i < 100; i++)
    h.log.record({ level: 'info', component: 'burst', msg: `event ${i}` });
  await settle();
  assert.equal(h.requests.length, 2, 'the high-water batch must not wait another 500ms');
  assert.deepEqual(
    rows(h.requests[1]).map((row) => row.msg),
    Array.from({ length: 100 }, (_, i) => `event ${i}`),
  );
  t.mock.timers.tick(500);
  assert.equal(h.requests.length, 2);
});

test('event-log: invalid levels default to info; empty or invalid entries produce no rows', async (t) => {
  const h = harness(t);
  h.reply();
  for (const entry of [null, undefined, 'not an entry', {}, { msg: '' }])
    h.log.record(/** @type {any} */ (entry));
  for (const level of ['info', 'warn', 'error', 'banana'])
    h.log.record(/** @type {any} */ ({ level, msg: level }));
  h.log.flushNow();
  await settle();
  assert.deepEqual(
    rows(h.requests[0]).map(({ level, component, msg }) => ({ level, component, msg })),
    ['info', 'warn', 'error', 'banana'].map((msg) => ({
      level: msg === 'banana' ? 'info' : msg,
      component: 'unknown',
      msg,
    })),
  );
});

test('event-log: HTTP fields and structured context survive the outgoing transport', async (t) => {
  const h = harness(t);
  h.reply();
  /** @type {Parameters<typeof h.log.record>[0]} */
  const entry = {
    level: 'info',
    component: 'http',
    msg: 'GET /api/synthetic → 200',
    method: 'GET',
    path: '/api/synthetic',
    status: 200,
    latency_ms: 42,
    user_id: 7,
    ip: '192.0.2.7',
    request_id: 'synthetic-request',
    ctx: { sampled: true, nested: { count: 7 } },
  };
  h.log.record(entry);
  h.log.flushNow();
  await settle();
  assert.deepEqual(rows(h.requests[0]), [
    { ...entry, ts: '2026-09-07T12:34:56.789', ctx: JSON.stringify(entry.ctx) },
  ]);
  assert.deepEqual(entry.ctx, { sampled: true, nested: { count: 7 } });
});

test('event-log: oversized fields are bounded and unserializable context cannot throw', async (t) => {
  const h = harness(t);
  h.reply();
  const ctx = {};
  ctx.self = ctx;
  assert.doesNotThrow(() =>
    h.log.record({
      level: 'error',
      component: 'c'.repeat(40),
      msg: 'm'.repeat(600),
      method: 'x'.repeat(20),
      path: '/'.repeat(600),
      ip: 'i'.repeat(80),
      request_id: 'r'.repeat(50),
      status: NaN,
      latency_ms: Infinity,
      user_id: /** @type {any} */ ('7'),
      ctx,
    }),
  );
  h.log.flushNow();
  await settle();
  const [row] = rows(h.requests[0]);
  assert.deepEqual(
    [
      row.component.length,
      row.msg.length,
      row.method.length,
      row.path.length,
      row.ip.length,
      row.request_id.length,
    ],
    [32, 500, 8, 500, 64, 32],
  );
  assert.deepEqual([row.status, row.latency_ms, row.user_id], [0, 0, 0]);
  assert.equal(JSON.parse(row.ctx), '[unserializable]');
});

test('event-log: count and rows use identical escaped filters and inclusive/exclusive time bounds', async (t) => {
  const h = harness(t);
  h.reply('{"n":"0"}\n');
  h.reply();
  assert.deepEqual(
    await h.log.query({
      since: 1700000000000.9,
      until: 1700000001000.9,
      level: 'warn',
      component: "ops\\team' OR 1=1 --\nnext\rrow",
      user_id: 7.9,
      limit: 17,
      offset: 6.9,
    }),
    { items: [], total: 0 },
  );
  const where =
    'WHERE ts >= fromUnixTimestamp64Milli(1700000000000) AND ' +
    'ts < fromUnixTimestamp64Milli(1700000001000) AND ' +
    String.raw`level = 'warn' AND component = 'ops\\team\' OR 1=1 --\nnext\rrow' AND user_id = 7`;
  assert.equal(
    h.requests[0].body,
    `SELECT count() AS n FROM analytics.ortbtools_events ${where} FORMAT JSONEachRow`,
  );
  assert.equal(
    h.requests[1].body,
    'SELECT toUnixTimestamp64Milli(ts) AS ts, level, component, msg, method, path, ' +
      'status, latency_ms, user_id, ip, request_id, ctx ' +
      `FROM analytics.ortbtools_events ${where} ORDER BY ts DESC LIMIT 17 OFFSET 6 FORMAT JSONEachRow`,
  );
  for (const request of h.requests) {
    assert.equal(request.url.href, 'http://clickhouse.example.invalid:8123/');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['x-clickhouse-user'], 'synthetic-event-log');
    assert.equal(request.headers['x-clickhouse-key'], 'synthetic-key');
  }
});

for (const [name, filters, page] of [
  ['defaults', undefined, '200 OFFSET 0'],
  ['upper limit and negative offset', { limit: 9000, offset: -10 }, '1000 OFFSET 0'],
  ['lower limit and fractional offset', { limit: -2, offset: 3.9 }, '1 OFFSET 3'],
  ['numeric strings', { limit: '17', offset: '6' }, '17 OFFSET 6'],
  ['non-numeric pagination', { limit: '1; DROP TABLE x', offset: 'NaN' }, '200 OFFSET 0'],
  [
    'unsupported filters',
    { level: "warn' OR 1=1", since: Infinity, until: NaN, user_id: '7', component: 7 },
    '200 OFFSET 0',
  ],
]) {
  test(`event-log: query pagination and filters handle ${name}`, async (t) => {
    const h = harness(t);
    h.reply('{"n":0}');
    h.reply();
    assert.deepEqual(await h.log.query(/** @type {any} */ (filters)), { items: [], total: 0 });
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests[1].body.endsWith(`ORDER BY ts DESC LIMIT ${page} FORMAT JSONEachRow`));
    assert.ok(h.requests.every((request) => !request.body.includes('WHERE')));
  });
}

test('event-log: async reads map rows, retain service order, and separate total from page length', async (t) => {
  const h = harness(t);
  const releaseCount = h.hold('{"n":"12"}\n');
  h.reply(
    [
      JSON.stringify({
        ts: String(NOW),
        level: 'warn',
        component: 'http',
        msg: 'newer',
        method: 'POST',
        path: '/api/synthetic',
        status: '202',
        latency_ms: '42',
        user_id: '7',
        ip: '192.0.2.7',
        request_id: 'synthetic-request',
        ctx: JSON.stringify({ nested: { count: 7 } }),
      }),
      'invalid JSON',
      'null',
      JSON.stringify({
        ts: NOW - 1000,
        msg: 'older',
        status: 0,
        latency_ms: '0',
        user_id: 'NaN',
        ctx: 'not JSON',
      }),
      '',
    ].join('\n'),
  );
  const resultPromise = h.log.query({ limit: 2 });
  assert.ok(resultPromise instanceof Promise);
  assert.equal(h.requests.length, 1, 'rows must wait for the count response');
  releaseCount();
  const result = await resultPromise;
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[1].body, /ORDER BY ts DESC LIMIT 2 OFFSET 0/);
  assert.deepEqual(result, {
    total: 12,
    items: [
      {
        id: NOW,
        ts: NOW,
        level: 'warn',
        component: 'http',
        msg: 'newer',
        method: 'POST',
        path: '/api/synthetic',
        status: 202,
        latency_ms: 42,
        user_id: 7,
        ip: '192.0.2.7',
        request_id: 'synthetic-request',
        ctx: { nested: { count: 7 } },
      },
      {
        id: NOW - 1000,
        ts: NOW - 1000,
        level: 'info',
        component: '',
        msg: 'older',
        method: null,
        path: null,
        status: null,
        latency_ms: null,
        user_id: null,
        ip: null,
        request_id: null,
        ctx: null,
      },
    ],
  });
});

test('event-log: query starts flushing recent writes before reading without awaiting the insert', async (t) => {
  const h = harness(t);
  const releaseInsert = h.hold('');
  h.reply('{"n":0}');
  h.reply();
  h.log.record({ level: 'info', component: 'worker', msg: 'still inserting' });
  assert.deepEqual(await h.log.query(), { items: [], total: 0 });
  assert.equal(h.requests.length, 3);
  assert.equal(rows(h.requests[0])[0].msg, 'still inserting');
  assert.match(h.requests[1].body, /^SELECT count\(\)/);
  releaseInsert();
  await settle();
});

test('event-log: listComponents requests distinct sorted names and ignores malformed response entries', async (t) => {
  const h = harness(t);
  h.reply();
  h.reply(
    '{"component":"http"}\n{"component":"worker"}\n{"component":""}\n{"component":7}\ninvalid\nnull\n',
  );
  h.log.record({ level: 'info', component: 'worker', msg: 'before component query' });
  assert.deepEqual(await h.log.listComponents(), ['http', 'worker']);
  assert.equal(h.requests.length, 2);
  assert.equal(rows(h.requests[0]).length, 1);
  assert.equal(
    h.requests[1].body,
    'SELECT DISTINCT component FROM analytics.ortbtools_events ORDER BY component FORMAT JSONEachRow',
  );
});

test('event-log: retention is 90 days and compatibility pruning issues no client-side deletion', async (t) => {
  const h = harness(t);
  assert.equal(h.log.RETENTION_DAYS, 90);
  for (const days of [0, 7, 90, 365]) assert.equal(h.log.pruneOlderThan(days), 0);
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  await settle();
  assert.deepEqual(h.requests, []);
});

for (const [name, env] of [
  ['missing ClickHouse user', { CLICKHOUSE_USER: undefined }],
  ['explicit analytics opt-out with credentials present', { ORTBTOOLS_ANALYTICS_DISABLED: '1' }],
]) {
  test(`event-log: ${name} disables writes and reads with one warning`, async (t) => {
    const h = harness(t, env);
    for (let i = 0; i < 101; i++)
      h.log.record({ level: 'info', component: 'worker', msg: 'dropped' });
    h.log.flushNow();
    t.mock.timers.tick(5000);
    assert.deepEqual(await h.log.query(), { items: [], total: 0 });
    assert.deepEqual(await h.log.listComponents(), []);
    assert.deepEqual(h.requests, []);
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].level, 'warn');
    assert.match(h.messages[0].msg, /no-op mode/);
  });
}

test('event-log: an enabled deployment without a password omits the key header', async (t) => {
  const h = harness(t, { CLICKHOUSE_PASSWORD: undefined });
  h.reply();
  h.log.record({ level: 'info', component: 'worker', msg: 'password optional' });
  h.log.flushNow();
  await settle();
  assert.equal(h.requests[0].headers['x-clickhouse-user'], 'synthetic-event-log');
  assert.equal(h.requests[0].headers['x-clickhouse-key'], undefined);
});

test('event-log: failed inserts drop their batch without blocking later writes', async (t) => {
  const h = harness(t);
  h.reply('synthetic unavailable', 503);
  h.fail();
  h.reply();
  for (const msg of ['HTTP failure', 'network failure', 'recovered']) {
    assert.doesNotThrow(() => h.log.record({ level: 'error', component: 'worker', msg }));
    assert.doesNotThrow(() => h.log.flushNow());
    await settle();
  }
  assert.deepEqual(
    h.requests.map((request) => rows(request)[0].msg),
    ['HTTP failure', 'network failure', 'recovered'],
  );
  assert.equal(h.messages.length, 2);
  assert.ok(
    h.messages.every((message) => message.level === 'error' && message.fields.dropped === 1),
  );
  assert.equal(h.messages[0].fields.status, 503);
  t.mock.timers.tick(10000);
  assert.equal(h.requests.length, 3, 'failed batches are dropped rather than retried indefinitely');
});

test('event-log: failed count or row requests return empty results; component failure returns no names', async (t) => {
  const h = harness(t);
  h.reply('synthetic failure', 503);
  assert.deepEqual(await h.log.query(), { items: [], total: 0 });
  assert.equal(h.requests.length, 1, 'a failed count must not trigger a row query');
  h.reply('{"n":"12"}');
  h.fail();
  assert.deepEqual(await h.log.query(), { items: [], total: 0 });
  h.reply('synthetic failure', 500);
  assert.deepEqual(await h.log.listComponents(), []);
  assert.deepEqual(
    h.messages.map((message) => message.msg),
    ['query failed', 'query failed', 'listComponents failed'],
  );
});

test('event-log: insert and query requests abort after 5 seconds without escaping callers', async (t) => {
  const h = harness(t);
  h.timeout();
  h.log.record({ level: 'warn', component: 'worker', msg: 'insert timeout' });
  h.log.flushNow();
  t.mock.timers.tick(4999);
  assert.equal(h.requests[0].signal.aborted, false);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.messages[0].fields.dropped, 1);
  h.timeout();
  const resultPromise = h.log.query();
  t.mock.timers.tick(5000);
  assert.deepEqual(await resultPromise, { items: [], total: 0 });
  assert.equal(h.requests[1].signal.aborted, true);
  assert.equal(h.messages[1].msg, 'query failed');
});
