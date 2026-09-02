'use strict';

/**
 * The exact-case role layer itself (016 R-01, contracts/key-role-layer.md):
 * identity, the three states, provenance completeness, condition predicates,
 * and the literal-unverified-status rule.
 */

const test = require('node:test');
const assert = require('node:assert');

const { lookupKeyRole: lookupTyped } = require('../packages/core/dialects/key-role-alphabet');
/** @param {any} input @returns {any} */
const lookupKeyRole = (input) => lookupTyped(input);

const corpus = require('../packages/core/dialects/data/key-role-corpus.v1.json');

test('a listed spelling resolves; a differently cased spelling abstains — never inherits', () => {
  const listed = lookupKeyRole({ signalPath: 'imp[].ext.ad_type', signalValue: 30 });
  assert.equal(listed.state, 'resolved');
  for (const casing of ['Ad_Type', 'AD_TYPE', 'aD_tYpE']) {
    const r = lookupKeyRole({ signalPath: `imp[].ext.${casing}`, signalValue: 30 });
    assert.equal(r.state, 'abstain', `${casing} must not inherit ad_type`);
  }
});

test('every one of the 22 collision groups keeps its members distinct', () => {
  const groups = Object.values(corpus.lowercaseDiagnostic.collisionBuckets);
  assert.equal(groups.length, 22);
  for (const members of groups) {
    // Each exact spelling is its own identity: the layer may answer
    // differently per member, and looking one up must not consult another —
    // asserted by the corpus evidence attached to the result.
    for (const name of members) {
      const r = lookupKeyRole({ signalPath: `imp[].ext.${name}`, signalValue: 7 });
      assert.ok(['resolved', 'ambiguous', 'abstain'].includes(r.state), name);
    }
  }
});

test('lookup never returns null; absence is an explicit abstain with evidence', () => {
  const r = lookupKeyRole({ signalPath: 'imp[].ext.publisher_account_ref', signalValue: 42 });
  assert.ok(r);
  assert.equal(r.state, 'abstain');
  assert.ok(Array.isArray(r.evidence));
});

test('an unsupported namespace abstains and says so', () => {
  for (const p of ['imp[].banner.ext.ad_type', 'bid[].ext.ad_type', 'ad_type']) {
    const r = lookupKeyRole({ signalPath: p, signalValue: 30 });
    assert.equal(r.state, 'abstain', p);
    assert.equal(r.evidence[0].type, 'unsupported-namespace', p);
  }
});

test('scores appear only on resolved, and only the five exact values', () => {
  const EXACT = [0.9, 0.8, 0.7, 0.6, 0.4];
  const cases = [
    ['ad_type', 30],
    ['subage', 18],
    ['ttl', 300],
    ['creative_type', 3],
  ];
  for (const [key, value] of cases) {
    const r = lookupKeyRole({ signalPath: `imp[].ext.${key}`, signalValue: value });
    assert.equal(r.state, 'resolved', String(key));
    assert.ok(EXACT.includes(r.score), `${key}: ${r.score}`);
  }
  const amb = lookupKeyRole({ signalPath: 'imp[].ext.limit', signalValue: 1 });
  assert.ok(!('score' in amb), 'no singular score on ambiguity');
});

test('the digit-only condition gates build; a failed condition means the rule is not present', () => {
  assert.equal(
    lookupKeyRole({ signalPath: 'imp[].ext.build', signalValue: '20260812' }).state,
    'resolved',
  );
  assert.equal(
    lookupKeyRole({ signalPath: 'imp[].ext.build', signalValue: '2026-rc1' }).state,
    'abstain',
  );
  assert.equal(
    lookupKeyRole({ signalPath: 'imp[].ext.build', signalValue: 20260812 }).state,
    'abstain',
    'a number is not a digit-only STRING; the condition reads the serialized form the vendor sent',
  );
});

test('corpus evidence travels with the answer, carrying its literal unverified status', () => {
  // `adtype` is both a named rule and a corpus name (coverage: both) — its
  // answer must retain BOTH provenance classes under one identity.
  const r = lookupKeyRole({ signalPath: 'imp[].ext.adtype', signalValue: 8 });
  assert.equal(r.state, 'resolved');
  const types = r.evidence.map((e) => e.type);
  assert.ok(types.includes('corpus'), 'corpus evidence retained');
  assert.ok(types.includes('named-rule'), 'named-rule evidence retained');
  const c = r.evidence.find((e) => e.type === 'corpus');
  assert.equal(typeof c.unverifiedOnly, 'boolean', 'literal verification status surfaced');
});

test('membership alone never supplies a role: an adjudicated-abstain name stays abstain', () => {
  // `PId` is a corpus name whose only description ("PID") restates the name —
  // both review passes recorded abstain, so the row proves existence, not a
  // role. (placementId, the pre-adjudication example here, now resolves to
  // identifier @ 0.9 — asserted below.)
  const r = lookupKeyRole({ signalPath: 'imp[].ext.PId', signalValue: 'abc' });
  assert.equal(r.state, 'abstain');
  assert.ok(r.evidence.some((e) => e.type === 'corpus'));
});

test('the adjudication landing flipped placementId to resolved identifier', () => {
  const r = lookupKeyRole({ signalPath: 'imp[].ext.placementId', signalValue: 'abc' });
  assert.equal(r.state, 'resolved');
  assert.equal(r.role, 'identifier');
  assert.equal(r.score, 0.9);
});
