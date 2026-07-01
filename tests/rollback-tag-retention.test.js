'use strict';

/**
 * SHA-keyed rollback tag retention (fixes the same-version clobber risk).
 *
 * Before: ROLLBACK_TAG = `rollback-pre-${VER}` (package.json APP_VERSION). Two
 * deploy attempts under an unchanged/unbumped version — e.g. a same-version retry
 * after a failed attempt, or a hotfix that forgot to bump SemVer — would `docker
 * tag` the SAME name (`rollback-pre-v1.2.3`) against whatever image happened to be
 * PREV_IMG at that moment. Each individual deploy re-derives PREV_IMG correctly,
 * but the NAME is not unique per distinct build: a human or tool referencing an
 * OLDER "rollback-pre-v1.2.3" (e.g. from a log/runbook) after a second deploy has
 * repointed that same name would silently get the WRONG (newer) target.
 *
 * After: ROLLBACK_TAG = `rollback-pre-${PREV_SHA}`, where PREV_SHA is the
 * previous image's own immutable BUILD_SHA (read directly off the image, not off
 * a mutable name). This is a pure function of the previous build's identity: two
 * deploys following DIFFERENT commits always get DIFFERENT tag names (no
 * collision, nothing clobbered); two deploys following the IDENTICAL commit get
 * the IDENTICAL name (a harmless idempotent re-tag of the same thing, not a
 * clobber of something different).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function runSim(scenario, extraEnv = {}) {
  try {
    const out = execFileSync('bash', [path.join(ROOT, 'tests', 'deploy-sim.sh'), scenario], {
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test("deploy.sh keys ROLLBACK_TAG off the PREVIOUS image's BUILD_SHA, not APP_VERSION", () => {
  const d = read('scripts/deploy.sh');
  assert.match(
    d,
    /ROLLBACK_TAG="rollback-pre-\$\{PREV_SHA\}"/,
    'ROLLBACK_TAG must be derived from PREV_SHA (immutable, per-build)',
  );
  assert.doesNotMatch(
    d,
    /ROLLBACK_TAG="rollback-pre-\$\{VER\}"/,
    'ROLLBACK_TAG must NOT be derived from APP_VERSION (collides across same-version deploys)',
  );
});

test('two deploys following DIFFERENT previous builds produce two DIFFERENT rollback tag names (no clobber)', () => {
  const first = runSim('happy', { PREV_BUILD_SHA_OVERRIDE: 'buildAAA111' });
  const second = runSim('happy', { PREV_BUILD_SHA_OVERRIDE: 'buildBBB222' });
  assert.equal(first.code, 0, first.out);
  assert.equal(second.code, 0, second.out);

  const tagOf = (out) => (out.match(/ROLLBACK_TAG=(\S+)/) || [])[1];
  const firstTag = tagOf(first.out);
  const secondTag = tagOf(second.out);
  assert.equal(firstTag, 'rollback-pre-buildAAA111');
  assert.equal(secondTag, 'rollback-pre-buildBBB222');
  assert.notEqual(
    firstTag,
    secondTag,
    'distinct previous builds must get distinct rollback tag names',
  );

  // Each run's OWN docker-tag trace names exactly its own SHA-keyed target —
  // proving the naming function is a pure function of PREV_SHA, so in a REAL
  // deploy sequence (where docker state persists across invocations, unlike
  // this throwaway sim) the second deploy's `docker tag` call would never
  // reuse — and thus never overwrite — the first deploy's distinct tag name.
  assert.match(first.out, /rollback-pre-buildAAA111/);
  assert.match(second.out, /rollback-pre-buildBBB222/);
  assert.doesNotMatch(
    second.out,
    /rollback-pre-buildAAA111/,
    "second run must not reference the first's tag name",
  );
});

test('two deploys following the IDENTICAL previous build produce the IDENTICAL (idempotent, harmless) tag name', () => {
  const first = runSim('happy', { PREV_BUILD_SHA_OVERRIDE: 'sameBuild999' });
  const second = runSim('happy', { PREV_BUILD_SHA_OVERRIDE: 'sameBuild999' });
  const tagOf = (out) => (out.match(/ROLLBACK_TAG=(\S+)/) || [])[1];
  assert.equal(tagOf(first.out), 'rollback-pre-sameBuild999');
  assert.equal(tagOf(second.out), 'rollback-pre-sameBuild999');
  // Same input → same name is EXPECTED and harmless: re-tagging a name to point
  // at the SAME underlying build is a no-op, never a loss of a DIFFERENT target.
});

test('rollback-pre- tag is still correctly gated by the privacy floor regardless of naming scheme', () => {
  // Sanity: the SHA-keyed rename must not have disturbed the existing floor-gated
  // rollback-target checks (floor-safe / floor-candidate-ancestor etc. already
  // cover this in tests/immutable-image.test.js) — spot-check one directly here.
  const r = runSim('floor-safe');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=2437646/);
  assert.match(
    r.out,
    /ROLLBACK_TAG=rollback-pre-prevsha0/,
    'default mock BUILD_SHA still produces the expected SHA-keyed name',
  );
});
