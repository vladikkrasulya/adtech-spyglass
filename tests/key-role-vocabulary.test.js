'use strict';

/**
 * The normative vocabulary (016 FR-019/FR-022/FR-024, ADR-015): twenty
 * storable labels, the format-recognition allowlist, the projection rules,
 * and the reserved valueStatus state.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  CANONICAL_ROLES,
  LEGACY_LABELS,
  ROLE_LABELS,
  STORABLE_LABELS,
  FORMAT_LABELS,
  NON_LABEL_IDENTIFIERS,
  projectRoleToLabel,
  isStorableLabel,
} = require('../packages/core/dialects/key-role-vocabulary');

test('the counts are the contract: 10 roles, 9 role labels, 11 legacy, 20 storable', () => {
  assert.equal(CANONICAL_ROLES.length, 10);
  assert.equal(ROLE_LABELS.length, 9);
  assert.equal(LEGACY_LABELS.length, 11);
  assert.equal(STORABLE_LABELS.length, 20);
  assert.equal(new Set(STORABLE_LABELS).size, 20, 'no duplicates');
});

test('every role label is a canonical role; format-declaration is the one role that is not storable', () => {
  for (const label of ROLE_LABELS) {
    assert.ok(CANONICAL_ROLES.includes(label), `${label} must be a canonical role`);
  }
  assert.ok(CANONICAL_ROLES.includes('format-declaration'));
  assert.ok(!STORABLE_LABELS.includes('format-declaration'));
});

test('FR-022: the nine new labels are inert to format recognition — absent from FORMAT_LABELS', () => {
  for (const label of ROLE_LABELS) {
    assert.ok(!FORMAT_LABELS.includes(label), `${label} must not be a format label`);
  }
  // The allowlist is exactly the eight pre-existing specific formats.
  assert.deepEqual([...FORMAT_LABELS].sort(), [
    'audio',
    'banner',
    'in-page-push',
    'interstitial-banner',
    'native',
    'pop',
    'push',
    'video',
  ]);
  for (const label of ['ignore', 'informational', 'custom']) {
    assert.ok(!FORMAT_LABELS.includes(label), `${label} stays inert, exactly as today`);
  }
});

test('FR-019: non-label identifiers are rejected by every accepting surface', () => {
  for (const id of NON_LABEL_IDENTIFIERS) {
    assert.ok(!isStorableLabel(id), `${id} must not be storable`);
  }
  // The three enums stay distinct: a valueStatus member is not a role.
  assert.ok(NON_LABEL_IDENTIFIERS.includes('unknown'));
  assert.ok(NON_LABEL_IDENTIFIERS.includes('not-applicable'));
  assert.ok(NON_LABEL_IDENTIFIERS.includes('abstain'));
});

test('projection: format-declaration → custom while the value is unknown', () => {
  assert.equal(projectRoleToLabel('format-declaration', { valueStatus: 'unknown' }), 'custom');
  assert.equal(
    projectRoleToLabel('format-declaration', { valueStatus: 'not-applicable' }),
    'custom',
  );
});

test('projection: each of the nine roles projects to itself, no value claim attached', () => {
  for (const role of ROLE_LABELS) {
    assert.equal(projectRoleToLabel(role, { valueStatus: 'not-applicable' }), role);
  }
});

test('FR-010: the reserved resolved branch is guarded — only a real format label passes it', () => {
  // Reachable only with future value evidence; the guard must hold anyway.
  assert.equal(
    projectRoleToLabel('format-declaration', { valueStatus: 'resolved', valueLabel: 'native' }),
    'native',
  );
  assert.equal(
    projectRoleToLabel('format-declaration', { valueStatus: 'resolved', valueLabel: 'identifier' }),
    null,
    'a non-format valueLabel never projects',
  );
  assert.equal(
    projectRoleToLabel('format-declaration', { valueStatus: 'resolved' }),
    null,
    'resolved without a valueLabel projects nothing',
  );
});

test('unknown roles project to nothing', () => {
  assert.equal(projectRoleToLabel('other', { valueStatus: 'unknown' }), null);
  assert.equal(projectRoleToLabel('unknown', { valueStatus: 'unknown' }), null);
});

test('FR-021 floor: all eleven legacy labels are storable, verbatim', () => {
  for (const label of LEGACY_LABELS) assert.ok(isStorableLabel(label), label);
});
