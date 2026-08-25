'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

// Deliberately explicit: closed feature packages and dated records preserve the
// authorization that applied at the time and must not be scanned as current policy.
const CURRENT_POLICY_FILES = [
  '.specify/memory/constitution.md',
  'specs/decisions/ADR-013-standing-release-authorization.md',
  'specs/decisions/ADR-010-supported-agents-safe-automation.md',
  'specs/DECISIONS.md',
  'specs/README.md',
  'specs/ROADMAP.md',
  'CONTRIBUTING.md',
  'specs/000-platform-baseline/contracts/release-deploy.md',
  'specs/000-platform-baseline/contracts/locales-versioning.md',
  'specs/001-spec-kit-foundation/contracts/agent-integration.md',
  'docs/OPERATIONS.md',
  '.githooks/pre-push',
];

const current = Object.fromEntries(
  CURRENT_POLICY_FILES.map((relativePath) => [relativePath, read(relativePath)]),
);

test('canonical governance defines the complete action-specific standing authorization', () => {
  const constitution = current['.specify/memory/constitution.md'];
  const decision = current['specs/decisions/ADR-013-standing-release-authorization.md'];

  assert.match(constitution, /\*\*Version\*\*: 2\.1\.0\b/);
  assert.match(constitution, /Version change: 2\.0\.0 -> 2\.1\.0/);
  assert.match(constitution, /MINOR because[\s\S]{0,220}standing authorization/i);
  assert.match(decision, /Status\*\*: Accepted; expanded by constitution 2\.1\.0/);
  for (const [owner, text] of [
    ['constitution', constitution],
    ['ADR-013', decision],
  ]) {
    assert.match(
      text,
      /stage only authored, in-scope changes[\s\S]{0,140}then commit/i,
      `${owner}: scoped commit`,
    );
    assert.match(text, /non-force push[\s\S]{0,100}`main`/i, `${owner}: bounded main push`);
    assert.match(text, /scripts\/backup-db\.sh/i, `${owner}: mandatory backup`);
    assert.match(text, /scripts\/deploy\.sh/i, `${owner}: canonical deploy`);
    assert.match(text, /scripts\/rollback\.sh/i, `${owner}: canonical rollback`);
    assert.match(
      text,
      /mechanism(?: availability|s)?[\s\S]{0,140}(?:(?:do|does)\s+not|never) expand authorization/i,
      `${owner}: mechanism availability boundary`,
    );
    assert.match(
      text,
      /direct access to `\/data` outside the[\s\S]{0,40}documented[\s\S]{0,100}flows/i,
      `${owner}: direct data access remains explicit`,
    );
    assert.match(text, /npm publication/i, `${owner}: npm publication remains explicit`);
    assert.match(text, /data migration or restore/i, `${owner}: restore remains explicit`);
    assert.match(
      text,
      /destructive data\s+actions/i,
      `${owner}: destructive actions remain explicit`,
    );
  }
});

test('allowlisted current contracts contain no superseded uniform-authorization claims', () => {
  const forbiddenByFile = {
    'CONTRIBUTING.md': [
      /Commits, pushes, pull requests, releases, and deployments always require/i,
      /Deployment is a separate, explicitly authorized operation/i,
    ],
    'specs/000-platform-baseline/contracts/release-deploy.md': [
      /Each external mutation requires separate authorization/i,
      /Running it is therefore an explicitly authorized production operation/i,
      /Production deploy or npm publication remains a separate decision/i,
    ],
    'specs/000-platform-baseline/contracts/locales-versioning.md': [
      /Those remain separately authorized actions/i,
    ],
    'specs/001-spec-kit-foundation/contracts/agent-integration.md': [
      /Review, commit, push, publish, or deploy only with separate authorization/i,
    ],
    'specs/ROADMAP.md': [
      /Future releases require their own authorization/i,
      /Gates, then a separately authorized deployment/i,
      /Green hosted CI[^\n]+separately authorized[^\n]+deployment/i,
      /Land the branch on `main`/i,
      /real Sentry delivery verification remains separately authorized/i,
      /human authorization gates; prohibit unattended Git or production mutation/i,
    ],
  };

  for (const [relativePath, patterns] of Object.entries(forbiddenByFile)) {
    for (const pattern of patterns) {
      assert.doesNotMatch(current[relativePath], pattern, `${relativePath}: ${pattern}`);
    }
  }

  assert.match(
    current['specs/decisions/ADR-010-supported-agents-safe-automation.md'],
    /ADR-013 supersedes that clause/i,
  );
  assert.match(current['specs/DECISIONS.md'], /ADR-010[^\n]+Accepted; amended by ADR-013/);

  const roadmap = current['specs/ROADMAP.md'];
  assert.match(roadmap, /Future releases follow the standing path/i);
  assert.match(
    roadmap,
    /Inspector defect repair[^\n]+Complete; merged at `1c60c75` \(implementation `936cc6e`\)[^\n]+live `1\.15\.0`[^\n]+`1b41d5b`/i,
  );
  assert.match(
    roadmap,
    /Button confirmation fit[^\n]+Complete; merged at `9fdabf2` \(implementation `08e1b97`\)[^\n]+live `1\.15\.0`[^\n]+`1b41d5b`/i,
  );
});

test('operator guidance keeps backup separate from deploy without requiring another approval', () => {
  const release = current['specs/000-platform-baseline/contracts/release-deploy.md'];
  const operations = current['docs/OPERATIONS.md'];
  const hook = current['.githooks/pre-push'];

  assert.match(
    release,
    /Backup readiness is a separate operator gate and is not created or validated by `deploy\.sh`/i,
  );
  assert.match(
    release,
    /separate gate is included in the standing deployment[\s\S]{0,80}does not require another approval/i,
  );
  assert.match(
    operations,
    /separate operator\s+gate[\s\S]{0,120}standing deployment authorization[\s\S]{0,80}does\s+not require another approval/i,
  );
  assert.doesNotMatch(hook, /--no-verify/);
  assert.doesNotMatch(hook, /same (?:checks )?(?:as )?GitHub CI/i);
  assert.match(hook, /hosted CI[\s\S]{0,100}package and Docker smoke/i);
});

test('pre-push gates the remote main destination regardless of the local ref', (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-pre-push-'));
  const binDir = path.join(sandbox, 'bin');
  const callsPath = path.join(sandbox, 'npm-calls');
  fs.mkdirSync(binDir);
  fs.writeFileSync(
    path.join(binDir, 'npm'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PRE_PUSH_CALLS"\n',
    { mode: 0o755 },
  );
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const runHook = (input) => {
    const result = spawnSync(path.join(ROOT, '.githooks/pre-push'), ['origin', 'unused'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH || ''}`,
        PRE_PUSH_CALLS: callsPath,
      },
      input,
    });
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  const calls = () =>
    fs.existsSync(callsPath)
      ? fs.readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean)
      : [];

  const nonMain = runHook('refs/heads/main local refs/heads/review remote\n');
  assert.match(nonMain.stdout, /no update to refs\/heads\/main/i);
  assert.deepEqual(calls(), []);

  runHook('refs/heads/feature local refs/heads/main remote\n');
  assert.deepEqual(calls(), ['run ci']);

  runHook('HEAD local refs/heads/main remote\n');
  assert.deepEqual(calls(), ['run ci', 'run ci']);
});
