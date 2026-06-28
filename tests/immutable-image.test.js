'use strict';

/**
 * Immutable-production-image guard.
 *
 * Enforces that the production container is a self-contained snapshot of a
 * release (v1.1.5+): the image bakes all source, the compose file does NOT
 * bind-mount source over it, the image tag is pinned (no silent local/dev
 * fallback), the design-system CSS is the real vendored snapshot (not the
 * 783-byte stub), the OCI version/revision labels are wired from build-args
 * (not hardcoded), the .dockerignore keeps the build context clean, and the
 * deploy/rollback/smoke/backup scripts are syntactically valid.
 *
 * Pure-text checks (no docker / no YAML dependency) so it runs in plain CI.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('docker-compose.yml does NOT bind-mount any source path', () => {
  const c = read('docker-compose.yml');
  const forbidden = [
    /-\s*\.\/public\b/,
    /-\s*\.\/packages\b/,
    /-\s*\.\/modules\b/,
    /-\s*\.\/server\.js\b/,
    /-\s*\.\/intel-llm\.js\b/,
    /-\s*\.\/lib\//,
    /-\s*\.\/samples\b/,
    /-\s*\.\/content\/posts\b/,
  ];
  for (const re of forbidden) {
    assert.ok(!re.test(c), `production compose must not bind-mount source (${re})`);
  }
});

test('docker-compose.yml keeps the persistent /data volume + CONTENT_DIR under it', () => {
  const c = read('docker-compose.yml');
  assert.match(c, /\/srv\/DATA\/AppData\/adtech-spyglass:\/data\b/, 'must mount the /data volume');
  assert.match(
    c,
    /CONTENT_DIR=\/data\/content-posts/,
    'CONTENT_DIR must live under the /data volume',
  );
});

test('docker-compose.yml pins the image tag with NO silent fallback + relative build context', () => {
  const c = read('docker-compose.yml');
  assert.match(
    c,
    /image:\s*adtech-spyglass:\$\{SPYGLASS_TAG:\?/,
    'image must be adtech-spyglass:${SPYGLASS_TAG:?...} (forbid silent fallback)',
  );
  assert.ok(
    !/\$\{SPYGLASS_TAG:-/.test(c),
    'must NOT use ${SPYGLASS_TAG:-default} (silent local/dev)',
  );
  assert.match(
    c,
    /^\s*context:\s*\.\s*$/m,
    'build context must be relative `.` (reproducible from any checkout)',
  );
  assert.ok(!/context:\s*\/srv\/DATA/.test(c), 'build context must not be an absolute host path');
});

test('public/design-system.css is the vendored snapshot (hash matches manifest, not the stub)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/design-system.css'));
  assert.ok(
    css.length > 5000,
    `design-system.css is only ${css.length}B — looks like the 783B stub`,
  );
  assert.ok(
    !css.toString().includes('PLACEHOLDER'),
    'design-system.css must not be the placeholder stub',
  );
  const manifest = JSON.parse(read('design-system.vendor.json'));
  const sha = crypto.createHash('sha256').update(css).digest('hex');
  assert.equal(
    sha,
    manifest.sha256,
    'design-system.css sha256 must match design-system.vendor.json',
  );
  assert.equal(css.length, manifest.bytes, 'design-system.css byte count must match the manifest');
});

test('Dockerfile bakes OCI version/revision labels from build-args (not hardcoded)', () => {
  const d = read('Dockerfile');
  assert.match(d, /ARG\s+APP_VERSION/, 'Dockerfile must declare ARG APP_VERSION');
  assert.match(d, /ARG\s+GIT_SHA/, 'Dockerfile must declare ARG GIT_SHA');
  assert.match(
    d,
    /org\.opencontainers\.image\.version="\$\{APP_VERSION\}"/,
    'version label must come from ${APP_VERSION}',
  );
  assert.match(
    d,
    /org\.opencontainers\.image\.revision="\$\{GIT_SHA\}"/,
    'revision label must come from ${GIT_SHA}',
  );
  assert.ok(!/image\.version="\d/.test(d), 'OCI version must NOT be hardcoded in the Dockerfile');
  const c = read('docker-compose.yml');
  for (const a of ['BUILD_SHA', 'GIT_SHA', 'APP_VERSION']) {
    assert.match(c, new RegExp(`${a}:\\s*\\$\\{${a}`), `compose must pass the ${a} build-arg`);
  }
});

test('.dockerignore keeps the build context clean (docs/.bak/.claude/.Jules/ops) but keeps the blog seed', () => {
  const di = read('.dockerignore');
  for (const pat of [
    '**/*.md',
    'docs/',
    '**/*.bak',
    '.claude/',
    '.Jules/',
    'Dockerfile*',
    'docker-compose*.yml',
  ]) {
    assert.ok(di.includes(pat), `.dockerignore must exclude "${pat}"`);
  }
  assert.ok(
    di.includes('!content/posts/**/*.md'),
    '.dockerignore must KEEP the blog seed (content/posts/**/*.md)',
  );
});

test('deploy/rollback/smoke/backup/lib/sim scripts are valid bash (bash -n)', () => {
  const scripts = ['deploy-lib.sh', 'deploy.sh', 'rollback.sh', 'smoke.sh', 'backup-db.sh'].map(
    (s) => path.join(ROOT, 'scripts', s),
  );
  scripts.push(path.join(ROOT, 'tests', 'deploy-sim.sh'));
  for (const p of scripts) {
    assert.ok(fs.existsSync(p), `${p} must exist`);
    assert.doesNotThrow(
      () => execFileSync('bash', ['-n', p], { stdio: 'pipe' }),
      `bash -n reported a syntax error in ${p}`,
    );
  }
});

// ── CP2 amendment guards ────────────────────────────────────────────────────

test('deploy/rollback wait for readiness (polling), not a fixed sleep before smoke', () => {
  const lib = read('scripts/deploy-lib.sh');
  assert.match(lib, /wait_ready\(\)/, 'deploy-lib must define wait_ready');
  assert.match(lib, /api\/health/, 'wait_ready must poll /api/health');
  assert.match(lib, /Health\.Status/, 'wait_ready must check docker health');
  for (const s of ['deploy.sh', 'rollback.sh']) {
    const t = read(`scripts/${s}`);
    assert.match(t, /wait_ready\s+"?\$\{?CONTAINER/, `${s} must wait_ready before smoke`);
    assert.ok(!/\bsleep\s+5\b/.test(t), `${s} must not use a fixed sleep 5 before smoke`);
  }
});

test('deploy-state lives under /data (not the repo) with atomic 0600 writes', () => {
  for (const s of ['deploy.sh', 'rollback.sh']) {
    const t = read(`scripts/${s}`);
    assert.match(
      t,
      /STATE_FILE="\$DATA_DIR\/deploy-state\.env"/,
      `${s} STATE_FILE must be under /data`,
    );
    assert.ok(!/STATE_FILE=.*REPO/.test(t), `${s} must not keep deploy-state in the repo`);
  }
  const lib = read('scripts/deploy-lib.sh');
  assert.match(lib, /mktemp "\$\{dir\}\/\.env\.tmp/, 'set_env must use a temp beside .env');
  assert.match(lib, /chmod 600/, 'set_env must chmod the .env 600');
  assert.match(lib, /write_state\(\)/, 'deploy-lib must define write_state');
});

test('rollback verifies the SELECTED image BUILD_SHA (not a stale PREV)', () => {
  assert.match(
    read('scripts/deploy-lib.sh'),
    /image_build_sha\(\)/,
    'deploy-lib must define image_build_sha',
  );
  const r = read('scripts/rollback.sh');
  assert.match(
    r,
    /EXPECT="\$\(image_build_sha "adtech-spyglass:\$\{TAG\}"/,
    'rollback must read BUILD_SHA from the selected image',
  );
  assert.match(
    r,
    /missing or carries no BUILD_SHA/,
    'rollback must abort if the image lacks BUILD_SHA',
  );
});

test('deploy auto-rollback records the rollback image as ACTIVE + the new release as LAST_FAILED', () => {
  const d = read('scripts/deploy.sh');
  assert.match(
    d,
    /ACTIVE_TAG=\$\{ROLLBACK_TAG\}/,
    'after auto-rollback ACTIVE_TAG must be the rollback image',
  );
  assert.match(
    d,
    /LAST_FAILED_TAG=\$\{SHA\}/,
    'the failed candidate must be recorded as LAST_FAILED',
  );
});

test('deploy seeds content-posts idempotently before launch and aborts on failure', () => {
  const d = read('scripts/deploy.sh');
  assert.match(
    d,
    /rsync -a --ignore-existing content\/posts\//,
    'deploy must idempotently seed content-posts',
  );
  assert.match(
    d,
    /SEED_UID="\$\{SPYGLASS_SEED_UID:-1000\}"/,
    'seed owner must be checked against uid 1000 by default',
  );
  assert.match(
    d,
    /container runs as uid \$\{SEED_UID\}/,
    'deploy must abort if the seed dir owner != container uid',
  );
  assert.match(d, /ABORT: content seed failed/, 'deploy must abort if the seed fails');
});

test('smoke requires the markdown welcome post per language + is documented non-destructive', () => {
  const s = read('scripts/smoke.sh');
  assert.match(
    s,
    /blog\/post\?slug=welcome&lang=\$lang/,
    'smoke must fetch the welcome post per lang',
  );
  assert.match(s, /"source":"markdown"/, 'smoke must require source=markdown');
  assert.match(s, /NON-DESTRUCTIVE/, 'smoke header must declare it non-destructive');
});

test('.env.example leaves SPYGLASS_TAG empty (compose :? fails on empty)', () => {
  const e = read('.env.example');
  assert.match(e, /^SPYGLASS_TAG=\s*$/m, 'SPYGLASS_TAG must be empty in .env.example');
  assert.ok(!/^SPYGLASS_TAG=(dev|local)/m.test(e), 'SPYGLASS_TAG must not default to dev/local');
});

test('deploy-lib set_env/write_state are atomic, 0600, secret-preserving (disposable sim)', () => {
  // Source the real helpers and exercise them in a throwaway dir — no docker,
  // no real .env. Portable mode check via `ls -l` (BSD + GNU).
  const harness = [
    'set -e',
    `cd ${JSON.stringify(ROOT)}`,
    '. scripts/deploy-lib.sh',
    'd="$(mktemp -d)"; f="$d/.env"',
    'printf \'NODE_ENV=production\\nSECRET_X=topsecret\\nSPYGLASS_TAG=old\\n\' > "$f"; chmod 664 "$f"',
    'o1="$(stat -c %u "$f" 2>/dev/null || stat -f %u "$f")"',
    'set_env SPYGLASS_TAG newtag "$f" >/dev/null',
    'grep -qx "SPYGLASS_TAG=newtag" "$f" || { echo tag-not-updated; exit 1; }',
    'grep -qx "SECRET_X=topsecret" "$f" || { echo secret-lost; exit 1; }',
    'o2="$(stat -c %u "$f" 2>/dev/null || stat -f %u "$f")"',
    '[ "$o1" = "$o2" ] || { echo owner-changed; exit 1; }',
    'case "$(ls -l "$f")" in -rw-------*) ;; *) echo env-not-600; exit 1;; esac',
    'ls "$d"/.env.tmp.* >/dev/null 2>&1 && { echo temp-left; exit 1; }',
    'set_env NEWKEY val "$f" >/dev/null',
    'grep -qx "NEWKEY=val" "$f" || { echo append-failed; exit 1; }',
    's="$d/state.env"; printf "ACTIVE_TAG=x\\n" | write_state "$s"',
    'grep -qx "ACTIVE_TAG=x" "$s" || { echo state-content; exit 1; }',
    'case "$(ls -l "$s")" in -rw-------*) ;; *) echo state-not-600; exit 1;; esac',
    'rm -rf "$d"',
  ].join('\n');
  assert.doesNotThrow(
    () => execFileSync('bash', ['-c', harness], { stdio: 'pipe' }),
    'deploy-lib disposable set_env/write_state simulation failed',
  );
});

// ── deploy.sh flow simulation (mocked docker/git/curl, real deploy.sh) ───────
function runSim(scenario) {
  try {
    const out = execFileSync('bash', [path.join(ROOT, 'tests', 'deploy-sim.sh'), scenario], {
      encoding: 'utf8',
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('deploy-sim: happy path → STATUS=ACTIVE, exit 0', () => {
  const r = runSim('happy');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /STATUS=ACTIVE/);
  assert.match(r.out, /ENV_SPYGLASS_TAG=abc1234/);
});

test('deploy-sim: candidate `compose up` failure → auto-rollback (STATUS=ROLLED_BACK, exit 1)', () => {
  const r = runSim('candidate-up-fail');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /STATUS=ROLLED_BACK/);
  assert.match(r.out, /ACTIVE_TAG=rollback-pre-/, 'rollback image must be ACTIVE');
  assert.match(r.out, /LAST_FAILED_TAG=abc1234/, 'failed candidate must be LAST_FAILED');
});

test('deploy-sim: rollback `compose up` failure → STATUS=CRITICAL, exit 3', () => {
  const r = runSim('rollback-up-fail');
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STATUS=CRITICAL/);
  assert.match(r.out, /ACTIVE_TAG=UNKNOWN/);
});

test('deploy-sim: missing previous BUILD_SHA aborts before activation (exit 2, .env unchanged)', () => {
  const r = runSim('missing-prev-sha');
  assert.equal(r.code, 2, r.out);
  assert.match(
    r.out,
    /ENV_SPYGLASS_TAG=old/,
    '.env must NOT be switched on a pre-activation abort',
  );
  assert.ok(
    !/STATUS=(ACTIVE|ROLLED_BACK)/.test(r.out),
    'must not reach an active/rolled-back state',
  );
});
