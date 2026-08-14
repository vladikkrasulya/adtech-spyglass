'use strict';

/**
 * tests/raw-json.test.js — packages/core/raw-json.js
 *
 * The module's whole claim is that it sees what `JSON.parse` destroys, so the
 * tests are written against the raw text and, where it matters, assert what
 * `JSON.parse` does with the same bytes — if the parse ever stopped hiding
 * these, the module would have no reason to exist.
 *
 * Privacy: synthetic payloads only — reserved example domains, 192.0.2.x
 * (RFC 5737 TEST-NET-1) and placeholder ids. Never paste partner data here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scanRawJson,
  findDuplicateKeys,
  findUnsafeNumbers,
  UNSAFE_REASONS,
  DEFAULT_LIMITS,
} = require('@ortbtools/core/raw-json');

// The exact bytes quoted in the module header. Two `id`s and two `bidfloor`s;
// `JSON.parse` keeps "B" and 9.99 and forgets the rest ever existed.
const MEASURED = '{"id":"A","imp":[{"id":"1"}],"id":"B","bidfloor":1.5,"bidfloor":9.99}';

/** Convenience: the finding for one key path, or undefined. */
function byPath(findings, path) {
  return findings.find((f) => f.path === path);
}

// ── Duplicate keys: the measured case ───────────────────────────────────────

test('the parse really does hide it — anchor for everything below', () => {
  const parsed = JSON.parse(MEASURED);
  assert.equal(parsed.id, 'B');
  assert.equal(parsed.bidfloor, 9.99);
  assert.deepEqual(Object.keys(parsed), ['id', 'imp', 'bidfloor']);
});

test('scanRawJson: finds both duplicated keys in the measured payload', () => {
  const r = scanRawJson(MEASURED);
  assert.equal(r.ok, true, 'the document is well-formed JSON — duplicates are legal');
  assert.equal(r.error, null);
  assert.deepEqual(
    r.duplicateKeys.map((f) => f.path),
    ['id', 'bidfloor'],
  );

  const floor = byPath(r.duplicateKeys, 'bidfloor');
  assert.equal(floor.kind, 'duplicate-key');
  assert.equal(floor.key, 'bidfloor');
  assert.equal(floor.pointer, '/bidfloor');
  assert.equal(floor.container, '', 'the object holding it is the document root');
  assert.equal(floor.count, 2);
  assert.equal(floor.valuesDiffer, true, '1.5 against 9.99 is money');
  assert.deepEqual(
    floor.occurrences.map((o) => o.value),
    ['1.5', '9.99'],
    'every value, in order of appearance',
  );
});

test('scanRawJson: occurrence offsets address the original text exactly', () => {
  const floor = byPath(findDuplicateKeys(MEASURED), 'bidfloor');
  for (const occ of floor.occurrences) {
    assert.equal(MEASURED.slice(occ.keyStart, occ.keyEnd), '"bidfloor"');
    assert.equal(MEASURED.slice(occ.valueStart, occ.valueEnd), occ.value);
    assert.equal(occ.raw, MEASURED.slice(occ.keyStart, occ.keyEnd));
  }
  assert.equal(floor.occurrences[0].valueStart < floor.occurrences[1].valueStart, true);
});

// ── Duplicate keys: shapes ──────────────────────────────────────────────────

test('duplicates nested in an object carry the nested path', () => {
  const text = '{"site":{"domain":"publisher.example","domain":"other.example"}}';
  const findings = findDuplicateKeys(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, 'site.domain');
  assert.equal(findings[0].pointer, '/site/domain');
  assert.equal(findings[0].container, 'site');
});

test('duplicates inside array elements carry the index', () => {
  const text = '{"imp":[{"id":"1","id":"2"},{"id":"3"},{"tagid":"a","tagid":"b"}]}';
  const findings = findDuplicateKeys(text);
  assert.deepEqual(
    findings.map((f) => f.path),
    ['imp[0].id', 'imp[2].tagid'],
  );
  assert.deepEqual(
    findings.map((f) => f.pointer),
    ['/imp/0/id', '/imp/2/tagid'],
  );
});

test('a duplicate deeper than one array level still resolves', () => {
  const text = '{"seatbid":[{"bid":[{"price":1.2,"price":3.4}]}]}';
  const findings = findDuplicateKeys(text);
  assert.equal(findings[0].path, 'seatbid[0].bid[0].price');
  assert.equal(findings[0].pointer, '/seatbid/0/bid/0/price');
});

test('three or more repeats are reported as one finding with every value', () => {
  const text = '{"cur":"USD","cur":"EUR","cur":"GBP","cur":"USD"}';
  const findings = findDuplicateKeys(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].count, 4);
  assert.deepEqual(
    findings[0].occurrences.map((o) => o.value),
    ['"USD"', '"EUR"', '"GBP"', '"USD"'],
  );
  assert.equal(findings[0].occurrencesTruncated, false);
});

test('identical repeated values are still a duplicate, but flagged as agreeing', () => {
  const findings = findDuplicateKeys('{"at":2,"at":2}');
  assert.equal(findings.length, 1, 'RFC 8259 §4 leaves even this undefined');
  assert.equal(findings[0].valuesDiffer, false, 'no receiver can diverge on the value');
});

test('duplicates are reported in document order, not innermost-first', () => {
  const text = '{"a":1,"ext":{"z":1,"z":2},"a":2}';
  const findings = findDuplicateKeys(text);
  assert.deepEqual(
    findings.map((f) => f.path),
    ['a', 'ext.z'],
    'the outer `a` opens first in the text, so it comes first',
  );
});

test('objects nested in every position are all walked', () => {
  const text = [
    '{"id":"req-1",',
    '"imp":[{"id":"1","banner":{"w":300,"w":320,"h":250}}],',
    '"device":{"ip":"192.0.2.10","ua":"synthetic-ua","ip":"192.0.2.11"},',
    '"user":{"ext":{"consent":"placeholder","consent":"placeholder-2"}}}',
  ].join('');
  assert.deepEqual(
    findDuplicateKeys(text).map((f) => f.path),
    ['imp[0].banner.w', 'device.ip', 'user.ext.consent'],
  );
});

// ── Duplicate keys: names that only look different ──────────────────────────

test('escape-equivalent key names are one key on the wire', () => {
  // "\u0069d" and "id" are the same four bytes after decoding — and JSON.parse
  // proves it by producing a single property.
  const text = '{"\\u0069d":"A","id":"B"}';
  assert.deepEqual(Object.keys(JSON.parse(text)), ['id']);

  const findings = findDuplicateKeys(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].key, 'id', 'reported under the decoded name');
  assert.equal(findings[0].path, 'id');
  assert.equal(findings[0].count, 2);
  assert.equal(findings[0].spellingsDiffer, true, 'they look different on screen');
  assert.deepEqual(
    findings[0].occurrences.map((o) => o.raw),
    ['"\\u0069d"', '"id"'],
    'each spelling is kept verbatim so the operator can see the trick',
  );
  assert.deepEqual(
    findings[0].occurrences.map((o) => o.escaped),
    [true, false],
  );
});

test('a surrogate pair written as two escapes equals the literal character', () => {
  const text = '{"\\ud83d\\ude00":1,"\u{1f600}":2}';
  assert.equal(Object.keys(JSON.parse(text)).length, 1);
  const findings = findDuplicateKeys(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].count, 2);
  assert.equal(findings[0].spellingsDiffer, true);
});

test('other escape forms decode before comparison', () => {
  const text = '{"a\\/b":1,"a/b":2}';
  assert.deepEqual(Object.keys(JSON.parse(text)), ['a/b']);
  const findings = findDuplicateKeys(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].key, 'a/b');
  assert.equal(findings[0].pointer, '/a~1b', 'RFC 6901 §3 escapes the slash back out');
});

test('every short escape decodes, so \\t and \\u0009 are the same key', () => {
  // The same name written two legal ways: short escapes, then the \u form of
  // each. Both decode to one string, and JSON.parse confirms one property.
  const shortForm = '"\\b\\f\\n\\r\\t\\"\\\\\\/"';
  const uForm = '"\\u0008\\u000c\\u000a\\u000d\\u0009\\u0022\\u005c\\u002f"';
  const text = `{${shortForm}:1,${uForm}:2}`;
  assert.equal(Object.keys(JSON.parse(text)).length, 1);

  const findings = findDuplicateKeys(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].key, '\b\f\n\r\t"\\/');
  assert.equal(findings[0].count, 2);
  assert.equal(findings[0].spellingsDiffer, true);
  assert.deepEqual(
    findings[0].occurrences.map((o) => o.raw),
    [shortForm, uForm],
  );
});

test('a raw control character in a string is tolerated, unlike JSON.parse', () => {
  // Deliberate superset, same as source-map.js: an inspector that refuses a
  // payload the exchange accepted can inspect nothing at all. The raw newline
  // also has to move the line counter, or every offset after it lies.
  const text = '{"adm":"line one\nline two","w":1,"w":2}';
  assert.throws(() => JSON.parse(text), SyntaxError);

  const r = scanRawJson(text);
  assert.equal(r.ok, true, r.error && r.error.message);
  assert.equal(r.duplicateKeys.length, 1);
  assert.equal(r.duplicateKeys[0].occurrences[0].line, 2);
  assert.equal(
    text.slice(r.duplicateKeys[0].occurrences[0].keyStart),
    '"w":1,"w":2}',
    'the offset still lands where it should',
  );
});

test('keys that only differ by case or spacing are different keys', () => {
  assert.deepEqual(findDuplicateKeys('{"ID":1,"id":2,"i d":3}'), []);
});

test('"__proto__" is counted like any other key', () => {
  // A plain-object accumulator would have swallowed this one.
  const findings = findDuplicateKeys('{"__proto__":1,"__proto__":2}');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].key, '__proto__');
  assert.equal(findings[0].count, 2);
});

test('a key outside the display grammar is bracket-quoted, and the pointer stays exact', () => {
  const findings = findDuplicateKeys('{"ext":{"a.b":1,"a.b":2}}');
  assert.equal(findings[0].path, 'ext["a.b"]', 'ext.a.b would be a lie about the key name');
  assert.equal(findings[0].pointer, '/ext/a.b');
});

// ── Unsafe numbers: the measured cases ──────────────────────────────────────

test('the parse really does round these — anchor for everything below', () => {
  assert.equal(JSON.parse('{"v":9007199254740993}').v, 9007199254740992);
  assert.equal(JSON.parse('{"v":1234567890123456789}').v, 1234567890123456800);
  assert.equal(Number.MAX_SAFE_INTEGER, 9007199254740991);
});

test('findUnsafeNumbers: 2^53+1 is reported as precision loss with both spellings', () => {
  const text = '{"imp":[{"ext":{"auction_id":9007199254740993}}]}';
  const findings = findUnsafeNumbers(text);
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.kind, 'unsafe-number');
  assert.equal(f.path, 'imp[0].ext.auction_id');
  assert.equal(f.pointer, '/imp/0/ext/auction_id');
  assert.equal(f.raw, '9007199254740993', 'the token exactly as written');
  assert.equal(f.rendered, '9007199254740992', 'what any JS receiver will echo back');
  assert.equal(f.reason, UNSAFE_REASONS.PRECISION_LOSS);
  assert.equal(f.lossy, true);
  assert.equal(text.slice(f.start, f.end), f.raw);
});

test('findUnsafeNumbers: the 19-digit id is reported too', () => {
  const f = findUnsafeNumbers('{"id":1234567890123456789}')[0];
  assert.equal(f.raw, '1234567890123456789');
  assert.equal(f.rendered, '1234567890123456800');
  assert.equal(f.reason, UNSAFE_REASONS.PRECISION_LOSS);
});

// ── Unsafe numbers: the 2^53−1 boundary, both sides ─────────────────────────

test('MAX_SAFE_INTEGER itself is safe and is not reported', () => {
  assert.deepEqual(findUnsafeNumbers('{"v":9007199254740991}'), []);
  assert.deepEqual(findUnsafeNumbers('{"v":-9007199254740991}'), []);
});

test('2^53 survives this parse exactly but is flagged as unsafe magnitude', () => {
  // Round-trips today; one increment anywhere downstream and it stops doing so.
  const f = findUnsafeNumbers('{"v":9007199254740992}')[0];
  assert.equal(f.reason, UNSAFE_REASONS.UNSAFE_MAGNITUDE);
  assert.equal(f.lossy, false, 'advisory — the value itself did not change');
  assert.equal(f.rendered, '9007199254740992');
});

test('2^53+1 is over the line in both directions', () => {
  for (const [token, rendered] of [
    ['9007199254740993', '9007199254740992'],
    ['-9007199254740993', '-9007199254740992'],
  ]) {
    const f = findUnsafeNumbers(`{"v":${token}}`)[0];
    assert.equal(f.reason, UNSAFE_REASONS.PRECISION_LOSS, token);
    assert.equal(f.lossy, true, token);
    assert.equal(f.rendered, rendered, token);
  }
});

// ── Unsafe numbers: forms that must not fool the check ──────────────────────

test('exponential notation is judged by value, not by spelling', () => {
  // Same number as 9007199254740993, written so a digit-counting check misses it.
  const f = findUnsafeNumbers('{"v":9.007199254740993e15}')[0];
  assert.equal(f.reason, UNSAFE_REASONS.PRECISION_LOSS);
  assert.equal(f.rendered, '9007199254740992');

  // 1e21 is an integer beyond the safe range that still round-trips exactly.
  const g = findUnsafeNumbers('{"v":1e21}')[0];
  assert.equal(g.reason, UNSAFE_REASONS.UNSAFE_MAGNITUDE);
  assert.equal(g.lossy, false);

  // And an exponent that is simply another way to write a small integer.
  assert.deepEqual(findUnsafeNumbers('{"v":1e2}'), []);
  assert.deepEqual(findUnsafeNumbers('{"v":-1.5e3}'), []);
});

test('ordinary fractional prices are not reported', () => {
  // Every one of these is inexact in binary64 — 9.99 is really
  // 9.9900000000000002131628…  Flagging that would bury the signal under every
  // bidfloor in the corpus. What matters is whether the token survives a
  // round trip, and it does, on every conforming implementation.
  assert.equal((9.99).toFixed(20), '9.99000000000000021316', 'the double is not the decimal');
  const text = '{"bidfloor":9.99,"a":1.5,"b":0.1,"c":1.50,"d":0.30000000000000004,"e":1e-7}';
  assert.deepEqual(findUnsafeNumbers(text), []);
  for (const token of ['9.99', '1.5', '0.1', '1e-7']) {
    assert.equal(String(Number(token)), token, `${token} round-trips`);
  }
});

test('a fraction whose digits do not survive is reported', () => {
  const f = findUnsafeNumbers('{"v":1.0000000000000000001}')[0];
  assert.equal(f.reason, UNSAFE_REASONS.PRECISION_LOSS);
  assert.equal(f.rendered, '1', 'the tail is gone and nothing downstream can tell');
});

test('magnitudes a double cannot hold at all are separated from rounding', () => {
  const over = findUnsafeNumbers('{"v":1e309}')[0];
  assert.equal(over.reason, UNSAFE_REASONS.OVERFLOW);
  assert.equal(over.lossy, true);
  assert.equal(over.rendered, 'Infinity', 'JSON.stringify would turn this into null');

  const under = findUnsafeNumbers('{"v":1e-999}')[0];
  assert.equal(under.reason, UNSAFE_REASONS.UNDERFLOW);
  assert.equal(under.lossy, true);
  assert.equal(under.rendered, '0');
});

test('zero and negative zero are not findings', () => {
  assert.deepEqual(findUnsafeNumbers('{"a":0,"b":-0,"c":0.0,"d":0e10}'), []);
});

test('unsafe numbers come back in document order', () => {
  const text = '{"a":9007199254740993,"b":[1,1234567890123456789],"c":1e309}';
  const findings = findUnsafeNumbers(text);
  assert.deepEqual(
    findings.map((f) => f.path),
    ['a', 'b[1]', 'c'],
  );
  for (let k = 1; k < findings.length; k++) {
    assert.equal(findings[k - 1].start < findings[k].start, true);
  }
});

// ── Strings must never be mistaken for structure ────────────────────────────

test('a numeric token inside a string is a string, not a number', () => {
  assert.deepEqual(findUnsafeNumbers('{"id":"9007199254740993"}'), []);
  assert.deepEqual(findUnsafeNumbers('{"note":"the id 1234567890123456789 was rounded"}'), []);
});

test('JSON embedded in a string value does not leak into the scan', () => {
  // A serialized payload carried inside `ext`, as vendors regularly do.
  const inner = '{"a":1,"a":2,"big":9007199254740993}';
  const text = `{"ext":{"payload":${JSON.stringify(inner)}},"a":1}`;
  const r = scanRawJson(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.duplicateKeys, [], 'the inner duplicate is text, not structure');
  assert.deepEqual(r.unsafeNumbers, [], 'so is the inner number');
});

test('escaped quotes and braces inside strings do not desynchronise the walk', () => {
  const text =
    '{"adm":"<a href=\\"https://creative.example/c?x=\\\\\\"y\\">{\\"a\\":1}</a>","w":1,"w":2}';
  const r = scanRawJson(text);
  assert.equal(r.ok, true, r.error && r.error.message);
  assert.deepEqual(
    r.duplicateKeys.map((f) => f.path),
    ['w'],
  );
});

test('a key that contains a colon or a brace is still just a key', () => {
  const findings = findDuplicateKeys('{"a:{}b":1,"a:{}b":2}');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].key, 'a:{}b');
});

// ── Malformed input ─────────────────────────────────────────────────────────

test('invalid JSON returns findings plus the error, and never throws', () => {
  const text = '{"id":"A","id":"B","imp":[{"w":1,"w":2},{"h":';
  assert.throws(() => JSON.parse(text), SyntaxError, 'the parser gives the operator nothing');

  const r = scanRawJson(text);
  assert.equal(r.ok, false);
  assert.equal(typeof r.error.message, 'string');
  assert.equal(r.error.offset, text.length);
  assert.deepEqual(
    r.duplicateKeys.map((f) => f.path),
    ['id', 'imp[0].w'],
    'a truncated paste leaves every enclosing object open — report them anyway',
  );
});

test('a duplicate whose second value was cut off is still reported', () => {
  // The paste stops mid-value. The key is right there in the text twice, so
  // waiting for a value that never arrives would throw away a real finding.
  const text = '{"imp":[{"h":250,"h":';
  const f = findDuplicateKeys(text)[0];
  assert.equal(f.path, 'imp[0].h');
  assert.equal(f.count, 2);
  assert.equal(f.occurrences[1].value, '', 'nothing of the second value was on the wire');
  assert.equal(f.occurrences[1].valueEnd, text.length);
  assert.equal(f.valuesDiffer, true);
});

test('what was scanned before the break is kept, including numbers', () => {
  const r = scanRawJson('[{"x":9007199254740993},{"y":');
  assert.equal(r.ok, false);
  assert.equal(r.unsafeNumbers.length, 1);
  assert.equal(r.unsafeNumbers[0].path, '[0].x');
});

test('garbage after a complete value is an error, but the value was still scanned', () => {
  const r = scanRawJson('{"a":1,"a":2} trailing junk');
  assert.equal(r.ok, false);
  assert.equal(r.error.message, 'unexpected trailing content');
  assert.equal(r.duplicateKeys.length, 1);
});

test('malformed tokens report a position a caller can highlight', () => {
  const r = scanRawJson('{\n  "a": 1,\n  "b": tru\n}');
  assert.equal(r.ok, false);
  assert.equal(r.error.line, 3);
  assert.equal(r.error.col, 8);
});

test('unterminated string, bad escape and bad number all degrade, none throw', () => {
  const cases = [
    '{"a":"unterminated',
    '{"a":"\\x"}',
    '{"a":"\\u00zz"}',
    '{"a":"trailing escape\\',
    '{"a":01}',
    '{"a":1.}',
    '{"a":1e}',
    '{"a":+1}',
    '{"a":-}',
    '{"a":tru}',
    '{"a"}',
    '{"a" 1}',
    '{a:1}',
    '[1 2]',
  ];
  for (const bad of cases) {
    const r = scanRawJson(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(typeof r.error.message, 'string', bad);
    assert.equal(Array.isArray(r.duplicateKeys), true, bad);
  }
});

test('runaway nesting stops at maxDepth instead of exhausting the stack', () => {
  const deep = '['.repeat(2000) + '1' + ']'.repeat(2000);
  const r = scanRawJson(deep);
  assert.equal(r.ok, false);
  assert.equal(r.error.message, 'maximum nesting depth exceeded');
});

// ── Empty and non-string input ──────────────────────────────────────────────

test('empty, blank and non-string input all come back empty, not thrown', () => {
  const empty = scanRawJson('');
  assert.equal(empty.ok, false);
  assert.equal(empty.error.message, 'empty input');
  assert.deepEqual(empty.duplicateKeys, []);
  assert.deepEqual(empty.unsafeNumbers, []);

  assert.equal(scanRawJson('   \n\t ').error.message, 'no JSON value found');
  // @ts-ignore — intentional wrong type for robustness testing
  assert.equal(scanRawJson(null).error.message, 'input is not a string');
  // @ts-ignore — intentional wrong type for robustness testing
  assert.equal(scanRawJson(undefined).ok, false);
  // @ts-ignore — intentional wrong type for robustness testing
  assert.deepEqual(scanRawJson({ id: 'A' }).duplicateKeys, []);
  // @ts-ignore — intentional wrong type for robustness testing
  assert.deepEqual(findUnsafeNumbers(42), []);
});

test('a clean payload produces no findings at all', () => {
  const text = JSON.stringify({
    id: 'req-1',
    imp: [{ id: '1', bidfloor: 0.5, banner: { w: 300, h: 250 } }],
    site: { domain: 'publisher.example' },
    device: { ip: '192.0.2.10', ua: 'synthetic-ua' },
  });
  const r = scanRawJson(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.duplicateKeys, []);
  assert.deepEqual(r.unsafeNumbers, []);
  assert.deepEqual(r.truncated, { duplicateKeys: false, unsafeNumbers: false });
});

test('scalars, empty containers and a leading BOM are all accepted', () => {
  for (const text of ['{}', '[]', 'null', 'true', '42', '"a string"', '\uFEFF{"a":1,"a":2}']) {
    const r = scanRawJson(text);
    assert.equal(r.ok, true, text);
  }
  assert.equal(scanRawJson('\uFEFF{"a":1,"a":2}').duplicateKeys.length, 1);
});

// ── Limits ──────────────────────────────────────────────────────────────────

test('occurrences are capped per key, but the count stays true', () => {
  const text = '{' + Array.from({ length: 200 }, (_, k) => `"cur":"C${k}"`).join(',') + '}';
  const f = findDuplicateKeys(text)[0];
  assert.equal(f.count, 200);
  assert.equal(f.occurrences.length, DEFAULT_LIMITS.maxOccurrences);
  assert.equal(f.occurrencesTruncated, true);

  const smaller = findDuplicateKeys(text, { maxOccurrences: 3 })[0];
  assert.equal(smaller.occurrences.length, 3);
  assert.equal(smaller.count, 200);
});

test('findings are capped per category and the cap is reported', () => {
  const text = '[' + Array.from({ length: 40 }, () => '{"a":1,"a":2}').join(',') + ']';
  const r = scanRawJson(text, { maxFindings: 5 });
  assert.equal(r.duplicateKeys.length, 5);
  assert.equal(r.truncated.duplicateKeys, true);

  const nums = '[' + Array.from({ length: 40 }, () => '9007199254740993').join(',') + ']';
  const rn = scanRawJson(nums, { maxFindings: 5 });
  assert.equal(rn.unsafeNumbers.length, 5);
  assert.equal(rn.truncated.unsafeNumbers, true);
  assert.equal(rn.ok, true, 'hitting a limit is not a parse failure');
});

test('long values are previewed, and the full extent stays addressable', () => {
  const long = 'x'.repeat(500);
  const text = `{"adm":"${long}","adm":"short"}`;
  const f = findDuplicateKeys(text, { maxValueChars: 20 })[0];
  assert.equal(f.occurrences[0].value.length, 20);
  assert.equal(f.occurrences[0].valueTruncated, true);
  assert.equal(
    text.slice(f.occurrences[0].valueStart, f.occurrences[0].valueEnd).length,
    long.length + 2,
  );
  assert.equal(f.occurrences[1].valueTruncated, false);
});

// ── Contract ────────────────────────────────────────────────────────────────

test('the helpers are the scan, narrowed', () => {
  assert.deepEqual(findDuplicateKeys(MEASURED), scanRawJson(MEASURED).duplicateKeys);
  assert.deepEqual(findUnsafeNumbers(MEASURED), scanRawJson(MEASURED).unsafeNumbers);
});

test('the scan is pure: repeatable, and it touches neither input nor options', () => {
  const options = { maxOccurrences: 4 };
  const frozen = Object.freeze({ ...options });
  const first = scanRawJson(MEASURED, options);
  const second = scanRawJson(MEASURED, options);
  assert.deepEqual(first, second);
  assert.deepEqual(options, frozen);
  assert.equal(MEASURED, '{"id":"A","imp":[{"id":"1"}],"id":"B","bidfloor":1.5,"bidfloor":9.99}');
});

test('reasons and default limits are exported and stable', () => {
  assert.deepEqual(Object.values(UNSAFE_REASONS).sort(), [
    'overflow',
    'precision-loss',
    'underflow',
    'unsafe-magnitude',
  ]);
  assert.equal(Object.isFrozen(UNSAFE_REASONS), true);
  assert.equal(Object.isFrozen(DEFAULT_LIMITS), true);
  for (const key of ['maxFindings', 'maxOccurrences', 'maxValueChars', 'maxDepth']) {
    assert.equal(typeof DEFAULT_LIMITS[key], 'number', key);
  }
});

test('a multi-megabyte payload scans in a sane amount of time', () => {
  const imps = [];
  for (let k = 0; k < 12000; k++) {
    imps.push(
      JSON.stringify({
        id: String(k),
        tagid: `slot-${k}`,
        bidfloor: 0.35 + (k % 100) / 100,
        banner: { w: 300, h: 250, mimes: ['image/png', 'image/jpeg'] },
        ext: { note: 'synthetic filler so the payload has realistic bulk ' },
      }),
    );
  }
  const text = `{"id":"req-1","imp":[${imps.join(',')}],"site":{"domain":"publisher.example"}}`;
  assert.equal(text.length > 2 * 1024 * 1024, true, 'fixture is at least 2 MB');

  const started = Date.now();
  const r = scanRawJson(text);
  const elapsed = Date.now() - started;
  assert.equal(r.ok, true);
  assert.deepEqual(r.duplicateKeys, []);
  // Generous on purpose — this guards against an accidental quadratic, not
  // against a slow CI box. Measured ~40 ms for this fixture.
  assert.equal(elapsed < 5000, true, `scan took ${elapsed} ms`);
});
