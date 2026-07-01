'use strict';

/**
 * Crash-safe deploy state machine (docker-compose.yml `restart: 'no'` +
 * scripts/deploy-lib.sh arm_restart_policy/is_inflight_status).
 *
 * State machine:  LAST_GOOD(=ACTIVE) → CANDIDATE_STARTING → CANDIDATE_READY → ACTIVE
 *                                    ↘ (failure) → ROLLING_BACK → ROLLED_BACK | CRITICAL
 *
 * Docker ground truth this suite encodes (see commit message / final report for
 * the full reasoning): `restart: always` is a property of a CONTAINER OBJECT,
 * resurrected by Docker's own restart-manager independent of .env/compose-file
 * re-reads — so an unverified candidate that was merely started must never be
 * created with that policy. docker-compose.yml's default is now `restart: 'no'`;
 * ONLY deploy.sh/rollback.sh arm `docker update --restart=always`, and only after
 * wait_ready + smoke both pass. A crash before that point leaves a container (if
 * any exists at all) that Docker will NOT resurrect on its own — recovery is
 * either automatic-and-safe (crash after commit) or requires an explicit
 * operator action (`scripts/rollback.sh`), never a silent unverified candidate.
 *
 * Each crash point is simulated by pre-seeding deploy-state.env with the STATUS
 * that phase would have left behind (a live process can't observe its own kill,
 * so we inspect what a FRESH script invocation does next — which is exactly the
 * real recovery scenario: an operator running deploy.sh/rollback.sh after finding
 * the service down).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function runSim(scenario, tag = '') {
  try {
    const out = execFileSync(
      'bash',
      [path.join(ROOT, 'tests', 'crash-recovery-sim.sh'), scenario, tag],
      { encoding: 'utf8' },
    );
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

// ── static contract: compose default must be 'no', not 'always' ─────────────

test('docker-compose.yml restart policy defaults to "no" (armed explicitly, not at creation)', () => {
  const c = read('docker-compose.yml');
  assert.match(c, /restart:\s*'no'/, "compose must default the service to restart: 'no'");
  assert.doesNotMatch(
    c,
    /restart:\s*always/,
    'compose must NOT statically set restart: always — Docker would resurrect an unverified candidate independent of .env',
  );
});

test('deploy-lib defines arm_restart_policy and is_inflight_status', () => {
  const lib = read('scripts/deploy-lib.sh');
  assert.match(lib, /arm_restart_policy\(\)/);
  assert.match(lib, /docker update --restart=/);
  assert.match(lib, /is_inflight_status\(\)/);
});

test('deploy.sh and rollback.sh both call arm_restart_policy only in a success branch', () => {
  const d = read('scripts/deploy.sh');
  const r = read('scripts/rollback.sh');
  for (const [name, src] of [
    ['deploy.sh', d],
    ['rollback.sh', r],
  ]) {
    assert.match(
      src,
      /arm_restart_policy "\$CONTAINER" always/,
      `${name} must arm restart:always on verified success`,
    );
  }
  // deploy.sh must arm it twice: once for a fully-successful candidate, once for
  // a successful auto-rollback.
  assert.equal(
    (d.match(/arm_restart_policy "\$CONTAINER" always/g) || []).length,
    2,
    'deploy.sh must arm restart:always on BOTH the candidate-success and rollback-success paths',
  );
});

// ── preflight: deploy.sh refuses to start a NEW deploy on top of in-flight state ─

test('preflight BLOCKS a new deploy when STATUS is CANDIDATE_STARTING (crash before/during candidate up or wait_ready)', () => {
  const r = runSim('preflight-blocks-candidate-starting');
  assert.equal(r.code, 7, r.out);
  assert.match(r.out, /ABORT: deploy-state\.env STATUS=CANDIDATE_STARTING/);
  assert.match(r.out, /STATUS=CANDIDATE_STARTING/, 'state must be left untouched for inspection');
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/, '.env must not be touched');
  assert.match(r.out, /COMPOSE_UP_CALLS=0/, 'must not attempt any new transition');
});

test('preflight BLOCKS a new deploy when STATUS is CANDIDATE_READY (crash after health, before smoke/commit)', () => {
  const r = runSim('preflight-blocks-candidate-ready');
  assert.equal(r.code, 7, r.out);
  assert.match(r.out, /STATUS=CANDIDATE_READY/);
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/);
  assert.match(r.out, /COMPOSE_UP_CALLS=0/);
});

test('preflight BLOCKS a new deploy when STATUS is ROLLING_BACK (crash during auto-rollback attempt)', () => {
  const r = runSim('preflight-blocks-rolling-back');
  assert.equal(r.code, 7, r.out);
  assert.match(r.out, /STATUS=ROLLING_BACK/);
  assert.match(r.out, /COMPOSE_UP_CALLS=0/);
});

test('preflight BLOCKS a new deploy on a legacy STATUS=DEPLOYING state (pre-state-machine host)', () => {
  const r = runSim('preflight-blocks-legacy-deploying');
  assert.equal(r.code, 7, r.out);
  assert.match(r.out, /STATUS=DEPLOYING/);
  assert.match(r.out, /COMPOSE_UP_CALLS=0/);
});

test('preflight ALLOWS a new deploy from terminal states: ACTIVE, ROLLED_BACK, CRITICAL, and no state at all', () => {
  for (const scen of [
    'preflight-allows-active',
    'preflight-allows-rolled-back',
    'preflight-allows-critical',
    'preflight-allows-no-state',
  ]) {
    const r = runSim(scen);
    assert.equal(r.code, 0, `${scen}: ${r.out}`);
    assert.match(r.out, /STATUS=ACTIVE/, `${scen}: must reach ACTIVE`);
  }
});

// ── rollback.sh remains the recovery lever regardless of deploy.sh's own phase ──

test('rollback.sh is NOT blocked by an in-flight STATUS (it is the designated recovery action)', () => {
  const r = runSim('rollback-works-during-candidate-starting');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /STATUS=ROLLED_BACK/, 'rollback must succeed and reach a terminal state');
  assert.match(
    r.out,
    /ENV_SPYGLASS_TAG=rollback-pre-oldsha/,
    '.env must be pinned to the restored image',
  );
});

// ── restart-policy arming: ONLY after full verification, in the correct order ──

test('restart:always is armed exactly once, AFTER verification, immediately before the ACTIVE commit', () => {
  const r = runSim('restart-armed-only-on-full-success');
  assert.equal(r.code, 0, r.out);
  const armLines = r.out.split('\n').filter((l) => l.startsWith('ARM '));
  assert.equal(armLines.length, 1, 'exactly one arm call on a fully successful deploy');
  assert.match(
    armLines[0],
    /^ARM always adtech-spyglass /,
    'must arm "always" on the app container',
  );
  // At the moment `docker update` ran, the state file still showed CANDIDATE_READY
  // (the write to ACTIVE happens AFTER arming) — proves the ordering: verify →
  // arm restart:always → THEN commit STATUS=ACTIVE, never the reverse.
  assert.match(
    armLines[0],
    /STATUS=CANDIDATE_READY/,
    'arm must happen BEFORE the STATUS=ACTIVE write',
  );
});

test('restart:always is armed exactly once for a successful auto-rollback (never for the failed candidate)', () => {
  const r = runSim('restart-not-armed-on-candidate-up-fail');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /STATUS=ROLLED_BACK/);
  const armLines = r.out.split('\n').filter((l) => l.startsWith('ARM '));
  assert.equal(
    armLines.length,
    1,
    'exactly one arm call — for the rollback image, not the failed candidate',
  );
  assert.match(
    armLines[0],
    /STATUS=ROLLING_BACK/,
    'arm must happen BEFORE the STATUS=ROLLED_BACK write',
  );
});

test('restart:always is NEVER armed when both candidate and rollback fail (CRITICAL stays fail-closed at the Docker level too)', () => {
  const r = runSim('restart-not-armed-on-total-failure');
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STATUS=CRITICAL/);
  const armLines = r.out.split('\n').filter((l) => l.startsWith('ARM '));
  assert.equal(armLines.length, 0, 'CRITICAL must never arm restart:always on anything');
});

// ── .env is never pinned to a candidate that failed verification ────────────

test('.env is NEVER pinned to a candidate that failed — only to the verified rollback image', () => {
  const r = runSim('env-never-pinned-to-failed-candidate');
  assert.equal(r.code, 1, r.out);
  assert.doesNotMatch(
    r.out,
    /ENV_SPYGLASS_TAG=abc1234/,
    '.env must never point at the failed candidate SHA',
  );
  assert.match(
    r.out,
    /ENV_SPYGLASS_TAG=rollback-pre-/,
    '.env must point at the verified rollback image',
  );
});
