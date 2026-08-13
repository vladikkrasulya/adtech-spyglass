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

const { makeCanonicalUrlRequest } = require('@ortbtools/core/decoders/request/_canonical');
const { decodeRequest, info } = require('@ortbtools/core/decoders/request');
const urlLinkfeed = require('@ortbtools/core/decoders/request/url-linkfeed');
const urlSearchFeed = require('@ortbtools/core/decoders/request/url-search-feed');

const LINKFEED_URL =
  'http://feed.vendor.example/link?format=json&feed=demo&auth=tk&subid=pub1' +
  '&user_ip=192.0.2.1&ua=Mozilla%2F5.0%20Test' +
  '&url=https%3A%2F%2Fexample.com%2F&lang=en';

// Fully synthetic: reserved example domains/IP and placeholder credentials.
// This mirrors only the wire shape; no partner-supplied values are retained.
const SEARCH_FEED_URL =
  'http://feed.vendor.example/search?format=json&feed=demo&auth=tk&query=demo-query' +
  '&subid=pub1&user_ip=192.0.2.44&ua=Mozilla%2F5.0%20Test' +
  '&url=https%3A%2F%2Fpublisher.example%2F&count=1&ad_info=1&lang=en';

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
  assert.equal(c.endpoint, 'feed.vendor.example/link');
});

test('info(): exposes registered decoder metadata', () => {
  const list = info();
  assert.ok(Array.isArray(list));
  assert.ok(list.find((d) => d.id === 'url-linkfeed'));
  assert.ok(list.find((d) => d.id === 'url-search-feed'));
  assert.ok(list.every((d) => typeof d.description === 'string'));
});

// ── url-linkfeed decoder ──────────────────────────────────────────────────

test('url-linkfeed.detect: claims the JSON link-feed shape on any host', () => {
  // Host-agnostic, shape-based: /link + format=json + feed + auth.
  const q = '?format=json&feed=demo&auth=tk';
  assert.equal(urlLinkfeed.detect('', new URL(`http://feed.vendor.example/link${q}`)), true);
  assert.equal(urlLinkfeed.detect('', new URL(`https://another-host.example/link${q}`)), true);
});

test('url-linkfeed.detect: rejects wrong path or incomplete feed-param shape', () => {
  const q = '?format=json&feed=demo&auth=tk';
  // Right shape, wrong path.
  assert.equal(urlLinkfeed.detect('', new URL(`http://feed.vendor.example/other${q}`)), false);
  // Right path, missing the auth/feed triad → not a link-feed pull.
  assert.equal(urlLinkfeed.detect('', new URL('http://feed.vendor.example/link?a=1')), false);
  assert.equal(
    urlLinkfeed.detect('', new URL('http://feed.vendor.example/link?format=json')),
    false,
  );
  assert.equal(
    urlLinkfeed.detect('', new URL('http://feed.vendor.example/link?feed=demo&auth=tk')),
    false,
  );
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

test('_raw reads a repeated key the same way detect() did — first value wins', () => {
  // The adversarial review caught last-wins here: one extra `&format=cu` at
  // the END overwrote the `format=json` that detection matched on, `_raw`
  // disagreed with the signature, and format-detect re-labelled the search
  // feed `pops` — the exact label the decoder exists to avoid. detect() uses
  // q.get(), which returns the FIRST value; _raw must read the same one.
  const c = decodeRequest(
    'https://feed.vendor.example/search?format=json&feed=7&auth=tk&query=x&format=cu',
  );
  assert.equal(c.variant, 'url-search-feed');
  assert.equal(c._raw.format, 'json', '_raw must report what detection saw, not the override');

  // Same reading on /link, same shared mapping.
  const l = decodeRequest(
    'http://feed.vendor.example/link?format=json&feed=demo&auth=tk&subid=a&subid=b',
  );
  assert.equal(l._raw.subid, 'a');
  assert.equal(l.user.id, 'a', 'the mapped field and _raw must agree');
});

test("url-linkfeed.decode: missing optional params don't pollute canonical", () => {
  // Required feed-param triad present; all optional params (ip/ua/lang/url/subid) absent.
  const c = decodeRequest('http://feed.vendor.example/link?format=json&feed=demo&auth=tk');
  assert.equal(c.variant, 'url-linkfeed');
  assert.equal(c.device.ip, undefined);
  assert.equal(c.device.ua, undefined);
  assert.equal(c.device.language, undefined);
  assert.equal(c.site.page, undefined);
  assert.equal(c.user.id, undefined);
});

// ── url-search-feed decoder ───────────────────────────────────────────────

test('url-search-feed.detect: claims only the full JSON search-feed signature', () => {
  assert.equal(urlSearchFeed.detect('', new URL(SEARCH_FEED_URL)), true);
  assert.equal(
    urlSearchFeed.detect(
      '',
      new URL('https://another-host.example/search?format=json&feed=demo&auth=tk&query=x'),
    ),
    true,
  );
  assert.equal(
    urlSearchFeed.detect(
      '',
      new URL('https://feed.vendor.example/search/?format=json&feed=demo&auth=tk&query=x'),
    ),
    true,
  );

  for (const url of [
    'https://feed.vendor.example/search?format=json&feed=demo&auth=tk',
    'https://feed.vendor.example/search?format=json&feed=demo&query=x',
    'https://feed.vendor.example/search?format=json&auth=tk&query=x',
    'https://feed.vendor.example/other?format=json&feed=demo&auth=tk&query=x',
    'ftp://feed.vendor.example/search?format=json&feed=demo&auth=tk&query=x',
    'https://user:pass@feed.vendor.example/search?format=json&feed=demo&auth=tk&query=x',
    'https://feed.vendor.example/search?format=json&feed=demo&auth=tk&query=x#fragment',
  ]) {
    assert.equal(urlSearchFeed.detect('', new URL(url)), false, url);
  }
});

test('decodeRequest: synthetic search-feed URL maps to canonical URL request', () => {
  const c = decodeRequest(SEARCH_FEED_URL);
  assert.ok(c, 'search-feed URL is claimed');
  assert.equal(c.variant, 'url-search-feed');
  assert.equal(c.endpoint, 'feed.vendor.example/search');
  assert.equal(c.format, undefined);
  assert.equal(c.device.ip, '192.0.2.44');
  assert.equal(c.device.ua, 'Mozilla/5.0 Test');
  assert.equal(c.device.language, 'en');
  assert.equal(c.site.page, 'https://publisher.example/');
  assert.equal(c.user.id, 'pub1');
  assert.equal(c._raw.query, 'demo-query');
  assert.ok(Object.hasOwn(c._raw, 'auth'));
});

test('decodeRequest: generic web search URL remains unclaimed', () => {
  assert.equal(decodeRequest('https://search.example/search?q=demo-query&format=json'), null);
});

// ── url-clickunder-feed (Track: clickunder/pop URL feed) ────────────────────

const CLICKUNDER_URL =
  'https://ads.vendor.example/feed?sid=123&format=cu&ua=Mozilla%2F5.0' +
  '&ip=192.0.2.1&uid=u1&language=en&page=https%3A%2F%2Fpub.example%2Fa';

test('decodeRequest: url-clickunder-feed URL → canonical with variant=url-clickunder-feed', () => {
  const c = decodeRequest(CLICKUNDER_URL);
  assert.ok(c, 'clickunder /feed?format=cu URL is claimed');
  assert.equal(c.variant, 'url-clickunder-feed');
  assert.equal(c.format, 'pops');
  assert.equal(c.endpoint, 'ads.vendor.example/feed');
});

test('decodeRequest: all clickunder format aliases are claimed', () => {
  for (const fmt of ['cu', 'pop', 'pops', 'popup', 'popunder', 'clickunder']) {
    const c = decodeRequest(`https://ads.vendor.example/feed?sid=1&format=${fmt}`);
    assert.ok(c && c.variant === 'url-clickunder-feed', `${fmt} → clickunder`);
  }
});

test('decodeRequest: generic /feed without a pop format is NOT claimed as clickunder', () => {
  // Path alone must not trigger the clickunder decoder. A non-pop `/feed`
  // (e.g. an RSS-ish JSON pull) has no pop signal, so no decoder claims it.
  assert.equal(decodeRequest('https://news.example/feed?format=json&id=1'), null);
  assert.equal(decodeRequest('https://news.example/feed'), null);
});

test('decodeRequest: clickunder and link-feed do not intercept each other', () => {
  // Disjoint paths: clickunder gates on /feed + pop format, link-feed on /link.
  assert.equal(decodeRequest(CLICKUNDER_URL).variant, 'url-clickunder-feed');
  assert.equal(decodeRequest(LINKFEED_URL).variant, 'url-linkfeed');
});

// ── _raw is verbatim (see docs/url-input-spec-2026-08-13.md, D1) ────────────

const { parseRawQuery, findDecodeDamage } = require('@ortbtools/core/decoders/request/_raw-query');

test('parseRawQuery: does not percent-decode', () => {
  const raw = parseRawQuery('?a=%20&b=%2F&c=hello%20world');
  assert.equal(raw.a, '%20');
  assert.equal(raw.b, '%2F');
  assert.equal(raw.c, 'hello%20world');
});

test('parseRawQuery: bare key is present with an empty value', () => {
  const raw = parseRawQuery('?flag&a=1');
  assert.ok(Object.hasOwn(raw, 'flag'));
  assert.equal(raw.flag, '');
  assert.equal(raw.a, '1');
});

test('parseRawQuery: first value wins on a repeated key', () => {
  // Must match detect(), which reads searchParams.get() — the first value.
  assert.equal(parseRawQuery('?format=json&format=cu').format, 'json');
});

test('parseRawQuery: tolerates leading ?, empty pairs and missing input', () => {
  assert.deepEqual(parseRawQuery(''), {});
  assert.deepEqual(parseRawQuery('?'), {});
  assert.deepEqual(parseRawQuery(undefined), {});
  assert.deepEqual(parseRawQuery('a=1&&b=2'), { a: '1', b: '2' });
  assert.deepEqual(parseRawQuery('a=1'), parseRawQuery('?a=1'));
});

test('findDecodeDamage: reports only values percent-decoding destroyed', () => {
  const url = new URL('https://f.example/s?cb=%%CACHEBUSTER%%&cu=%%CLICK_URL%%&sp=hello%20world');
  const damage = findDecodeDamage(url.searchParams, parseRawQuery(url.search));
  assert.equal(damage.length, 1, 'only the hex-prefix macro is damaged');
  assert.equal(damage[0].key, 'cb');
});

// A macro `%%NAME%%` is destroyed exactly when NAME's first two letters are a
// valid hex pair: `CA` → 0xCA → invalid UTF-8 → U+FFFD. `CL` is not, so
// %%CLICK_URL%% survives. Measured on Node, Chrome and Firefox alike.
const MACROS_DESTROYED = ['CACHEBUSTER', 'AD_UNIT', 'ADV_DOM', 'DEVICE_ID', 'EARNINGS'];
const MACROS_INTACT = ['CLICK_URL', 'AUCTION_PRICE', 'CORRELATOR', 'TIMESTAMP'];

test('_raw: unexpanded feed macros survive verbatim', () => {
  for (const name of [...MACROS_DESTROYED, ...MACROS_INTACT]) {
    const c = decodeRequest(
      `https://feed.vendor.example/search?format=json&feed=demo&auth=tk&query=q&m=%%${name}%%`,
    );
    assert.ok(c, `${name}: claimed`);
    assert.equal(c._raw.m, `%%${name}%%`, `${name}: _raw is verbatim`);
  }
});

test('_raw: damaged macros warn, intact macros do not', () => {
  const build = (name) =>
    decodeRequest(
      `https://feed.vendor.example/search?format=json&feed=demo&auth=tk&query=q&m=%%${name}%%`,
    );
  for (const name of MACROS_DESTROYED) {
    const w = build(name).warnings;
    assert.equal(w.length, 1, `${name}: warns`);
    assert.equal(w[0].code, 'query_value_decode_damage');
    assert.equal(w[0].param, 'm');
  }
  for (const name of MACROS_INTACT) {
    assert.deepEqual(build(name).warnings, [], `${name}: no warning`);
  }
});

test('_raw: verbatim reading does not stop fields that need decoding', () => {
  const c = decodeRequest(SEARCH_FEED_URL);
  assert.equal(c.site.page, 'https://publisher.example/', 'site.page stays decoded');
  assert.equal(c.device.ua, 'Mozilla/5.0 Test', 'device.ua stays decoded');
  assert.equal(c._raw.url, 'https%3A%2F%2Fpublisher.example%2F', '_raw stays encoded');
});

test('makeCanonicalUrlRequest: envelope carries an empty warnings array', () => {
  assert.deepEqual(makeCanonicalUrlRequest('v', 'http://x.test/').warnings, []);
});
