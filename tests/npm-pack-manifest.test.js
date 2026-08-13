'use strict';

/**
 * tests/npm-pack-manifest.test.js — npm workspaces ship complete tarballs.
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
const CLI = path.join(__dirname, '..', 'packages', 'cli');

const REQUIRED_IN_TARBALL = [
  'package/non-iab-formats.js',
  'package/utils/domain.js',
  'package/behavior/index.js',
  'package/intel/index.js',
  'package/migrate/index.js',
  'package/vast-timeline/index.js',
  'package/iab-categories.en.json',
];

test('npm pack @ortbtools/core includes runtime modules', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-pack-manifest-'));
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

test('npm pack @ortbtools/cli includes its license and executable', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-cli-pack-manifest-'));
  try {
    const tgz = execFileSync('npm', ['pack', '--pack-destination', tmp, '--silent'], {
      cwd: CLI,
      encoding: 'utf8',
    }).trim();
    const listing = execFileSync('tar', ['-tzf', path.join(tmp, tgz)], { encoding: 'utf8' });
    assert.match(listing, /(?:^|\n)package\/LICENSE(?:\n|$)/, 'CLI tarball missing LICENSE');
    assert.match(
      listing,
      /(?:^|\n)package\/bin\/ortbtools\.js(?:\n|$)/,
      'CLI tarball missing bin/ortbtools.js',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
