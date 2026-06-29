'use strict';

/**
 * Coordinated security-cutover guard (scripts/cutover-spyglass-ro.sh).
 *
 * The wrapper applies the host SQLite permissions, then deploys the v1.1.7 app,
 * and — on any deploy failure where v1.1.7 is not active — rolls the host
 * permissions back to baseline so Grafana keeps reading and no half-secured state
 * is left behind. These tests drive the REAL wrapper through mocked
 * provision/deploy/git/docker/curl (tests/cutover-sim.sh) and assert the exit
 * codes + state transitions for every failure mode.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function runCutover(scenario) {
  try {
    const out = execFileSync('bash', [path.join(ROOT, 'tests', 'cutover-sim.sh'), scenario], {
      encoding: 'utf8',
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const CASES = [
  // provision fails → deploy never starts, perms stay baseline
  { s: 'provision-apply-fail', code: 2, status: 'ABORTED', perms: 'BASELINE', db: 644 },
  // happy path → secure perms stay, app active
  { s: 'deploy-success', code: 0, status: 'SECURITY_CUTOVER', perms: 'APPLIED', db: 640 },
  // deploy preflight/build failure → host perms rolled back to baseline
  { s: 'deploy-preflight-fail', code: 6, status: 'ROLLED_BACK', perms: 'BASELINE', db: 644 },
  // candidate failure + app auto-rollback (exit 1) → host perms baseline
  { s: 'deploy-candidate-fail', code: 1, status: 'ROLLED_BACK', perms: 'BASELINE', db: 644 },
  // deploy CRITICAL (exit 3) → controlled host rollback succeeds → baseline, code 3
  { s: 'deploy-critical', code: 3, status: 'ROLLED_BACK', perms: 'BASELINE', db: 644 },
  // host rollback ALSO fails → CRITICAL, distinct exit 9, perms left as-is
  { s: 'host-rollback-fail', code: 9, status: 'CRITICAL', perms: 'UNKNOWN', db: 640 },
  // repeated run after success → idempotent abort, state untouched
  { s: 'repeated-success', code: 2, status: 'SECURITY_CUTOVER', db: 644 },
];

for (const c of CASES) {
  test(`cutover-sim: ${c.s} → exit ${c.code}, STATUS=${c.status}, DB ${c.db}`, () => {
    const r = runCutover(c.s);
    assert.equal(r.code, c.code, r.out);
    assert.match(r.out, new RegExp(`STATUS=${c.status}\\b`), r.out);
    if (c.perms) assert.match(r.out, new RegExp(`HOST_PERMS=${c.perms}\\b`), r.out);
    assert.match(r.out, new RegExp(`DB_MODE=${c.db}\\b`), r.out);
  });
}

test('cutover wrapper: host-user (sudo -n), dry-run default, coordinated rollback, no recursion / DB copy', () => {
  const w = read('scripts/cutover-spyglass-ro.sh');
  assert.match(w, /DRY-RUN/, 'default must be a dry-run');
  assert.match(w, /--recover/, 'must offer an explicit recovery mode');
  assert.match(w, /sudo -n/, 'must escalate only via sudo -n (runs as the host user, not root)');
  assert.match(w, /run_provision apply[\s\S]*run_deploy/, 'must apply perms THEN deploy');
  assert.match(w, /run_provision rollback/, 'must roll host perms back on deploy failure');
  assert.match(w, /STATUS=SECURITY_CUTOVER/, 'must record the cutover state');
  assert.match(
    w,
    /STATUS=CRITICAL[\s\S]*return 9|return 9/,
    'a failed host rollback must be CRITICAL (exit 9)',
  );
  assert.ok(!/chgrp\s+-R|chmod\s+-R/.test(w), 'must never recurse (no chgrp -R / chmod -R)');
  assert.ok(!/\bcp\b.*spyglass\.db|\bmv\b.*spyglass\.db/.test(w), 'must never copy/replace the DB');
  assert.match(
    w,
    /write_state "\$STATE"/,
    'state must be written atomically (0600 via write_state)',
  );
});
