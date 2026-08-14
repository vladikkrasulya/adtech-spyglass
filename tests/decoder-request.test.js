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

// `null` is reserved for "no input". Anything the caller actually typed gets a
// reason, because "not a URL" and "not a feed we know" need different answers
// on screen. See docs/url-input-spec-2026-08-13.md (D2).

test('decodeRequest: malformed URL → unparseable, not a bare null', () => {
  for (const bad of ['not a url', 'http://']) {
    const r = decodeRequest(bad);
    assert.equal(r.ok, false, `${bad}: not claimed`);
    assert.equal(r.reason, 'unparseable', `${bad}: reason`);
    assert.equal(typeof r.detail, 'string', `${bad}: carries the parser message`);
    assert.equal(r.variant, undefined, `${bad}: never looks like a canonical result`);
  }
});

test('decodeRequest: valid URL nobody claims → no_decoder, with what we read', () => {
  const r = decodeRequest('https://example.com/foo?bar=1&bar=2&baz=3');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_decoder');
  assert.equal(r.parsed.protocol, 'https:');
  assert.equal(r.parsed.host, 'example.com');
  assert.equal(r.parsed.pathname, '/foo');
  assert.deepEqual(r.parsed.params, ['bar', 'baz'], 'param names, deduped, no values');
  assert.equal(r.variant, undefined);
});

test('decodeRequest: unparseable and no_decoder are distinguishable', () => {
  // The whole point of D2: one `null` for both events left the operator with
  // no way to tell "fix your URL" from "we do not know this feed".
  assert.notEqual(decodeRequest('not a url').reason, decodeRequest('https://example.com/').reason);
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
    // Scheme is no longer asserted here: the gate moved to the registry, which
    // refuses anything outside http(s) with an explicit `unsupported_scheme`
    // before a decoder is consulted at all. Covered by the scheme-gating tests
    // below — `ftp://…` included.
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
  const r = decodeRequest('https://search.example/search?q=demo-query&format=json');
  assert.equal(r.reason, 'no_decoder');
  assert.equal(r.variant, undefined);
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
  assert.equal(decodeRequest('https://news.example/feed?format=json&id=1').reason, 'no_decoder');
  assert.equal(decodeRequest('https://news.example/feed').reason, 'no_decoder');
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

test('_raw: clickunder decoder keeps macros verbatim too', () => {
  // Same defect lived in two places. The clickunder decoder builds its own
  // envelope instead of going through decodeAuthenticatedJsonFeed, so it
  // needed the same fix rather than inheriting it.
  const c = decodeRequest(
    'https://ads.vendor.example/feed?sid=1&format=cu&cb=%%CACHEBUSTER%%' +
      '&page=https%3A%2F%2Fpublisher.example%2Fa',
  );
  assert.equal(c.variant, 'url-clickunder-feed');
  assert.equal(c._raw.cb, '%%CACHEBUSTER%%', '_raw is verbatim');
  assert.equal(c.site.page, 'https://publisher.example/a', 'mapped fields stay decoded');
  assert.deepEqual(
    c.warnings.map((w) => w.param),
    ['cb'],
  );
});

test('_raw: clickunder repeated key takes the first value, matching detect()', () => {
  // detect() reads normalisedQueryFormat(q) → q.get(), which is the first
  // value. `_raw` must not disagree with the value detection matched on.
  const c = decodeRequest('https://ads.vendor.example/feed?format=cu&sid=1&sid=2');
  assert.equal(c._raw.sid, '1');
});

// ── Case-insensitive signature matching (spec §3, layer 3) ──────────────────

const {
  pathEquals,
  getParam,
  hasParam,
  valueEquals,
} = require('@ortbtools/core/decoders/request/_signature');

test('_signature: path compare ignores case and trailing slashes', () => {
  assert.equal(pathEquals('/search', '/search'), true);
  assert.equal(pathEquals('/SEARCH', '/search'), true);
  assert.equal(pathEquals('/Search//', '/search'), true);
  assert.equal(pathEquals('/searching', '/search'), false, 'prefix is not a match');
  assert.equal(pathEquals('/a/search', '/search'), false, 'suffix is not a match');
});

test('_signature: param lookup ignores name case and takes query order', () => {
  const q = new URL('https://x.test/?FORMAT=a&format=b&Feed=demo&empty=').searchParams;
  assert.equal(getParam(q, 'format'), 'a', 'first in query order wins, as detect() sees it');
  assert.equal(getParam(q, 'feed'), 'demo');
  assert.equal(getParam(q, 'missing'), null);
  assert.equal(hasParam(q, 'FeEd'), true);
  assert.equal(hasParam(q, 'empty'), true, 'present-but-empty is present');
  assert.equal(hasParam(q, 'nope'), false);
});

test('_signature: enumerated value compare ignores case', () => {
  assert.equal(valueEquals('JSON', 'json'), true);
  assert.equal(valueEquals('json', 'JSON'), true);
  assert.equal(valueEquals(null, 'json'), false);
  assert.equal(valueEquals('jsonp', 'json'), false);
});

test('detect: the same feed URL is claimed however the paste mangled its case', () => {
  const variants = [
    'https://feed.vendor.example/search?format=json&feed=demo&auth=tk&query=q',
    'https://feed.vendor.example/SEARCH?format=json&feed=demo&auth=tk&query=q',
    'https://feed.vendor.example/search?FORMAT=json&FEED=demo&AUTH=tk&QUERY=q',
    'https://feed.vendor.example/search?format=JSON&feed=demo&auth=tk&query=q',
    'https://feed.vendor.example/search/?format=json&feed=demo&auth=tk&query=q',
  ];
  for (const url of variants) {
    assert.equal(decodeRequest(url).variant, 'url-search-feed', url);
  }
});

test('detect: loose matching does not rewrite the operator input', () => {
  // RFC 3986 §6.2.2.1 — only scheme and host are case-insensitive. We match
  // loosely and preserve exactly, so a replay sends what was pasted.
  const c = decodeRequest(
    'https://feed.vendor.example/SEARCH?FORMAT=json&feed=demo&auth=tk&query=Q',
  );
  assert.equal(c.endpoint, 'feed.vendor.example/SEARCH', 'path case preserved');
  assert.ok(Object.hasOwn(c._raw, 'FORMAT'), '_raw keeps the key as sent');
  assert.equal(Object.hasOwn(c._raw, 'format'), false, 'and does not invent a lowercased twin');
  assert.equal(c._raw.query, 'Q', 'operator values are never case-folded');
  assert.match(c.url, /SEARCH\?FORMAT=json/, 'url is the input, verbatim');
});

test('decode: mapped fields are read case-insensitively too', () => {
  // Detection succeeding while every mapped field came back empty would be
  // worse than not claiming the URL at all.
  const c = decodeRequest(
    'https://feed.vendor.example/search?FORMAT=json&FEED=demo&AUTH=tk&QUERY=q' +
      '&USER_IP=192.0.2.7&UA=Mozilla%2F5.0%20Test&LANG=en&SUBID=pub9',
  );
  assert.equal(c.device.ip, '192.0.2.7');
  assert.equal(c.device.ua, 'Mozilla/5.0 Test');
  assert.equal(c.device.language, 'en');
  assert.equal(c.user.id, 'pub9');
});

test('detect: linkfeed and clickunder gained the same tolerance', () => {
  assert.equal(
    decodeRequest('https://feed.vendor.example/LINK/?Format=JSON&Feed=demo&Auth=tk').variant,
    'url-linkfeed',
  );
  const cu = decodeRequest('https://ads.vendor.example/FEED?FORMAT=CU&IP=192.0.2.9');
  assert.equal(cu.variant, 'url-clickunder-feed');
  assert.equal(cu.device.ip, '192.0.2.9');
});

test('detect: looser case matching did not make the decoders greedy', () => {
  // The guards that mattered before still hold: path alone claims nothing,
  // and an incomplete signature is still incomplete.
  assert.equal(decodeRequest('https://news.example/FEED?format=json&id=1').reason, 'no_decoder');
  assert.equal(
    decodeRequest('https://feed.vendor.example/SEARCH?FORMAT=json').reason,
    'no_decoder',
  );
  assert.equal(
    decodeRequest('https://search.example/SEARCH?q=demo&FORMAT=json').reason,
    'no_decoder',
  );
  assert.equal(
    decodeRequest('https://feed.vendor.example/SEARCHING?format=json&feed=d&auth=t&query=q').reason,
    'no_decoder',
  );
});

// ── Scheme gating (spec §5) ────────────────────────────────────────────────

test('decodeRequest: only http(s) is accepted, with the scheme named', () => {
  // `new URL()` accepts all of these without complaint — measured, not
  // assumed — so the blocklist has to be explicit. The parser does not help.
  for (const [input, scheme] of [
    ['javascript:alert(1)', 'javascript:'],
    ['data:text/html,<b>x', 'data:'],
    ['file:///etc/passwd', 'file:'],
    ['ftp://host.example/f', 'ftp:'],
    ['mailto:ops@vendor.example', 'mailto:'],
    ['ws://host.example/s', 'ws:'],
  ]) {
    const r = decodeRequest(input);
    assert.equal(r.ok, false, input);
    assert.equal(r.reason, 'unsupported_scheme', input);
    assert.equal(r.scheme, scheme, `${input}: names the scheme so the UI can say which`);
    assert.equal(r.variant, undefined, input);
  }
});

test('decodeRequest: a bare host:port reads as a scheme and is refused as one', () => {
  // `adserver:8080/feed` parses with protocol `adserver:`, so it lands here
  // rather than looking like a feed. Layer 1 is what will turn it into
  // `https://adserver:8080/feed` before it ever reaches this gate.
  const r = decodeRequest('adserver:8080/feed');
  assert.equal(r.reason, 'unsupported_scheme');
  assert.equal(r.scheme, 'adserver:');
});

test('decodeRequest: unsupported_scheme is distinct from the other refusals', () => {
  const reasons = [
    decodeRequest('not a url').reason,
    decodeRequest('javascript:alert(1)').reason,
    decodeRequest('https://example.com/').reason,
  ];
  assert.deepEqual(reasons, ['unparseable', 'unsupported_scheme', 'no_decoder']);
});

test('decodeRequest: http and https still decode on every variant', () => {
  assert.equal(
    decodeRequest('https://feed.vendor.example/search?format=json&feed=d&auth=t&query=q').variant,
    'url-search-feed',
  );
  assert.equal(
    decodeRequest('http://feed.vendor.example/link?format=json&feed=d&auth=t').variant,
    'url-linkfeed',
  );
  assert.equal(
    decodeRequest('HTTPS://ads.vendor.example/feed?format=cu&sid=1').variant,
    'url-clickunder-feed',
  );
});

test('url-search-feed.detect: userinfo and fragment stay a decoder concern', () => {
  // Moved scheme checking to the registry; these did not move, because a
  // fragment is arguably paste noise for layer 1 to strip rather than a
  // reason to refuse the whole URL.
  const q = '?format=json&feed=demo&auth=tk&query=q';
  assert.equal(
    urlSearchFeed.detect('', new URL(`https://u:p@feed.vendor.example/search${q}`)),
    false,
  );
  assert.equal(
    urlSearchFeed.detect('', new URL(`https://feed.vendor.example/search${q}#frag`)),
    false,
  );
  assert.equal(urlSearchFeed.detect('', new URL(`https://feed.vendor.example/search${q}`)), true);
});
