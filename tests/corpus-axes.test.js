'use strict';

/**
 * The pairwise axis view must classify every cell from specification and
 * contract knowledge, not from corpus contents: a cell no case occupies is
 * "unverified", never silently absent, and a contract-excluded cell is
 * "unsupported" with a stated reason.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const axes = require('../scripts/corpus-axes');
const { FORMATS, PROTOCOLS, CONTEXTS } = require('./corpus/lib/schema');

const fake = (id, meta) => ({ id, kind: 'pair', meta });

test('axes: applicability rules follow the specifications and product contracts', () => {
  assert.equal(axes.protocolApplies('push', 'ortb-3.0').status, 'n/a');
  for (const format of ['banner', 'native']) {
    for (const protocol of ['jsonfeed', 'url-request'])
      assert.equal(axes.protocolApplies(format, protocol).status, 'applicable');
  }
  assert.equal(axes.protocolApplies('pop', 'url-request').status, 'applicable');
  assert.equal(axes.contextApplies('native', 'ctv').status, 'applicable');
  assert.equal(axes.contextApplies('native', 'dooh').status, 'applicable');
  for (const format of FORMATS)
    assert.equal(axes.contextApplies(format, 'n/a').status, 'applicable');
  assert.equal(axes.contextApplies('video', 'dooh').status, 'applicable');
  assert.equal(axes.dialectApplies('banner', 'inpage-push').status, 'n/a');
  assert.equal(axes.renderedApplies('video', 'full').status, 'unsupported');
  assert.match(axes.renderedApplies('audio', 'partial').reason, /inert text by contract/);
  assert.equal(axes.mediaApplies('banner', 'yes').status, 'unsupported');
  assert.match(axes.mediaApplies('video', 'yes').reason, /media-src 'none'/);
  assert.equal(axes.previewKindApplies('pop', 'url').status, 'applicable');
  assert.equal(axes.previewKindApplies('audio', 'native').status, 'n/a');
});

test('axes: every format × column cell is classified and empty applicable cells read unverified', () => {
  const cases = [
    fake('a', {
      format: 'banner',
      protocol: 'ortb-2.6',
      context: 'web',
      dialect: 'iab',
      scenario: 'pair',
      expect: { preview: { kind: 'markup', rendered: 'full', mediaPlays: 'n/a' } },
    }),
    fake('b', {
      format: 'video',
      protocol: 'ortb-2.5',
      context: 'ctv',
      dialect: 'iab',
      scenario: 'pair',
      expect: { preview: { kind: 'vast', rendered: 'inert-text', mediaPlays: 'no' } },
    }),
  ];
  const built = axes.buildAxes(cases);
  const proto = built.tables.find((t) => t.title === 'Format × protocol');
  assert.ok(proto);
  assert.equal(Object.keys(proto.cells).length, FORMATS.length * PROTOCOLS.length);
  assert.equal(proto.cells['banner|ortb-2.6'].status, 'covered');
  assert.deepEqual(proto.cells['banner|ortb-2.6'].cases, ['a']);
  assert.equal(proto.cells['native|ortb-2.6'].status, 'unverified');
  for (const format of ['banner', 'native']) {
    for (const protocol of ['jsonfeed', 'url-request'])
      assert.equal(proto.cells[`${format}|${protocol}`].status, 'unverified');
  }
  assert.equal(proto.cells['push|ortb-3.0'].status, 'n/a');
  const ctx = built.tables.find((t) => t.title === 'Format × context');
  assert.equal(Object.keys(ctx.cells).length, FORMATS.length * CONTEXTS.length);
  assert.equal(ctx.cells['video|ctv'].status, 'covered');
  assert.equal(ctx.cells['native|ctv'].status, 'unverified');
  assert.equal(ctx.cells['native|dooh'].status, 'unverified');
  assert.equal(ctx.cells['banner|n/a'].status, 'unverified');
  const rendered = built.tables.find((t) => t.title === 'Format × rendered state');
  assert.equal(rendered.cells['video|full'].status, 'unsupported');
  assert.equal(rendered.cells['video|inert-text'].status, 'covered');
  const total =
    built.summary.covered +
    built.summary.unverified +
    built.summary.unsupported +
    built.summary.notApplicable;
  assert.equal(
    total,
    built.tables.reduce((n, t) => n + Object.keys(t.cells).length, 0),
  );
  assert.ok(
    built.triples.some(
      (t) =>
        t.format === 'video' &&
        t.protocol === 'ortb-2.5' &&
        t.context === 'ctv' &&
        t.cases.includes('b'),
    ),
  );
  for (const context of ['ctv', 'dooh', 'n/a']) {
    const triple = built.triples.find(
      (t) => t.format === 'native' && t.protocol === 'ortb-2.6' && t.context === context,
    );
    assert.ok(triple);
    assert.deepEqual(triple.cases, []);
  }
  const md = axes.markdown(built);
  assert.match(md, /\| banner \| ✓ 1 \|/);
  assert.match(md, /\? unverified/);
  assert.match(md, /✗ unsupported/);
  assert.match(md, /media-src 'none'/);
  assert.match(md, /presence of cases, not conformance/);
  assert.match(md, /case metadata alone/);
});

const measuredCase = fake('measured-case', {
  format: 'native',
  protocol: 'ortb-2.6',
  context: 'n/a',
  dialect: 'iab',
  scenario: 'response-only',
  expect: { preview: { kind: 'native', rendered: 'partial', mediaPlays: 'n/a' } },
});
const result = (layer, outcome = 'pass', reason = undefined) => ({
  id: measuredCase.id,
  layer,
  outcome,
  reason,
});
const completePass = ['core', 'http', 'browser'].map((layer) => result(layer));
const noConformance = { conformant: 0, deviating: 0, incomplete: 0, notApplicable: 0 };
const conformanceCell = (built) =>
  built.tables.find((t) => t.title === 'Format × protocol').cells['native|ortb-2.6'];

for (const example of [
  {
    name: 'Core-only results remain incomplete',
    rows: [result('core')],
    counts: { incomplete: 1 },
  },
  {
    name: 'three Core passes do not substitute for three distinct layers',
    rows: [result('core'), result('core'), result('core')],
    counts: { incomplete: 1 },
  },
  {
    name: 'duplicate results invalidate an otherwise complete pass',
    rows: [...completePass, result('core')],
    counts: { incomplete: 1 },
  },
  {
    name: 'three distinct passes demonstrate conformance',
    rows: completePass,
    counts: { conformant: 1 },
  },
  {
    name: 'explicit justified N/A permits conformance of applicable layers',
    rows: [result('core'), result('http'), result('browser', 'not-applicable', 'No response')],
    counts: { conformant: 1 },
  },
  {
    name: 'all justified N/A outcomes demonstrate no conformance or deviation',
    rows: ['core', 'http', 'browser'].map((layer) =>
      result(layer, 'not-applicable', 'This layer does not apply'),
    ),
    counts: { notApplicable: 1 },
  },
  {
    name: 'N/A without a reason is incomplete',
    rows: [result('core'), result('http'), result('browser', 'not-applicable')],
    counts: { incomplete: 1 },
  },
  {
    name: 'N/A with a blank reason is incomplete',
    rows: [result('core'), result('http'), result('browser', 'not-applicable', '  ')],
    counts: { incomplete: 1 },
  },
  {
    name: 'skips are incomplete measurements rather than measured deviations',
    rows: [result('core'), result('http'), result('browser', 'skip', 'Browser unavailable')],
    counts: { incomplete: 1 },
  },
  {
    name: 'explicit missing rows stay incomplete',
    rows: [result('core'), result('http'), result('browser', 'missing')],
    counts: { incomplete: 1 },
  },
  {
    name: 'an unknown outcome cannot be counted as conformance',
    rows: [result('core'), result('http'), result('browser', 'unexpected')],
    counts: { incomplete: 1 },
  },
  {
    name: 'measured failures remain deviations',
    rows: [result('core'), result('http'), result('browser', 'fail')],
    counts: { deviating: 1 },
  },
  {
    name: 'partial known-gap results retain both deviation and incompleteness',
    rows: [result('core', 'known-gap')],
    counts: { deviating: 1, incomplete: 1 },
  },
  {
    name: 'a duplicate pass cannot hide a recorded failure',
    rows: [...completePass, result('core', 'fail')],
    counts: { deviating: 1, incomplete: 1 },
  },
]) {
  test(`axes: ${example.name}`, () => {
    const built = axes.buildAxes([measuredCase], example.rows);
    assert.equal(conformanceCell(built).status, 'covered');
    assert.deepEqual(conformanceCell(built).conformance, {
      ...noConformance,
      ...example.counts,
    });
    assert.equal(built.measured, true);
  });
}

test('axes: measured markdown exposes incomplete and all-N/A cases', () => {
  const incomplete = axes.markdown(axes.buildAxes([measuredCase], [result('core')]));
  assert.match(incomplete, /✓ 1 \(0 ok \/ 0 deviating \/ 1 incomplete \/ 0 all N\/A\)/);
  assert.match(incomplete, /a deviating case can also be incomplete/);
  const allNa = axes.markdown(
    axes.buildAxes(
      [measuredCase],
      ['core', 'http', 'browser'].map((layer) => result(layer, 'not-applicable', 'No input')),
    ),
  );
  assert.match(allNa, /✓ 1 \(0 ok \/ 0 deviating \/ 0 incomplete \/ 1 all N\/A\)/);
});

test('axes: unrelated layers cannot claim that corpus cases were measured', () => {
  const built = axes.buildAxes([measuredCase], [result('ux'), result('a11y')]);
  assert.equal(built.measured, false);
  assert.deepEqual(conformanceCell(built).conformance, {
    ...noConformance,
    incomplete: 1,
  });
});

test('axes: the committed corpus renders without unclassified cells', () => {
  const { loadCorpus } = require('./corpus/lib/load');
  const built = axes.buildAxes(loadCorpus().all);
  for (const t of built.tables) {
    for (const cell of Object.values(t.cells)) {
      assert.ok(['covered', 'unverified', 'unsupported', 'n/a'].includes(cell.status));
    }
  }
});

test('axes: declared corpus gaps require measured outcomes and remain deviations when observed', () => {
  const { loadCorpus } = require('./corpus/lib/load');
  const c = loadCorpus().all.find((entry) => entry.meta.knownGap?.layers.length);
  assert.ok(c, 'the committed corpus contains a recorded known-gap case');
  const rows = ['core', 'http', 'browser'].map((layer) => ({
    id: c.id,
    layer,
    outcome: c.meta.knownGap.layers.includes(layer) ? 'known-gap' : 'pass',
  }));
  const cell = (built) =>
    built.tables.find((t) => t.title === 'Format × scenario').cells[
      `${c.meta.format}|${c.meta.scenario}`
    ];
  assert.deepEqual(cell(axes.buildAxes([c])).conformance, {
    ...noConformance,
    incomplete: 1,
  });
  assert.deepEqual(cell(axes.buildAxes([c], rows)).conformance, {
    ...noConformance,
    deviating: 1,
  });
});
