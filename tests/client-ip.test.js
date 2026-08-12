'use strict';

/**
 * tests/client-ip.test.js — trusted-proxy client-address resolution.
 *
 * Regression cover for the defect this module exists to fix: behind Docker's
 * published-port proxy the TCP peer is the bridge gateway, never loopback, so
 * the loopback-only rule discarded the forwarded header and every real visitor
 * resolved to a private address. Product telemetry then classified all of them
 * as `internal` and `is_external` was 0 forever.
 *
 * The security half matters just as much: an UNTRUSTED peer must never be able
 * to talk its way into a different address.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveClientIp, isTrustedProxy } = require('../lib/client-ip');
const { classifyTraffic } = require('../lib/traffic-class');

const GATEWAY = '172.24.0.1'; // the measured peer for both public and local calls
const CLIENT = '203.0.113.45';

function req(peer, headers) {
  return { socket: { remoteAddress: peer }, headers: headers || {} };
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

// ── Default posture: trust nothing that is not loopback ─────────────────────

test('with no configuration only loopback is trusted', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: undefined }, () => {
    assert.equal(isTrustedProxy('127.0.0.1'), true);
    assert.equal(isTrustedProxy('::1'), true);
    assert.equal(isTrustedProxy(GATEWAY), false);
    assert.equal(isTrustedProxy(CLIENT), false);
    assert.equal(isTrustedProxy(''), false);
  }));

test('an unconfigured deployment behaves exactly like the loopback-only rule', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: undefined }, () => {
    // The gateway is not trusted, so its forwarded header is ignored.
    assert.equal(resolveClientIp(req(GATEWAY, { 'x-forwarded-for': CLIENT })), GATEWAY);
    assert.equal(resolveClientIp(req(GATEWAY, { 'cf-connecting-ip': CLIENT })), GATEWAY);
    // Loopback still works as it always did.
    assert.equal(resolveClientIp(req('127.0.0.1', { 'x-forwarded-for': CLIENT })), CLIENT);
  }));

// ── The defect this module fixes ────────────────────────────────────────────

test('a trusted gateway peer resolves the real client behind it', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.1' }, () => {
    assert.equal(isTrustedProxy(GATEWAY), true);
    assert.equal(resolveClientIp(req(GATEWAY, { 'cf-connecting-ip': CLIENT })), CLIENT);
    assert.equal(resolveClientIp(req(GATEWAY, { 'x-forwarded-for': CLIENT })), CLIENT);
  }));

test('the resolved address is what makes a real visitor classify as external', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.1', ORTBTOOLS_OWNER_IPS: '' }, () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    const request = req(GATEWAY, { 'cf-connecting-ip': CLIENT });

    // Before the fix the gateway address was used directly → internal, forever.
    assert.equal(classifyTraffic({ ip: GATEWAY, userAgent: ua }).traffic_class, 'internal');
    // After it, the same request is correctly a real external visitor.
    assert.equal(
      classifyTraffic({ ip: resolveClientIp(request), userAgent: ua }).traffic_class,
      'external',
    );
  }));

test('CIDR and multiple trusted proxies are accepted', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.0/16, 192.168.64.1' }, () => {
    assert.equal(isTrustedProxy('172.24.0.1'), true);
    assert.equal(isTrustedProxy('172.24.9.9'), true);
    assert.equal(isTrustedProxy('192.168.64.1'), true);
    assert.equal(isTrustedProxy('192.168.65.1'), false);
    assert.equal(isTrustedProxy(CLIENT), false);
  }));

// ── Spoofing ────────────────────────────────────────────────────────────────

test('an untrusted peer cannot claim a different address', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.1' }, () => {
    const attacker = '198.51.100.66';
    for (const headers of [
      { 'x-forwarded-for': '203.0.113.1' },
      { 'cf-connecting-ip': '203.0.113.1' },
      { 'x-forwarded-for': '203.0.113.1, 203.0.113.2', 'cf-connecting-ip': '203.0.113.3' },
    ]) {
      assert.equal(
        resolveClientIp(req(attacker, headers)),
        attacker,
        'an untrusted peer must always resolve to itself',
      );
    }
  }));

test('a client-prepended X-Forwarded-For entry is unreachable', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.1' }, () => {
    // The client sent "1.2.3.4" itself; the proxy appended the address it saw.
    const resolved = resolveClientIp(req(GATEWAY, { 'x-forwarded-for': `1.2.3.4, ${CLIENT}` }));
    assert.equal(resolved, CLIENT, 'the rightmost untrusted hop wins, not the leftmost');
  }));

test('CF-Connecting-IP wins over X-Forwarded-For', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.1' }, () => {
    const resolved = resolveClientIp(
      req(GATEWAY, { 'cf-connecting-ip': CLIENT, 'x-forwarded-for': '1.2.3.4' }),
    );
    assert.equal(resolved, CLIENT, 'Cloudflare overwrites its own header; XFF it does not');
  }));

test('trusted hops are skipped when walking X-Forwarded-For', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.0/16' }, () => {
    const resolved = resolveClientIp(
      req(GATEWAY, { 'x-forwarded-for': `${CLIENT}, 172.24.0.5, 172.24.0.9` }),
    );
    assert.equal(resolved, CLIENT);
  }));

// ── Degradation ─────────────────────────────────────────────────────────────

test('a trusted peer with no usable header falls back to the peer', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.1' }, () => {
    assert.equal(resolveClientIp(req(GATEWAY, {})), GATEWAY);
    assert.equal(resolveClientIp(req(GATEWAY, { 'x-forwarded-for': '' })), GATEWAY);
    assert.equal(resolveClientIp(req(GATEWAY, { 'x-forwarded-for': 'not-an-ip' })), 'not-an-ip');
    assert.equal(resolveClientIp(req(GATEWAY, { 'cf-connecting-ip': '   ' })), GATEWAY);
  }));

test('malformed requests never throw', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { headers: null }, { socket: null }]) {
    assert.doesNotThrow(() => resolveClientIp(/** @type {any} */ (bad)));
  }
  assert.equal(resolveClientIp(/** @type {any} */ ({})), '');
});

test('a repeated header arrives as an array and still resolves', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.1' }, () => {
    assert.equal(
      resolveClientIp(req(GATEWAY, { 'cf-connecting-ip': [CLIENT, '1.2.3.4'] })),
      CLIENT,
    );
  }));

test('IPv6 and v4-mapped forms normalise', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.1' }, () => {
    assert.equal(
      resolveClientIp(req(GATEWAY, { 'cf-connecting-ip': '2001:DB8::5' })),
      '2001:db8::5',
    );
    assert.equal(
      resolveClientIp(req(`::ffff:${GATEWAY}`, { 'cf-connecting-ip': CLIENT })),
      CLIENT,
      'a v4-mapped peer must still match the trusted rule',
    );
  }));

test('trusted-proxy env changes take effect without a restart', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '' }, () => {
    assert.equal(isTrustedProxy(GATEWAY), false);
    process.env.ORTBTOOLS_TRUSTED_PROXIES = GATEWAY;
    assert.equal(isTrustedProxy(GATEWAY), true);
  }));

// ── Rate-limit bucketing: the reason this is not just a telemetry concern ───

/** The per-IP limiter shape used across the app (auth.js, server.js). */
function makeLimiter(maxPerWindow) {
  const buckets = new Map();
  return (key) => {
    const used = buckets.get(key) || 0;
    if (used >= maxPerWindow) return false;
    buckets.set(key, used + 1);
    return true;
  };
}

test('distinct visitors behind one proxy get distinct buckets', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.1' }, () => {
    const limiter = makeLimiter(2);
    const visitor = (addr) => limiter(resolveClientIp(req(GATEWAY, { 'cf-connecting-ip': addr })));

    // Visitor A burns their allowance.
    assert.equal(visitor('203.0.113.1'), true);
    assert.equal(visitor('203.0.113.1'), true);
    assert.equal(visitor('203.0.113.1'), false, 'A is throttled after its own quota');

    // Visitor B must be unaffected. Before the fix every visitor resolved to
    // the gateway, so A exhausting the bucket locked B out too.
    assert.equal(visitor('203.0.113.2'), true, "B must not inherit A's throttling");
  }));

test('a spoofed forwarded header cannot mint fresh buckets', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.1' }, () => {
    const limiter = makeLimiter(2);
    const attacker = '198.51.100.66'; // reaches the app directly, not via the proxy

    // Each attempt carries a different forged address. An untrusted peer must
    // resolve to itself every time, so all attempts share one bucket.
    const attempt = (forged) =>
      limiter(resolveClientIp(req(attacker, { 'x-forwarded-for': forged })));

    assert.equal(attempt('203.0.113.1'), true);
    assert.equal(attempt('203.0.113.2'), true);
    assert.equal(attempt('203.0.113.3'), false, 'rotating a fake header must not reset the quota');
    assert.equal(attempt('203.0.113.4'), false);
  }));

test('a client prefix cannot mint fresh buckets through the trusted proxy', () =>
  withEnv({ ORTBTOOLS_TRUSTED_PROXIES: '172.24.0.1' }, () => {
    const limiter = makeLimiter(2);
    // Cloudflare APPENDS, so a client-sent value ends up on the left and the
    // real address on the right. Reading from the right is what defeats this.
    const attempt = (forgedPrefix) =>
      limiter(resolveClientIp(req(GATEWAY, { 'x-forwarded-for': `${forgedPrefix}, ${CLIENT}` })));

    assert.equal(attempt('1.1.1.1'), true);
    assert.equal(attempt('2.2.2.2'), true);
    assert.equal(attempt('3.3.3.3'), false, 'the real rightmost hop keys the bucket');
  }));
