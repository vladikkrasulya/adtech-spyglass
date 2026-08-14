'use strict';

/**
 * CHANGELOG completeness gate.
 *
 * CHANGELOG.md opens by claiming "All notable changes to ortbtools are
 * documented here". Nothing checked that claim, and five releases — v1.7.0,
 * v1.8.0, v1.9.0, v1.10.0 and v1.10.1 — shipped to production without an entry
 * while the file still said its history was complete. Every release bumped
 * `package.json`, every bump passed `tests/version-consistency.test.js`, and
 * that test asks whether the version SURFACES agree with each other, never
 * whether the release was written down.
 *
 * So this is the same defect the v1.10.0 release was about: a record
 * describing something it is not checked against. The fix is the same shape —
 * a gate rather than a corrected document, because a corrected document drifts
 * again on the next release and this one drifted for five.
 *
 * The invariant is continuous, not release-only. Between releases
 * `package.json` still holds the last released version and the newest entry is
 * still that version, so this holds on every commit rather than only on the
 * ones that bump. It fails at the moment a version moves without its entry,
 * which is the moment the author still knows what changed.
 *
 * Deliberately file-based: no git, no network. A shallow CI clone has no
 * history to walk, and a test that silently stops checking on such a clone
 * would be the same failure again.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CHANGELOG = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/** Release headings, in file order — the file is newest-first. */
const HEADINGS = [...CHANGELOG.matchAll(/^### v(\d+\.\d+\.\d+)/gm)].map((m) => m[1]);

test('the changelog has release headings to check at all', () => {
  // A regex that quietly matched nothing would turn every assertion below into
  // a vacuous pass — the same shape as a guard listing a subset of what it
  // guards, which is what let the browser mirror drift.
  assert.ok(
    HEADINGS.length >= 100,
    `expected the accumulated release history, parsed ${HEADINGS.length} headings`,
  );
});

test('the newest changelog entry is the version package.json declares', () => {
  assert.equal(
    HEADINGS[0],
    PKG_VERSION,
    `package.json is ${PKG_VERSION} but the newest CHANGELOG entry is v${HEADINGS[0]} — ` +
      'a released version with no entry. Add a "### v' +
      PKG_VERSION +
      ' — <summary>" section directly under "## [Unreleased]".',
  );
});

test('no version is documented twice', () => {
  const seen = new Set();
  const duplicates = [];
  for (const version of HEADINGS) {
    if (seen.has(version)) duplicates.push(version);
    seen.add(version);
  }
  assert.deepEqual(duplicates, [], `these versions have more than one entry: ${duplicates}`);
});
