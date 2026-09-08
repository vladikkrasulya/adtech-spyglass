#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeReport } = require('./corpus-matrix');

const root = path.join(__dirname, '..');
// Every invocation owns a fresh directory. No stale rows or automatic retries.
const parent = process.env.CORPUS_REPORT_DIR || os.tmpdir();
fs.mkdirSync(parent, { recursive: true });
const dir = fs.mkdtempSync(path.join(parent, 'ortbtools-audit-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-audit-data-'));
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const run = {
  startedAt: new Date().toISOString(),
  commit: git.stdout?.trim(),
  node: process.version,
  phases: [],
};
console.log(`Corpus report: ${dir}`);
try {
  for (const file of [
    'tests/corpus-lib.test.js',
    'tests/corpus-report.test.js',
    'tests/corpus-axes.test.js',
    'tests/corpus-fixture-contract.test.js',
    'tests/corpus-core.test.js',
    'tests/corpus-http.test.js',
    'tests/corpus-browser.test.js',
    'tests/corpus-ux-browser.test.js',
    'tests/corpus-ux-a11y-browser.test.js',
  ]) {
    const started = Date.now();
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', file], {
      cwd: root,
      stdio: 'inherit',
      timeout: 30 * 60 * 1000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        ORTBTOOLS_DATA_DIR: dataDir,
        ORTBTOOLS_ANALYTICS_DISABLED: '1',
        NEWS_CRAWLER_DISABLED: '1',
        FX_DISABLED: '1',
        CORPUS_REPORT_DIR: dir,
        CORPUS_REQUIRE_BROWSER: '1',
      },
    });
    run.phases.push({
      file,
      status: result.status ?? 1,
      signal: result.signal || null,
      durationMs: Date.now() - started,
      error: result.error?.message,
    });
  }
  run.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run, null, 2) + '\n');
  const report = writeReport(dir, run);
  console.log(
    `Corpus report: ${dir}\n${JSON.stringify({ complete: report.auditComplete, productConformant: report.productConformant, counts: report.counts, problems: report.problems }, null, 2)}`,
  );
  process.exitCode = report.auditComplete ? 0 : 1;
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
