'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { replay } = require('../lib/replay');

// Stub deps. Each one returns a deterministic shape so we can verify the
// runner aggregates correctly without coupling to the real engine.

function makeDeps(overrides = {}) {
  return {
    validate:
      overrides.validate ||
      ((p) => ({
        type: 'oRTB BidRequest',
        version: '2.5',
        status: 'clean',
        findings: [],
      })),
    crosscheck: overrides.crosscheck || (() => []),
    analyzeBehavior:
      overrides.analyzeBehavior ||
      (() => ({
        findings: [],
        status: 'clean',
        eventCount: 0,
      })),
  };
}

// ─── shape ────────────────────────────────────────────────────────────────

test('replay: throws on non-array input', () => {
  // @ts-expect-error -- intentionally passing wrong type to test the throw path
  assert.throws(() => replay('nope', makeDeps()), /samples_must_be_array/);
});

test('replay: skips empty samples (no req/res/events)', () => {
  const out = replay([{}, { label: 'just-a-label' }], makeDeps());
  assert.equal(out.summary.skipped, 2);
  assert.equal(out.results[0].status, 'skipped');
  assert.equal(out.results[0].reason, 'empty_sample');
});

test('replay: skips invalid (non-object) entries', () => {
  const out = replay([null, 'string', 42], makeDeps());
  assert.equal(out.summary.skipped, 3);
  assert.ok(out.results.every((r) => r.status === 'skipped'));
});

// ─── validation pipeline ──────────────────────────────────────────────────

test('replay: bidReq runs validate, no crosscheck without bidRes', () => {
  let validateCalls = 0;
  let crossCalls = 0;
  const out = replay(
    [{ bidReq: { id: 'r1' } }],
    makeDeps({
      validate: () => {
        validateCalls++;
        return { type: 'req', version: '2.5', status: 'clean', findings: [] };
      },
      crosscheck: () => {
        crossCalls++;
        return [];
      },
    }),
  );
  assert.equal(validateCalls, 1);
  assert.equal(crossCalls, 0);
  assert.ok(out.results[0].validation);
  assert.equal(out.results[0].crosscheck, null);
});

test('replay: bidReq + bidRes runs validate twice + crosscheck once', () => {
  let validateCalls = 0;
  let crossCalls = 0;
  replay(
    [{ bidReq: { id: 'r' }, bidRes: { id: 'r' } }],
    makeDeps({
      validate: () => {
        validateCalls++;
        return { type: 'x', version: '2.5', status: 'clean', findings: [] };
      },
      crosscheck: () => {
        crossCalls++;
        return [];
      },
    }),
  );
  assert.equal(validateCalls, 2);
  assert.equal(crossCalls, 1);
});

test('replay: behaviorEvents runs analyzeBehavior with adm', () => {
  /** @type {{events: any[], opts: any} | null} */
  let captured = null;
  replay(
    [{ behaviorEvents: [{ kind: 'click' }], adm: '<html>x</html>' }],
    makeDeps({
      analyzeBehavior: (events, opts) => {
        captured = { events, opts };
        return { findings: [], status: 'clean', eventCount: events.length };
      },
    }),
  );
  if (!captured) throw new Error('analyzeBehavior should have been called');
  assert.equal(captured.events.length, 1);
  assert.equal(captured.opts.adm, '<html>x</html>');
});

// ─── status rollup ────────────────────────────────────────────────────────

test('replay: rolls up status to worst across validate / crosscheck / behavior', () => {
  const out = replay(
    [
      // validation clean, crosscheck CRIT → status errors
      { bidReq: { id: 'r' }, bidRes: { id: 'r' } },
    ],
    makeDeps({
      crosscheck: () => [{ id: 'crosscheck.id_mismatch', level: 'crit' }],
    }),
  );
  assert.equal(out.results[0].status, 'errors');
});

test('replay: behavior errors propagate to sample status', () => {
  const out = replay(
    [{ behaviorEvents: [{}] }],
    makeDeps({
      analyzeBehavior: () => ({
        findings: [{ id: 'behavior.bot.x', level: 'error' }],
        status: 'errors',
        eventCount: 1,
      }),
    }),
  );
  assert.equal(out.results[0].status, 'errors');
});

// ─── tally + counts ───────────────────────────────────────────────────────

test('replay: counts errors / warnings / info / crits per sample', () => {
  const out = replay(
    [{ bidReq: { id: 'a' } }, { bidReq: { id: 'b' }, bidRes: { id: 'b' } }],
    makeDeps({
      validate: (p) => ({
        type: 'r',
        version: '2.5',
        status: 'errors',
        findings: [
          { id: 'r.missing', level: 'error' },
          { id: 'r.tip', level: 'info' },
        ],
      }),
      crosscheck: () => [
        { id: 'crosscheck.bid.below_floor', level: 'crit' },
        { id: 'crosscheck.bid.size_match', level: 'warn' },
      ],
    }),
  );
  // sample 0: 1 error + 1 info
  assert.equal(out.results[0].errorCount, 1);
  assert.equal(out.results[0].infoCount, 1);
  // sample 1: 1 error + 1 info from validate (twice for req + res = 2+2)
  // plus crosscheck: 1 crit + 1 warn
  assert.equal(out.results[1].errorCount, 2);
  assert.equal(out.results[1].infoCount, 2);
  assert.equal(out.results[1].critCount, 1);
  assert.equal(out.results[1].warningCount, 1);
});

test('replay: aggregates totalFindings across all samples', () => {
  const out = replay(
    [{ bidReq: { id: 'a' } }, { bidReq: { id: 'b' } }, { bidReq: { id: 'c' } }],
    makeDeps({
      validate: () => ({
        type: 'r',
        version: '2.5',
        status: 'errors',
        findings: [{ id: 'x', level: 'error' }],
      }),
    }),
  );
  assert.equal(out.summary.totalFindings.errors, 3);
  assert.equal(out.summary.totalFindings.warnings, 0);
});

// ─── topFindings ──────────────────────────────────────────────────────────

test('replay: topFindings sorted by frequency desc', () => {
  const out = replay(
    [{ bidReq: { id: 'a' } }, { bidReq: { id: 'b' } }, { bidReq: { id: 'c' } }],
    makeDeps({
      validate: (p) => {
        // emit different ids per sample
        const id = p.id; // 'a' / 'b' / 'c'
        return {
          type: 'r',
          version: '2.5',
          status: 'errors',
          findings: [
            { id: 'common.error', level: 'error' },
            { id: 'unique.' + id, level: 'error' },
          ],
        };
      },
    }),
  );
  // common.error fired 3x, unique.{a,b,c} fired 1x each
  assert.equal(out.summary.topFindings[0].id, 'common.error');
  assert.equal(out.summary.topFindings[0].count, 3);
  assert.equal(out.summary.topFindings.length, 4);
});

test('replay: topFindings respects topK', () => {
  const out = replay([{ bidReq: { id: 'x' } }], {
    ...makeDeps({
      validate: () => ({
        type: 'r',
        version: '2.5',
        status: 'errors',
        findings: [
          { id: 'a', level: 'error' },
          { id: 'b', level: 'error' },
          { id: 'c', level: 'error' },
          { id: 'd', level: 'error' },
        ],
      }),
    }),
    topK: 2,
  });
  assert.equal(out.summary.topFindings.length, 2);
});

// ─── summary statusCounts ────────────────────────────────────────────────

test('replay: summary.statusCounts correctly histograms', () => {
  const out = replay(
    [
      { bidReq: { id: 'clean' } },
      { bidReq: { id: 'err' } },
      { bidReq: { id: 'warn' } },
      { bidReq: { id: 'err2' } },
    ],
    makeDeps({
      validate: (p) => {
        if (p.id === 'clean') return { type: 'r', version: '2.5', status: 'clean', findings: [] };
        if (p.id === 'warn')
          return {
            type: 'r',
            version: '2.5',
            status: 'warnings',
            findings: [{ id: 'w', level: 'warning' }],
          };
        return {
          type: 'r',
          version: '2.5',
          status: 'errors',
          findings: [{ id: 'e', level: 'error' }],
        };
      },
    }),
  );
  assert.equal(out.summary.statusCounts.clean, 1);
  assert.equal(out.summary.statusCounts.warnings, 1);
  assert.equal(out.summary.statusCounts.errors, 2);
});

// ─── caps ─────────────────────────────────────────────────────────────────

test('replay: maxSamples caps how many we process', () => {
  const samples = Array.from({ length: 50 }, (_, i) => ({ bidReq: { id: 'r' + i } }));
  const out = replay(samples, { ...makeDeps(), maxSamples: 10 });
  assert.equal(out.summary.total, 10);
  assert.equal(out.results.length, 10);
});

test('replay: empty array returns clean summary', () => {
  const out = replay([], makeDeps());
  assert.equal(out.summary.total, 0);
  assert.equal(out.results.length, 0);
  assert.equal(out.summary.topFindings.length, 0);
});

test('replay: label is echoed back in result', () => {
  const out = replay([{ bidReq: { id: 'r' }, label: 'kadam-prod-2026-05-10' }], makeDeps());
  assert.equal(out.results[0].label, 'kadam-prod-2026-05-10');
});
