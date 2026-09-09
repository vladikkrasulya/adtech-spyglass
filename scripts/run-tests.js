#!/usr/bin/env node
'use strict';

/**
 * Parallel Node tests, then serial browser files with one reported retry.
 * Each invocation and attempt owns its temporary data and Chromium profiles.
 * Failed-attempt logs survive a passing retry; no result establishes its cause.
 * Usage: node scripts/run-tests.js [--coverage] [--browser-only|--unit-only]
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { cleanupBrowsers, stopOwnedGroup } = require('./test-process-lifecycle');

const ROOT = path.join(__dirname, '..');

function partitionTests(root) {
  const result = { unit: [], browser: [] };
  for (const file of fs.readdirSync(path.join(root, 'tests')).sort()) {
    if (!file.endsWith('.test.js')) continue;
    const rel = path.join('tests', file);
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    // The shared corpus driver can launch a real browser too. Those callers need
    // the same serial attempts/preflight as files loading the engine directly;
    // a browser-like filename alone also matches DOM-only tests.
    const sharedBrowser =
      /\brequire\s*\(\s*['"]\.\/corpus\/lib\/browser(?:\.js)?['"]\s*\)/.test(source) &&
      /\blaunchBrowser\s*\(/.test(source);
    result[/puppeteer/.test(source) || sharedBrowser ? 'browser' : 'unit'].push(rel);
  }
  return result;
}

function browserPrerequisite(root, env) {
  try {
    createRequire(path.join(root, 'package.json'))('puppeteer-core');
  } catch (error) {
    throw new Error('Browser tests require puppeteer-core; run npm ci.', { cause: error });
  }
  const candidates = env.CHROME_BIN
    ? [env.CHROME_BIN]
    : [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ];
  const executable = candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const result = spawnSync(candidate, ['--version'], { env, timeout: 5000, encoding: 'utf8' });
      return result.status === 0;
    } catch (_error) {
      return false;
    }
  });
  if (!executable)
    throw new Error('Browser tests require executable Chrome/Chromium; set CHROME_BIN.');
  return executable;
}

async function runAttempt({ root, runDir, files, extraArgs, env, output, signal, attempt }) {
  const directory = fs.mkdtempSync(path.join(runDir, 'attempt-'));
  const tempDir = path.join(directory, 'tmp');
  const dataDir = path.join(directory, 'data');
  fs.mkdirSync(tempDir);
  fs.mkdirSync(dataDir);
  const logs = {
    stdout: path.join(directory, 'stdout.log'),
    stderr: path.join(directory, 'stderr.log'),
  };
  const fds = { stdout: fs.openSync(logs.stdout, 'w'), stderr: fs.openSync(logs.stderr, 'w') };
  const startedAt = new Date().toISOString();
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;
  /** @type {Promise<void> | undefined} */
  let termination;
  let result;
  const abort = () => {
    if (child?.pid && !termination) termination = stopOwnedGroup(child.pid);
  };
  const childEnv = {
    ...env,
    TMPDIR: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
    ORTBTOOLS_DATA_DIR: dataDir,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    NEWS_CRAWLER_DISABLED: '1',
    FX_DISABLED: '1',
  };
  // A runner invoked by its own contract tests is still a fresh Node test host.
  delete childEnv.NODE_TEST_CONTEXT;
  try {
    result = await new Promise((resolve) => {
      child = spawn(process.execPath, ['--test', ...extraArgs, ...files], {
        cwd: root,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
      });
      for (const channel of ['stdout', 'stderr'])
        child[channel].on('data', (chunk) => {
          fs.writeSync(fds[channel], chunk);
          output[channel].write(chunk);
        });
      let spawnError;
      child.once('error', (error) => {
        spawnError = error.message;
      });
      child.once('close', (status, exitSignal) =>
        resolve({
          status: status ?? 1,
          signal: exitSignal,
          ...(spawnError ? { error: spawnError } : {}),
        }),
      );
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  } finally {
    signal?.removeEventListener('abort', abort);
    if (termination) await termination;
    else if (child?.pid) await stopOwnedGroup(child.pid);
    await cleanupBrowsers(tempDir);
    for (const fd of Object.values(fds)) fs.closeSync(fd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  return { files, attempt, startedAt, finishedAt: new Date().toISOString(), ...result, logs };
}

/**
 * Exported for isolated harness tests; the CLI always discovers this repository.
 * @param {{root?:string, files?:{unit:string[],browser:string[]}, coverage?:boolean,
 * browserOnly?:boolean, unitOnly?:boolean, env?:NodeJS.ProcessEnv,
 * output?:{stdout:{write:(chunk:any)=>any},stderr:{write:(chunk:any)=>any}},
 * signal?:AbortSignal, checkBrowser?:(root:string,env:NodeJS.ProcessEnv)=>string,
 * temporaryParent?:string}} [options]
 */
async function runSuite({
  root = ROOT,
  files = partitionTests(root),
  coverage = false,
  browserOnly = false,
  unitOnly = false,
  env = process.env,
  output = process,
  signal,
  checkBrowser = browserPrerequisite,
  temporaryParent = os.tmpdir(),
} = {}) {
  if (browserOnly && unitOnly) throw new Error('Choose --browser-only or --unit-only, not both.');
  const unit = browserOnly ? [] : files.unit;
  const browser = unitOnly ? [] : files.browser;
  const executable = browser.length ? checkBrowser(root, env) : null;
  const runDir = fs.mkdtempSync(path.join(temporaryParent, 'ortbtools-tests-'));
  const attempts = [];
  const runEnv = executable ? { ...env, CHROME_BIN: executable } : env;
  let status = 0;
  const execute = async (phaseFiles, extraArgs, attempt = 1) => {
    if (signal?.aborted) return null;
    const record = await runAttempt({
      root,
      runDir,
      files: phaseFiles,
      extraArgs,
      env: runEnv,
      output,
      signal,
      attempt,
    });
    attempts.push(record);
    return record;
  };
  try {
    if (unit.length) {
      output.stderr.write(`\n── Node tests, parallel: ${unit.length} files ──\n`);
      const record = await execute(unit, coverage ? ['--experimental-test-coverage'] : []);
      if (record?.status) status = 1;
    }
    if (browser.length && !signal?.aborted) {
      output.stderr.write(`\n── Browser tests, serial: ${browser.length} files ──\n`);
      const failed = [];
      for (const file of browser) {
        const record = await execute([file], ['--test-concurrency=1']);
        if (!record) break;
        if (record.status) failed.push(file);
      }
      for (const file of failed) {
        if (signal?.aborted) break;
        output.stderr.write(
          `\nRETRY ${file}: first attempt failed; cause unconfirmed. Original logs retained.\n`,
        );
        const record = await execute([file], ['--test-concurrency=1'], 2);
        if (record?.status) status = 1;
      }
    }
    if (signal?.aborted) status = signal.reason === 'SIGINT' ? 130 : 143;
  } catch (error) {
    status = 1;
    output.stderr.write(`Test runner failed: ${error.message}\n`);
  }
  const retained = status !== 0 || attempts.some((record) => record.status !== 0);
  const report = {
    status,
    attempts,
    interrupted: signal?.aborted || false,
    ...(retained ? { evidenceDirectory: runDir } : {}),
  };
  fs.writeFileSync(path.join(runDir, 'attempts.json'), JSON.stringify(report, null, 2) + '\n');
  if (retained) output.stderr.write(`Test attempt evidence: ${runDir}\n`);
  else fs.rmSync(runDir, { recursive: true, force: true });
  output.stderr.write(
    status
      ? '\nTEST RUN FAILED\n'
      : `\nAll passed — ${unit.length} + ${browser.length} files${retained ? ' (retry succeeded; first failure retained, cause unconfirmed)' : ''}\n`,
  );
  return report;
}

async function main() {
  const controller = new AbortController();
  const onInt = () => controller.abort('SIGINT');
  const onTerm = () => controller.abort('SIGTERM');
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  try {
    const args = process.argv.slice(2);
    const unknown = args.filter(
      (arg) => !['--coverage', '--browser-only', '--unit-only'].includes(arg),
    );
    if (unknown.length) throw new Error(`Unknown test runner option: ${unknown.join(', ')}`);
    const result = await runSuite({
      coverage: args.includes('--coverage'),
      browserOnly: args.includes('--browser-only'),
      unitOnly: args.includes('--unit-only'),
      signal: controller.signal,
    });
    process.exitCode = result.status;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
  }
}

if (require.main === module) main();
module.exports = { partitionTests, browserPrerequisite, runSuite };
