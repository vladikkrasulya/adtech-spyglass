'use strict';

/**
 * Coordinated security-cutover guard (scripts/cutover-spyglass-ro.sh).
 *
 * The wrapper applies the host SQLite permissions, then deploys the v1.1.7 app,
 * and verifies the FULL secure contract before declaring success. On a deploy
 * failure where the target isn't active it rolls the host permissions back to
 * baseline; if the target IS active but verification fails it records DEGRADED
 * (perms kept); any unconfirmed rollback/baseline is CRITICAL. Every state write
 * is a full snapshot. These tests drive the REAL wrapper through mocked
 * provision/deploy/git/docker/curl/setpriv (tests/cutover-sim.sh).
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
  { s: 'provision-apply-fail', code: 2, status: 'ABORTED', perms: 'BASELINE', db: 644 },
  { s: 'provision-fail-rollback-fail', code: 9, status: 'CRITICAL', perms: 'UNKNOWN' },
  { s: 'deploy-success', code: 0, status: 'SECURITY_CUTOVER', perms: 'APPLIED', db: 640 },
  { s: 'deploy-preflight-fail', code: 6, status: 'ROLLED_BACK', perms: 'BASELINE', db: 644 },
  { s: 'deploy-candidate-fail', code: 1, status: 'ROLLED_BACK', perms: 'BASELINE', db: 644 },
  { s: 'deploy-critical', code: 3, status: 'ROLLED_BACK', perms: 'BASELINE', db: 644 },
  { s: 'host-rollback-fail', code: 9, status: 'CRITICAL', perms: 'UNKNOWN' },
  { s: 'repeated-success', code: 2, status: 'SECURITY_CUTOVER' },
  { s: 'partial-perms', code: 8, status: 'DEGRADED', perms: 'PARTIAL', err: 'db-contract' },
  { s: 'wrong-umask', code: 8, status: 'DEGRADED', perms: 'APPLIED', err: 'umask' },
  {
    s: 'grafana-read-fail',
    code: 8,
    status: 'DEGRADED',
    perms: 'APPLIED',
    err: 'grafana-cannot-read',
  },
  { s: 'incomplete-baseline', code: 9, status: 'CRITICAL', perms: 'UNKNOWN' },
  { s: 'interrupted-applying', code: 2, status: 'APPLYING' },
  { s: 'recovery-gate-fail', code: 2, noState: true },
  { s: 'deploy-nonzero-target-active', code: 1, status: 'DEGRADED', perms: 'APPLIED' },
  // deploy reports 0 but the target build is NOT active → rolled back, never success
  { s: 'deploy-zero-not-active', code: 8, status: 'ROLLED_BACK', perms: 'BASELINE', db: 644 },
];

for (const c of CASES) {
  test(`cutover-sim: ${c.s} → exit ${c.code} / ${c.status || 'no-state'}`, () => {
    const r = runCutover(c.s);
    assert.equal(r.code, c.code, r.out);
    if (c.noState) assert.match(r.out, /\(no state\)/, r.out);
    if (c.status) assert.match(r.out, new RegExp(`STATUS=${c.status}\\b`), r.out);
    if (c.perms) assert.match(r.out, new RegExp(`HOST_PERMS=${c.perms}\\b`), r.out);
    if (c.err) assert.match(r.out, new RegExp(`LAST_ERROR=.*${c.err}`), r.out);
    if (c.db) assert.match(r.out, new RegExp(`DB_MODE=${c.db}\\b`), r.out);
  });
}

test('cutover state is a FULL snapshot (all 10 fields written every time)', () => {
  const r = runCutover('deploy-success');
  assert.match(r.out, /STATE_FIELDS=10\b/, `expected a 10-field snapshot, got: ${r.out}`);
  for (const f of [
    'STATUS',
    'TARGET',
    'HOST_PERMS',
    'APP_DEPLOY',
    'ACTIVE_BUILD_SHA',
    'PREV_BUILD_SHA',
    'DEPLOY_RC',
    'LAST_ERROR',
  ]) {
    assert.match(r.out, new RegExp(`^${f}=`, 'm'), `snapshot must contain ${f}`);
  }
});

test('cutover wrapper: precise secure/baseline checks, full verify, fail-closed recover, no recursion / DB copy', () => {
  const w = read('scripts/cutover-spyglass-ro.sh');
  assert.match(w, /is_secure_state\(\)/, 'must define a precise secure-state check');
  assert.match(w, /is_baseline_state\(\)/, 'must define a precise baseline-state check');
  // both predicates check the dir AND the DB/WAL/SHM trio
  for (const pred of ['is_secure_state', 'is_baseline_state']) {
    const body = w.slice(w.indexOf(`${pred}()`), w.indexOf(`${pred}()`) + 260);
    assert.match(
      body,
      /DB_FILES/,
      `${pred} must iterate the DB/WAL/SHM trio, not just the main DB`,
    );
  }
  assert.match(w, /verify_secure\(\)/, 'success must require full verification');
  assert.match(w, /pid1_umask_ok|Umask/, 'must verify PID1 umask 0027');
  assert.match(w, /stranger_reads/, 'must verify a stranger UID is denied');
  assert.match(
    w,
    /STATUS=DEGRADED/,
    'target-active-but-unverified must be DEGRADED (not ROLLED_BACK)',
  );
  assert.match(w, /snapshot\b/, 'state writes must go through the full-snapshot helper');
  // --recover must NOT bypass the minimum gates (no `gate || true`)
  assert.ok(!/gate \|\| true/.test(w), '--recover must keep the minimum gates fail-closed');
  assert.ok(!/chgrp\s+-R|chmod\s+-R/.test(w), 'must never recurse');
  assert.ok(!/\bcp\b.*spyglass\.db|\bmv\b.*spyglass\.db/.test(w), 'must never copy/replace the DB');
  // snapshot() must sanitize LAST_ERROR into a single shell/dotenv-safe token
  assert.match(w, /ST_LAST_ERROR\/\/;\/-/, 'snapshot must strip ";" from LAST_ERROR');
  assert.match(w, /le\/\/ \/-/, 'snapshot must strip spaces from LAST_ERROR');
});

test('cutover LAST_ERROR is always a single token (no spaces, no ";")', () => {
  // exercise paths that build multi-part error strings
  for (const s of [
    'host-rollback-fail',
    'provision-fail-rollback-fail',
    'deploy-zero-not-active',
  ]) {
    const r = runCutover(s);
    const m = r.out.match(/^LAST_ERROR=(.*)$/m);
    assert.ok(m, `expected a LAST_ERROR line for ${s}: ${r.out}`);
    assert.doesNotMatch(m[1], /[ ;]/, `LAST_ERROR must be a single token for ${s}, got "${m[1]}"`);
  }
});
