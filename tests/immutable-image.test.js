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

test('deploy/rollback/smoke/backup scripts are valid bash (bash -n)', () => {
  for (const s of ['deploy.sh', 'rollback.sh', 'smoke.sh', 'backup-db.sh']) {
    const p = path.join(ROOT, 'scripts', s);
    assert.ok(fs.existsSync(p), `scripts/${s} must exist`);
    assert.doesNotThrow(
      () => execFileSync('bash', ['-n', p], { stdio: 'pipe' }),
      `bash -n reported a syntax error in scripts/${s}`,
    );
  }
});
