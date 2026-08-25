'use strict';

/**
 * tests/asset-fetch.test.js
 *
 * The SSRF guard on lib/asset-fetch.js. This is the one place in the app that
 * makes an outbound request to a host the caller chose, from a URL that
 * arrived inside a pasted payload — so the interesting assertions are all
 * about what it REFUSES.
 *
 * No network is touched: every case here is rejected during URL parsing or
 * during address resolution, both of which run before any socket opens.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAssetUrl, resolveSafely, ALLOWED_TYPES } = require('../lib/asset-fetch');

async function refusalCode(url) {
  try {
    const u = parseAssetUrl(url);
    await resolveSafely(u.hostname);
    return null; // allowed
  } catch (e) {
    return e.code;
  }
}

test('non-http schemes are refused before anything else happens', async () => {
  for (const u of ['file:///etc/passwd', 'gopher://x/', 'ftp://h/f', 'data:text/plain,hi']) {
    assert.equal(await refusalCode(u), 'scheme_blocked', u);
  }
});

test('non-default ports are refused — closes the port-scan side channel', async () => {
  for (const u of ['http://example.com:22/x', 'https://example.com:6379/x']) {
    assert.equal(await refusalCode(u), 'port_blocked', u);
  }
});

test('loopback, RFC1918, link-local and CGNAT literals are refused', async () => {
  const hostile = [
    'http://127.0.0.1/x',
    'http://10.1.2.3/x',
    'http://192.168.0.1/x',
    'http://172.16.0.1/x',
    // The cloud metadata endpoint — the single most-targeted SSRF destination.
    'http://169.254.169.254/latest/meta-data/',
    // CGNAT, which on this host is also the Tailscale range.
    'http://100.64.0.1/',
  ];
  for (const u of hostile) {
    assert.equal(await refusalCode(u), 'host_blocked', u);
  }
});

test('IPv6 literals are checked directly, not left to a failing lookup', async () => {
  // A bracketed literal is not a name any resolver knows, so these would be
  // refused as dns_failed even with no guard at all. The code matters: it is
  // the difference between a rule and a coincidence.
  assert.equal(await refusalCode('http://[::1]/x'), 'host_blocked');
  assert.equal(await refusalCode('http://[fd00::1]/x'), 'host_blocked');
});

test('WHATWG-canonical IPv4-mapped IPv6 cannot disguise private IPv4', async () => {
  // new URL() rewrites the dotted source spelling into these hexadecimal
  // forms before resolveSafely sees it. They must still take the IPv4 policy.
  for (const u of [
    'http://[::ffff:127.0.0.1]/x',
    'http://[::ffff:7f00:1]/x',
    'http://[::ffff:10.1.2.3]/x',
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://[0:0:0:0:0:ffff:a9fe:a9fe]/latest/meta-data/',
  ]) {
    assert.equal(await refusalCode(u), 'host_blocked', u);
  }
});

test('a public IPv4-mapped literal remains allowed', async () => {
  assert.equal(await refusalCode('http://[::ffff:203.0.113.9]/asset.png'), null);
});

test('malformed input is refused, never thrown raw', async () => {
  for (const u of ['not a url', '', '///', 'http://']) {
    const code = await refusalCode(u);
    assert.ok(code === 'url_invalid' || code === 'scheme_blocked', `${u} → ${code}`);
  }
});

test('SVG is not a renderable image here — it is script', () => {
  assert.ok(!ALLOWED_TYPES.has('image/svg+xml'));
  assert.ok(ALLOWED_TYPES.has('image/png'));
  assert.ok(ALLOWED_TYPES.has('image/webp'));
});

test('a public hostname resolves and is allowed through', async (t) => {
  // The only case needing DNS. Skipped rather than failed when the box is
  // offline, so an air-gapped run does not report a guard regression.
  let code;
  try {
    code = await refusalCode('https://example.com/banner.png');
  } catch (_) {
    return t.skip('no DNS available');
  }
  if (code === 'dns_failed') return t.skip('no DNS available');
  assert.equal(code, null, 'a public host must not be refused');
});
