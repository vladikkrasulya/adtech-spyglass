'use strict';

/**
 * tests/product-telemetry.test.js — the product-telemetry privacy boundary.
 *
 * The headline guarantee is structural: `buildRow()` REBUILDS every row from a
 * closed contract, so no BidRequest/BidResponse content, IP address, User-Agent
 * string, URL path or free-form text can reach ClickHouse — not by a caller
 * mistake, not by a hostile caller, not by a future refactor that starts
 * passing a bigger object in.
 *
 * These tests assert that by construction (exact key set, adversarial inputs)
 * rather than by spot-checking a happy path.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildRow,
  recordProductEvent,
  isProductTelemetryEnabled,
  sanitizeId,
  sanitizeReferrerHost,
  sanitizeUtm,
  pendingCount,
  resetForTest,
  PRODUCT_EVENTS,
  SURFACES,
  LOCALES,
  ROW_KEYS,
} = require('../lib/product-telemetry');

const { createTelemetryModule, isSameSiteBeacon } = require('../modules/telemetry/handler');

const ROOT = path.join(__dirname, '..');
const VISITOR = 'a'.repeat(32);
const SESSION = 'b'.repeat(32);
const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const PUBLIC_IP = '203.0.113.45';

/** A well-formed browser event that should classify as a real external user. */
function goodInput(overrides) {
  return {
    event: 'landing',
    ip: PUBLIC_IP,
    userAgent: REAL_UA,
    visitorId: VISITOR,
    sessionId: SESSION,
    locale: 'uk',
    surface: 'web',
    now: 1_770_000_000_000,
    ...overrides,
  };
}

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ── The row contract ────────────────────────────────────────────────────────

test('a valid event produces exactly the declared key set', () => {
  const row = buildRow(goodInput());
  assert.ok(row, 'expected a row');
  assert.deepEqual(Object.keys(row).sort(), [...ROW_KEYS].sort());
});

test('the row carries the expected values', () => {
  const row = buildRow(goodInput());
  assert.equal(row.event, 'landing');
  assert.equal(row.traffic_class, 'external');
  assert.equal(row.is_external, 1);
  assert.equal(row.visitor_id, VISITOR);
  assert.equal(row.session_id, SESSION);
  assert.equal(row.locale, 'uk');
  assert.equal(row.surface, 'web');
  assert.equal(row.ua_class, 'desktop');
  assert.equal(row.user_id, 0);
  assert.equal(row.dnt, 0);
  assert.equal(row.ts, 1_770_000_000_000);
  assert.equal(typeof row.app_version, 'string');
});

test('an unknown event name is dropped', () => {
  for (const event of [
    'bid_request',
    'payload',
    'LANDING',
    'landing ',
    '',
    null,
    undefined,
    42,
    ['landing'],
    { toString: () => 'landing' },
  ]) {
    assert.equal(buildRow(goodInput({ event })), null, `event ${String(event)} was not dropped`);
  }
});

test('a non-object input is dropped', () => {
  for (const input of [null, undefined, 'landing', 42, ['landing'], true]) {
    assert.equal(buildRow(/** @type {any} */ (input)), null);
  }
});

// ── Payload can never get through ───────────────────────────────────────────

test('extra caller fields never reach the row', () => {
  const row = buildRow(
    goodInput({
      // Everything a careless or hostile caller might attach.
      bidReq: { imp: [{ id: '1', banner: { w: 300, h: 250 } }] },
      bidRes: { seatbid: [{ bid: [{ adm: '<script>x</script>', price: 4.2 }] }] },
      payload: 'secret',
      msg: 'free text',
      email: 'user@example.com',
      ip_address: '203.0.113.99',
      user_agent: REAL_UA,
      path: '/library?token=abc',
      ctx: { anything: true },
      traffic_class: 'external',
      is_external: 1,
      app_version: 'spoofed',
    }),
  );
  assert.ok(row);
  assert.deepEqual(Object.keys(row).sort(), [...ROW_KEYS].sort());
  const serialized = JSON.stringify(row);
  for (const leak of [
    'seatbid',
    'imp',
    'adm',
    'secret',
    'free text',
    'user@example.com',
    '203.0.113.99',
    '/library',
    'spoofed',
    'Macintosh',
  ]) {
    assert.ok(!serialized.includes(leak), `"${leak}" leaked into the row`);
  }
});

test('the transient IP and User-Agent are classified, never stored', () => {
  const row = buildRow(goodInput());
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes(PUBLIC_IP), 'IP leaked into the row');
  assert.ok(!serialized.includes('537.36'), 'UA leaked into the row');
  // What survives is the derived bucket only.
  assert.equal(row.ua_class, 'desktop');
});

test('a getter cannot pass validation and then change the stored value', () => {
  let reads = 0;
  const input = goodInput();
  Object.defineProperty(input, 'event', {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? 'landing' : 'bid_payload_dump';
    },
  });
  const row = buildRow(input);
  assert.ok(row);
  assert.equal(row.event, 'landing', 'the validated value must be the stored value');
});

test('inherited prototype properties are not picked up as fields', () => {
  const proto = { utmSource: 'inherited-source', locale: 'en' };
  const input = Object.assign(Object.create(proto), {
    event: 'landing',
    ip: PUBLIC_IP,
    userAgent: REAL_UA,
  });
  const row = buildRow(input);
  assert.ok(row);
  // Reading through the prototype chain is acceptable here (the values are
  // still sanitised), but the KEY SET must not grow.
  assert.deepEqual(Object.keys(row).sort(), [...ROW_KEYS].sort());
});

// ── Identity fields ─────────────────────────────────────────────────────────

test('only a 32-hex id is accepted as visitor/session id', () => {
  assert.equal(sanitizeId(VISITOR), VISITOR);
  assert.equal(sanitizeId(VISITOR.toUpperCase()), VISITOR);
  for (const bad of [
    'a'.repeat(31),
    'a'.repeat(33),
    'g'.repeat(32),
    'user@example.com',
    '../../etc/passwd',
    '',
    null,
    undefined,
    12345,
    {},
  ]) {
    assert.equal(sanitizeId(/** @type {any} */ (bad)), '', `id "${String(bad)}" was accepted`);
  }
});

test('a malformed id becomes empty rather than dropping the event', () => {
  const row = buildRow(goodInput({ visitorId: 'nope', sessionId: null }));
  assert.ok(row, 'the visit should still be counted');
  assert.equal(row.visitor_id, '');
  assert.equal(row.session_id, '');
});

test('dnt=1 strips both ids so the visit cannot join a cohort', () => {
  const row = buildRow(goodInput({ dnt: 1 }));
  assert.ok(row);
  assert.equal(row.dnt, 1);
  assert.equal(row.visitor_id, '', 'visitor id must not survive a DNT signal');
  assert.equal(row.session_id, '', 'session id must not survive a DNT signal');
  // The visit is still counted — that is the point of not simply dropping it.
  assert.equal(row.event, 'landing');
  assert.equal(row.is_external, 1);
});

// ── Acquisition fields ──────────────────────────────────────────────────────

test('a referrer is reduced to its bare host', () => {
  assert.equal(sanitizeReferrerHost('https://www.google.com/search?q=openrtb+debug'), 'google.com');
  assert.equal(
    sanitizeReferrerHost('https://news.ycombinator.com/item?id=1'),
    'news.ycombinator.com',
  );
  assert.equal(sanitizeReferrerHost('http://example.com:8443/a/b'), 'example.com');
  assert.equal(sanitizeReferrerHost('EXAMPLE.COM'), 'example.com');
  assert.equal(sanitizeReferrerHost('www.example.com'), 'example.com');
});

test('a referrer never contributes a path, query, port or credentials', () => {
  for (const referrer of [
    'https://example.com/secret/path?token=abc123#frag',
    'https://user:pass@example.com/',
    'example.com/leak',
    'example.com?q=1',
    'example.com#x',
  ]) {
    const host = sanitizeReferrerHost(referrer);
    for (const leak of ['secret', 'token', 'abc123', 'pass', 'leak', 'q=1', '/', '?', '#', '@']) {
      assert.ok(!host.includes(leak), `"${leak}" survived in "${host}" from "${referrer}"`);
    }
  }
});

test('a junk referrer becomes empty', () => {
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>',
    '   ',
    'a'.repeat(80),
    '-bad-.com',
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(sanitizeReferrerHost(/** @type {any} */ (bad)), '');
  }
});

test('utm values are campaign slugs, not free text', () => {
  assert.equal(sanitizeUtm('Newsletter'), 'newsletter');
  assert.equal(sanitizeUtm('spring_2026-promo.v2'), 'spring_2026-promo.v2');
  for (const bad of [
    'a'.repeat(49),
    'has space',
    '<script>alert(1)</script>',
    '{"bidReq":{}}',
    '../../etc',
    'utm/with/slash',
    '',
    null,
    undefined,
    {},
  ]) {
    assert.equal(sanitizeUtm(/** @type {any} */ (bad)), '', `utm "${String(bad)}" was accepted`);
  }
});

test('utm and referrer land in the row already sanitised', () => {
  const row = buildRow(
    goodInput({
      referrer: 'https://www.reddit.com/r/adops/comments/xyz/',
      utmSource: 'Reddit',
      utmMedium: 'social post',
      utmCampaign: 'launch-2026',
    }),
  );
  assert.ok(row);
  assert.equal(row.referrer_host, 'reddit.com');
  assert.equal(row.utm_source, 'reddit');
  assert.equal(row.utm_medium, '', 'a value with a space is not a slug');
  assert.equal(row.utm_campaign, 'launch-2026');
});

// ── Enums and numbers ───────────────────────────────────────────────────────

test('locale falls back to empty outside the served set', () => {
  for (const locale of LOCALES) {
    assert.equal(buildRow(goodInput({ locale })).locale, locale);
  }
  for (const bad of ['de', 'en-US', 'x'.repeat(40), '', null, 42]) {
    assert.equal(buildRow(goodInput({ locale: bad })).locale, '');
  }
});

test('surface falls back to web outside the declared set', () => {
  for (const surface of SURFACES) {
    assert.equal(buildRow(goodInput({ surface })).surface, surface);
  }
  assert.equal(buildRow(goodInput({ surface: 'mainframe' })).surface, 'web');
});

test('user_id is a positive int or zero', () => {
  assert.equal(buildRow(goodInput({ userId: 7 })).user_id, 7);
  for (const bad of [0, -1, 1.5, NaN, Infinity, '7abc', null, undefined, {}, 2 ** 33]) {
    assert.equal(buildRow(goodInput({ userId: bad })).user_id, 0, `userId ${String(bad)}`);
  }
});

// ── Traffic classification is server-owned ──────────────────────────────────

test('a bot cannot claim to be an external user', () => {
  const row = buildRow(
    goodInput({
      userAgent: 'curl/8.4.0',
      clientHint: 'external',
      headers: { 'x-ortbtools-traffic': 'external' },
    }),
  );
  assert.ok(row);
  assert.equal(row.traffic_class, 'bot');
  assert.equal(row.is_external, 0);
});

test('a browser can demote itself to internal', () => {
  const row = buildRow(goodInput({ clientHint: 'internal' }));
  assert.ok(row);
  assert.equal(row.traffic_class, 'internal');
  assert.equal(row.is_external, 0);
});

test('an owner user id demotes an otherwise-external event', () =>
  withEnv({ ORTBTOOLS_OWNER_USER_IDS: '3' }, () => {
    assert.equal(buildRow(goodInput({ userId: 3 })).traffic_class, 'owner');
    assert.equal(buildRow(goodInput({ userId: 4 })).traffic_class, 'external');
  }));

// ── Kill switches ───────────────────────────────────────────────────────────

test('telemetry is off when ClickHouse is not configured', () =>
  withEnv({ CLICKHOUSE_USER: undefined, ORTBTOOLS_PRODUCT_TELEMETRY_DISABLED: undefined }, () => {
    assert.equal(isProductTelemetryEnabled(), false);
    resetForTest();
    assert.equal(recordProductEvent(goodInput()), false);
    assert.equal(pendingCount(), 0, 'nothing may be buffered while disabled');
  }));

test('the dedicated kill switch wins over configured ClickHouse', () =>
  withEnv({ CLICKHOUSE_USER: 'ortb', ORTBTOOLS_PRODUCT_TELEMETRY_DISABLED: '1' }, () => {
    assert.equal(isProductTelemetryEnabled(), false);
    resetForTest();
    assert.equal(recordProductEvent(goodInput()), false);
    assert.equal(pendingCount(), 0);
  }));

test('the shared analytics kill switch also disables product telemetry', () =>
  withEnv({ CLICKHOUSE_USER: 'ortb', ORTBTOOLS_ANALYTICS_DISABLED: '1' }, () => {
    assert.equal(isProductTelemetryEnabled(), false);
    resetForTest();
    assert.equal(recordProductEvent(goodInput()), false);
    assert.equal(pendingCount(), 0);
  }));

test('an enabled writer buffers a valid event and drops an invalid one', () =>
  withEnv(
    {
      CLICKHOUSE_USER: 'ortb',
      ORTBTOOLS_ANALYTICS_DISABLED: undefined,
      ORTBTOOLS_PRODUCT_TELEMETRY_DISABLED: undefined,
    },
    () => {
      assert.equal(isProductTelemetryEnabled(), true);
      resetForTest();
      try {
        assert.equal(recordProductEvent(goodInput()), true);
        assert.equal(pendingCount(), 1);
        assert.equal(recordProductEvent(goodInput({ event: 'not_an_event' })), false);
        assert.equal(pendingCount(), 1, 'an invalid event must not be buffered');
      } finally {
        // Drop the buffer without flushing — no ClickHouse in tests.
        resetForTest();
      }
    },
  ));

test('recordProductEvent never throws on hostile input', () => {
  resetForTest();
  const cyclic = { event: 'landing' };
  cyclic.self = cyclic;
  for (const input of [null, undefined, 42, 'landing', [], cyclic, Object.create(null)]) {
    assert.doesNotThrow(() => recordProductEvent(/** @type {any} */ (input)));
  }
  resetForTest();
});

// ── Beacon endpoint ─────────────────────────────────────────────────────────

test('cross-site beacons are rejected, same-site and legacy ones allowed', () => {
  assert.equal(isSameSiteBeacon({ headers: { 'sec-fetch-site': 'same-origin' } }), true);
  assert.equal(isSameSiteBeacon({ headers: { 'sec-fetch-site': 'same-site' } }), true);
  assert.equal(isSameSiteBeacon({ headers: { 'sec-fetch-site': 'none' } }), true);
  assert.equal(isSameSiteBeacon({ headers: {} }), true, 'older browsers omit the header');
  assert.equal(isSameSiteBeacon({ headers: { 'sec-fetch-site': 'cross-site' } }), false);
});

test('the beacon route answers 204 with no body, even when disabled', async () =>
  withEnv({ CLICKHOUSE_USER: undefined }, async () => {
    const mod = createTelemetryModule({
      telemetryLimiter: () => true,
      auth: { clientIp: () => PUBLIC_IP, getCurrentUser: () => null },
    });
    const route = mod.routes.find((r) => r.path === '/api/v1/telemetry/event');
    assert.ok(route);

    let status = 0;
    let body;
    const res = {
      writeHead(s) {
        status = s;
        return this;
      },
      end(b) {
        body = b;
        return this;
      },
      setHeader() {},
    };
    await route.handler({ headers: { 'sec-fetch-site': 'same-origin' }, on: () => {} }, res);
    assert.equal(status, 204);
    assert.equal(body, undefined, 'the beacon must not return a body');
  }));

test('the module exposes both telemetry routes', () => {
  const mod = createTelemetryModule({
    telemetryLimiter: () => true,
    auth: { clientIp: () => PUBLIC_IP, getCurrentUser: () => null },
  });
  assert.equal(mod.id, 'telemetry');
  const paths = mod.routes.map((r) => `${r.method} ${r.path}`).sort();
  assert.deepEqual(paths, ['GET /api/v1/telemetry/summary', 'POST /api/v1/telemetry/event']);
});

// ── Cross-file contracts ────────────────────────────────────────────────────

test('the browser client and the server share one event vocabulary', () => {
  const client = fs.readFileSync(path.join(ROOT, 'public/telemetry.js'), 'utf8');
  const match = /const EVENTS = \[([\s\S]*?)\];/.exec(client);
  assert.ok(match, 'public/telemetry.js must declare a const EVENTS array');
  const clientEvents = [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    clientEvents.sort(),
    [...PRODUCT_EVENTS].sort(),
    'public/telemetry.js EVENTS drifted from PRODUCT_EVENTS',
  );
});

test('every wired event name appears at a real emit site', () => {
  const sources = [
    'public/telemetry.js',
    'public/ortbtools.app.js',
    'public/modules/auth/index.js',
    'public/modules/macros/index.js',
    'public/modules/share/index.js',
  ]
    .map((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'))
    .join('\n');

  const wired = [
    'landing',
    'session_start',
    'analyze_success',
    'macro_use',
    'share_use',
    'register',
    'verify_email',
  ];
  for (const event of wired) {
    assert.ok(
      new RegExp(`ortbtoolsTrack(Once)?\\('${event}'\\)|track\\('${event}'\\)`).test(sources),
      `event "${event}" is declared wired but has no emit site`,
    );
  }
});

test('the beacon body shape carries no field that could hold a payload', () => {
  const client = fs.readFileSync(path.join(ROOT, 'public/telemetry.js'), 'utf8');
  const match = /return send\(\{([\s\S]*?)\n\s*\}\);/.exec(client);
  assert.ok(match, 'public/telemetry.js must build its beacon body in one literal');
  const keys = [...match[1].matchAll(/^\s{8}(\w+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(
    keys,
    [
      'dnt',
      'event',
      'internal',
      'locale',
      'referrer',
      'session_id',
      'utm_campaign',
      'utm_medium',
      'utm_source',
      'visitor_id',
    ],
    'the beacon body gained a field — re-audit it against the privacy contract',
  );
});
