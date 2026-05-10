'use strict';

/**
 * Confusion-matrix runner correctness on a synthetic 4-entry corpus.
 *
 * We don't drive the real behavior engine through complex events — that's
 * already covered by tests/behavior.test.js. Here we mock analyzeBehavior
 * to return deterministic findings per fixture, so we can verify the math
 * (precision / recall / F1, fraud-vs-legit tallying, ambiguous-skip).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeCorpusMatrix } = require('../lib/corpus-matrix');

// Stub corpus model. listForUser returns metadata; getById returns row with
// eventsJson. We key fixtures off the entry id so the stub is trivially
// deterministic.
function makeFixture(entries) {
  // entries: [{ id, label, fires: ['pattern.id', ...] }]
  const byId = new Map(entries.map((e) => [e.id, e]));
  return {
    BehaviorCorpus: {
      listForUser() {
        return entries.map(({ id, label }) => ({ id, label }));
      },
      getById(id) {
        const e = byId.get(id);
        if (!e) return null;
        return { id, eventsJson: JSON.stringify([{ kind: 'tag', tag: id }]) };
      },
    },
    analyzeBehavior(events) {
      const tag = events[0]?.tag;
      const e = byId.get(tag);
      const fires = e ? e.fires : [];
      return { findings: fires.map((id) => ({ id, level: 'error' })) };
    },
  };
}

// ─── happy paths ─────────────────────────────────────────────────────────

test('matrix: perfect precision + recall = F1 1.0', () => {
  const deps = makeFixture([
    { id: 1, label: 'fraud', fires: ['behavior.bot.click_burst'] },
    { id: 2, label: 'fraud', fires: ['behavior.bot.click_burst'] },
    { id: 3, label: 'legitimate', fires: [] },
    { id: 4, label: 'legitimate', fires: [] },
  ]);
  const m = computeCorpusMatrix(deps, 1);
  assert.equal(m.totals.fraud, 2);
  assert.equal(m.totals.legitimate, 2);
  assert.equal(m.patterns.length, 1);
  const p = m.patterns[0];
  assert.equal(p.id, 'behavior.bot.click_burst');
  assert.equal(p.tp, 2);
  assert.equal(p.fp, 0);
  assert.equal(p.fn, 0);
  assert.equal(p.tn, 2);
  assert.equal(p.precision, 1);
  assert.equal(p.recall, 1);
  assert.equal(p.f1, 1);
});

test('matrix: 50% precision, 100% recall', () => {
  const deps = makeFixture([
    { id: 1, label: 'fraud', fires: ['p.weak'] },
    { id: 2, label: 'legitimate', fires: ['p.weak'] }, // false positive
  ]);
  const m = computeCorpusMatrix(deps, 1);
  const p = m.patterns[0];
  assert.equal(p.tp, 1);
  assert.equal(p.fp, 1);
  assert.equal(p.fn, 0);
  assert.equal(p.tn, 0);
  assert.equal(p.precision, 0.5);
  assert.equal(p.recall, 1);
  assert.equal(p.f1, 2 * (0.5 * 1) / (0.5 + 1)); // 0.6666…
});

test('matrix: missed fraud → recall 0', () => {
  const deps = makeFixture([
    { id: 1, label: 'fraud', fires: [] }, // never fired
    { id: 2, label: 'legitimate', fires: [] },
  ]);
  const m = computeCorpusMatrix(deps, 1);
  // No pattern fired → no rows in matrix
  assert.equal(m.patterns.length, 0);
  assert.equal(m.totals.fraud, 1);
});

test('matrix: ambiguous excluded from math, counted in totals', () => {
  const deps = makeFixture([
    { id: 1, label: 'fraud', fires: ['p.x'] },
    { id: 2, label: 'legitimate', fires: [] },
    { id: 3, label: 'ambiguous', fires: ['p.x', 'p.y'] }, // ignored
    { id: 4, label: 'ambiguous', fires: [] },
  ]);
  const m = computeCorpusMatrix(deps, 1);
  assert.equal(m.totals.ambiguous, 2);
  assert.equal(m.totals.fraud, 1);
  assert.equal(m.totals.legitimate, 1);
  // Only p.x has TP from fraud entry — and 0 FP because no legitimate fired it
  assert.equal(m.patterns.length, 1);
  const p = m.patterns[0];
  assert.equal(p.id, 'p.x');
  assert.equal(p.tp, 1);
  assert.equal(p.fp, 0);
});

test('matrix: dedup within one entry — same pattern fired N times counts as 1', () => {
  const deps = {
    BehaviorCorpus: {
      listForUser() {
        return [{ id: 1, label: 'fraud' }];
      },
      getById() {
        return { id: 1, eventsJson: JSON.stringify([{}]) };
      },
    },
    analyzeBehavior() {
      // simulate a noisy rule firing 3x for the same id on one entry
      return {
        findings: [
          { id: 'p.noisy', level: 'error' },
          { id: 'p.noisy', level: 'error' },
          { id: 'p.noisy', level: 'error' },
        ],
      };
    },
  };
  const m = computeCorpusMatrix(deps, 1);
  const p = m.patterns[0];
  assert.equal(p.tp, 1, 'should count as 1 entry, not 3 firings');
});

test('matrix: sort order — by F1 desc, ties by TP desc, then id asc', () => {
  const deps = makeFixture([
    { id: 1, label: 'fraud', fires: ['p.a', 'p.b', 'p.c'] }, // TP all 3
    { id: 2, label: 'fraud', fires: ['p.a', 'p.b'] },        // p.a + p.b TP again
    { id: 3, label: 'legitimate', fires: ['p.c'] },          // p.c gets FP
  ]);
  const m = computeCorpusMatrix(deps, 1);
  // p.a: tp=2, fp=0, fn=0 → P=1, R=1, F=1
  // p.b: tp=2, fp=0, fn=0 → P=1, R=1, F=1
  // p.c: tp=1, fp=1, fn=1 → P=0.5, R=0.5, F=0.5
  // p.a and p.b tie on F=1 and TP=2 → sort by id: p.a first, then p.b
  assert.equal(m.patterns[0].id, 'p.a');
  assert.equal(m.patterns[1].id, 'p.b');
  assert.equal(m.patterns[2].id, 'p.c');
  assert.equal(m.patterns[0].f1, 1);
  assert.equal(m.patterns[2].f1, 0.5);
});

test('matrix: zero fraud entries → all recall null, no division-by-zero', () => {
  const deps = makeFixture([
    { id: 1, label: 'legitimate', fires: ['p.weird'] },
  ]);
  const m = computeCorpusMatrix(deps, 1);
  const p = m.patterns[0];
  assert.equal(p.precision, 0); // tp=0, fp=1 → 0/1
  assert.equal(p.recall, null);
  assert.equal(p.f1, null);
});

test('matrix: corrupt JSON in events_json — entry skipped silently', () => {
  const deps = {
    BehaviorCorpus: {
      listForUser() {
        return [
          { id: 1, label: 'fraud' },
          { id: 2, label: 'legitimate' },
        ];
      },
      getById(id) {
        if (id === 1) return { id: 1, eventsJson: '{not json' };
        return { id: 2, eventsJson: JSON.stringify([{ k: 1 }]) };
      },
    },
    analyzeBehavior() {
      return { findings: [{ id: 'p.x' }] };
    },
  };
  const m = computeCorpusMatrix(deps, 1);
  assert.equal(m.totals.fraud, 0, 'corrupt-json entry not counted');
  assert.equal(m.totals.legitimate, 1);
  assert.equal(m.patterns[0].fp, 1);
});

test('matrix: empty corpus → empty totals, no patterns', () => {
  const deps = {
    BehaviorCorpus: { listForUser: () => [], getById: () => null },
    analyzeBehavior: () => ({ findings: [] }),
  };
  const m = computeCorpusMatrix(deps, 1);
  assert.equal(m.totals.fraud, 0);
  assert.equal(m.totals.legitimate, 0);
  assert.equal(m.totals.ambiguous, 0);
  assert.equal(m.patterns.length, 0);
});
