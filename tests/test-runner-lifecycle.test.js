'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const {
  PROFILE_PREFIX,
  ownedBrowsers,
  cleanupBrowsers,
  stopOwnedGroup,
} = require('../scripts/test-process-lifecycle');
const { partitionTests, browserPrerequisite, runSuite } = require('../scripts/run-tests');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-contract-'));
  fs.mkdirSync(path.join(root, 'tests'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function capture() {
  const chunks = [];
  const sink = {
    write: (chunk) => {
      chunks.push(String(chunk));
      return true;
    },
  };
  return { output: { stdout: sink, stderr: sink }, text: () => chunks.join('') };
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function until(predicate) {
  const end = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Fixture did not reach its expected state');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('owned cleanup matches exact private profiles, complete arguments and group leaders', (t) => {
  const root = fixture(t);
  const profile = fs.mkdtempSync(path.join(root, PROFILE_PREFIX));
  const stamp = 'Wed Sep 9 12:30:00 2026';
  const line = (pid, group, value) => `${pid} ${group} ${stamp} browser --user-data-dir=${value}`;
  const result = ownedBrowsers(
    [
      line(80001, 80001, profile),
      line(80002, 80002, profile + '-other'),
      line(80003, 80001, profile),
      line(80004, 80004, path.join(root + '-peer', PROFILE_PREFIX + 'x')),
      line(80005, 80005, path.join(root, PROFILE_PREFIX + 'absent')),
    ].join('\n'),
    root,
  );
  assert.deepEqual(
    result.map((entry) => entry.pid),
    [80001],
  );
});

test(
  'two concurrent detached browser groups and an unrelated profile cannot clean one another',
  { skip: process.platform === 'win32', timeout: 15000 },
  async (t) => {
    const root = fixture(t);
    const script = path.join(root, 'browser.cjs');
    fs.writeFileSync(
      script,
      "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000);\n",
    );
    const groups = [];
    for (const name of ['first', 'second', 'unrelated']) {
      const temp = path.join(root, name);
      fs.mkdirSync(temp);
      const profile = fs.mkdtempSync(path.join(temp, PROFILE_PREFIX));
      const child = spawn(process.execPath, [script, `--user-data-dir=${profile}`], {
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      t.after(() => stopOwnedGroup(child.pid, 20));
      await once(child.stdout, 'data');
      groups.push({ temp, child });
    }
    assert.equal(await cleanupBrowsers(groups[0].temp, 30), 1);
    await until(() => !alive(groups[0].child.pid));
    assert.ok(alive(groups[1].child.pid));
    assert.ok(alive(groups[2].child.pid));
    assert.equal(await cleanupBrowsers(groups[1].temp, 30), 1);
    await until(() => !alive(groups[1].child.pid));
    assert.ok(alive(groups[2].child.pid));
  },
);

function attemptFixture(root, behavior) {
  const file = 'tests/attempt.test.js';
  const record = path.join(root, 'observed.json');
  const browserScript = path.join(root, 'browser.cjs');
  fs.writeFileSync(browserScript, 'setInterval(() => {}, 1000);\n');
  fs.writeFileSync(
    path.join(root, file),
    `
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
test('controlled attempt', async () => {
  const records = fs.existsSync(${JSON.stringify(record)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(record)}, 'utf8')) : [];
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), ${JSON.stringify(PROFILE_PREFIX)}));
  const browser = spawn(process.execPath, [${JSON.stringify(browserScript)}, '--user-data-dir=' + profile], { detached: true, stdio: 'ignore' });
  browser.unref();
  records.push({ pid: browser.pid, temp: os.tmpdir(), data: process.env.ORTBTOOLS_DATA_DIR });
  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(records));
  console.error('attempt-diagnostic-' + records.length);
  ${behavior}
});
`,
  );
  return { file, record };
}

test(
  'passing retry retains the original failure, logs and isolated data while cleaning both browser groups',
  { skip: process.platform === 'win32', timeout: 15000 },
  async (t) => {
    const root = fixture(t);
    const f = attemptFixture(root, "assert.ok(records.length > 1, 'first-attempt-proof');");
    const log = capture();
    const report = await runSuite({
      root,
      files: { unit: [], browser: [f.file] },
      checkBrowser: () => process.execPath,
      temporaryParent: root,
      output: log.output,
    });
    assert.equal(report.status, 0);
    assert.deepEqual(
      report.attempts.map((attempt) => [attempt.attempt, attempt.status]),
      [
        [1, 1],
        [2, 0],
      ],
    );
    assert.match(fs.readFileSync(report.attempts[0].logs.stdout, 'utf8'), /first-attempt-proof/);
    assert.match(
      fs.readFileSync(report.attempts[0].logs.stderr, 'utf8') +
        fs.readFileSync(report.attempts[0].logs.stdout, 'utf8'),
      /attempt-diagnostic-1/,
    );
    assert.match(log.text(), /cause unconfirmed/);
    assert.doesNotMatch(log.text(), /environment.*flake|флейк середовища/);
    const persisted = JSON.parse(
      fs.readFileSync(path.join(report.evidenceDirectory, 'attempts.json'), 'utf8'),
    );
    assert.deepEqual(
      persisted.attempts.map((attempt) => attempt.status),
      [1, 0],
    );
    const observed = JSON.parse(fs.readFileSync(f.record, 'utf8'));
    assert.notEqual(observed[0].temp, observed[1].temp);
    assert.notEqual(observed[0].data, observed[1].data);
    for (const item of observed) {
      await until(() => !alive(item.pid));
      assert.equal(fs.existsSync(item.temp), false);
      assert.equal(fs.existsSync(item.data), false);
    }
  },
);

test(
  'a repeated browser failure is nonzero and keeps both attempts',
  { skip: process.platform === 'win32', timeout: 15000 },
  async (t) => {
    const root = fixture(t);
    const f = attemptFixture(root, "assert.fail('persistent-proof');");
    const log = capture();
    const report = await runSuite({
      root,
      files: { unit: [], browser: [f.file] },
      checkBrowser: () => process.execPath,
      temporaryParent: root,
      output: log.output,
    });
    assert.equal(report.status, 1);
    assert.deepEqual(
      report.attempts.map((attempt) => attempt.status),
      [1, 1],
    );
    assert.match(log.text(), /TEST RUN FAILED/);
  },
);

test(
  'concurrent runner invocations keep the other active attempt alive',
  { skip: process.platform === 'win32', timeout: 15000 },
  async (t) => {
    const first = fixture(t);
    const second = fixture(t);
    const a = attemptFixture(first, '');
    const b = attemptFixture(
      second,
      'await new Promise(resolve => setTimeout(resolve, 1500)); assert.doesNotThrow(() => process.kill(browser.pid, 0));',
    );
    const run = (root, file) =>
      runSuite({
        root,
        files: { unit: [], browser: [file] },
        checkBrowser: () => process.execPath,
        temporaryParent: root,
        output: capture().output,
      });
    const pendingA = run(first, a.file);
    const pendingB = run(second, b.file);
    await until(() => fs.existsSync(b.record));
    const secondPid = JSON.parse(fs.readFileSync(b.record, 'utf8'))[0].pid;
    const reportA = await pendingA;
    assert.equal(reportA.status, 0);
    assert.ok(alive(secondPid), 'finishing the first run must not terminate the active second run');
    const reportB = await pendingB;
    assert.equal(reportB.status, 0);
    assert.equal(reportB.attempts.length, 1, 'the peer did not need a retry');
    await until(() => !alive(secondPid));
  },
);

test(
  'interruption cleans the active Node group and its detached browser without retrying',
  { skip: process.platform === 'win32', timeout: 15000 },
  async (t) => {
    const root = fixture(t);
    const f = attemptFixture(root, 'await new Promise(() => { setInterval(() => {}, 1000); });');
    const controller = new AbortController();
    const log = capture();
    const pending = runSuite({
      root,
      files: { unit: [], browser: [f.file] },
      checkBrowser: () => process.execPath,
      temporaryParent: root,
      output: log.output,
      signal: controller.signal,
    });
    await until(() => fs.existsSync(f.record));
    const observed = JSON.parse(fs.readFileSync(f.record, 'utf8'));
    controller.abort('SIGTERM');
    const report = await pending;
    assert.equal(report.status, 143);
    assert.equal(report.interrupted, true);
    assert.equal(report.attempts.length, 1);
    await until(() => !alive(observed[0].pid));
    assert.equal(fs.existsSync(observed[0].temp), false);
    assert.doesNotMatch(log.text(), /RETRY/);
  },
);

test('missing browser prerequisites fail before test execution; unit-only does not need a browser', async (t) => {
  const root = fixture(t);
  const file = 'tests/unit.test.js';
  fs.writeFileSync(path.join(root, file), "require('node:test')('unit control', () => {});\n");
  assert.throws(
    () =>
      browserPrerequisite(path.join(__dirname, '..'), {
        ...process.env,
        CHROME_BIN: path.join(root, 'missing-browser'),
      }),
    /set CHROME_BIN/,
  );
  assert.throws(() => browserPrerequisite(root, process.env), /run npm ci/);
  const log = capture();
  const checkBrowser = () => {
    throw new Error('explicit missing prerequisite');
  };
  await assert.rejects(
    runSuite({
      root,
      files: { unit: [file], browser: [file] },
      checkBrowser,
      temporaryParent: root,
      output: log.output,
    }),
    /explicit missing prerequisite/,
  );
  assert.equal(log.text(), '');
  const report = await runSuite({
    root,
    files: { unit: [file], browser: [file] },
    unitOnly: true,
    checkBrowser,
    temporaryParent: root,
    output: log.output,
  });
  assert.equal(report.status, 0);
  assert.equal(report.attempts.length, 1);
  assert.equal(report.evidenceDirectory, undefined);
});

test('test partition keeps unconventional browser filenames in the serial phase', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'tests/plain.test.js'), 'const x = 1;');
  fs.writeFileSync(path.join(root, 'tests/site.test.js'), `require('${'pupp' + 'eteer'}-core');`);
  assert.deepEqual(partitionTests(root), {
    unit: ['tests/plain.test.js'],
    browser: ['tests/site.test.js'],
  });
});

test('runner preserves analytics opt-out while allowing explicitly configured synthetic collectors', async (t) => {
  const root = fixture(t);
  const file = 'tests/collector.test.js';
  fs.writeFileSync(
    path.join(root, file),
    `
const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.CLICKHOUSE_URL = 'http://collector.invalid:8123';
process.env.CLICKHOUSE_USER = 'runner-synthetic';
process.env.CLICKHOUSE_PASSWORD = 'synthetic';
const requests = [];
global.fetch = async (url, options) => {
  requests.push({ url, body: options.body });
  return { ok: true, status: 200, text: async () => '' };
};
const eventLog = require(${JSON.stringify(require.resolve('../lib/event-log'))});
test('synthetic collector respects the caller analytics configuration', async () => {
  eventLog.record({ level: 'info', component: 'http', msg: 'synthetic runner event' });
  eventLog.flushNow();
  await new Promise(resolve => setImmediate(resolve));
  const disabled = process.env.RUNNER_EXPECT_COLLECTOR_DISABLED === '1';
  assert.equal(process.env.ORTBTOOLS_ANALYTICS_DISABLED === '1', disabled);
  assert.equal(requests.length, disabled ? 0 : 1);
  if (!disabled) {
    assert.equal(new URL(requests[0].url).hostname, 'collector.invalid');
    assert.equal(JSON.parse(requests[0].body.trim()).msg, 'synthetic runner event');
  }
});
`,
  );
  for (const analyticsDisabled of [undefined, '0', '1']) {
    const env = { ...process.env };
    if (analyticsDisabled === undefined) delete env.ORTBTOOLS_ANALYTICS_DISABLED;
    else env.ORTBTOOLS_ANALYTICS_DISABLED = analyticsDisabled;
    env.RUNNER_EXPECT_COLLECTOR_DISABLED = analyticsDisabled === '1' ? '1' : '0';
    const log = capture();
    const report = await runSuite({
      root,
      files: { unit: [file], browser: [] },
      temporaryParent: root,
      env,
      output: log.output,
    });
    assert.equal(report.status, 0, log.text());
    assert.equal(report.attempts.length, 1);
  }
});
