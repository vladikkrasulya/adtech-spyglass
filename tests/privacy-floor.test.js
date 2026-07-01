'use strict';

/**
 * Privacy-floor guard — FAIL-CLOSED behaviour (fix/privacy-floor-fail-closed).
 *
 * These tests pin the security contract of scripts/deploy-lib.sh
 * (effective_privacy_floor / image_contains_privacy_floor / state_get) and prove
 * that scripts/deploy.sh and scripts/rollback.sh enforce the SAME policy:
 *
 *   1. An IMMUTABLE baseline (PRIVACY_BASELINE_SHA = 2437646, the v1.2.1 PII
 *      removal) is ALWAYS enforced. Deleting/resetting/omitting the runtime floor
 *      in deploy-state can never disable it, and a candidate that predates the
 *      baseline is rejected.
 *   2. A runtime floor may only STRENGTHEN the baseline (baseline-or-descendant);
 *      a weaker (ancestor), unrelated, malformed or missing runtime floor is
 *      ignored and the baseline stands. It can never "bless" an arbitrary image.
 *   3. The deploy-state file is PARSED as data (state_get), never sourced — shell
 *      payloads, symlinks and malformed values cannot execute or weaken the floor.
 *
 * Real git (this repo's history) + a mock `docker` shell function. Runs
 * identically on Node 20 (CI runtime) and Node 22 — it invokes each test file by
 * explicit path (node:test builtins + bash), so it does NOT depend on the
 * `node --test tests/` directory-argument behaviour that differs across versions.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BASELINE = '24376462c3fd1988447b26ee69a897190bdeac1a'; // v1.2.1, #24
const ANCESTOR = 'a43adad666b8eb8601391fa95c6a2b4aad699f63'; // v1.2.0, #23 (baseline~1)

// Run a bash snippet from the repo root; returns { code, out }.
function sh(script) {
  try {
    const out = execFileSync('bash', ['-c', script], { cwd: ROOT, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

// Harness: source deploy-lib.sh with a mock `docker` that reports MOCK_REV as the
// image's org.opencontainers.image.revision, then run `body`.
function guard(mockRev, body) {
  return sh(
    [
      'set -u',
      '. scripts/deploy-lib.sh',
      `MOCK_REV=${JSON.stringify(mockRev)}`,
      'docker() {',
      '  if [ "$1" = image ] && [ "$2" = inspect ]; then',
      '    case "$*" in',
      '      *--format*revision*) printf "%s" "$MOCK_REV"; return 0 ;;',
      '      *) return 0 ;;',
      '    esac',
      '  fi',
      '  return 0',
      '}',
      body,
    ].join('\n'),
  );
}

// ── baseline is real + immutable ─────────────────────────────────────────────

test('deploy-lib pins an immutable 40-hex baseline that resolves to a real commit', () => {
  const r = sh(
    '. scripts/deploy-lib.sh; ' +
      'echo "$PRIVACY_BASELINE_SHA"; ' +
      'git rev-parse --verify "${PRIVACY_BASELINE_SHA}^{commit}" >/dev/null && echo RESOLVES',
  );
  assert.match(r.out, new RegExp(`^${BASELINE}$`, 'm'), 'baseline must be the v1.2.1 SHA');
  assert.match(r.out, /RESOLVES/, 'baseline must resolve to a real commit in this repo');
  // The baseline is a hardcoded literal — a pre-set (even exported) env value must
  // NOT survive sourcing, and there must be no `${PRIVACY_BASELINE_SHA:-...}` form.
  const r2 = sh(
    'export PRIVACY_BASELINE_SHA=deadbeef; . scripts/deploy-lib.sh; echo "$PRIVACY_BASELINE_SHA"',
  );
  assert.match(
    r2.out,
    new RegExp(`^${BASELINE}$`, 'm'),
    'a pre-set env value must be overwritten by the hardcoded baseline',
  );
  const src = require('node:fs').readFileSync(path.join(ROOT, 'scripts', 'deploy-lib.sh'), 'utf8');
  assert.match(
    src,
    new RegExp(`PRIVACY_BASELINE_SHA="${BASELINE}"`),
    'baseline must be a hardcoded 40-hex literal',
  );
  assert.doesNotMatch(
    src,
    /PRIVACY_BASELINE_SHA="\$\{PRIVACY_BASELINE_SHA/,
    'baseline must not read from an env override',
  );
});

// ── effective_privacy_floor: runtime may only STRENGTHEN ─────────────────────

test('effective floor = baseline when runtime floor is empty / missing', () => {
  const r = guard('', 'effective_privacy_floor ""');
  assert.equal(r.out.trim(), BASELINE, 'empty runtime floor → baseline');
});

test('effective floor = baseline when runtime floor is MALFORMED', () => {
  const r = guard('', 'effective_privacy_floor "not-a-sha"');
  assert.equal(r.out.trim(), BASELINE, 'malformed runtime floor is ignored → baseline');
});

test('effective floor = baseline when runtime floor is WEAKER (ancestor of baseline)', () => {
  const r = guard('', `effective_privacy_floor "${ANCESTOR}"`);
  assert.equal(r.out.trim(), BASELINE, 'a runtime floor below baseline cannot lower the bar');
});

test('effective floor is RAISED to a valid descendant runtime floor', () => {
  const r = guard('', 'd="$(git rev-parse HEAD)"; effective_privacy_floor "$d"');
  const head = sh('git rev-parse HEAD').out.trim();
  assert.equal(r.out.trim(), head, 'a baseline-descendant runtime floor strengthens the bar');
});

test('effective floor = baseline when runtime floor is UNRELATED', () => {
  const r = guard(
    '',
    'u="$(git commit-tree "$(git rev-parse HEAD^{tree})" -m x </dev/null)"; effective_privacy_floor "$u"',
  );
  assert.equal(r.out.trim(), BASELINE, 'an unrelated runtime floor is ignored → baseline');
});

// ── image_contains_privacy_floor: candidate must meet the EFFECTIVE floor ─────

test('empty runtime floor: candidate == baseline → ALLOW', () => {
  const r = guard(
    BASELINE,
    'if image_contains_privacy_floor img ""; then echo ALLOW; else echo REJECT; fi',
  );
  assert.match(r.out, /ALLOW/);
});

test('empty runtime floor: candidate is a DESCENDANT of baseline → ALLOW', () => {
  const r = guard(
    '',
    'MOCK_REV="$(git rev-parse HEAD)"; if image_contains_privacy_floor img ""; then echo ALLOW; else echo REJECT; fi',
  );
  assert.match(r.out, /ALLOW/);
});

test('empty runtime floor: PRE-baseline candidate → REJECT (baseline fail-closed)', () => {
  const r = guard(
    ANCESTOR,
    'if image_contains_privacy_floor img ""; then echo ALLOW; else echo REJECT; fi',
  );
  assert.match(r.out, /REJECT/, 'a pre-privacy image must be rejected even with no runtime floor');
});

test('state reset (no floor at all): PRE-baseline candidate → REJECT', () => {
  // Identical to the empty-floor case, but framed as a wiped state — same policy.
  const r = guard(
    ANCESTOR,
    'floor="$(state_get /nonexistent/deploy-state.env PRIVACY_FLOOR_BUILD_SHA)"; if image_contains_privacy_floor img "$floor"; then echo ALLOW; else echo REJECT; fi',
  );
  assert.match(r.out, /REJECT/);
});

test('UNRELATED candidate → REJECT', () => {
  const r = guard(
    '',
    'MOCK_REV="$(git commit-tree "$(git rev-parse HEAD^{tree})" -m x </dev/null)"; ' +
      'if image_contains_privacy_floor img ""; then echo ALLOW; else echo REJECT; fi',
  );
  assert.match(r.out, /REJECT/);
});

test('malformed OCI revision label → REJECT (fail closed)', () => {
  const r = guard(
    'not-a-40-hex-sha',
    'if image_contains_privacy_floor img ""; then echo ALLOW; else echo REJECT; fi',
  );
  assert.match(r.out, /REJECT/);
});

test('missing OCI revision label → REJECT (fail closed)', () => {
  const r = guard(
    '',
    'if image_contains_privacy_floor img ""; then echo ALLOW; else echo REJECT; fi',
  );
  // MOCK_REV empty → image_git_revision returns 1 → reject.
  assert.match(r.out, /REJECT/);
});

test('valid 40-hex candidate but missing Git object → REJECT (fail closed)', () => {
  const r = guard(
    'ffffffffffffffffffffffffffffffffffffffff',
    'if image_contains_privacy_floor img ""; then echo ALLOW; else echo REJECT; fi',
  );
  assert.match(r.out, /REJECT/);
});

// ── runtime floor BELOW baseline cannot weaken; ABOVE baseline is enforced ────

test('runtime floor below baseline is ignored: candidate == baseline still ALLOW', () => {
  const r = guard(
    BASELINE,
    `if image_contains_privacy_floor img "${ANCESTOR}"; then echo ALLOW; else echo REJECT; fi`,
  );
  assert.match(r.out, /ALLOW/, 'weaker runtime floor must not change that baseline is met');
});

test('runtime floor RAISED to descendant: candidate == baseline (below raised floor) → REJECT', () => {
  const r = guard(
    BASELINE,
    'd="$(git rev-parse HEAD)"; if image_contains_privacy_floor img "$d"; then echo ALLOW; else echo REJECT; fi',
  );
  assert.match(r.out, /REJECT/, 'once the runtime floor is raised, an image below it is rejected');
});

test('runtime floor RAISED to descendant: candidate == that descendant → ALLOW', () => {
  const r = guard(
    '',
    'd="$(git rev-parse HEAD)"; MOCK_REV="$d"; if image_contains_privacy_floor img "$d"; then echo ALLOW; else echo REJECT; fi',
  );
  assert.match(r.out, /ALLOW/);
});

// ── PRIVACY REVERT on top of a descendant: documented ancestry limitation ─────

test('ancestry guard ALLOWS any baseline-descendant (incl. a hypothetical privacy-revert) — CI gate is the compensating control', () => {
  // The guard proves ancestry, not behaviour: a commit that descends from the
  // baseline is allowed even if it reverted the PII fix. This asserts that
  // reality AND that the compensating CI privacy-regression gate exists.
  const r = guard(
    '',
    'MOCK_REV="$(git rev-parse HEAD)"; if image_contains_privacy_floor img ""; then echo ALLOW; else echo REJECT; fi',
  );
  assert.match(
    r.out,
    /ALLOW/,
    'a descendant is allowed by ancestry alone (the documented limitation)',
  );
  const gate = path.join(ROOT, 'tests', 'auth-event-pii.test.js');
  assert.ok(
    require('node:fs').existsSync(gate),
    'CI privacy-regression gate tests/auth-event-pii.test.js must exist',
  );
  const body = require('node:fs').readFileSync(gate, 'utf8');
  assert.match(
    body,
    /PII|email|ip|password/i,
    'the CI gate must assert on PII fields (behavioural check)',
  );
});

// ── state_get: parse-as-data, no shell execution, symlink & charset safety ────

test('state_get does NOT execute a shell payload in a value (parsed as data)', () => {
  const r = sh(
    [
      'set -u',
      '. scripts/deploy-lib.sh',
      'd="$(mktemp -d)"; f="$d/deploy-state.env"',
      // A payload that would run if the file were sourced.
      'printf "PRIVACY_FLOOR_BUILD_SHA=\\$(touch $d/PWNED; echo x)\\nROLLBACK_TAG=a;rm -f $d/CANARY\\n" > "$f"',
      ': > "$d/CANARY"',
      'v="$(state_get "$f" PRIVACY_FLOOR_BUILD_SHA)"',
      't="$(state_get "$f" ROLLBACK_TAG)"',
      '[ -e "$d/PWNED" ] && echo EXECUTED || echo INERT',
      '[ -e "$d/CANARY" ] && echo CANARY-OK || echo CANARY-GONE',
      'echo "FLOOR=[$v]"',
      'echo "TAG=[$t]"',
      'rm -rf "$d"',
    ].join('\n'),
  );
  assert.match(r.out, /INERT/, 'no command substitution may run');
  assert.match(r.out, /CANARY-OK/, 'no `; rm` may run');
  assert.doesNotMatch(r.out, /EXECUTED/);
  // Sanitised values contain no shell metacharacters / whitespace.
  assert.doesNotMatch(r.out, /FLOOR=\[[^\]]*[$();\s][^\]]*\]/, 'floor value must be metachar-free');
  assert.doesNotMatch(r.out, /TAG=\[[^\]]*[;\s][^\]]*\]/, 'tag value must be metachar-free');
});

test('state_get refuses to read through a SYMLINK', () => {
  const r = sh(
    [
      'set -u',
      '. scripts/deploy-lib.sh',
      'd="$(mktemp -d)"',
      'printf "PRIVACY_FLOOR_BUILD_SHA=deadbeef\\n" > "$d/real"',
      'ln -s "$d/real" "$d/link"',
      'v="$(state_get "$d/link" PRIVACY_FLOOR_BUILD_SHA 2>"$d/err")"',
      'echo "VAL=[$v]"',
      'grep -q "refusing to read deploy-state via symlink" "$d/err" && echo REFUSED || echo NOT-REFUSED',
      'rm -rf "$d"',
    ].join('\n'),
  );
  assert.match(r.out, /VAL=\[\]/, 'a symlinked state file must yield no value');
  assert.match(r.out, /REFUSED/, 'a symlink read must be refused on stderr');
});

test('state_get strips a malformed value to a git-unresolvable string → floor falls back to baseline', () => {
  const r = guard(
    '',
    [
      'd="$(mktemp -d)"; f="$d/s.env"',
      'printf "PRIVACY_FLOOR_BUILD_SHA=not-a-sha!!\\n" > "$f"',
      'v="$(state_get "$f" PRIVACY_FLOOR_BUILD_SHA)"',
      'echo "SANITIZED=[$v]"',
      'echo "EFFECTIVE=[$(effective_privacy_floor "$v")]"',
      'rm -rf "$d"',
    ].join('\n'),
  );
  assert.match(r.out, /SANITIZED=\[not-a-sha\]/, '`!!` must be stripped');
  assert.match(
    r.out,
    new RegExp(`EFFECTIVE=\\[${BASELINE}\\]`),
    'a malformed floor falls back to baseline',
  );
});

test('state_get returns the LAST value when a key is duplicated (deterministic)', () => {
  const r = sh(
    [
      'set -u',
      '. scripts/deploy-lib.sh',
      'd="$(mktemp -d)"; f="$d/s.env"',
      'printf "PRIVACY_FLOOR_BUILD_SHA=aaaa\\nPRIVACY_FLOOR_BUILD_SHA=bbbb\\n" > "$f"',
      'echo "V=[$(state_get "$f" PRIVACY_FLOOR_BUILD_SHA)]"',
      'rm -rf "$d"',
    ].join('\n'),
  );
  assert.match(r.out, /V=\[bbbb\]/);
});

// ── write_state / set_env: atomic, symlink-refusing, no partial write ─────────

test('write_state and set_env REFUSE to write through a symlink (no partial write; original intact)', () => {
  const r = sh(
    [
      'set -u',
      '. scripts/deploy-lib.sh',
      'd="$(mktemp -d)"',
      // write_state via symlink
      'printf "ORIGINAL\\n" > "$d/state-real"; ln -s "$d/state-real" "$d/state-link"',
      'if printf "STATUS=X\\n" | write_state "$d/state-link" 2>/dev/null; then echo WS-WROTE; else echo WS-REFUSED; fi',
      'grep -qx ORIGINAL "$d/state-real" && echo WS-INTACT || echo WS-CLOBBERED',
      // set_env via symlink
      'printf "SPYGLASS_TAG=old\\n" > "$d/env-real"; chmod 600 "$d/env-real"; ln -s "$d/env-real" "$d/env-link"',
      'if set_env SPYGLASS_TAG new "$d/env-link" >/dev/null 2>&1; then echo SE-WROTE; else echo SE-REFUSED; fi',
      'grep -qx "SPYGLASS_TAG=old" "$d/env-real" && echo SE-INTACT || echo SE-CLOBBERED',
      'rm -rf "$d"',
    ].join('\n'),
  );
  assert.match(r.out, /WS-REFUSED/, 'write_state must refuse a symlinked target');
  assert.match(r.out, /WS-INTACT/, 'the real state file must be untouched (no partial write)');
  assert.match(r.out, /SE-REFUSED/, 'set_env must refuse a symlinked target');
  assert.match(r.out, /SE-INTACT/, 'the real env file must be untouched');
});

test('write_state is atomic 0600 and leaves no temp behind on success', () => {
  const r = sh(
    [
      'set -u',
      '. scripts/deploy-lib.sh',
      'd="$(mktemp -d)"; f="$d/state.env"',
      'printf "STATUS=ACTIVE\\nPRIVACY_FLOOR_BUILD_SHA=2437646\\n" | write_state "$f"',
      'grep -qx "PRIVACY_FLOOR_BUILD_SHA=2437646" "$f" && echo CONTENT-OK || echo CONTENT-BAD',
      'case "$(ls -l "$f")" in -rw-------*) echo MODE-600 ;; *) echo MODE-BAD ;; esac',
      'ls "$d"/.deploy-state.tmp.* >/dev/null 2>&1 && echo TEMP-LEFT || echo NO-TEMP',
      'rm -rf "$d"',
    ].join('\n'),
  );
  assert.match(r.out, /CONTENT-OK/);
  assert.match(r.out, /MODE-600/);
  assert.match(r.out, /NO-TEMP/, 'no temp file may be left behind');
});

// ── deploy.sh and rollback.sh enforce the SAME policy ────────────────────────

test('rollback.sh does NOT source the state file (no `. "$STATE_FILE"`)', () => {
  const r = require('node:fs').readFileSync(path.join(ROOT, 'scripts', 'rollback.sh'), 'utf8');
  assert.doesNotMatch(r, /^\s*\.\s+"\$STATE_FILE"/m, 'rollback.sh must not source the state file');
  assert.doesNotMatch(r, /source\s+"\$STATE_FILE"/, 'rollback.sh must not source the state file');
});

test('deploy.sh and rollback.sh read the floor through the SAME state_get parser', () => {
  const d = require('node:fs').readFileSync(path.join(ROOT, 'scripts', 'deploy.sh'), 'utf8');
  const rb = require('node:fs').readFileSync(path.join(ROOT, 'scripts', 'rollback.sh'), 'utf8');
  for (const [name, src] of [
    ['deploy.sh', d],
    ['rollback.sh', rb],
  ]) {
    assert.match(
      src,
      /state_get "\$STATE_FILE" PRIVACY_FLOOR_BUILD_SHA/,
      `${name} must read the floor via state_get`,
    );
    assert.match(src, /image_contains_privacy_floor/, `${name} must enforce the floor guard`);
  }
  // rollback also reads its tag via state_get (not by sourcing).
  assert.match(
    rb,
    /state_get "\$STATE_FILE" ROLLBACK_TAG/,
    'rollback.sh must read ROLLBACK_TAG via state_get',
  );
});

// ── full-script flow: baseline enforced with a wiped/empty state ─────────────

function deploySim(scenario) {
  try {
    const out = execFileSync('bash', [path.join(ROOT, 'tests', 'deploy-sim.sh'), scenario], {
      encoding: 'utf8',
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}
function rollbackSim(scenario, tag = '') {
  try {
    const out = execFileSync(
      'bash',
      [path.join(ROOT, 'tests', 'rollback-floor-sim.sh'), scenario, tag],
      { encoding: 'utf8' },
    );
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('deploy-sim: WIPED state (no floor line) + pre-baseline candidate → REJECT (exit 2, no state, 0 compose up)', () => {
  const r = deploySim('floor-reset-prefloor');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /\(no state\)/, 'must abort before writing any state');
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/, '.env must be untouched');
  assert.match(r.out, /COMPOSE_UP_CALLS=0/, 'nothing may be brought up');
});

test('rollback-sim: empty runtime floor + baseline-descendant target → ALLOW (exit 0)', () => {
  const r = rollbackSim('floor-empty');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /STATUS=ROLLED_BACK/);
});

test('rollback-sim: empty runtime floor + PRE-baseline target → REJECT (exit 2, no mutation)', () => {
  const r = rollbackSim('floor-empty-prefloor');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /ABORT: target image/);
  assert.match(r.out, /STATUS=ACTIVE/, 'state must not be mutated');
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/, '.env must not be mutated');
});
