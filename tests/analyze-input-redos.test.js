'use strict';

/**
 * Quadratic / cubic work on anonymous input to POST /api/analyze.
 *
 * `bidReq` and `bidRes` are accepted up to the 2 MB body cap and reach the URL
 * repair layer, the request decoders, the pop landing-host extractor and the VAST
 * rules. Each case below feeds one worst-case shape and asserts a wall-clock
 * ceiling. The ceiling is two orders of magnitude above the linear cost and
 * several orders below the old one (seconds to minutes), so it holds on a slow CI
 * runner and still fails if a rescan comes back.
 *
 * Inputs are synthetic and generic on purpose; this file does not document a
 * working attack beyond the shape of the repeated token.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate, crosscheck } = require('@ortbtools/core');
const { decodeRequest } = require('@ortbtools/core/decoders/request');
const {
  repairInput,
  looksLikeHost,
  MAX_REPAIR_LENGTH,
} = require('@ortbtools/core/decoders/request/_input-repair');
const { pathEquals } = require('@ortbtools/core/decoders/request/_signature');
const { extractPopLandingHost, admLooksLikePop } = require('@ortbtools/core/non-iab-formats');
const { validateVast } = require('@ortbtools/core/rules-vast');
const { canonicalPath } = require('../lib/locale-routes');
const seo = require('../lib/seo');

const LIMIT_MS = 500;
const MB = 1024 * 1024;

/**
 * @param {() => any} fn
 * @returns {{ ms: number, value: any }}
 */
function elapsed(fn) {
  const start = process.hrtime.bigint();
  const value = fn();
  return { ms: Number(process.hrtime.bigint() - start) / 1e6, value };
}

/**
 * @param {string} label
 * @param {() => any} fn
 * @returns {any}
 */
function within(label, fn) {
  const { ms, value } = elapsed(fn);
  assert.ok(ms < LIMIT_MS, `${label}: ${ms.toFixed(0)} ms (limit ${LIMIT_MS} ms)`);
  return value;
}

// Whole units only: a run cut mid-token would not end the way the shape intends.
const rep = (unit, n) => unit.repeat(Math.floor(n / unit.length));

// ── looksLikeHost: same answer as before the regex change ────────────────────

/** The pre-fix implementation, kept verbatim except for the guard it replaced. */
function legacyLooksLikeHost(value) {
  const schemeRelative = value.startsWith('//');
  if (/\s+(?:(?:https?:)?\/\/)/i.test(value)) return false;
  let parsed;
  try {
    parsed = new URL(schemeRelative ? `https:${value}` : `https://${value}`);
  } catch {
    return false;
  }
  const hostname = parsed.hostname;
  if (
    !hostname ||
    parsed.username ||
    parsed.password ||
    hostname.includes('_') ||
    hostname.includes('..')
  ) {
    return false;
  }
  if (hostname === 'localhost') return true;
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;
  const labels = hostname.endsWith('.') ? hostname.slice(0, -1).split('.') : hostname.split('.');
  if (!schemeRelative && labels.length < 2) return false;
  return labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

test('looksLikeHost: identical to the previous implementation on real pastes', () => {
  const examples = [
    'example.com',
    'example.com/path?x=1',
    'feed.vendor.example/search?format=json&feed=demo&auth=tk&query=shoes',
    '//example.com/a',
    'localhost',
    'localhost:3000/feed',
    '192.168.0.1/x',
    '[::1]/x',
    'user:pw@example.com',
    'exa_mple.com',
    'example..com',
    'example.com ',
    'example.com extra words',
    'example.com http://other.example',
    'example.com\thttps://other.example',
    'example.com\n//other.example',
    'see example.com',
    'hello world',
    'hello',
    '42',
    '-bad-.example.com',
    'EXAMPLE.COM/Path',
    'example.com.',
    'a b c d //x',
    'text HTTPS://UPPER.example',
    'text   //nbsp.example',
  ];
  for (const v of examples) {
    assert.equal(looksLikeHost(v), legacyLooksLikeHost(v), JSON.stringify(v));
  }
});

test('looksLikeHost: identical to the previous implementation on every short token string', () => {
  const tokens = [' ', '\t', 'a.com', '//', 'http:', 'https:', '/', 'x', ' ', '@'];
  let checked = 0;
  const walk = (prefix, depth) => {
    assert.equal(looksLikeHost(prefix), legacyLooksLikeHost(prefix), JSON.stringify(prefix));
    checked += 1;
    if (depth === 0) return;
    for (const token of tokens) walk(prefix + token, depth - 1);
  };
  walk('', 4);
  assert.ok(checked > 10000);
});

// ── repair layer and decoders ────────────────────────────────────────────────

// Below MAX_REPAIR_LENGTH so that the length cap does not hide the algorithm.
const BELOW_CAP = MAX_REPAIR_LENGTH - 64;

const REPAIR_SHAPES = {
  'host + whitespace run + one more character': (n) => 'example.com' + ' '.repeat(n) + 'x',
  'run of closing parentheses': (n) => 'example.com' + ')'.repeat(n),
  'run of HTML entities': (n) => 'example.com' + rep('&amp;', n),
  'run of generic entities': (n) => 'example.com' + rep('&a;', n),
  'nested parentheses': (n) => '('.repeat(n >> 1) + 'example.com' + ')'.repeat(n >> 1),
  'nested quotes and brackets': (n) => rep('<"', n >> 1) + 'example.com' + rep('">', n >> 1),
  'repeated markdown links': (n) => rep('[a](', n) + 'example.com' + ')'.repeat(n >> 2),
  'run of trailing punctuation': (n) => 'example.com' + '?'.repeat(n),
  'run of slashes then one character': (n) => 'https://example.com' + '/'.repeat(n) + 'x',
};

for (const [name, build] of Object.entries(REPAIR_SHAPES)) {
  test(`repairInput + decodeRequest: ${name} stays fast below the cap`, () => {
    const input = build(BELOW_CAP);
    within('repairInput', () => repairInput(input));
    within('decodeRequest', () => decodeRequest(input));
    within('validate', () => validate(input, { locale: 'en' }));
  });

  test(`repairInput + decodeRequest: ${name} stays fast at 2 MB`, () => {
    const input = build(2 * MB);
    within('repairInput', () => repairInput(input));
    within('decodeRequest', () => decodeRequest(input));
    within('validate', () => validate(input, { locale: 'en' }));
  });
}

test('decoders: a query with a million-scale count of distinct keys is read once', () => {
  let query = '';
  for (let i = 0; query.length < 200 * 1024; i += 1) query += `&k${i}=v`;
  const kinds = [
    `https://feed.example/feed?format=cu${query}`,
    `https://feed.example/link?format=json&feed=1&auth=1${query}`,
  ];
  for (const url of kinds) {
    const decoded = within('decodeRequest', () => decodeRequest(url));
    assert.ok(decoded && decoded.ok !== false, 'still decoded');
    assert.equal(decoded._raw.k0, 'v');
  }
});

test('decoders: decode damage is still reported for a destroyed percent-escape', () => {
  const url = 'https://feed.example/feed?format=cu&cb=%%CACHEBUSTER%%&ok=1';
  const decoded = decodeRequest(url);
  const damage = decoded.warnings.filter((w) => w.code === 'query_value_decode_damage');
  assert.deepEqual(
    damage.map((w) => w.param),
    ['cb'],
  );
});

test('pathEquals: a long run of slashes is not rescanned per slash', () => {
  within('pathEquals', () => pathEquals('/'.repeat(100000) + 'x', '/feed'));
  assert.equal(pathEquals('/Feed///', '/feed'), true);
  assert.equal(pathEquals('/feed', '/feed/'), true);
  assert.equal(pathEquals('/other', '/feed'), false);
  assert.equal(pathEquals('///', '/'), true);
});

test('request path helpers: a 16 KB run of slashes costs milliseconds', () => {
  const hostile = '/'.repeat(16 * 1024) + 'x';
  within('canonicalPath', () => canonicalPath(hostile));
  within('parseRoute', () => seo.parseRoute(hostile));
  assert.equal(canonicalPath('/Docs///'), '/docs');
  assert.equal(canonicalPath('/docs'), '/docs');
  assert.equal(seo.parseRoute('/blog///').sectionPath, seo.parseRoute('/blog').sectionPath);
});

// ── length cap ───────────────────────────────────────────────────────────────

test('repairInput: text above the cap is returned untouched, below it is still repaired', () => {
  const huge = '"' + 'a'.repeat(MAX_REPAIR_LENGTH) + '"';
  const skipped = repairInput(huge);
  assert.equal(skipped.text, huge);
  assert.deepEqual(skipped.repairs, []);

  const repaired = repairInput('"example.com/feed"');
  assert.equal(repaired.text, 'https://example.com/feed');
});

test('analyze input: a real JSON payload near the 2 MB body limit is still validated', () => {
  const sample = { id: '0', banner: { w: 300, h: 250 }, bidfloor: 0.5, bidfloorcur: 'USD' };
  const count = Math.floor((1.9 * MB) / (JSON.stringify(sample).length + 4));
  const imp = Array.from({ length: count }, (_, i) => ({ ...sample, id: String(i) }));
  const payload = { id: 'req-1', imp, site: { id: 's', page: 'https://example.com/' } };
  const result = validate(payload, { locale: 'en' });
  assert.equal(result.type, 'oRTB BidRequest');
  assert.ok(Array.isArray(result.findings));
});

// ── pop landing host and VAST open tags ──────────────────────────────────────

test('extractPopLandingHost: whitespace after a redirect call site is bounded work', () => {
  for (const key of ['window.open', 'top.location', 'parent.location', 'location.href']) {
    within(key, () => extractPopLandingHost(key + ' '.repeat(2 * MB) + 'x'));
    within(`${key} (paren)`, () => extractPopLandingHost(key + ' '.repeat(100000) + '( ' + 'x'));
  }
  within('admLooksLikePop', () => admLooksLikePop('window.open' + ' '.repeat(2 * MB) + 'x'));
});

test('extractPopLandingHost: real call sites still yield the landing host', () => {
  const cases = [
    ["window.open('https://landing.example/p?x=1')", 'landing.example'],
    ['window.open ( "https://a.example" )', 'a.example'],
    ['location.href = `https://b.example/`', 'b.example'],
    ["top.location='https://c.example'", 'c.example'],
    ["parent.location . ( 'https://d.example'", 'd.example'],
    ["LOCATION.REPLACE('HTTPS://E.EXAMPLE/')", 'e.example'],
    ['https://bare.example/x', 'bare.example'],
    ["<script>window.open(  '  https://no.example')</script>", null],
    ["window.open('ftp://no.example')", null],
    ['nothing here', null],
  ];
  for (const [adm, host] of cases) assert.equal(extractPopLandingHost(adm), host, adm);
});

test('extractPopLandingHost: same match as the original expression on short strings', () => {
  const original =
    /(?:window\.open|(?:top|parent)\.location|location\.(?:href|replace|assign))\s*[=(]?\.?\s*\(?\s*['"`](https?:\/\/[^'"`]+)['"`]/i;
  const alphabet = [' ', '=', '(', '.', "'", '"', '`'];
  const keys = ['window.open', 'top.location', 'location.href'];
  const tails = ['http://a.b/x', 'https://c.d/'];
  let checked = 0;
  const walk = (middle, depth) => {
    for (const key of keys) {
      for (const tail of tails) {
        for (const quote of ['', "'", '"']) {
          const adm = `${key}${middle}${quote}${tail}${quote}`;
          const expected = original.exec(adm);
          const host = extractPopLandingHost(adm);
          let want = null;
          if (expected) {
            try {
              want = new URL(expected[1]).hostname.toLowerCase();
            } catch {
              want = null;
            }
          }
          // The bare-URL branch comes first and never applies to these strings.
          assert.equal(host, want, JSON.stringify(adm));
          checked += 1;
        }
      }
    }
    if (depth === 0) return;
    for (const c of alphabet) walk(middle + c, depth - 1);
  };
  walk('', 4);
  assert.ok(checked > 10000);
});

test('crosscheck: a pop bid whose adm is a whitespace run is bounded work', () => {
  const request = {
    id: 'r',
    imp: [{ id: '1', banner: { w: 1, h: 1 }, ext: { adtype: 'popunder' } }],
    site: { page: 'https://example.com/' },
  };
  const response = {
    id: 'r',
    cur: 'USD',
    seatbid: [
      {
        bid: [
          {
            id: 'b',
            impid: '1',
            price: 1,
            adomain: ['advertiser.example'],
            adm: 'window.open' + ' '.repeat(2 * MB) + 'x',
            ext: { adtype: 'popunder' },
          },
        ],
      },
    ],
  };
  within('crosscheck', () => crosscheck(request, response, { locale: 'en' }));
  within('validate', () => validate(response, { locale: 'en' }));
});

test('validateVast: runs of unterminated MediaFile / NonLinear starts are bounded work', () => {
  for (const tag of ['<MediaFile ', '<NonLinear ']) {
    const adm = '<VAST version="4.2"><Ad><InLine>' + rep(tag, 2 * MB);
    within(tag, () => validateVast(adm, 'adm'));
  }
});

test('validateVast: MediaFile and NonLinear dimension findings are unchanged', () => {
  const vast = (media, nonlinear) =>
    '<VAST version="4.2"><Ad><InLine><AdSystem>X</AdSystem><AdTitle>T</AdTitle>' +
    `<Creatives><Creative><Linear><Duration>00:00:15</Duration><MediaFiles>${media}` +
    `</MediaFiles></Linear></Creative><Creative><NonLinearAds>${nonlinear}</NonLinearAds>` +
    '</Creative></Creatives></InLine></Ad></VAST>';
  const count = (adm, id) => {
    const finding = validateVast(adm, 'adm').find((f) => f.id === id);
    return finding ? finding.params.count : 0;
  };
  const withDims =
    '<MediaFile type="video/mp4" width="640" height="360">https://a.example/v.mp4</MediaFile>';
  const noDims = '<MediaFile type="video/mp4" width="640">https://a.example/v.mp4</MediaFile>';
  const nlWithDims = '<NonLinear width="300" height="50"/>';
  const nlNoDims = '<NonLinear height="50"/>';
  assert.equal(count(vast(withDims, nlWithDims), 'vast.mediafile_no_dimensions'), 0);
  assert.equal(
    count(vast(withDims + noDims + noDims, nlWithDims), 'vast.mediafile_no_dimensions'),
    2,
  );
  assert.equal(count(vast(withDims, nlWithDims), 'vast.nonlinear_no_dimensions'), 0);
  assert.equal(count(vast(withDims, nlNoDims + nlNoDims), 'vast.nonlinear_no_dimensions'), 2);
  const badType =
    '<MediaFile type="video/x-bogus" width="1" height="1">https://a.example/v</MediaFile>';
  const finding = validateVast(vast(badType, nlWithDims), 'adm').find(
    (f) => f.id === 'vast.mediafile_type_invalid',
  );
  assert.equal(finding && finding.params.type, 'video/x-bogus');
});

// ── lib/seo.js: replacement strings are data, not patterns ───────────────────

test('seo: "$&", "$`" and "$\'" in title, summary and body are rendered literally', () => {
  const shell = [
    '<!doctype html><html><head>',
    '<title>Shell</title>',
    '<meta name="description" content="shell" />',
    '<link rel="canonical" href="https://ortbtools.com/" />',
    '<meta name="robots" content="index,follow" />',
    '<meta property="og:title" content="shell" />',
    '<meta property="og:description" content="shell" />',
    '<meta name="twitter:title" content="shell" />',
    '<meta name="twitter:description" content="shell" />',
    '</head><body><main id="app-root">loading</main></body></html>',
  ].join('\n');
  const title = "Price $& more $` and $' end";
  const summary = "Summary $& with $` and $' too";
  const post = { title, summary, category: 'guide', body: "Body $& $` $' text." };

  const meta = seo.postSeo('slug', 'en', post, { indexable: true, existingLangs: ['en'] });
  const out = seo.injectPostSsr(seo.applySeoToHtml(shell, meta), post, 'en');

  const esc = seo.escapeHtml;
  assert.ok(out.includes(`<title>${esc(title)} — ortbtools blog</title>`));
  assert.ok(out.includes(`<meta name="description" content="${esc(summary)}" />`));
  assert.ok(out.includes(`<meta property="og:description" content="${esc(summary)}" />`));
  assert.ok(out.includes(`<meta name="twitter:description" content="${esc(summary)}" />`));
  assert.ok(out.includes(`<h1>${esc(title)}</h1>`));
  assert.ok(out.includes(esc(summary)));
  assert.ok(out.includes(esc("Body $& $` $' text.")));
  // Nothing from the shell was spliced back in by a special replacement pattern.
  assert.equal((out.match(/<main id="app-root">/g) || []).length, 1);
  assert.equal((out.match(/<title>/g) || []).length, 1);
  assert.equal((out.match(/rel="canonical"/g) || []).length, 1);
  assert.ok(!out.includes('loading'));
});
