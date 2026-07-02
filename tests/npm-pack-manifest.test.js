'use strict';

/**
 * tests/npm-pack-manifest.test.js — @kyivtech/spyglass-core ships a complete tarball.
 *
 * Catches missing `files` entries (e.g. non-iab-formats.js) before npm publish.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CORE = path.join(__dirname, '..', 'packages', 'core');

const REQUIRED_IN_TARBALL = [
  'package/non-iab-formats.js',
  'package/utils/domain.js',
  'package/behavior/index.js',
  'package/intel/index.js',
  'package/iab-categories.en.json',
];

test('npm pack @kyivtech/spyglass-core includes runtime modules', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spyglass-pack-manifest-'));
  try {
    const tgz = execFileSync('npm', ['pack', '--pack-destination', tmp, '--silent'], {
      cwd: CORE,
      encoding: 'utf8',
    }).trim();
    const listing = execFileSync('tar', ['-tzf', path.join(tmp, tgz)], { encoding: 'utf8' });
    for (const entry of REQUIRED_IN_TARBALL) {
      assert.match(listing, new RegExp(entry.replace(/\./g, '\\.')), `tarball missing ${entry}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
