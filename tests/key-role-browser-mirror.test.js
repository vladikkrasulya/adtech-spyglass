'use strict';

/**
 * The browser mirror equals Core's normative vocabulary, value for value and
 * order for order (016 R-10, FR-024). The picker is a no-bundler IIFE that
 * cannot require Core, so the enum ships twice with one source of truth —
 * and this gate is what makes divergence a build failure instead of a
 * silently wrong picker.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const core = require('../packages/core/dialects/key-role-vocabulary');

function loadMirror() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'core', 'key-role-vocabulary.js'),
    'utf8',
  );
  /** @type {any} */
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  return sandbox.window.KeyRoleVocabulary;
}

test('the mirror exists, parses as a plain IIFE, and exports the four sets', () => {
  const m = loadMirror();
  assert.ok(m, 'window.KeyRoleVocabulary must be defined');
  for (const k of ['LEGACY_LABELS', 'ROLE_LABELS', 'STORABLE_LABELS', 'FORMAT_LABELS']) {
    assert.ok(Array.isArray(m[k]), k);
  }
});

test('every set equals Core exactly — same members, same order', () => {
  const m = loadMirror();
  assert.deepEqual(m.LEGACY_LABELS, [...core.LEGACY_LABELS]);
  assert.deepEqual(m.ROLE_LABELS, [...core.ROLE_LABELS]);
  assert.deepEqual(m.STORABLE_LABELS, [...core.STORABLE_LABELS]);
  assert.deepEqual(m.FORMAT_LABELS, [...core.FORMAT_LABELS]);
});

test('the mirror stays dependency-free: no require, no import, no fetch', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'core', 'key-role-vocabulary.js'),
    'utf8',
  );
  assert.doesNotMatch(src, /\brequire\s*\(|\bimport\s|fetch\s*\(/);
});
