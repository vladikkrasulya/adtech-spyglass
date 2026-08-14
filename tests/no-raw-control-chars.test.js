'use strict';

/**
 * Control-character guard — no raw control or invisible character may reach the
 * source tree.
 *
 * Prettier, ESLint and tsc all happily accept a literal BEL (U+0007) inside a
 * comment: none of the three has an opinion about raw control bytes in source.
 * One reached the header of the very module that detects unescaped control
 * characters in JSON, passed all three gates, and surfaced only when an
 * external tool refused the string. Characters like this are invisible in a
 * diff, invisible in review, and quietly change what a string literal means.
 *
 * Two classes are rejected:
 *
 *   1. C0 controls U+0000–U+001F except TAB, LF and CR, plus DEL (U+007F).
 *      Never legitimate in source — the escape sequence denotes exactly the
 *      same character and a reviewer can see it.
 *   2. Invisible characters outside C0 that survive `new URL()` and corrupt the
 *      value they hide inside: ZWSP, ZWNJ, ZWJ, word joiner, BOM, soft hyphen,
 *      line separator, paragraph separator and NBSP.
 *
 * Both classes go into ONE report, sorted, listing every site. Splitting them
 * across two assertions would stop at the first, and fixing a file would turn
 * into a game of catch-up; the per-hit label carries the class instead.
 *
 * This file is scanned by itself, so it may not contain a single literal
 * offender. Every pattern below is therefore assembled numerically and the
 * regular expression is generated from `\uXXXX` escape TEXT at run time. A
 * literal U+2028 pasted into a regex literal terminates that literal and the
 * file stops parsing — that is not hypothetical, it happened while the first
 * draft of this scanner was written.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Extensions whose bytes are not text. This is deliberately a deny-list: a new
 * *binary* type missing from it fails loudly, because its bytes decode to
 * control characters and get reported by name, and someone adds the extension
 * here. An allow-list of text types would fail the other way — a new *source*
 * type would go unscanned in silence. Kept in step with brand-guard.test.js,
 * which skips the same set for the same reason.
 * @type {Set<string>}
 */
const BINARY_EXT = new Set(['.png', '.woff2', '.ico', '.jpg', '.gif', '.pdf', '.gz', '.zip']);

/**
 * Files permitted to carry a raw offender. Empty, and it should stay that way:
 * the fix for a control character in source is the escape sequence that denotes
 * it, which every format in this repository supports, so an exemption is almost
 * never the right answer. Named paths only — never a glob. A glob grows to
 * cover a directory and then swallows a genuine defect without anyone noticing.
 * @type {Set<string>}
 */
const FILE_ALLOWLIST = new Set(/** @type {string[]} */ ([]));

/**
 * A single misread binary file would otherwise produce a report tens of
 * thousands of lines long. The cap announces itself in the output, so nothing
 * is hidden silently, and fifty sites in one file are already more than enough
 * to act on.
 */
const MAX_PER_FILE = 50;

/**
 * Code points rejected everywhere, built numerically so that no literal
 * offender has to appear in this file.
 * @type {Set<number>}
 */
const FORBIDDEN = new Set([
  0x007f, // DEL
  0x00a0,
  0x00ad,
  0x200b,
  0x200c,
  0x200d,
  0x2028,
  0x2029,
  0x2060,
  0xfeff,
]);
for (let cp = 0x00; cp <= 0x1f; cp++) {
  // TAB, LF and CR are the only C0 characters source is allowed to spell raw.
  if (cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) FORBIDDEN.add(cp);
}

/**
 * Fast reject for the ~99.7% of files that are clean. Generated from the set
 * above as escape text, never written as literal characters — see the header.
 */
const HAS_FORBIDDEN = new RegExp(
  '[' + [...FORBIDDEN].map((cp) => '\\u' + cp.toString(16).padStart(4, '0')).join('') + ']',
  'u',
);

/** @type {Record<number, string>} */
const NAMES = {
  0x0000: 'NUL',
  0x0007: 'BEL',
  0x0008: 'BACKSPACE',
  0x000b: 'VERTICAL TAB',
  0x000c: 'FORM FEED',
  0x001a: 'SUB',
  0x001b: 'ESC',
  0x007f: 'DEL',
  0x00a0: 'NBSP',
  0x00ad: 'SOFT HYPHEN',
  0x200b: 'ZWSP',
  0x200c: 'ZWNJ',
  0x200d: 'ZWJ',
  0x2028: 'LINE SEPARATOR',
  0x2029: 'PARAGRAPH SEPARATOR',
  0x2060: 'WORD JOINER',
  0xfeff: 'BOM',
};

/**
 * Every forbidden code point in `text`, with 1-based line and column.
 *
 * Columns count UTF-16 code units, matching the source map this repository
 * already ships. Lines are split on LF alone — what an editor, git and a diff
 * count — even though U+2028 and U+2029 end a line for the JS parser; a hit on
 * one of those two is reported at the position a human would look at.
 *
 * Every forbidden code point is BMP and never a surrogate, so charCodeAt reads
 * them exactly.
 *
 * @param {string} text
 * @returns {{ line: number, col: number, cp: number }[]}
 */
function scanText(text) {
  /** @type {{ line: number, col: number, cp: number }[]} */
  const found = [];
  if (!HAS_FORBIDDEN.test(text)) return found;
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp === 0x0a) {
      line += 1;
      lineStart = i + 1;
      continue;
    }
    if (FORBIDDEN.has(cp)) found.push({ line, col: i - lineStart + 1, cp });
  }
  return found;
}

/**
 * One actionable line: where it is, which character it is, and which class it
 * belongs to.
 *
 * @param {string} rel
 * @param {{ line: number, col: number, cp: number }} hit
 * @returns {string}
 */
function describe(rel, hit) {
  const hex = 'U+' + hit.cp.toString(16).toUpperCase().padStart(4, '0');
  const kind = hit.cp <= 0x1f || hit.cp === 0x007f ? 'control' : 'invisible';
  return `${rel}:${hit.line}:${hit.col}  ${hex}  ${NAMES[hit.cp] || 'C0 CONTROL'}  (${kind})`;
}

test('no tracked file carries a raw control or invisible character', () => {
  // -z keeps paths NUL-separated and unquoted. Without it git C-quotes any path
  // holding an unusual byte, which would mangle the very characters this gate
  // exists to see. Reading the index rather than walking the tree also means
  // node_modules/, coverage/, dist/ and every other ignored directory is out of
  // scope by construction, with no second copy of the ignore rules to drift.
  const tracked = execSync('git ls-files -z', {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\u0000')
    .filter(Boolean);

  assert.ok(tracked.length > 100, `expected a populated index, got ${tracked.length} paths`);

  /** @type {string[]} */
  const violations = [];
  for (const rel of tracked) {
    if (FILE_ALLOWLIST.has(rel)) continue;
    if (BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
      continue; // staged deletion — the index still lists the path
    }
    const hits = scanText(text);
    for (const hit of hits.slice(0, MAX_PER_FILE)) violations.push(describe(rel, hit));
    if (hits.length > MAX_PER_FILE) {
      violations.push(`${rel}: … ${hits.length - MAX_PER_FILE} further hits in this file`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    'raw control or invisible characters in tracked files:\n' +
      violations.join('\n') +
      '\n\nWrite the escape sequence instead — \\u0000, \\uFEFF, \\u00A0 and so on. ' +
      'It denotes the same character, survives copy-paste, and stays visible in a diff.',
  );
});

test('the guard recognises the characters it claims to reject', () => {
  // A class string edited into a no-op would leave the gate green forever, so
  // pin both directions. Every sample is built from a code point, never pasted.
  const rejected = [
    0x0000, 0x0007, 0x000b, 0x000c, 0x001b, 0x001f, 0x007f, 0x00a0, 0x00ad, 0x200b, 0x200c, 0x200d,
    0x2028, 0x2029, 0x2060, 0xfeff,
  ];
  for (const cp of rejected) {
    const hits = scanText('a' + String.fromCodePoint(cp) + 'b');
    assert.equal(hits.length, 1, `U+${cp.toString(16)} should be rejected`);
    assert.equal(hits[0].cp, cp);
  }

  // TAB, LF and CR are structure, not smuggled payload; ordinary text and the
  // em dashes and box-drawing characters this repository's comments use are of
  // course fine.
  const allowed = [0x0009, 0x000a, 0x000d, 0x0020, 0x0041, 0x2014, 0x2500, 0x0456];
  for (const cp of allowed) {
    const hits = scanText('a' + String.fromCodePoint(cp) + 'b');
    assert.deepEqual(hits, [], `U+${cp.toString(16)} should be allowed`);
  }
});

test('the report points at the exact line and column', () => {
  const nul = String.fromCodePoint(0x0000);
  const bom = String.fromCodePoint(0xfeff);

  const hits = scanText(`first\nsecond ${nul} line\n\nfourth${bom}`);
  assert.deepEqual(hits, [
    { line: 2, col: 8, cp: 0x0000 },
    { line: 4, col: 7, cp: 0xfeff },
  ]);

  assert.equal(describe('tests/x.test.js', hits[0]), 'tests/x.test.js:2:8  U+0000  NUL  (control)');
  assert.equal(
    describe('tests/x.test.js', hits[1]),
    'tests/x.test.js:4:7  U+FEFF  BOM  (invisible)',
  );

  // A CRLF file must not shift the column by the carriage return.
  assert.deepEqual(scanText(`a\r\nb${nul}`), [{ line: 2, col: 2, cp: 0x0000 }]);
});
