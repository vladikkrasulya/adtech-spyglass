'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gapFor, deviationVerdict, recordResult } = require('./corpus/lib/report');
const { analyzeBodyFor, startServer, runHttp, postAnalyzeRaw } = require('./corpus/lib/http-run');
const { buildReport, markdown } = require('../scripts/corpus-matrix');
const { A11Y_SCENARIOS, validateA11yReport } = require('./corpus/lib/a11y-contract');

/** @returns {any} */
const passingA11y = () => ({
  schemaVersion: 1,
  scenarios: A11Y_SCENARIOS.map((id) => ({ id, status: 'pass', failures: [] })),
  findings: [],
});

const a11yFinding = (overrides = {}) => ({
  scenarioId: 'keyboard',
  kind: 'observation',
  area: 'keyboard.tab-order',
  severity: 'info',
  repro: 'Press Tab in the Inspector',
  expected: 'Record the focus order for manual review',
  actual: 'Analyze, request editor, response editor',
  screenshot: null,
  ...overrides,
});

function completeReportFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-report-a11y-'));
  const saved = { CORPUS_CASE: process.env.CORPUS_CASE, CORPUS_FORMAT: process.env.CORPUS_FORMAT };
  delete process.env.CORPUS_CASE;
  delete process.env.CORPUS_FORMAT;
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const all = ['banner', 'video', 'audio', 'native', 'push', 'pop', 'inpage'].flatMap((format) =>
    Array.from({ length: 5 }, (_, index) => ({
      id: `${format}-${index}`,
      kind: /** @type {const} */ ('pair'),
      file: 'inline report fixture',
      meta: { format, scenario: 'pair', expect: {} },
    })),
  );
  for (const layer of ['core', 'http', 'browser'])
    fs.writeFileSync(
      path.join(dir, `${layer}.jsonl`),
      all.map((c) => JSON.stringify({ layer, id: c.id, outcome: 'pass' })).join('\n') + '\n',
    );
  const uxIds = ['en', 'uk', 'ru'].flatMap((locale) =>
    ['light', 'dark'].flatMap((theme) =>
      ['desktop', 'mobile'].map((viewport) => `ux-${locale}-${theme}-${viewport}`),
    ),
  );
  fs.writeFileSync(
    path.join(dir, 'ux.jsonl'),
    uxIds.map((id) => JSON.stringify({ layer: 'ux', id, outcome: 'pass' })).join('\n') + '\n',
  );
  const corpus = { all, pairs: all, mutations: [], knownGaps: {}, skippedByFilter: 0 };
  const run = { phases: [{ file: 'tests/corpus-ux-a11y-browser.test.js', status: 0 }] };
  const write = (value) =>
    fs.writeFileSync(path.join(dir, 'ux-a11y-findings.json'), JSON.stringify(value));
  return { dir, run, corpus, write, read: () => buildReport(dir, run, corpus) };
}

const caseWithGap = () => ({
  id: 'report-self-check',
  kind: 'pair',
  meta: {
    format: 'banner',
    knownGap: {
      id: 'DEF-999',
      note: 'self-test only',
      layers: ['core', 'http'],
      matches: { core: ['^missing A$', '^missing B$'], http: ['^missing A$'] },
    },
  },
});

test('report: layer signatures reject novel failures, partial repairs and retired gaps', () => {
  const c = caseWithGap();
  const core = gapFor(c, 'core');
  assert.equal(deviationVerdict(['missing A', 'missing B'], core).stillPresent, true);
  for (const failures of [[], ['missing A'], ['missing B'], ['missing A', 'missing B', 'HTTP 500']])
    assert.equal(deviationVerdict(failures, core).stillPresent, false);
  assert.equal(deviationVerdict(['missing A'], gapFor(c, 'http')).stillPresent, true);
  assert.equal(gapFor(c, 'browser'), null);
  c.meta.knownGap.matches.core = [];
  assert.throws(() => gapFor(c, 'core'), /nonempty/);
  c.meta.knownGap.matches.core = ['missing'];
  assert.throws(() => gapFor(c, 'core'), /anchored/);
});

test('report: known gaps cannot turn a novel failure or repair into a product pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-report-self-'));
  const saved = process.env.CORPUS_REPORT_DIR;
  try {
    process.env.CORPUS_REPORT_DIR = dir;
    const c = caseWithGap();
    recordResult('core', c, { pass: false, failures: ['missing A', 'missing B'] });
    recordResult('core', c, { pass: false, failures: ['missing A', 'missing B', 'crash'] });
    recordResult('core', c, { pass: true, failures: [] });
    assert.throws(
      () =>
        recordResult('core', c, { outcome: 'not-applicable', reason: 'transport parsing only' }),
      /cannot suppress/,
    );
    recordResult('browser', c, { outcome: 'not-applicable', reason: 'no browser assertions' });
    assert.throws(() => recordResult('core', c, { outcome: 'skip' }), /needs a reason/);
    const rows = fs
      .readFileSync(path.join(dir, 'core.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      rows.map((r) => r.outcome),
      ['known-gap', 'fail', 'fail'],
    );
    assert.ok(rows.every((r) => r.pass === false));
    const matrix = buildReport(
      dir,
      {},
      { all: [], pairs: [], mutations: [], knownGaps: {}, skippedByFilter: 0 },
    );
    assert.equal(matrix.auditComplete, false);
    assert.ok(matrix.problems.some((p) => p.includes('duplicate result')));
    assert.ok(matrix.problems.some((p) => p.includes('UX: expected 12')));
  } finally {
    if (saved === undefined) delete process.env.CORPUS_REPORT_DIR;
    else process.env.CORPUS_REPORT_DIR = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HTTP envelope preserves valid lexical JSON sidecars and distinguishes malformed transport', () => {
  const c = /** @type {any} */ ({
    rawRequest: '{"id":"first","id":"last"}',
    response: { id: 'last' },
  });
  const body = JSON.parse(analyzeBodyFor(c));
  assert.equal(body.bidReq.id, 'last');
  assert.equal(body.bidReqRaw, c.rawRequest);
  assert.deepEqual(body.bidRes, c.response);
  assert.throws(() => JSON.parse(analyzeBodyFor(/** @type {any} */ ({ rawRequest: '{oops' }))));
});

test(
  'HTTP harness observes actual success, per-side errors and malformed envelope rejection',
  { timeout: 30000 },
  async () => {
    const server = await startServer();
    const response = {
      id: 'audit-http',
      seatbid: [{ bid: [{ id: 'bid', impid: 'imp', price: true, adm: '<div>fixture</div>' }] }],
    };
    try {
      const single = await runHttp(
        server.url,
        /** @type {any} */ ({ meta: { dialect: 'iab' }, response }),
      );
      assert.equal(single.http.status, 200);
      assert.equal(single.http.body.success, true);
      assert.equal(single.response.type, 'oRTB BidResponse');
      assert.ok(single.response.findings.some((f) => f.level === 'error'));
      assert.ok(single.response.findings.every((f) => f.side === 'response'));
      const pair = await runHttp(
        server.url,
        /** @type {any} */ ({
          meta: { dialect: 'iab' },
          response,
          request: {
            id: 'audit-http',
            imp: [{ id: 'imp', banner: { w: 300, h: 250 } }],
            site: { domain: 'example.com' },
            device: { ua: 'synthetic', ip: '192.0.2.1' },
          },
        }),
      );
      assert.equal(pair.response.status, 'errors');
      assert.notEqual(pair.request.status, 'errors');
      assert.ok(pair.response.findings.every((f) => f.side === 'response'));
      const malformed = await postAnalyzeRaw(server.url, '{bad');
      assert.equal(malformed.status, 400);
      assert.equal(malformed.body.success, false);
    } finally {
      await server.stop();
    }
  },
);

test('matrix: explicitly missing execution cannot pass a populated report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-matrix-self-'));
  try {
    const all = ['banner', 'video', 'audio', 'native', 'push', 'pop', 'inpage'].flatMap((format) =>
      Array.from({ length: 5 }, (_, index) => ({
        id: `${format}-${index}`,
        kind: 'pair',
        meta: { format, scenario: 'pair', expect: {} },
      })),
    );
    for (const layer of ['core', 'http', 'browser'])
      fs.writeFileSync(
        path.join(dir, `${layer}.jsonl`),
        all
          .map((c, i) =>
            JSON.stringify({
              layer,
              id: c.id,
              outcome: layer === 'browser' && i === 0 ? 'missing' : 'pass',
            }),
          )
          .join('\n') + '\n',
      );
    fs.writeFileSync(
      path.join(dir, 'ux.jsonl'),
      Array.from({ length: 12 }, (_, i) =>
        JSON.stringify({
          layer: 'ux',
          id: `ux-${i}`,
          outcome: 'pass',
        }),
      ).join('\n') + '\n',
    );
    const report = buildReport(dir, {}, /** @type {any} */ ({ all }));
    assert.equal(report.auditComplete, false);
    assert.equal(report.counts.browser.missing, 1);
    assert.ok(report.problems.some((p) => p.includes('browser:banner-0: missing')));
    assert.ok(report.problems.some((p) => p.includes('UX: unknown ux-0')));
    fs.writeFileSync(
      path.join(dir, 'browser.jsonl'),
      all.map((c) => JSON.stringify({ layer: 'browser', id: c.id, outcome: 'pass' })).join('\n') +
        '\n',
    );
    assert.equal(
      buildReport(dir, {}, /** @type {any} */ ({ all })).auditComplete,
      false,
      'twelve unrelated UX IDs are insufficient',
    );
    const uxIds = ['en', 'uk', 'ru'].flatMap((locale) =>
      ['light', 'dark'].flatMap((theme) =>
        ['desktop', 'mobile'].map((viewport) => `ux-${locale}-${theme}-${viewport}`),
      ),
    );
    fs.writeFileSync(
      path.join(dir, 'ux.jsonl'),
      uxIds.map((id) => JSON.stringify({ layer: 'ux', id, outcome: 'pass' })).join('\n') + '\n',
    );
    assert.equal(buildReport(dir, {}, /** @type {any} */ ({ all })).auditComplete, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a11y contract: every scenario is required once, while zero findings is a valid result', () => {
  assert.equal(Object.isFrozen(A11Y_SCENARIOS), true);
  assert.equal(A11Y_SCENARIOS.length, 19);
  const passing = validateA11yReport(passingA11y());
  assert.equal(passing.valid, true);
  assert.equal(passing.productConformant, true);
  assert.equal(passing.summary.byStatus.pass, 19);
  assert.equal(passing.summary.findings, 0);
  /** @type {Array<[(value: any) => void, RegExp]>} */
  const changes = [
    [
      (value) => {
        value.scenarios = [];
      },
      /missing scenario/,
    ],
    [
      (value) => {
        value.scenarios.pop();
      },
      /missing scenario zoom-css150/,
    ],
    [
      (value) => {
        value.scenarios.push({ ...value.scenarios[0] });
      },
      /duplicate scenario/,
    ],
    [
      (value) => {
        value.scenarios[0].id = 'unknown';
      },
      /unknown id unknown/,
    ],
    [
      (value) => {
        value.scenarios[0].status = 'observed';
      },
      /unknown status observed/,
    ],
  ];
  for (const [change, expected] of changes) {
    const value = passingA11y();
    change(value);
    const result = validateA11yReport(value);
    assert.equal(result.valid, false);
    assert.equal(result.productConformant, false);
    assert.match(result.problems.join('\n'), expected);
  }
});

test('a11y contract: malformed envelope, scenario and finding shapes return problems without crashing', () => {
  const malformed = [null, [], 'bad', 1, {}, { schemaVersion: 2, scenarios: [], findings: [] }];
  for (const change of [
    (value) => {
      value.scenarios = null;
    },
    (value) => {
      value.scenarios[0] = null;
    },
    (value) => {
      value.scenarios[0].id = { toString: null };
    },
    (value) => {
      value.scenarios[0].status = { toString: null };
    },
    (value) => {
      value.scenarios[0].failures = null;
    },
    (value) => {
      value.scenarios[0].failures = [' '];
    },
    (value) => {
      value.findings = {};
    },
    (value) => {
      value.findings = [null];
    },
    (value) => {
      value.findings = [a11yFinding({ scenarioId: 'unknown' })];
    },
    (value) => {
      value.findings = [a11yFinding({ scenarioId: { toString: null } })];
    },
    (value) => {
      value.findings = [a11yFinding({ kind: 'warning' })];
    },
    (value) => {
      value.findings = [a11yFinding({ actual: null })];
    },
    (value) => {
      value.findings = [a11yFinding({ screenshot: {} })];
    },
  ]) {
    const value = passingA11y();
    change(value);
    malformed.push(value);
  }
  for (const value of malformed) {
    const result = validateA11yReport(value);
    assert.equal(result.valid, false, JSON.stringify(value));
    assert.equal(result.productConformant, false);
    assert.ok(result.problems.length);
    assert.ok(Array.isArray(result.scenarios));
    assert.ok(Array.isArray(result.findings));
  }
});

test('a11y contract: known gaps reject missing signatures, new failures, partial repairs and retirement', () => {
  const value = passingA11y();
  const scenario = value.scenarios.find((row) => row.id === 'keyboard');
  Object.assign(scenario, {
    status: 'known-gap',
    failures: ['missing A', 'missing B'],
    gap: { id: 'DEF-999', matches: ['^missing A$', '^missing B$'] },
  });
  const known = validateA11yReport(value);
  assert.equal(known.valid, true);
  assert.equal(known.productConformant, false);
  for (const failures of [[], ['missing A'], ['missing A', 'missing B', 'new crash']]) {
    scenario.failures = failures;
    assert.equal(validateA11yReport(value).valid, false);
  }
  scenario.failures = ['missing A', 'missing B'];
  for (const gap of [
    null,
    {},
    { id: ' ', matches: ['^missing A$'] },
    { id: 'DEF-999', matches: [] },
    { id: 'DEF-999', matches: ['missing'] },
    { id: 'DEF-999', matches: ['^[$'] },
    { id: 'DEF-999', matches: [null] },
  ]) {
    scenario.gap = gap;
    assert.equal(validateA11yReport(value).valid, false);
  }
  scenario.status = 'pass';
  scenario.gap = null;
  assert.equal(validateA11yReport(value).valid, false, 'a pass cannot carry failures');
  scenario.failures = [];
  scenario.gap = { id: 'DEF-999', matches: ['^missing A$'] };
  assert.equal(validateA11yReport(value).valid, false, 'a pass cannot keep a gap');
  scenario.gap = null;
  assert.equal(validateA11yReport(value).productConformant, true);
});

test('matrix: a11y is mandatory for a full run and every present file is validated even when filtered', (t) => {
  const fixture = completeReportFixture(t);
  const missing = fixture.read();
  assert.equal(missing.auditComplete, false);
  assert.equal(missing.productConformant, false);
  assert.equal(missing.counts.a11y.missing, 19);
  assert.match(missing.problems.join('\n'), /UX a11y: ux-a11y-findings.json missing/);
  fixture.write(passingA11y());
  const passing = fixture.read();
  assert.equal(passing.auditComplete, true, passing.problems.join('\n'));
  assert.equal(passing.productConformant, true);
  assert.equal(passing.a11y.scenarios, 19);
  assert.equal(passing.a11y.findings, 0);
  assert.equal(passing.counts.a11y.pass, 19);
  assert.match(markdown(passing), /\| zoom-css150 \| pass \|/);
  process.env.CORPUS_CASE = 'banner-0';
  fs.rmSync(path.join(fixture.dir, 'ux-a11y-findings.json'));
  assert.equal(fixture.read().auditComplete, true, 'filtered runs may omit a11y entirely');
  for (const value of [[], null, {}, { schemaVersion: 1, scenarios: [], findings: [] }]) {
    fixture.write(value);
    const invalid = fixture.read();
    assert.equal(invalid.auditComplete, false);
    assert.equal(invalid.productConformant, false);
    assert.match(invalid.problems.join('\n'), /UX a11y/);
  }
  fs.writeFileSync(path.join(fixture.dir, 'ux-a11y-findings.json'), '{invalid JSON');
  assert.match(fixture.read().problems.join('\n'), /UX a11y: findings file unreadable/);
});

test('matrix: observations preserve conformity, while deviations of every severity require a failing or known-gap scenario', (t) => {
  const fixture = completeReportFixture(t);
  const value = passingA11y();
  value.findings = [a11yFinding({ severity: 'high' })];
  fixture.write(value);
  assert.equal(fixture.read().productConformant, true, 'observations are not deviations');
  const scenario = value.scenarios.find((row) => row.id === 'keyboard');
  for (const severity of ['info', 'low', 'medium', 'high', 'critical']) {
    value.findings = [a11yFinding({ kind: 'deviation', severity })];
    fixture.write(value);
    const unguarded = fixture.read();
    assert.equal(unguarded.auditComplete, false);
    assert.equal(unguarded.productConformant, false);
    assert.match(unguarded.problems.join('\n'), /deviation requires a known-gap or fail scenario/);
  }
  Object.assign(scenario, {
    status: 'known-gap',
    failures: ['Escape does not close More'],
    gap: { id: 'DEF-999', matches: ['^Escape does not close More$'] },
  });
  fixture.write(value);
  const known = fixture.read();
  assert.equal(known.auditComplete, true, known.problems.join('\n'));
  assert.equal(known.productConformant, false);
  assert.equal(known.counts.a11y['known-gap'], 1);
  assert.equal(known.a11y.byKind.deviation, 1);
  assert.deepEqual(known.a11y.bySeverity, { critical: 1 });
  assert.match(markdown(known), /\| keyboard \| known-gap \| DEF-999 \|/);
  for (const status of ['fail', 'skip']) {
    scenario.status = status;
    delete scenario.gap;
    value.findings = [];
    fixture.write(value);
    const incomplete = fixture.read();
    assert.equal(incomplete.auditComplete, false);
    assert.equal(incomplete.productConformant, false);
    assert.equal(incomplete.counts.a11y[status], 1);
  }
});

test('matrix: nonapplicable core, HTTP and browser outcomes require a nonblank reason', (t) => {
  const fixture = completeReportFixture(t);
  fixture.write(passingA11y());
  for (const layer of ['core', 'http', 'browser']) {
    const file = path.join(fixture.dir, `${layer}.jsonl`);
    const original = fs.readFileSync(file, 'utf8');
    const rows = original
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    rows[0].outcome = 'not-applicable';
    for (const reason of ['  \n\t', 1, null]) {
      rows[0].reason = reason;
      fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
      const invalid = fixture.read();
      assert.equal(invalid.auditComplete, false);
      assert.match(invalid.problems.join('\n'), /nonapplicable outcome lacks reason/);
    }
    rows[0].reason = 'Raw transport JSON cannot be evaluated by this layer';
    fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    assert.equal(fixture.read().auditComplete, true);
    fs.writeFileSync(file, original);
  }
});
