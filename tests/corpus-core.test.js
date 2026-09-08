'use strict';

/**
 * Verification corpus — Core layer.
 *
 * Every base pair and every mutation under tests/corpus/ runs through Core's
 * public entry points (validate, crosscheck, detectFormat) and is judged by
 * the spec-grounded expectations stored beside the payloads. A case whose
 * current result is a recorded deviation (`knownGap`) is reported as a todo
 * with the gap id, and a separate ordinary assertion proves the deviation is
 * still exactly the one on record — if the product changes, or a different
 * failure appears, the ledger must change with it.
 *
 * Run everything:        node --test tests/corpus-core.test.js
 * One case:              CORPUS_CASE=banner-web-26-html-001 node --test tests/corpus-core.test.js
 * One format:            CORPUS_FORMAT=video node --test tests/corpus-core.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCorpus } = require('./corpus/lib/load');
const { runCore, coreApplicability } = require('./corpus/lib/core-run');
const { evaluate } = require('./corpus/lib/oracle');
const { recordResult, gapFor, deviationVerdict } = require('./corpus/lib/report');

const corpus = loadCorpus();
const filtered = !!(process.env.CORPUS_CASE || process.env.CORPUS_FORMAT);

/** @param {import('./corpus/lib/load').Materialized} c */
function observeCore(c) {
  try {
    const actual = runCore(c);
    return evaluate(actual, c.meta.expect, { layers: ['core'] });
  } catch (err) {
    return { failures: [`core.execution: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

test(`corpus: ${corpus.all.length} case(s) loaded (${corpus.skippedByFilter} filtered out)`, () => {
  if (!filtered) assert.ok(corpus.pairs.length > 0, 'the committed corpus must contain base pairs');
  else assert.ok(corpus.all.length > 0, 'the filter matched no case');
});

for (const c of corpus.all) {
  const gap = gapFor(c, 'core');
  const label = `${c.kind} ${c.id} — ${c.meta.title}`;
  const applicability = coreApplicability(c);
  if (!applicability.applicable) {
    recordResult('core', c, {
      pass: false,
      failures: [],
      outcome: 'not-applicable',
      reason: applicability.reason,
      measured: { applicability },
    });
    test(`core: ${label}`, { skip: applicability.reason }, () => {});
    test(`core: ${c.id} — non-applicable cases cannot hide Core deviations`, () => {
      assert.equal(gap, null, `${c.file}: remove Core from knownGap.layers; Core is not exercised`);
    });
    continue;
  }
  if (!gap) {
    test(`core: ${label}`, () => {
      const { failures } = observeCore(c);
      recordResult('core', c, {
        pass: failures.length === 0,
        failures,
        gap: null,
        reason: applicability.reason,
        measured: { applicability },
      });
      assert.deepEqual(failures, [], `${c.file}\n${failures.join('\n')}`);
    });
    continue;
  }
  const { failures } = observeCore(c);
  const verdict = deviationVerdict(failures, gap);
  recordResult('core', c, {
    pass: failures.length === 0,
    failures,
    gap: gap.id,
    reason: applicability.reason,
    measured: { applicability },
  });
  test(`core: ${label} [known gap ${gap.id}]`, { todo: `${gap.id}: ${gap.note}` }, () => {
    assert.deepEqual(failures, [], failures.join('\n'));
  });
  test(`core: ${label} — deviation ${gap.id} is still the recorded one`, () => {
    assert.ok(
      failures.length > 0,
      `${c.file}: the spec expectation now PASSES at the Core layer — retire ${gap.id} for this case (and in tests/corpus/known-gaps.json when no other case needs it)`,
    );
    assert.deepEqual(
      verdict.unexpected,
      [],
      `${c.file}: failures that do not match the recorded ${gap.id} signature (${verdict.reason}):\n${verdict.unexpected.join('\n')}`,
    );
    assert.ok(verdict.stillPresent, `${c.file}: ${verdict.reason}`);
  });
}
