'use strict';

/**
 * tests/decoder-request.test.js — packages/core/decoders/request/
 *
 * Covers the URL-style request decoder registry + canonical envelope +
 * the first-shipped URL decoder (url-linkfeed). Mirrors the structure
 * of decoders-infrastructure.test.js (response side).
 *
 * Privacy: synthetic feed ids / auth tokens / IPs only. Never paste
 * partner-supplied URLs here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeCanonicalUrlRequest } = require('@kyivtech/spyglass-core/decoders/request/_canonical');
const { decodeRequest, info } = require('@kyivtech/spyglass-core/decoders/request');
const urlLinkfeed = require('@kyivtech/spyglass-core/decoders/request/url-linkfeed');

const LINKFEED_URL =
  'http://xml.pushub.net/link?format=json&feed=demo&auth=tk&subid=pub1' +
  '&user_ip=192.0.2.1&ua=Mozilla%2F5.0%20Test' +
  '&url=https%3A%2F%2Fexample.com%2F&lang=en';

// ── Canonical envelope ──────────────────────────────────────────────────────

test('makeCanonicalUrlRequest: returns expected envelope', () => {
  const c = makeCanonicalUrlRequest('demo-variant', 'http://x.test/y?z=1');
  assert.equal(c.variant, 'demo-variant');
  assert.equal(c.method, 'GET');
  assert.equal(c.url, 'http://x.test/y?z=1');
  assert.equal(c.meta.detectedVariant, 'demo-variant');
  assert.deepEqual(c.device, {});
  assert.deepEqual(c.site, {});
  assert.deepEqual(c.user, {});
  assert.deepEqual(c._raw, {});
});

// ── Registry ────────────────────────────────────────────────────────────────

test('decodeRequest: null/empty/non-string input → null', () => {
  assert.equal(decodeRequest(null), null);
  assert.equal(decodeRequest(''), null);
  // @ts-ignore — intentional wrong type for robustness testing
  assert.equal(decodeRequest(42), null);
  // @ts-ignore — intentional wrong type for robustness testing
  assert.equal(decodeRequest({}), null);
});

test('decodeRequest: malformed URL → null (no decoder fires)', () => {
  assert.equal(decodeRequest('not a url'), null);
  assert.equal(decodeRequest('http://'), null);
});

test('decodeRequest: unknown host → null (no decoder claims)', () => {
  assert.equal(decodeRequest('https://example.com/foo?bar=1'), null);
});

test('decodeRequest: url-linkfeed URL → canonical with variant=url-linkfeed', () => {
  const c = decodeRequest(LINKFEED_URL);
  assert.ok(c, 'url-linkfeed URL is claimed');
  assert.equal(c.variant, 'url-linkfeed');
  assert.equal(c.endpoint, 'xml.pushub.net/link');
});

test('info(): exposes registered decoder metadata', () => {
  const list = info();
  assert.ok(Array.isArray(list));
  assert.ok(list.find((d) => d.id === 'url-linkfeed'));
  assert.ok(list.every((d) => typeof d.description === 'string'));
});

// ── url-linkfeed decoder ──────────────────────────────────────────────────

test('url-linkfeed.detect: claims xml.pushub.net/link', () => {
  assert.equal(urlLinkfeed.detect('', new URL('http://xml.pushub.net/link?a=1')), true);
  assert.equal(urlLinkfeed.detect('', new URL('https://xml.pushub.net/link')), true);
});

test('url-linkfeed.detect: rejects other hosts/paths', () => {
  assert.equal(urlLinkfeed.detect('', new URL('http://xml.pushub.net/other')), false);
  assert.equal(urlLinkfeed.detect('', new URL('http://other.host/link')), false);
});

test('url-linkfeed.decode: IPv4 → device.ip, not device.ipv6', () => {
  const c = decodeRequest(LINKFEED_URL);
  assert.equal(c.device.ip, '192.0.2.1');
  assert.equal(c.device.ipv6, undefined);
});

test('url-linkfeed.decode: IPv6 → device.ipv6, not device.ip', () => {
  const url = LINKFEED_URL.replace('user_ip=192.0.2.1', 'user_ip=2001:db8::1');
  const c = decodeRequest(url);
  assert.equal(c.device.ipv6, '2001:db8::1');
  assert.equal(c.device.ip, undefined);
});

test('url-linkfeed.decode: ua + lang + subid + url → mapped fields', () => {
  const c = decodeRequest(LINKFEED_URL);
  assert.equal(c.device.ua, 'Mozilla/5.0 Test');
  assert.equal(c.device.language, 'en');
  assert.equal(c.user.id, 'pub1');
  assert.equal(c.site.page, 'https://example.com/');
});

test('url-linkfeed.decode: ch-* params fold into device.sua only when present', () => {
  const c = decodeRequest(LINKFEED_URL);
  // No ch-* params in baseline URL → no sua at all.
  assert.equal(c.device.sua, undefined);

  const chUrl =
    LINKFEED_URL + '&ch-ua=Chromium&ch-platform=Android&ch-mobile=%3F1&ch-platformv=&ch-model=';
  const c2 = decodeRequest(chUrl);
  assert.equal(c2.device.sua.brands, 'Chromium');
  assert.equal(c2.device.sua.platform, 'Android');
  assert.equal(c2.device.sua.mobile, '?1');
  // Empty ch-platformv / ch-model NOT folded — the param presence is in _raw
  // and the validator surfaces the empty-value issue from there.
  assert.equal(c2.device.sua.platformVersion, undefined);
  assert.equal(c2.device.sua.model, undefined);
});

test('url-linkfeed.decode: _raw preserves every query param verbatim', () => {
  const c = decodeRequest(LINKFEED_URL);
  assert.equal(c._raw.format, 'json');
  assert.equal(c._raw.feed, 'demo');
  assert.equal(c._raw.auth, 'tk');
  assert.equal(c._raw.subid, 'pub1');
  assert.equal(c._raw.lang, 'en');
});

test("url-linkfeed.decode: missing optional params don't pollute canonical", () => {
  const c = decodeRequest('http://xml.pushub.net/link?format=json');
  assert.equal(c.variant, 'url-linkfeed');
  assert.equal(c.device.ip, undefined);
  assert.equal(c.device.ua, undefined);
  assert.equal(c.device.language, undefined);
  assert.equal(c.site.page, undefined);
  assert.equal(c.user.id, undefined);
});
