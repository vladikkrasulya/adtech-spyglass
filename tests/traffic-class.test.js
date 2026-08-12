'use strict';

/**
 * tests/traffic-class.test.js — request-classification matrix.
 *
 * The product metrics are only trustworthy if `is_external` really means "a
 * real outside human". These tests pin the whole matrix: owner, dev agents, CI,
 * uptime monitors, crawlers and private-network traffic must all fall outside
 * `external`, and — critically — no caller-supplied value may promote a request
 * INTO `external`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyTraffic,
  classifyUa,
  normalizeIp,
  normalizeHint,
  isPrivateIp,
  isOwnerIp,
  isOwnerUserId,
  TRAFFIC_CLASSES,
  HINT_CLASSES,
} = require('../lib/traffic-class');

// A plausible, unremarkable desktop browser from a public address.
const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const PUBLIC_IP = '203.0.113.45';

function classify(overrides) {
  return classifyTraffic({ ip: PUBLIC_IP, userAgent: REAL_UA, ...overrides });
}

/** Set env for one test and always restore it. */
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

// ── Baseline ────────────────────────────────────────────────────────────────

test('a plain browser from a public IP is external', () => {
  const out = classify();
  assert.equal(out.traffic_class, 'external');
  assert.equal(out.is_external, true);
  assert.equal(out.ua_class, 'desktop');
});

test('every emitted class is declared in TRAFFIC_CLASSES', () => {
  const samples = [
    classify(),
    classify({ userAgent: 'curl/8.4.0' }),
    classify({ userAgent: 'Uptime-Kuma/1.23.0' }),
    classify({ userAgent: 'GPTBot/1.2' }),
    classify({ userAgent: 'GitHub-Actions/2.0' }),
    classify({ ip: '10.1.2.3' }),
    classify({ clientHint: 'internal' }),
  ];
  for (const s of samples) {
    assert.ok(TRAFFIC_CLASSES.includes(s.traffic_class), `undeclared class: ${s.traffic_class}`);
  }
});

// ── The security property ───────────────────────────────────────────────────

test('no client-supplied hint can promote a request into external', () => {
  // Every hint value, plus values a hostile caller would try.
  const attempts = [
    ...HINT_CLASSES,
    'external',
    'EXTERNAL',
    ' external ',
    'human',
    'user',
    '',
    null,
    undefined,
    123,
    { toString: () => 'external' },
  ];
  for (const hint of attempts) {
    // Start from a request that would otherwise classify as a bot.
    const out = classifyTraffic({
      ip: PUBLIC_IP,
      userAgent: 'curl/8.4.0',
      clientHint: hint,
    });
    assert.equal(
      out.is_external,
      false,
      `hint ${JSON.stringify(String(hint))} escaped into external`,
    );
  }
});

test('X-Ortbtools-Traffic: external does not promote a bot', () => {
  const out = classifyTraffic({
    ip: PUBLIC_IP,
    userAgent: 'python-requests/2.32',
    headers: { 'x-ortbtools-traffic': 'external' },
  });
  assert.equal(out.traffic_class, 'bot');
  assert.equal(out.is_external, false);
});

test('normalizeHint never returns external', () => {
  for (const v of ['external', 'External', ' EXTERNAL', 'real', 'ok']) {
    const out = normalizeHint(v);
    assert.notEqual(out, 'external');
    assert.ok(out === '' || HINT_CLASSES.includes(out));
  }
});

// ── Header + beacon hints (demote-only) ─────────────────────────────────────

test('header hint demotes an otherwise-external browser', () => {
  for (const hint of HINT_CLASSES) {
    const out = classify({ headers: { 'x-ortbtools-traffic': hint } });
    assert.equal(out.traffic_class, hint);
    assert.equal(out.is_external, false);
  }
});

test('beacon internal flag demotes an otherwise-external browser', () => {
  const out = classify({ clientHint: 'internal' });
  assert.equal(out.traffic_class, 'internal');
  assert.equal(out.is_external, false);
});

test('header hint wins over the beacon hint', () => {
  const out = classify({
    headers: { 'x-ortbtools-traffic': 'ci' },
    clientHint: 'internal',
  });
  assert.equal(out.traffic_class, 'ci');
});

// ── Monitoring, CI, agents, crawlers ────────────────────────────────────────

test('uptime monitors classify as monitor, not as users', () => {
  const monitors = [
    'Uptime-Kuma/1.23.16',
    'UptimeRobot/2.0; http://uptimerobot.com/',
    'Prometheus/2.53.0',
    'Blackbox Exporter/0.25.0',
    'kube-probe/1.29',
    'Better Uptime Bot betteruptime.com',
    'Zabbix',
  ];
  for (const ua of monitors) {
    const out = classify({ userAgent: ua });
    assert.equal(out.traffic_class, 'monitor', `expected monitor for ${ua}`);
    assert.equal(out.is_external, false);
  }
});

test('CI runners and this repo smoke script classify as ci', () => {
  for (const ua of ['GitHub-Actions/2.317', 'ortbtools-smoke/1.0', 'ortbtools-ci/1.0']) {
    const out = classify({ userAgent: ua });
    assert.equal(out.traffic_class, 'ci', `expected ci for ${ua}`);
    assert.equal(out.is_external, false);
  }
});

test('AI agents classify as agent', () => {
  for (const ua of [
    'ClaudeBot/1.0 (+https://anthropic.com/claude-bot)',
    'Mozilla/5.0 AppleWebKit (KHTML, like Gecko); compatible; GPTBot/1.2',
    'PerplexityBot/1.0',
    'Mozilla/5.0 (compatible; OAI-SearchBot/1.0)',
  ]) {
    const out = classify({ userAgent: ua });
    assert.equal(out.traffic_class, 'agent', `expected agent for ${ua}`);
    assert.equal(out.is_external, false);
  }
});

test('crawlers, HTTP libraries and headless drivers classify as bot', () => {
  for (const ua of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'curl/8.4.0',
    'Wget/1.21.4',
    'python-requests/2.32.3',
    'node-fetch/3.3.2',
    'Go-http-client/2.0',
    'PostmanRuntime/7.39.0',
    'Mozilla/5.0 HeadlessChrome/140.0.0.0',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0)',
    'Slackbot-LinkExpanding 1.0',
  ]) {
    const out = classify({ userAgent: ua });
    assert.equal(out.traffic_class, 'bot', `expected bot for ${ua}`);
    assert.equal(out.is_external, false);
    assert.equal(out.ua_class, 'bot');
  }
});

test('a missing User-Agent is never treated as a real user', () => {
  for (const ua of ['', undefined, null]) {
    const out = classifyTraffic({ ip: PUBLIC_IP, userAgent: ua });
    assert.equal(out.traffic_class, 'bot');
    assert.equal(out.is_external, false);
  }
});

// ── Network-based classification ────────────────────────────────────────────

test('private, loopback, link-local and CGNAT addresses are internal', () => {
  for (const ip of [
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '10.0.0.7',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.10',
    '169.254.10.1',
    '100.64.0.5', // Tailscale
    'fd7a:115c:a1e0::1',
    'fe80::1',
  ]) {
    assert.equal(isPrivateIp(normalizeIp(ip)), true, `${ip} should be private`);
    const out = classify({ ip });
    assert.equal(out.traffic_class, 'internal', `expected internal for ${ip}`);
    assert.equal(out.is_external, false);
  }
});

test('public addresses just outside the private ranges stay external', () => {
  for (const ip of ['172.15.255.255', '172.32.0.1', '11.0.0.1', '100.128.0.1', '9.255.255.255']) {
    assert.equal(isPrivateIp(normalizeIp(ip)), false, `${ip} should be public`);
    assert.equal(classify({ ip }).traffic_class, 'external', `expected external for ${ip}`);
  }
});

test('an unresolvable IP is treated as internal, never as a user', () => {
  for (const ip of ['', 'unknown', undefined, null, 'not-an-ip-at-all']) {
    const out = classify({ ip });
    assert.equal(out.is_external, false, `${String(ip)} leaked into external`);
  }
});

test('normalizeIp strips brackets, zone ids and the v4-mapped prefix', () => {
  assert.equal(normalizeIp('[2001:db8::1]'), '2001:db8::1');
  assert.equal(normalizeIp('fe80::1%eth0'), 'fe80::1');
  assert.equal(normalizeIp('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(normalizeIp('  203.0.113.9  '), '203.0.113.9');
  assert.equal(normalizeIp('unknown'), '');
  assert.equal(normalizeIp(42), '');
});

test('zero-padded octets are rejected so one address has one spelling', () =>
  withEnv({ ORTBTOOLS_OWNER_IPS: '203.0.113.45' }, () => {
    // A second spelling of an allowlisted address must not match it — otherwise
    // `0203.0.113.45` would silently inherit owner status.
    assert.equal(isOwnerIp('203.0.113.45'), true);
    assert.equal(isOwnerIp(normalizeIp('0203.0.113.45')), false);
    // …and, having failed to parse, it lands on the private side rather than
    // escaping into external.
    assert.equal(isPrivateIp(normalizeIp('010.0.0.1')), true);
    assert.equal(classify({ ip: '010.0.0.1' }).is_external, false);
  }));

// ── Owner allowlists ────────────────────────────────────────────────────────

test('ORTBTOOLS_OWNER_IPS matches exact IPv4, CIDR and literal IPv6', () =>
  withEnv({ ORTBTOOLS_OWNER_IPS: '203.0.113.45, 198.51.100.0/24, 2001:db8::5' }, () => {
    assert.equal(isOwnerIp('203.0.113.45'), true);
    assert.equal(isOwnerIp('198.51.100.200'), true);
    assert.equal(isOwnerIp('198.51.101.1'), false);
    assert.equal(isOwnerIp('2001:db8::5'), true);
    assert.equal(isOwnerIp('2001:db8::6'), false);

    assert.equal(classify({ ip: '203.0.113.45' }).traffic_class, 'owner');
    assert.equal(classify({ ip: '198.51.100.7' }).traffic_class, 'owner');
    assert.equal(classify({ ip: '203.0.113.46' }).traffic_class, 'external');
  }));

test('an empty owner allowlist matches nothing', () =>
  withEnv({ ORTBTOOLS_OWNER_IPS: '' }, () => {
    assert.equal(isOwnerIp('203.0.113.45'), false);
    assert.equal(classify().traffic_class, 'external');
  }));

test('a /32 rule matches exactly one address', () =>
  withEnv({ ORTBTOOLS_OWNER_IPS: '203.0.113.45/32' }, () => {
    assert.equal(isOwnerIp('203.0.113.45'), true);
    assert.equal(isOwnerIp('203.0.113.44'), false);
    assert.equal(isOwnerIp('203.0.113.46'), false);
  }));

test('ORTBTOOLS_OWNER_USER_IDS demotes a signed-in owner', () =>
  withEnv({ ORTBTOOLS_OWNER_USER_IDS: '1,7' }, () => {
    assert.equal(isOwnerUserId(1), true);
    assert.equal(isOwnerUserId(7), true);
    assert.equal(isOwnerUserId(2), false);
    assert.equal(isOwnerUserId('1'), true); // numeric string from a query layer
    assert.equal(isOwnerUserId(0), false);
    assert.equal(isOwnerUserId(null), false);

    assert.equal(classify({ userId: 1 }).traffic_class, 'owner');
    assert.equal(classify({ userId: 2 }).traffic_class, 'external');
  }));

test('owner env changes take effect without a process restart', () =>
  withEnv({ ORTBTOOLS_OWNER_IPS: '203.0.113.45' }, () => {
    assert.equal(classify().traffic_class, 'owner');
    process.env.ORTBTOOLS_OWNER_IPS = '198.51.100.1';
    assert.equal(classify().traffic_class, 'external');
  }));

// ── ua_class ────────────────────────────────────────────────────────────────

test('ua_class buckets devices without keeping the UA string', () => {
  assert.equal(classifyUa(REAL_UA), 'desktop');
  assert.equal(
    classifyUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit Mobile/15E148'),
    'mobile',
  );
  assert.equal(classifyUa('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit'), 'tablet');
  assert.equal(classifyUa('curl/8.4.0'), 'bot');
  assert.equal(classifyUa(''), 'unknown');
});

test('classification never returns the raw User-Agent or IP', () => {
  const out = classify({ userAgent: REAL_UA, ip: PUBLIC_IP });
  const serialized = JSON.stringify(out);
  assert.ok(!serialized.includes(PUBLIC_IP), 'IP leaked into the classification result');
  assert.ok(!serialized.includes('Macintosh'), 'UA leaked into the classification result');
  assert.deepEqual(Object.keys(out).sort(), ['is_external', 'traffic_class', 'ua_class']);
});
