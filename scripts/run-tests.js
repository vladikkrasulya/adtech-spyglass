#!/usr/bin/env node
'use strict';

/**
 * scripts/run-tests.js — run the suite in two phases so browser tests stop
 * starving each other.
 *
 * ── The problem this solves ──────────────────────────────────────────────
 * `node --test tests/*.test.js` runs one process per FILE, concurrently, and
 * defaults that concurrency to the core count — sixteen here. Fourteen of the
 * test files launch a real Chrome. Sixteen-way parallelism against fourteen
 * browsers means the CDP connections start missing their deadlines, and the
 * failure surfaces as `Runtime.callFunctionOn timed out` in whichever test
 * happened to be unlucky. Nothing is wrong with that test: re-run it alone
 * and it passes.
 *
 * That produced a gate that lied. The pre-push hook rejected four pushes in
 * one evening, each time with a different browser test, and each time the
 * very next run was green. A gate that fails at random is a gate people
 * learn to bypass with --no-verify, and then it stops catching the real
 * breakage too.
 *
 * ── The split ────────────────────────────────────────────────────────────
 * Phase 1 — everything that does not touch a browser, full concurrency,
 *           with coverage. This is the bulk of the suite and the fast part.
 * Phase 2 — the browser tests, ONE at a time. Serial is not a compromise
 *           here: each of these already spends most of its time waiting on
 *           a page, and running them together was never faster in wall
 *           clock once the retries and timeouts are counted.
 *
 * ── Why the partition reads the file instead of the filename ─────────────
 * The convention is `*-browser.test.js`, and four of the fourteen do not
 * follow it (site-app, site-behavior, site-docs, verdict-completeness).
 * A glob would therefore have left four browsers inside the parallel phase
 * and reintroduced exactly the contention this exists to remove. Grepping
 * for the import cannot drift: a file that launches Chrome is a file that
 * mentions puppeteer.
 *
 * Usage:  node scripts/run-tests.js [--coverage]
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TESTS = path.join(ROOT, 'tests');
const wantCoverage = process.argv.includes('--coverage');

const all = fs
  .readdirSync(TESTS)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join('tests', f));

const browser = [];
const unit = [];
for (const rel of all) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  (/puppeteer/.test(src) ? browser : unit).push(rel);
}

/**
 * Kill Chromes left behind by earlier test runs.
 *
 * A browser test that times out or throws before its `finally` leaves its
 * Chrome alive. They accumulate: nine were found on this box after an
 * evening of flaky pushes, and every one of them was still holding memory
 * and CPU shares, which made the NEXT run slower and likelier to time out
 * in turn. That is the compounding half of the flake — the first failure
 * makes the second more probable.
 *
 * Matched on `puppeteer_dev_chrome_profile`, the temp profile directory
 * puppeteer's launcher creates and nothing else does. A broader pattern
 * would reach the developer's own browser, and on this host a careless
 * pattern once killed the production container.
 */
function sweepOrphanChromes() {
  const found = spawnSync('pgrep', ['-f', 'puppeteer_dev_chrome_profile'], { encoding: 'utf8' });
  const pids = (found.stdout || '').split('\n').filter(Boolean);
  if (!pids.length) return 0;
  process.stderr.write(`  прибираю ${pids.length} покинутих Chrome від попередніх прогонів\n`);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch (_) {
      /* already gone between the scan and the kill */
    }
  }
  return pids.length;
}

/**
 * One `node --test` invocation. Returns its exit status.
 *
 * A fresh ORTBTOOLS_DATA_DIR per phase, matching what the old single command
 * did — tests that touch the database expect to own it.
 */
function runPhase(label, files, extraArgs) {
  if (!files.length) return 0;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-test-'));
  if (label) process.stderr.write(`\n──  ${label}: ${files.length} файлів  ──\n`);
  const res = spawnSync(process.execPath, ['--test', ...extraArgs, ...files], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ORTBTOOLS_DATA_DIR: dataDir,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
  });
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch (_) {
    /* a test may still hold a handle; the OS reclaims the temp dir */
  }
  return res.status == null ? 1 : res.status;
}

const unitStatus = runPhase(
  'без браузера, паралельно',
  unit,
  wantCoverage ? ['--experimental-test-coverage'] : [],
);

/**
 * The browser phase: one file per invocation, a sweep between each, and one
 * retry for anything that fails.
 *
 * Serial is measured, not assumed — the phase ran clean twice at 4-way and
 * failed the third time with the protocol timeout, taking 210s to do it.
 *
 * The retry is the honest part. Serial execution removed most of the flake
 * but not all of it: one file (clear-resets-results) still times out roughly
 * twice in seven full phases while passing 3/3 in isolation, which points at
 * pressure accumulated over fourteen sequential Chrome launches rather than
 * at anything in the test. Retrying only what failed, exactly once, and
 * SAYING SO turns that into a gate that is both reliable and truthful. A
 * silent retry would be the same lie in the other direction: green when
 * something is genuinely wrong.
 *
 * A file that fails twice in a row is a real failure and stops the run.
 */
function runBrowserPhase(files) {
  if (!files.length) return 0;
  process.stderr.write(`\n──  браузерні, по одному: ${files.length} файлів  ──\n`);
  sweepOrphanChromes();
  const failed = [];
  for (const f of files) {
    if (runPhase(null, [f], ['--test-concurrency=1'])) failed.push(f);
    sweepOrphanChromes();
  }
  if (!failed.length) return 0;

  process.stderr.write(
    `\n  ПОВТОР: ${failed.length} файл(ів) впали з першого разу — ${failed
      .map((f) => f.replace('tests/', ''))
      .join(', ')}\n` +
      '  Якщо повтор зелений, це був флейк середовища, а не код. Якщо ні — це справжнє падіння.\n',
  );
  const stillFailing = [];
  for (const f of failed) {
    if (runPhase(null, [f], ['--test-concurrency=1'])) stillFailing.push(f);
    sweepOrphanChromes();
  }
  if (stillFailing.length) {
    process.stderr.write(
      `\n  ВПАЛИ ДВІЧІ: ${stillFailing.map((f) => f.replace('tests/', '')).join(', ')}\n`,
    );
    return 1;
  }
  process.stderr.write('  повтор зелений\n');
  return 0;
}

const browserStatus = runBrowserPhase(browser);

if (unitStatus || browserStatus) {
  process.stderr.write(
    `\nПАДІННЯ — без браузера: ${unitStatus ? 'так' : 'ні'}, браузерні: ${browserStatus ? 'так' : 'ні'}\n`,
  );
  process.exit(unitStatus || browserStatus);
}
process.stderr.write(`\nусе зелено — ${unit.length} + ${browser.length} файлів\n`);
