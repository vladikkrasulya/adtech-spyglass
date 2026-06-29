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
const PAIRS = [['packages/core/source-map.js', 'public/core/source-map.js']];
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
