'use strict';

/**
 * CI parity guard: the browser copy of the canonical core MUST be byte-identical
 * (same SHA-256). One canonical source — no silent drift between two copies.
 * If this fails, run: node scripts/gen-browser-core.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
// Read the pair list from the generator instead of restating it. This test
// used to carry its own copy naming one pair of the six, so five mirrors had no
// drift protection at all while the header promised that none could drift —
// and one of them had already diverged: a migration rule added to the canonical
// file never reached the browser, so the advisor proposed it server-side and
// silently did not client-side. A guard that lists what it guards is a record
// describing a set it is not checked against.
const GENERATOR = path.join(ROOT, 'scripts/gen-browser-core.js');
const PAIRS = [
  ...fs
    .readFileSync(GENERATOR, 'utf8')
    .matchAll(/\[\s*'(packages\/core\/[^']+\.js)',\s*'(public\/core\/[^']+\.js)'\s*\]/g),
].map((match) => [match[1], match[2]]);

// A regex that quietly matches nothing would turn this guard into a test that
// always passes — the same failure it exists to prevent, wearing a different hat.
test('browser-core parity: the generator pair list is readable', () => {
  assert.ok(PAIRS.length >= 6, `expected the generator's pairs, parsed ${PAIRS.length}`);
});
const sha = (p) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, p)))
    .digest('hex');

for (const [src, dst] of PAIRS) {
  test(`browser copy ${dst} is byte-identical to ${src}`, () => {
    assert.ok(
      fs.existsSync(path.join(ROOT, dst)),
      `${dst} missing — run node scripts/gen-browser-core.js`,
    );
    assert.equal(
      sha(dst),
      sha(src),
      `${dst} drifted from ${src} — run node scripts/gen-browser-core.js`,
    );
  });
}
