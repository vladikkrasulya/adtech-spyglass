'use strict';

/**
 * tests/input-repair.test.js — paste-transport repair before URL parsing.
 *
 * Privacy: every URL, address, token, and macro below is synthetic. Never put
 * partner-supplied request URLs in this table.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { repairInput } = require('@ortbtools/core/decoders/request/_input-repair');

const BASE_URL = 'https://feed.vendor.example/search?format=json&feed=demo&auth=tk&query=shoes';
const NO_SCHEME = BASE_URL.slice('https://'.length);

const PASTE_CASES = [
  { name: 'clean URL', input: BASE_URL, text: BASE_URL, steps: [] },
  { name: 'double quotes', input: `"${BASE_URL}"`, text: BASE_URL, steps: ['wrappers'] },
  { name: 'single quotes', input: `'${BASE_URL}'`, text: BASE_URL, steps: ['wrappers'] },
  { name: 'backticks', input: `\`${BASE_URL}\``, text: BASE_URL, steps: ['wrappers'] },
  { name: 'angle brackets', input: `<${BASE_URL}>`, text: BASE_URL, steps: ['wrappers'] },
  { name: 'markdown link', input: `[feed](${BASE_URL})`, text: BASE_URL, steps: ['wrappers'] },
  { name: 'parentheses', input: `(${BASE_URL})`, text: BASE_URL, steps: ['wrappers'] },
  {
    name: 'nested wrappers aggregate into one repair',
    input: `'"<${BASE_URL}>"'`,
    text: BASE_URL,
    steps: ['wrappers'],
  },
  {
    name: 'HTML-escaped separators',
    input: BASE_URL.replaceAll('&', '&amp;'),
    text: BASE_URL,
    steps: ['html_amp'],
  },
  { name: 'missing scheme', input: NO_SCHEME, text: BASE_URL, steps: ['scheme'] },
  { name: 'scheme-relative', input: `//${NO_SCHEME}`, text: BASE_URL, steps: ['scheme'] },
  {
    name: 'extra closing parenthesis',
    input: `${BASE_URL})`,
    text: BASE_URL,
    steps: ['trailing_punctuation'],
  },
  {
    name: 'trailing comma',
    input: `${BASE_URL},`,
    text: BASE_URL,
    steps: ['trailing_punctuation'],
  },
  {
    name: 'trailing period',
    input: `${BASE_URL}.`,
    text: BASE_URL,
    steps: ['trailing_punctuation'],
  },
  {
    name: 'entity-like trailing semicolon',
    input: `${BASE_URL}&copy;`,
    text: BASE_URL,
    steps: ['trailing_punctuation'],
  },
  {
    name: 'bare trailing semicolon is payload',
    input: `${BASE_URL};`,
    text: `${BASE_URL};`,
    steps: [],
  },
  {
    name: 'uppercase path is payload',
    input: BASE_URL.replace('/search', '/SEARCH'),
    text: BASE_URL.replace('/search', '/SEARCH'),
    steps: [],
  },
  {
    name: 'uppercase format value is payload',
    input: BASE_URL.replace('format=json', 'format=JSON'),
    text: BASE_URL.replace('format=json', 'format=JSON'),
    steps: [],
  },
  {
    name: 'uppercase format key is payload',
    input: BASE_URL.replace('format=json', 'FORMAT=json'),
    text: BASE_URL.replace('format=json', 'FORMAT=json'),
    steps: [],
  },
];

const PUNCTUATION_CASES = [
  ...['?', '!', '.', ',', ':', '*', '_', '~'].map((character) => ({
    name: `always-trimmed ${character}`,
    input: `${BASE_URL}${character}`,
    text: BASE_URL,
    steps: ['trailing_punctuation'],
  })),
  {
    name: 'balanced query parentheses stay',
    input: 'https://feed.vendor.example/search?q=(shoes)',
    text: 'https://feed.vendor.example/search?q=(shoes)',
    steps: [],
  },
  {
    name: 'unbalanced query parenthesis goes',
    input: 'https://feed.vendor.example/search?q=shoes)',
    text: 'https://feed.vendor.example/search?q=shoes',
    steps: ['trailing_punctuation'],
  },
  {
    name: 'only one excess parenthesis goes',
    input: 'https://feed.vendor.example/search?q=(a))',
    text: 'https://feed.vendor.example/search?q=(a)',
    steps: ['trailing_punctuation'],
  },
  {
    name: 'mixed trailing punctuation is iterative',
    input: 'https://feed.vendor.example/search?q=shoes).',
    text: 'https://feed.vendor.example/search?q=shoes',
    steps: ['trailing_punctuation'],
  },
  {
    name: 'several always-trimmed characters aggregate',
    input: 'https://feed.vendor.example/search?q=shoes?!',
    text: 'https://feed.vendor.example/search?q=shoes',
    steps: ['trailing_punctuation'],
  },
  {
    name: 'non-alphanumeric entity tail keeps semicolon',
    input: 'https://feed.vendor.example/search?q=x&foo_bar;',
    text: 'https://feed.vendor.example/search?q=x&foo_bar;',
    steps: [],
  },
  {
    name: 'numeric entity syntax keeps semicolon',
    input: 'https://feed.vendor.example/search?q=x&#123;',
    text: 'https://feed.vendor.example/search?q=x&#123;',
    steps: [],
  },
  {
    name: 'terminal HTML entity is outside the GFM autolink',
    input: 'https://feed.vendor.example/search?q=a&amp;',
    text: 'https://feed.vendor.example/search?q=a',
    steps: ['trailing_punctuation'],
  },
];

const INVISIBLE_CHARACTERS = ['\u200B', '\u00AD', '\uFEFF', '\u2028', '\u2029', '\u0000'];
const INVISIBLE_CASES = [
  ...INVISIBLE_CHARACTERS.map((character) => ({
    name: `remove U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
    input: `https://feed.vendor.example/search?q=a${character}b`,
    text: 'https://feed.vendor.example/search?q=ab',
    steps: ['invisible_chars'],
  })),
  {
    name: 'replace internal non-breaking space',
    input: 'https://feed.vendor.example/search?q=a\u00A0b',
    text: 'https://feed.vendor.example/search?q=a b',
    steps: ['invisible_chars'],
  },
  {
    name: 'all invisible characters aggregate into one repair',
    input: `https://feed${INVISIBLE_CHARACTERS.join('')}.vendor.example/a\u00A0b`,
    text: 'https://feed.vendor.example/a b',
    steps: ['invisible_chars'],
  },
  {
    name: 'internal TAB LF CR are left to URL parsing',
    input: 'https://feed.vendor.example/a\tb\nc\rd',
    text: 'https://feed.vendor.example/a\tb\nc\rd',
    steps: [],
  },
  {
    name: 'invisible characters cannot hide edge whitespace from trim',
    input: `\u200B  ${BASE_URL}  \u200B`,
    text: BASE_URL,
    steps: ['invisible_chars'],
  },
];

const HTML_AMP_CASES = [
  {
    name: 'single escaped separator',
    input: '?a=1&amp;b=2',
    text: '?a=1&b=2',
    steps: ['html_amp'],
  },
  {
    name: 'several escaped separators aggregate',
    input: '?a=1&amp;b=2&amp;c=3',
    text: '?a=1&b=2&c=3',
    steps: ['html_amp'],
  },
  {
    name: 'double escaping is ambiguous',
    input: '?x=a&amp;amp;b=2',
    text: '?x=a&amp;amp;b=2',
    steps: [],
    warningCount: 1,
  },
  {
    name: 'triple escaping is ambiguous',
    input: '?x=a&amp;amp;amp;b=2',
    text: '?x=a&amp;amp;amp;b=2',
    steps: [],
    warningCount: 1,
  },
  {
    name: 'entity inside a value without name-equals guard stays',
    input: '?q=rock&amp;roll',
    text: '?q=rock&amp;roll',
    steps: [],
  },
  {
    name: 'encoded separator before fragment stays',
    input: '?q=a&amp;#tail',
    text: '?q=a&amp;#tail',
    steps: [],
  },
  {
    name: 'encoded nested redirect stays byte-identical',
    input: '?redirect=https%3A%2F%2Fpublisher.example%2F%3Fa%3D1%26amp%3Bb%3D2',
    text: '?redirect=https%3A%2F%2Fpublisher.example%2F%3Fa%3D1%26amp%3Bb%3D2',
    steps: [],
  },
  {
    name: 'adjacent macro values survive guarded separators',
    input: '?cb=%%CACHEBUSTER%%&amp;price=${AUCTION_PRICE}&amp;slot=[NAME]',
    text: '?cb=%%CACHEBUSTER%%&price=${AUCTION_PRICE}&slot=[NAME]',
    steps: ['html_amp'],
  },
  {
    name: 'ordinary and ambiguous escapes coexist',
    input: '?a=1&amp;b=2&x=a&amp;amp;c=3',
    text: '?a=1&b=2&x=a&amp;amp;c=3',
    steps: ['html_amp'],
    warningCount: 1,
  },
  ...['a1', 'a_b', 'a-b', 'a[b]', 'a.b', '%NAME%'].map((name) => ({
    name: `guard accepts ${name}`,
    input: `?a=1&amp;${name}=2`,
    text: `?a=1&${name}=2`,
    steps: ['html_amp'],
  })),
  ...['', '${NAME}', 'a;b'].map((name) => ({
    name: `guard rejects ${name || 'empty name'}`,
    input: `?a=1&amp;${name}=2`,
    text: `?a=1&amp;${name}=2`,
    steps: [],
    warningCount: name === 'a;b' ? 0 : undefined,
  })),
  {
    name: 'entity match is case-sensitive',
    input: '?a=1&AMP;b=2',
    text: '?a=1&AMP;b=2',
    steps: [],
  },
];

const SCHEME_CASES = [
  ...[
    'adserver:8080/feed',
    'ad-server:8080/feed',
    'ad_server:8080/feed',
    '127.0.0.1:8080/feed',
    'localhost:8080/search',
  ].map((input) => ({
    name: `numeric host port ${input}`,
    input,
    text: `https://${input}`,
    steps: ['scheme'],
  })),
  {
    name: 'minimum port',
    input: 'adserver:1/feed',
    text: 'https://adserver:1/feed',
    steps: ['scheme'],
  },
  {
    name: 'maximum port',
    input: 'adserver:65535/feed',
    text: 'https://adserver:65535/feed',
    steps: ['scheme'],
  },
  { name: 'zero is not a port', input: 'adserver:0/feed', text: 'adserver:0/feed', steps: [] },
  {
    name: 'out-of-range port stays',
    input: 'adserver:65536/feed',
    text: 'adserver:65536/feed',
    steps: [],
  },
  {
    name: 'non-numeric port stays',
    input: 'adserver:notaport/feed',
    text: 'adserver:notaport/feed',
    steps: [],
  },
  { name: 'mailto stays', input: 'mailto:x@y', text: 'mailto:x@y', steps: [] },
  {
    name: 'javascript stays',
    input: 'javascript:alert(1)',
    text: 'javascript:alert(1)',
    steps: [],
  },
  {
    name: 'FTP stays',
    input: 'ftp://feed.vendor.example/feed',
    text: 'ftp://feed.vendor.example/feed',
    steps: [],
  },
  {
    name: 'uppercase HTTP spelling stays byte-identical',
    input: 'HTTP://feed.vendor.example/SEARCH?FORMAT=JSON',
    text: 'HTTP://feed.vendor.example/SEARCH?FORMAT=JSON',
    steps: [],
  },
  {
    name: 'colon in payload does not hide a missing scheme',
    input: 'feed.vendor.example/search?next=https://publisher.example/',
    text: 'https://feed.vendor.example/search?next=https://publisher.example/',
    steps: ['scheme'],
  },
];

const BOUNDARY_CASES = [
  {
    name: 'broken empty DNS label',
    input: 'feed..example/search',
    text: 'feed..example/search',
    steps: [],
  },
  {
    name: 'underscore in dotted DNS host',
    input: 'feed.example_com/search',
    text: 'feed.example_com/search',
    steps: [],
  },
  {
    name: 'port does not rescue a broken empty DNS label',
    input: 'feed..example:8080/search',
    text: 'feed..example:8080/search',
    steps: [],
  },
  {
    name: 'port does not rescue an underscored dotted DNS host',
    input: 'feed.example_com:8080/search',
    text: 'feed.example_com:8080/search',
    steps: [],
  },
  { name: 'not a URL', input: 'not a url', text: 'not a url', steps: [] },
  { name: 'email-like text is not a host', input: 'x@y.example', text: 'x@y.example', steps: [] },
  { name: 'relative path', input: '/search?format=json', text: '/search?format=json', steps: [] },
  {
    name: 'unknown query structure',
    input: 'https://feed.vendor.example/search?a=1b=2',
    text: 'https://feed.vendor.example/search?a=1b=2',
    steps: [],
  },
  {
    name: 'truncated percent macro',
    input: 'https://feed.vendor.example/search?cb=%%CACHEBUSTER',
    text: 'https://feed.vendor.example/search?cb=%%CACHEBUSTER',
    steps: [],
  },
  {
    name: 'truncated braced macro',
    input: 'https://feed.vendor.example/search?price=${AUCTION_PRICE',
    text: 'https://feed.vendor.example/search?price=${AUCTION_PRICE',
    steps: [],
  },
  {
    name: 'complete macro forms',
    input: 'https://feed.vendor.example/search?a=%%CACHEBUSTER%%&b=${AUCTION_PRICE}&c=[NAME]',
    text: 'https://feed.vendor.example/search?a=%%CACHEBUSTER%%&b=${AUCTION_PRICE}&c=[NAME]',
    steps: [],
  },
  {
    name: 'several pasted URLs',
    input: 'curl https://one.example/feed https://two.example/feed',
    text: 'curl https://one.example/feed https://two.example/feed',
    steps: [],
  },
  {
    name: 'asymmetric quotes stay',
    input: `"${BASE_URL}'`,
    text: `"${BASE_URL}'`,
    steps: [],
  },
  {
    name: 'parenthesis wrapper does not repair malformed payload',
    input: '(https://feed.vendor.example/search?q=()',
    text: 'https://feed.vendor.example/search?q=(',
    steps: ['wrappers'],
  },
];

const COMPOSED_CASES = [
  {
    name: 'punctuation cannot expose a wrapper on run two',
    input: `(${BASE_URL}).`,
    text: BASE_URL,
    steps: ['wrappers', 'trailing_punctuation'],
  },
  {
    name: 'wrapper cannot expose trim on run two',
    input: `"  ${BASE_URL}  "`,
    text: BASE_URL,
    steps: ['wrappers'],
  },
  {
    name: 'nested wrapper and excess parenthesis stay one-pass stable',
    input: `"(${BASE_URL}))".`,
    text: BASE_URL,
    steps: ['wrappers', 'trailing_punctuation'],
  },
];

const ALL_CASES = [
  ...PASTE_CASES,
  ...PUNCTUATION_CASES,
  ...INVISIBLE_CASES,
  ...HTML_AMP_CASES,
  ...SCHEME_CASES,
  ...BOUNDARY_CASES,
  ...COMPOSED_CASES,
];

function assertCases(cases) {
  for (const entry of cases) {
    const result = repairInput(entry.input);
    assert.equal(result.text, entry.text, entry.name);
    assert.deepEqual(
      result.repairs.map((repair) => repair.step),
      entry.steps,
      `${entry.name}: repair steps`,
    );
    assert.equal(result.warnings.length, entry.warningCount || 0, `${entry.name}: warnings`);
  }
}

// ── Paste variants and payload preservation ───────────────────────────────

test('repairInput: paste variants are repaired without normalizing payload', () => {
  assertCases(PASTE_CASES);
});

// ── Trailing punctuation ──────────────────────────────────────────────────

test('repairInput: trailing punctuation follows the stated GFM rules', () => {
  assertCases(PUNCTUATION_CASES);
});

// ── Invisible characters ──────────────────────────────────────────────────

test('repairInput: removes the six invisible characters and replaces NBSP', () => {
  assertCases(INVISIBLE_CASES);
});

// ── Guarded HTML ampersands and warnings ──────────────────────────────────

test('repairInput: HTML ampersand repair is guarded and non-recursive', () => {
  assertCases(HTML_AMP_CASES);
});

test('repairInput: double escaping warns without changing ambiguous text', () => {
  const result = repairInput('?x=a&amp;amp;b=2');
  assert.deepEqual(result.repairs, []);
  assert.equal(result.text, '?x=a&amp;amp;b=2');
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].step, 'html_amp');
  assert.equal(result.warnings[0].code, 'double_escaped_amp');
  assert.equal(typeof result.warnings[0].detail, 'string');
});

// ── Scheme repair ─────────────────────────────────────────────────────────

test('repairInput: adds HTTPS only to host-like and numeric host-port inputs', () => {
  assertCases(SCHEME_CASES);
});

// ── Boundary negatives ────────────────────────────────────────────────────

test('repairInput: ambiguous or payload-level damage is left untouched', () => {
  assertCases(BOUNDARY_CASES);
});

// ── Repair audit ──────────────────────────────────────────────────────────

test('repairInput: every changed step leaves one ordered before/after record', () => {
  const s0 = '  "<feed.vendor.example/se\u200Barch?format=json&amp;feed=demo).>"  ';
  const s1 = '"<feed.vendor.example/se\u200Barch?format=json&amp;feed=demo).>"';
  const s2 = '"<feed.vendor.example/search?format=json&amp;feed=demo).>"';
  const s3 = 'feed.vendor.example/search?format=json&amp;feed=demo).';
  const s4 = 'feed.vendor.example/search?format=json&amp;feed=demo';
  const s5 = 'feed.vendor.example/search?format=json&feed=demo';
  const s6 = 'https://feed.vendor.example/search?format=json&feed=demo';

  assert.deepEqual(repairInput(s0), {
    text: s6,
    repairs: [
      { step: 'trim', before: s0, after: s1 },
      { step: 'invisible_chars', before: s1, after: s2 },
      { step: 'wrappers', before: s2, after: s3 },
      { step: 'trailing_punctuation', before: s3, after: s4 },
      { step: 'html_amp', before: s4, after: s5 },
      { step: 'scheme', before: s5, after: s6 },
    ],
    warnings: [],
  });
});

test('repairInput: no-op steps never leave records', () => {
  const result = repairInput(BASE_URL);
  assert.deepEqual(result, { text: BASE_URL, repairs: [], warnings: [] });
});

test('repairInput: all repair records form an exact non-empty audit chain', () => {
  for (const entry of ALL_CASES) {
    const result = repairInput(entry.input);
    for (let index = 0; index < result.repairs.length; index += 1) {
      const repair = result.repairs[index];
      assert.notEqual(repair.before, repair.after, `${entry.name}: changed record`);
      assert.equal(
        repair.before,
        index === 0 ? entry.input : result.repairs[index - 1].after,
        `${entry.name}: before chain`,
      );
    }
    if (result.repairs.length > 0) {
      assert.equal(result.repairs.at(-1).after, result.text, `${entry.name}: final after`);
    }
  }
});

// ── Idempotence ───────────────────────────────────────────────────────────

test('repairInput: every table case is idempotent, including warning-only inputs', () => {
  for (const entry of ALL_CASES) {
    const once = repairInput(entry.input);
    const twice = repairInput(once.text);
    assert.equal(twice.text, once.text, `${entry.name}: stable text`);
    assert.deepEqual(twice.repairs, [], `${entry.name}: no second-run repairs`);
    assert.deepEqual(twice.warnings, once.warnings, `${entry.name}: stable warnings`);
  }
});
