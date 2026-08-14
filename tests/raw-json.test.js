'use strict';

/**
 * tests/raw-json.test.js — packages/core/raw-json/index.js
 *
 * The scanner exists because `JSON.parse` throws information away without
 * saying so. Every test here is written against that: the assertion is not
 * "the scanner returns X" but "the scanner returns what parsing destroyed",
 * and where it matters the test parses the same bytes to show the loss.
 *
 * Payloads are synthetic and inline.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { scanRawJson, MAX_SAFE, MAX_DEPTH } = require('@ortbtools/core/raw-json');

// ── B1. Duplicate keys ──────────────────────────────────────────────────────

test('duplicate key: both values survive the scan, only one survives the parse', () => {
  const src = '{"id":"A","bidfloor":1.5,"id":"B"}';

  // What the parse leaves you with — the first value is simply gone.
  assert.equal(JSON.parse(src).id, 'B');

  const r = scanRawJson(src);
  assert.ok(r.ok);
  assert.equal(r.duplicateKeys.length, 1);
  const dup = r.duplicateKeys[0];
  assert.equal(dup.key, 'id');
  assert.equal(dup.pointer, '/id');
  assert.deepEqual(
    dup.occurrences.map((o) => o.raw),
    ['"A"', '"B"'],
    'every occurrence in source order — a conformant peer may keep the first',
  );
});

test('duplicate bidfloor: the money case, with its pointer', () => {
  // RFC 8259 §4 leaves the choice open, so 1.5 and 9.99 are both defensible
  // readings of these bytes. That is the whole problem.
  const src = '{"imp":[{"id":"1","bidfloor":1.5,"bidfloor":9.99}]}';
  const r = scanRawJson(src);
  assert.equal(r.duplicateKeys.length, 1);
  assert.equal(r.duplicateKeys[0].pointer, '/imp/0/bidfloor');
  assert.deepEqual(
    r.duplicateKeys[0].occurrences.map((o) => o.raw),
    ['1.5', '9.99'],
  );
});

test('duplicate key written with a \\u escape is still a duplicate', () => {
  // `"id"` is `"id"` on the wire. A byte-for-byte comparison misses this
  // one, which makes it the interesting case rather than an edge case.
  const src = '{"id":"A","\\u0069d":"B"}';
  assert.equal(JSON.parse(src).id, 'B');
  const r = scanRawJson(src);
  assert.equal(r.duplicateKeys.length, 1);
  assert.equal(r.duplicateKeys[0].key, 'id');
  assert.equal(r.duplicateKeys[0].occurrences.length, 2);
});

test('duplicate key: three occurrences all reported', () => {
  const r = scanRawJson('{"cur":"USD","cur":"EUR","cur":"GBP"}');
  assert.equal(r.duplicateKeys.length, 1);
  assert.deepEqual(
    r.duplicateKeys[0].occurrences.map((o) => o.raw),
    ['"USD"', '"EUR"', '"GBP"'],
  );
});

test('the same key in sibling objects is not a duplicate', () => {
  const r = scanRawJson('{"a":{"id":1},"b":{"id":2}}');
  assert.deepEqual(r.duplicateKeys, [], 'scoping is per object, not per document');
});

test('duplicate object values are reported with their full source text', () => {
  const src = '{"ext":{"x":1},"ext":{"y":[2,3]}}';
  const r = scanRawJson(src);
  assert.deepEqual(
    r.duplicateKeys[0].occurrences.map((o) => o.raw),
    ['{"x":1}', '{"y":[2,3]}'],
  );
});

test('clean payload reports no duplicates', () => {
  const r = scanRawJson('{"id":"1","imp":[{"id":"1"}],"at":1}');
  assert.ok(r.ok);
  assert.deepEqual(r.duplicateKeys, []);
});

test('pointer tokens are RFC 6901 escaped', () => {
  // `/` → `~1` and `~` → `~0`, so a key containing them stays addressable.
  const r = scanRawJson('{"a/b":1,"a/b":2,"c~d":3,"c~d":4}');
  const pointers = r.duplicateKeys.map((d) => d.pointer).sort();
  assert.deepEqual(pointers, ['/a~1b', '/c~0d']);
});

// ── B2. Integers that do not survive the read ───────────────────────────────

test('int64 id: silently rounded by Node, reported as lossy', () => {
  const src = '{"user":{"id":9007199254740993}}';

  // The loss, demonstrated rather than asserted from memory.
  assert.equal(JSON.parse(src).user.id, 9007199254740992);

  const r = scanRawJson(src);
  assert.equal(r.unsafeIntegers.length, 1);
  assert.deepEqual(r.unsafeIntegers[0], {
    pointer: '/user/id',
    raw: '9007199254740993',
    parsed: '9007199254740992',
    lossy: true,
  });
});

test('long int64: the trailing digits are replaced, not truncated', () => {
  const r = scanRawJson('{"tid":1234567890123456789}');
  assert.equal(r.unsafeIntegers[0].raw, '1234567890123456789');
  assert.equal(r.unsafeIntegers[0].parsed, '1234567890123456800');
  assert.equal(r.unsafeIntegers[0].lossy, true);
});

test('2^53 is flagged for magnitude but NOT called damaged', () => {
  // 9007199254740992 is above MAX_SAFE_INTEGER and still round-trips exactly.
  // Reporting it as corrupted would be a false alarm — the distinction is the
  // point of `lossy`.
  const r = scanRawJson('{"n":9007199254740992}');
  assert.equal(r.unsafeIntegers.length, 1);
  assert.equal(r.unsafeIntegers[0].lossy, false);
  assert.equal(r.unsafeIntegers[0].parsed, '9007199254740992');
});

test('MAX_SAFE_INTEGER itself is not reported at all', () => {
  assert.equal(MAX_SAFE, 9007199254740991);
  const r = scanRawJson(`{"n":${MAX_SAFE}}`);
  assert.deepEqual(r.unsafeIntegers, [], 'inside the safe range there is nothing to say');
});

test('negative integers past the safe range are caught too', () => {
  const r = scanRawJson('{"n":-9007199254740993}');
  assert.equal(r.unsafeIntegers.length, 1);
  assert.equal(r.unsafeIntegers[0].lossy, true);
});

test('an integer too large to be a double is reported as overflow, not a crash', () => {
  const r = scanRawJson('{"n":' + '9'.repeat(400) + '}');
  assert.ok(r.ok, 'scanning still succeeds');
  assert.equal(r.unsafeIntegers[0].parsed, 'Infinity');
  assert.equal(r.unsafeIntegers[0].lossy, true);
});

test('floats and exponents are out of scope', () => {
  // `1.50` → `1.5` is cosmetic; separating cosmetic from lossy in decimal
  // fractions needs more than a token scan, so the scanner stays quiet rather
  // than guessing.
  const r = scanRawJson('{"a":1.5,"b":1.50,"c":1e400,"d":0.1}');
  assert.deepEqual(r.unsafeIntegers, []);
});

test('integers in arrays carry an indexed pointer', () => {
  const r = scanRawJson('{"ids":[1,9007199254740993]}');
  assert.equal(r.unsafeIntegers[0].pointer, '/ids/1');
});

// ── Both mechanisms in one payload ──────────────────────────────────────────

test('duplicate keys and unsafe integers are found in one pass', () => {
  const src = '{"id":9007199254740993,"imp":[{"bidfloor":1.5,"bidfloor":9.99}],"id":42}';
  const r = scanRawJson(src);
  assert.deepEqual(
    r.duplicateKeys.map((d) => d.pointer).sort(),
    ['/id', '/imp/0/bidfloor'],
    'nesting does not hide the inner duplicate behind the outer one',
  );
  assert.equal(r.unsafeIntegers.length, 1);
  assert.equal(r.unsafeIntegers[0].pointer, '/id');
});

test('`parsed` is the re-emitted value, `lossy` is decided exactly', () => {
  // These are two different true answers about the same token and the scanner
  // deliberately uses each for a different job:
  //   String(Number(raw)) = 1234567890123456800  ← what gets written onward
  //   BigInt(Number(raw)) = 1234567890123456768  ← what is actually stored
  // Reporting the second would show the operator a number their logs will
  // never contain; testing with the first would call 2^53 damaged.
  const raw = '1234567890123456789';
  assert.equal(String(Number(raw)), '1234567890123456800');
  assert.equal(BigInt(Number(raw)).toString(), '1234567890123456768');

  const r = scanRawJson(`{"tid":${raw}}`);
  assert.equal(r.unsafeIntegers[0].parsed, '1234567890123456800');
  assert.equal(r.unsafeIntegers[0].lossy, true);

  // And the exact form is what keeps 2^53 honest: it prints identically to
  // how it was written, so a printed-form comparison would also say "same",
  // but only the BigInt comparison says so for the right reason.
  const safe = scanRawJson('{"n":9007199254740992}');
  assert.equal(safe.unsafeIntegers[0].lossy, false);
});

// ── Tolerance ───────────────────────────────────────────────────────────────

test('malformed input keeps what was found before the break', () => {
  // Truncation is exactly when an operator most needs to see what was in
  // there, so the scan reports the failure without discarding its findings.
  const src = '{"id":"A","id":"B","imp":[{"bidfloor":';
  const r = scanRawJson(src);
  assert.equal(r.ok, false);
  assert.ok(r.error && typeof r.error.offset === 'number');
  assert.equal(r.duplicateKeys.length, 0, 'the unclosed object never completed');
  assert.match(r.error.message, /unexpected end of input/);
});

test('a completed object keeps its duplicates when a later one breaks', () => {
  const src = '{"a":{"id":1,"id":2},"b":[';
  const r = scanRawJson(src);
  assert.equal(r.ok, false);
  assert.equal(r.duplicateKeys.length, 1);
  assert.equal(r.duplicateKeys[0].pointer, '/a/id');
});

test('trailing content after the top-level value is refused', () => {
  const r = scanRawJson('{"a":1} {"b":2}');
  assert.equal(r.ok, false);
  assert.match(r.error.message, /trailing content/);
});

test('non-string input is refused rather than coerced', () => {
  for (const bad of [null, undefined, 42, {}, ['{}']]) {
    const r = scanRawJson(/** @type {any} */ (bad));
    assert.equal(r.ok, false, `${String(bad)}: ok`);
    assert.equal(r.error.message, 'input is not a string');
  }
});

test('scalars and empty containers at the top level scan cleanly', () => {
  for (const src of ['{}', '[]', '"x"', '42', 'true', 'null', '  {"a":[]}  ']) {
    assert.equal(scanRawJson(src).ok, true, `${src}: ok`);
  }
});

test('strings containing braces and escaped quotes do not confuse the scan', () => {
  // The scanner must be a real tokenizer; a brace counter would break here.
  const src = '{"adm":"<div a=\\"{\\">{\\"id\\":\\"not a key\\"}</div>","id":1,"id":2}';
  assert.deepEqual(JSON.parse(src).id, 2);
  const r = scanRawJson(src);
  assert.ok(r.ok);
  assert.equal(r.duplicateKeys.length, 1, 'only the real duplicate, none from inside the string');
  assert.equal(r.duplicateKeys[0].pointer, '/id');
});

// ── Agreement with JSON.parse ───────────────────────────────────────────────

test('the scanner accepts exactly what JSON.parse accepts', () => {
  // A scanner looser than the parser makes `ok: true` a lie: the caller reads
  // it as "this payload is fine" on input nothing downstream can read. These
  // are the cases where a hand-rolled tokenizer usually drifts.
  const cases = [
    '01', // leading zero
    '1.', // no digit after the point
    '.5', // no integer part
    '1e', // truncated exponent
    '+1',
    '{"a":1,}',
    '[1,]',
    '{a:1}',
    "{'a':1}",
    '"\\x"',
    '[1 2]',
    '{"a"1}',
    '"unterminated',
    'nul',
    'NaN',
    'Infinity',
    '[]extra',
    '{"a":"control"}', // RFC 8259 §7 forbids a bare control character
    // Valid, and each one a chance to reject something legitimate:
    '1e5',
    '-0',
    '0',
    '[[[]]]',
    '{"":1}',
    '"\\ud83d\\ude00"',
    '"😀"',
    '  \n\t {"a":1}  \n ',
  ];
  for (const src of cases) {
    let parses = true;
    try {
      JSON.parse(src);
    } catch {
      parses = false;
    }
    assert.equal(scanRawJson(src).ok, parses, `disagreed on ${JSON.stringify(src)}`);
  }
});

test('escape-equivalence holds for astral keys too', () => {
  // A surrogate pair written as two \u escapes is the same key as the literal
  // character. Comparing decoded values rather than source text is what makes
  // this work, and it is the case a naive byte comparison gets wrong.
  const r = scanRawJson('{"\\ud83d\\ude00":1,"😀":2}');
  assert.ok(r.ok);
  assert.equal(r.duplicateKeys.length, 1);
  assert.equal(r.duplicateKeys[0].key, '😀');
});

test('nesting is refused at a fixed depth, with a reason', () => {
  // The limit exists so the failure is the same on every runtime and can
  // explain itself, instead of surfacing as "Maximum call stack size exceeded"
  // at whatever depth the stack happens to give out.
  assert.equal(scanRawJson('['.repeat(MAX_DEPTH) + ']'.repeat(MAX_DEPTH)).ok, true);

  const tooDeep = '['.repeat(MAX_DEPTH + 1) + ']'.repeat(MAX_DEPTH + 1);
  const r = scanRawJson(tooDeep);
  assert.equal(r.ok, false);
  assert.match(r.error.message, /nesting deeper than 512 levels/);

  // Well past the native stack limit: still a report, never a thrown RangeError.
  const absurd = '['.repeat(50000) + ']'.repeat(50000);
  assert.equal(scanRawJson(absurd).ok, false, 'reports rather than crashing the caller');
});

// ── Corpus sweep ────────────────────────────────────────────────────────────

test('every JSON sample in the repo scans without a structural error', () => {
  // Guards the tokenizer against real payload shapes rather than only the
  // cases it was written for. A sample that JSON.parse accepts and the scanner
  // rejects is a scanner bug by definition.
  const dir = path.join(__dirname, '..', 'samples');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, 'corpus is not empty');
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    let parses = true;
    try {
      JSON.parse(src);
    } catch {
      parses = false;
    }
    if (!parses) continue; // deliberately-malformed fixtures are not the target
    const r = scanRawJson(src);
    assert.equal(r.ok, true, `${f}: ${r.error && r.error.message} at ${r.error && r.error.offset}`);
  }
});
