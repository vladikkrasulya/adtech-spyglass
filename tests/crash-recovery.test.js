'use strict';

/**
 * Crash-safe deploy state machine — split-file restart policy.
 *
 * State machine:  LAST_GOOD(=ACTIVE) → CANDIDATE_STARTING → CANDIDATE_READY → ACTIVE
 *                                    ↘ (failure) → ROLLING_BACK → ROLLED_BACK | CRITICAL
 *
 * Docker ground truth this suite encodes: `restart: always` is a property of a
 * CONTAINER OBJECT, resurrected by Docker's own restart-manager independent of
 * .env/compose-file re-reads — so an unverified candidate that was merely
 * started must never be CREATED with that policy. But a GLOBAL `restart: 'no'`
 * in the base docker-compose.yml is itself an operational regression: it would
 * silently change behavior for every OTHER caller of `docker compose up -d`
 * (routine ops, manual recovery, whatever brings the daemon back after a host
 * reboot with no deploy in flight) — those must keep the normal auto-heal
 * `always` policy, completely unaffected by anything deploy-specific.
 *
 * The fix is a split-file override: docker-compose.yml (base) keeps
 * `restart: always`; a SEPARATE docker-compose.deploy-transition.yml overrides
 * it to 'no', and is passed via `-f docker-compose.yml -f
 * docker-compose.deploy-transition.yml` ONLY by deploy.sh/rollback.sh's OWN
 * `up` calls, ONLY while bringing up an UNVERIFIED candidate/rollback image
 * (scripts/deploy-lib.sh COMPOSE_TRANSITION_FILES). A PLAIN `docker compose up
 * -d` (no -f flags) never sees the override and always gets the base file's
 * `always`. Once wait_ready + smoke both pass, the scripts arm `docker update
 * --restart=always` IN PLACE (no recreate) — re-establishing exactly the base
 * file's normal policy — via scripts/deploy-lib.sh arm_restart_policy() /
 * is_inflight_status(). A crash before that point leaves a container (if any
 * exists at all) that Docker will NOT resurrect on its own — recovery is either
 * automatic-and-safe (crash after commit) or requires an explicit operator
 * action (`scripts/rollback.sh`), never a silent unverified candidate.
 *
 * Each crash point is simulated by pre-seeding deploy-state.env with the STATUS
 * that phase would have left behind (a live process can't observe its own kill,
 * so we inspect what a FRESH script invocation does next — which is exactly the
 * real recovery scenario: an operator running deploy.sh/rollback.sh after finding
 * the service down). The mock docker in crash-recovery-sim.sh maintains a
 * STATEFUL restart-policy-state file simulating `docker inspect --format
 * '{{.HostConfig.RestartPolicy.Name}}'` — set to 'no' whenever `up` runs WITH
 * the override, 'always' whenever it runs WITHOUT it, and to the arg of
 * `docker update --restart=X` whenever that runs — so tests can assert the
 * actual simulated Docker-level policy, not just the deploy-state.env STATUS.
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

// ── static contract: base file keeps 'always'; the override is a SEPARATE file ─

test('docker-compose.yml (base) keeps restart: always — no global operational regression', () => {
  const c = read('docker-compose.yml');
  assert.match(
    c,
    /restart:\s*always/,
    'the base file must keep restart: always for normal/plain operations',
  );
  assert.doesNotMatch(
    c,
    /restart:\s*'no'/,
    'the base file must NOT set restart: no — that would regress every plain docker compose up -d',
  );
});

test('docker-compose.deploy-transition.yml overrides restart to "no", and is NOT the auto-merged override.yml name', () => {
  const c = read('docker-compose.deploy-transition.yml');
  assert.match(c, /restart:\s*'no'/, 'the transition file must set restart: no');
  assert.ok(
    fs.existsSync(path.join(ROOT, 'docker-compose.deploy-transition.yml')),
    'file must exist at the exact name COMPOSE_TRANSITION_FILES references',
  );
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'docker-compose.override.yml')),
    'must NOT also exist as docker-compose.override.yml — that name is auto-merged by a PLAIN `docker compose` invocation with no -f flags, which would silently apply restart:no everywhere',
  );
});

test('deploy-lib defines COMPOSE_TRANSITION_FILES, arm_restart_policy, and is_inflight_status', () => {
  const lib = read('scripts/deploy-lib.sh');
  assert.match(
    lib,
    /COMPOSE_TRANSITION_FILES="-f docker-compose\.yml -f docker-compose\.deploy-transition\.yml"/,
    'must define ONE shared COMPOSE_TRANSITION_FILES string (not re-derived per call-site)',
  );
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

test('deploy.sh and rollback.sh both use $COMPOSE_TRANSITION_FILES on every candidate/rollback `up` call', () => {
  const d = read('scripts/deploy.sh');
  const r = read('scripts/rollback.sh');
  // deploy.sh has TWO transitional `up` calls (candidate + its own auto-rollback).
  assert.equal(
    (d.match(/docker compose \$COMPOSE_TRANSITION_FILES up -d --no-build/g) || []).length,
    2,
    'deploy.sh must apply the override on BOTH the candidate and auto-rollback up calls',
  );
  assert.match(
    r,
    /docker compose \$COMPOSE_TRANSITION_FILES up -d --no-build/,
    'rollback.sh must apply the SAME override variable on its up call',
  );
  // Neither script may invoke a bare `docker compose up` without the override
  // for a candidate/rollback transition (the ONLY plain-`up` caller allowed is
  // an operator/bystander, never these scripts).
  assert.doesNotMatch(
    d,
    /(?<!\$COMPOSE_TRANSITION_FILES )up -d --no-build/,
    'deploy.sh must not bring up a candidate/rollback image without the transition override',
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
  assert.match(
    r.out,
    /RESTART_POLICY_STATE=\s*$/m,
    'no restart-policy transition may occur — reboot from this phase is fail-closed at the Docker level too',
  );
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

test('rollback.sh applies the SAME deploy-transition override as deploy.sh (candidate born restart:no, armed always only after verified)', () => {
  const r = runSim('rollback-works-during-candidate-starting');
  assert.equal(r.code, 0, r.out);
  assert.match(
    r.out,
    /POLICY no SRC=up STATUS=STATUS=ROLLING_BACK/,
    "rollback.sh's own up call must create the container with restart:no (override applied)",
  );
  assert.match(
    r.out,
    /POLICY always SRC=arm-update/,
    'rollback.sh must arm restart:always in place only after its own wait_ready+smoke pass',
  );
  assert.match(
    r.out,
    /RESTART_POLICY_STATE=always/,
    'final simulated Docker-level policy must be always',
  );
});

// ── restart-policy arming: ONLY after full verification, in the correct order ──

test('a plain `docker compose up -d` (no -f override — a bystander/manual command) always creates with restart:always, unaffected by the deploy-transition override', () => {
  const r = runSim('plain-compose-up-uses-always');
  assert.equal(r.code, 0, r.out);
  assert.match(
    r.out,
    /POLICY always SRC=up/,
    "a plain up with no -f flags must resolve to the base file's restart: always",
  );
  assert.match(r.out, /RESTART_POLICY_STATE=always/);
});

test('candidate is created with restart:no via the deploy-transition override; the verified container is armed to always', () => {
  const r = runSim('restart-armed-only-on-full-success');
  assert.equal(r.code, 0, r.out);
  assert.match(
    r.out,
    /POLICY no SRC=up STATUS=STATUS=CANDIDATE_STARTING/,
    'the candidate up call (with the override) must create the container with restart:no',
  );
  assert.match(
    r.out,
    /POLICY always SRC=arm-update/,
    'the SAME container must be armed to always via docker update, not recreated',
  );
  assert.match(
    r.out,
    /RESTART_POLICY_STATE=always/,
    'the final simulated Docker-level restart policy must be always for a verified, ACTIVE deploy',
  );
});

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

test('restart:always is NEVER armed when both candidate and rollback fail — arm_restart_policy never runs, STATUS never reaches ACTIVE, simulated Docker-level policy stays "no"', () => {
  const r = runSim('restart-not-armed-on-total-failure');
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STATUS=CRITICAL/);
  assert.doesNotMatch(r.out, /STATUS=ACTIVE/, 'a failure must never write STATUS=ACTIVE');
  const armLines = r.out.split('\n').filter((l) => l.startsWith('ARM '));
  assert.equal(armLines.length, 0, 'CRITICAL must never arm restart:always on anything');
  assert.doesNotMatch(
    r.out,
    /POLICY always/,
    'no up/arm call may ever resolve to "always" in this scenario',
  );
  assert.match(
    r.out,
    /RESTART_POLICY_STATE=no/,
    'the simulated Docker-level policy must remain "no" — nothing is ever silently resurrectable after a total failure',
  );
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
