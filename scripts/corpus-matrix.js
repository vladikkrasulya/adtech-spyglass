#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadCorpus } = require('../tests/corpus/lib/load');
const { A11Y_SCENARIOS, validateA11yReport } = require('../tests/corpus/lib/a11y-contract');

const LAYERS = ['core', 'http', 'browser'];
const OUTCOMES = ['pass', 'known-gap', 'fail', 'skip', 'not-applicable', 'missing'];
const cell = (value) =>
  String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');

function buildReport(dir, run = {}, corpus = loadCorpus()) {
  const rows = [];
  const problems = [];
  for (const layer of [...LAYERS, 'ux']) {
    const file = path.join(dir, `${layer}.jsonl`);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.layer !== layer || !OUTCOMES.includes(row.outcome))
        throw new Error(`${file}: invalid result layer/outcome`);
      rows.push(row);
    }
  }
  const key = (row) => `${row.layer}:${row.id}`;
  const byKey = new Map();
  for (const row of rows) {
    if (byKey.has(key(row))) problems.push(`duplicate result ${key(row)}`);
    byKey.set(key(row), row);
    if (row.outcome === 'not-applicable' && (typeof row.reason !== 'string' || !row.reason.trim()))
      problems.push(`${key(row)}: nonapplicable outcome lacks reason`);
    if (['fail', 'skip', 'missing'].includes(row.outcome))
      problems.push(`${key(row)}: ${row.outcome}${row.reason ? ' — ' + row.reason : ''}`);
  }
  const ids = new Set(corpus.all.map((c) => c.id));
  for (const row of rows) {
    if (row.layer !== 'ux' && !ids.has(row.id)) problems.push(`unknown case ${key(row)}`);
  }
  const matrix = corpus.all.map((c) => {
    const outcomes = {};
    for (const layer of LAYERS) {
      const result = byKey.get(`${layer}:${c.id}`);
      outcomes[layer] = result ? result.outcome : 'missing';
      if (!result) problems.push(`missing result ${layer}:${c.id}`);
    }
    return {
      id: c.id,
      kind: c.kind,
      format: c.meta.format,
      protocol: c.meta.protocol,
      context: c.meta.context,
      dialect: c.meta.dialect,
      scenario: c.meta.scenario,
      tags: c.meta.tags || [],
      preview: c.meta.expect.preview
        ? {
            kind: c.meta.expect.preview.kind,
            rendered: c.meta.expect.preview.rendered,
            mediaPlays: c.meta.expect.preview.mediaPlays,
          }
        : null,
      provisional: c.meta.reference?.validity === 'documented-reference',
      category: c.meta.category || null,
      outcomes,
      gaps: [...new Set(LAYERS.map((layer) => byKey.get(`${layer}:${c.id}`)?.gap).filter(Boolean))],
    };
  });
  /** @type {Record<string, Record<string, number>>} */
  const counts = {};
  for (const layer of [...LAYERS, 'ux']) {
    counts[layer] = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]));
    for (const row of rows.filter((r) => r.layer === layer)) counts[layer][row.outcome]++;
    if (layer !== 'ux')
      counts[layer].missing = matrix.filter((r) => r.outcomes[layer] === 'missing').length;
  }
  const formatCounts = {};
  for (const format of ['banner', 'video', 'audio', 'native', 'push', 'pop', 'inpage']) {
    const cases = matrix.filter((r) => r.format === format);
    formatCounts[format] = {
      qualifiedPairs: cases.filter(
        (r) => r.kind === 'pair' && r.scenario === 'pair' && !r.provisional,
      ).length,
      provisionalPairs: cases.filter(
        (r) => r.kind === 'pair' && r.scenario === 'pair' && r.provisional,
      ).length,
      standaloneCases: cases.filter((r) => r.kind === 'pair' && r.scenario !== 'pair').length,
      mutations: cases.filter((r) => r.kind === 'mutation').length,
    };
    if (
      !process.env.CORPUS_CASE &&
      !process.env.CORPUS_FORMAT &&
      formatCounts[format].qualifiedPairs < 5
    )
      problems.push(`${format}: fewer than five qualified pairs`);
  }
  const ux = rows.filter((r) => r.layer === 'ux');
  if (ux.length !== 12) problems.push(`UX: expected 12 scenarios, recorded ${ux.length}`);
  const expectedUx = ['en', 'uk', 'ru'].flatMap((locale) =>
    ['light', 'dark'].flatMap((theme) =>
      ['desktop', 'mobile'].map((viewport) => `ux-${locale}-${theme}-${viewport}`),
    ),
  );
  for (const id of expectedUx)
    if (!ux.some((row) => row.id === id)) problems.push(`UX: missing ${id}`);
  for (const row of ux) if (!expectedUx.includes(row.id)) problems.push(`UX: unknown ${row.id}`);
  if (run.phases?.some((p) => p.status !== 0)) problems.push('one or more test phases failed');
  // The accessibility/overflow layer is a required part of the dedicated
  // audit: its findings file must exist and parse, or the audit is incomplete.
  const a11yFile = path.join(dir, 'ux-a11y-findings.json');
  const a11yRequired =
    !process.env.CORPUS_CASE && !process.env.CORPUS_FORMAT && Array.isArray(run.phases);
  let a11y = null;
  if (!fs.existsSync(a11yFile)) {
    if (a11yRequired)
      problems.push(
        'UX a11y: ux-a11y-findings.json missing — accessibility layer did not record results',
      );
  } else {
    try {
      a11y = validateA11yReport(JSON.parse(fs.readFileSync(a11yFile, 'utf8')));
      problems.push(...a11y.problems.map((problem) => `UX a11y: ${problem}`));
    } catch (err) {
      problems.push(`UX a11y: findings file unreadable — ${err.message}`);
    }
  }
  if (a11y || a11yRequired)
    counts.a11y = {
      ...Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])),
      ...a11y?.summary.byStatus,
      missing: a11y ? a11y.summary.missing : A11Y_SCENARIOS.length,
    };
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    run,
    filtered: !!(process.env.CORPUS_CASE || process.env.CORPUS_FORMAT),
    auditComplete: problems.length === 0,
    productConformant:
      problems.length === 0 &&
      rows.every((r) => ['pass', 'not-applicable'].includes(r.outcome)) &&
      (!a11y || a11y.productConformant),
    counts,
    formatCounts,
    a11y: a11y
      ? {
          ...a11y.summary,
          valid: a11y.valid,
          productConformant: a11y.productConformant,
          outcomes: a11y.scenarios.map((scenario) => ({
            id: scenario.id,
            status: scenario.status,
            gap: typeof scenario.gap?.id === 'string' ? scenario.gap.id : null,
          })),
        }
      : null,
    problems,
    matrix,
    rows,
  };
}

function markdown(report) {
  const lines = [
    '# Ad format verification matrix',
    '',
    `Generated: ${report.generatedAt}. Baseline: ${report.run.commit || 'not recorded'}.`,
    '',
    `Audit execution: **${report.auditComplete ? 'complete' : 'incomplete / failed'}**. Product conformity across asserted cases: **${report.productConformant ? 'satisfied' : 'not fully satisfied'}**.`,
    '',
    'A known gap is a reproducible unmet expectation, not a passing product check. Not-applicable and missing execution are counted separately. This is representative coverage, not all possible OpenRTB combinations.',
    '',
    '| Format | Qualified pairs | Provisional references | Standalone probes | Mutations |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  for (const [format, c] of Object.entries(report.formatCounts))
    lines.push(
      `| ${format} | ${c.qualifiedPairs} | ${c.provisionalPairs} | ${c.standaloneCases} | ${c.mutations} |`,
    );
  lines.push(
    '',
    '| Layer | Pass | Known gap | Fail | Skip | Not applicable | Missing |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const [layer, c] of Object.entries(report.counts))
    lines.push(`| ${layer} | ${OUTCOMES.map((o) => c[o]).join(' | ')} |`);
  lines.push(
    '',
    '| Case | Format / context | Protocol / dialect | Scenario | Preview expectation | Core | HTTP | Browser | Gap |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const r of report.matrix)
    lines.push(
      `| ${cell(r.id)} | ${r.format} / ${r.context} | ${r.protocol} / ${r.dialect} | ${r.scenario} | ${r.preview ? [r.preview.kind, r.preview.rendered, `play:${r.preview.mediaPlays}`].filter(Boolean).join(' / ') : 'n/a'} | ${LAYERS.map((l) => r.outcomes[l]).join(' | ')} | ${r.gaps.join(', ')} |`,
    );
  lines.push('', '| UX scenario | Outcome | Gap |', '| --- | --- | --- |');
  for (const r of report.rows.filter((r) => r.layer === 'ux'))
    lines.push(`| ${cell(r.id)} | ${r.outcome} | ${r.gap || ''} |`);
  if (report.a11y) {
    lines.push(
      '',
      '## Accessibility, overflow and state layer',
      '',
      `Scenarios recorded: ${report.a11y.scenarios}. Findings: ${report.a11y.findings} (${
        Object.entries(report.a11y.bySeverity)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ') || 'none'
      }). Details: ux-a11y-findings.json in the report directory.`,
      '',
      `Observations: ${report.a11y.byKind.observation}. Deviations: ${report.a11y.byKind.deviation}. Observations do not certify that an unasserted behavior meets its expectation.`,
      '',
      '| Accessibility scenario | Outcome | Gap |',
      '| --- | --- | --- |',
    );
    for (const scenario of report.a11y.outcomes)
      lines.push(`| ${cell(scenario.id)} | ${scenario.status} | ${cell(scenario.gap)} |`);
  }
  if (report.problems.length)
    lines.push('', '## Execution problems', '', ...report.problems.map((p) => `- ${cell(p)}`));
  lines.push(
    '',
    '## Remaining coverage boundaries',
    '',
    '- Finite source examples and mutations do not exhaust arbitrary vendor extensions or the format × version × context cross-product.',
    '- VAST preview is inert by contract; external wrappers, live ad serving, trackers, click destinations and real media playback are not certified.',
    '- Chromium automation does not replace manual accessibility, screen-reader, Safari/Firefox or real mobile-device review.',
    '- Provisional vendor references are retained for investigation and excluded from minimum qualified-pair counts.',
    '- See verification.md, defects.md and cleanup-backlog.md for interpretations and follow-up work.',
    '',
  );
  return lines.join('\n');
}

function writeReport(dir, run) {
  const report = buildReport(dir, run);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'coverage-matrix.md'), markdown(report));
  // Pairwise axis view with applicability marks (covered / unverified /
  // unsupported by contract / not applicable), derived from case metadata.
  const axes = require('./corpus-axes');
  fs.writeFileSync(
    path.join(dir, 'coverage-axes.md'),
    axes.markdown(axes.buildAxes(loadCorpus().all, report.rows)),
  );
  return report;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: node scripts/corpus-matrix.js REPORT_DIR');
  const runFile = path.join(dir, 'run.json');
  const report = writeReport(
    dir,
    fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : {},
  );
  console.log(
    JSON.stringify(
      {
        directory: dir,
        complete: report.auditComplete,
        counts: report.counts,
        problems: report.problems,
      },
      null,
      2,
    ),
  );
  process.exitCode = report.auditComplete ? 0 : 1;
}

module.exports = { buildReport, markdown, writeReport };
