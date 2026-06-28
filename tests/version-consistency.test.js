'use strict';

/**
 * Version-surface consistency guard.
 *
 * package.json is the single source of truth for the app version. Every other
 * surface that paints/declares the version must agree with it:
 *   - public/version.js          → const VERSION = `v${package.version}`
 *   - public/about.{en,uk,ru}.html               (static fallback span)
 *   - public/modules/inspector/template.{en,uk,ru}.html (static fallback span)
 *
 * These six HTML fallbacks are what a no-JS client sees and what export.js reads
 * from `#engineVer.textContent`; version.js paints over them at runtime. They
 * drifted (stale at v1.1.1) across v1.1.2–v1.1.5 because only version.js was
 * bumped — this test fails the build on the NEXT incomplete bump.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PKG_VERSION = JSON.parse(read('package.json')).version; // source of truth
const EXPECTED = `v${PKG_VERSION}`;

test('package.json version is a clean semver (source of truth)', () => {
  assert.match(
    PKG_VERSION,
    /^\d+\.\d+\.\d+$/,
    `package.json version "${PKG_VERSION}" is not x.y.z`,
  );
});

test('public/version.js VERSION === `v${package.version}`', () => {
  const m = read('public/version.js').match(/const VERSION = '([^']+)'/);
  assert.ok(m, 'public/version.js must declare const VERSION = "v..."');
  assert.equal(m[1], EXPECTED, `version.js VERSION ${m[1]} must equal ${EXPECTED}`);
});

const HTML_FALLBACKS = [
  'public/about.en.html',
  'public/about.uk.html',
  'public/about.ru.html',
  'public/modules/inspector/template.en.html',
  'public/modules/inspector/template.uk.html',
  'public/modules/inspector/template.ru.html',
];

for (const f of HTML_FALLBACKS) {
  test(`${f} static version fallback === ${EXPECTED}`, () => {
    const html = read(f);
    // Each file carries exactly one runtime-painted span: `data-spyglass-version>vX.Y.Z`.
    const matches = [...html.matchAll(/data-spyglass-version>\s*(v\d+\.\d+\.\d+)/g)].map(
      (m) => m[1],
    );
    assert.ok(matches.length >= 1, `${f} must contain a data-spyglass-version fallback`);
    for (const v of matches) {
      assert.equal(
        v,
        EXPECTED,
        `${f} static fallback ${v} must equal ${EXPECTED} (incomplete version bump)`,
      );
    }
  });
}
