'use strict';

/**
 * SC-002: run every routing-matrix fixture through the NEW combined chain,
 * measure D1, report the five route counts separately, and assert the two
 * structural guarantees — D1 > D0 and no demotion. Slice A now; slice B
 * fixtures join the same run when the adjudication manifest lands.
 */

const test = require('node:test');
const assert = require('node:assert');

const { classifySignal } = require('../packages/core/dialects/signal-lexicon');
const { lookupKeyRole } = require('../packages/core/dialects/key-role-alphabet');
const { combine } = require('../packages/core/dialects/resolve-precedence');

const matrix = require('../packages/core/dialects/data/key-role-routing-matrix.v1.json');

const IMP = { banner: { w: 300, h: 250 } };

/** @param {any} f @returns {any} */
function d1(f) {
  const legacy = classifySignal({
    signalPath: f.signalPath.replace('imp[].', 'imp[0].'),
    signalValue: f.signalValue,
    imp: f.signalPath.startsWith('imp[]') ? IMP : null,
    locale: 'en',
  });
  const role = /** @type {any} */ (
    lookupKeyRole({ signalPath: f.signalPath, signalValue: f.signalValue, locale: 'en' })
  );
  return combine({ savedMapping: null, legacy, role });
}

const fixtures = [...matrix.fixtures, ...((matrix.sliceB && matrix.sliceB.fixtures) || [])];

test('SC-002: D1 > D0, no demotion, five route counts reported separately', () => {
  const counts = {
    'exact-format': 0,
    'role-resolved': 0,
    'role-ambiguous': 0,
    'preserved-legacy': 0,
    model: 0,
  };
  let d0Deterministic = 0;
  let d1Deterministic = 0;
  const demotions = [];

  for (const f of fixtures) {
    const r = d1(f);
    counts[r.route] += 1;
    const wasDeterministic = f.D0.route !== 'model';
    const isDeterministic = r.route !== 'model';
    if (wasDeterministic) d0Deterministic += 1;
    if (isDeterministic) d1Deterministic += 1;
    if (wasDeterministic && !isDeterministic) demotions.push(f.id);
  }

  // The report SC-002 demands — visible in the TAP output.
  console.log(
    `routing matrix: ${fixtures.length} fixtures | D0 deterministic ${d0Deterministic} → D1 ${d1Deterministic} |`,
    counts,
  );

  assert.deepEqual(demotions, [], 'no fixture deterministic in D0 may reach the model in D1');
  assert.ok(
    d1Deterministic > d0Deterministic,
    `D1 (${d1Deterministic}) must exceed D0 (${d0Deterministic})`,
  );
  // Partition rule: every fixture lands in exactly one counter.
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b, 0),
    fixtures.length,
  );
});

test('role-layer resolved/ambiguous outcomes make zero model calls by construction', () => {
  for (const f of fixtures) {
    const r = d1(f);
    if (r.route === 'role-resolved' || r.route === 'role-ambiguous') {
      assert.notEqual(r.outcome, 'model', f.id);
      assert.ok(r.answer, f.id);
    }
  }
});

test('unlisted-casing controls: the role layer abstains and never inherits; the legacy layer keeps its own answer', () => {
  for (const f of fixtures.filter((x) => x.class === 'unlisted-casing')) {
    const role = /** @type {any} */ (
      lookupKeyRole({ signalPath: f.signalPath, signalValue: f.signalValue, locale: 'en' })
    );
    assert.equal(role.state, 'abstain', `${f.id}: no case-fold inheritance in the role layer`);
    const r = d1(f);
    // The final route follows the matrix: a legacy broad heuristic that
    // matched TODAY (pId/tagID hit the lowercased id$ pattern) is preserved
    // — that is the no-demotion guarantee, not inheritance. What is
    // forbidden is a role-layer answer.
    assert.notEqual(r.route, 'role-resolved', f.id);
    assert.notEqual(r.route, 'role-ambiguous', f.id);
    assert.equal(r.route, f.D0.route === 'model' ? 'model' : 'preserved-legacy', f.id);
  }
});

test('absent-key controls fall through to the model in both namespaces', () => {
  for (const f of fixtures.filter((x) => x.class === 'absent-key')) {
    const r = d1(f);
    assert.equal(r.route, 'model', f.id);
  }
});

test('determinism procedure: a second pass over the whole matrix yields identical routes', () => {
  const first = fixtures.map((f) => d1(f).route);
  const second = fixtures.map((f) => d1(f).route);
  assert.deepEqual(second, first);
});
