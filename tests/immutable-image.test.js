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

test('production compose mounts ONLY the persistent /data volume (no cross-project mount) — v1.1.6', () => {
  const c = read('docker-compose.yml');
  // The service `volumes:` block, up to the next 4-space key (networks:).
  // Comment-safe: we only count real list entries (`- ...`).
  const block = c.match(/\n {4}volumes:\n([\s\S]*?)\n {4}\w/);
  assert.ok(block, 'compose must declare a service volumes: block');
  const mounts = block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '));
  assert.equal(
    mounts.length,
    1,
    `production must mount exactly ONE volume, found ${mounts.length}: ${mounts.join(' | ')}`,
  );
  assert.match(
    mounts[0],
    /^- \/srv\/DATA\/AppData\/adtech-spyglass:\/data\b/,
    'the only mount must be the persistent /data volume',
  );
  // No runtime dependency on the sibling portal repo, and the transitional
  // design-system.css overlay must be gone (the CSS is baked + hash-guarded).
  assert.ok(
    !/kyivtech-portal/.test(c),
    'production compose must not depend on kyivtech-portal at runtime',
  );
  assert.ok(
    !/design-system\.css:/.test(c),
    'the transitional design-system.css mount must be removed in v1.1.6',
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
  const scripts = [
    'deploy-lib.sh',
    'deploy.sh',
    'rollback.sh',
    'smoke.sh',
    'backup-db.sh',
    'provision-spyglass-ro.sh',
    'cutover-spyglass-ro.sh',
  ].map((s) => path.join(ROOT, 'scripts', s));
  for (const t of [
    'deploy-sim.sh',
    'backup-sim.sh',
    'grafana-ro-sim.sh',
    'cutover-sim.sh',
    'rollback-floor-sim.sh',
    'crash-recovery-sim.sh',
  ]) {
    scripts.push(path.join(ROOT, 'tests', t));
  }
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

test('deploy-sim: floor absent → legacy happy path', () => {
  const r = runSim('floor-absent');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /STATUS=ACTIVE/);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=\n/);
});

test('deploy-sim: safe candidate + safe rollback → deploy allowed', () => {
  const r = runSim('floor-safe');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /STATUS=ACTIVE/);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=2437646/);
});

test('deploy-sim: candidate ancestor → exit 2, state untouched, 0 compose up', () => {
  const r = runSim('floor-candidate-ancestor');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/);
  assert.match(r.out, /STATUS=ACTIVE/);
  assert.match(r.out, /ACTIVE_TAG=old/);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=2437646/);
  assert.match(r.out, /COMPOSE_UP_CALLS=0/);
});

test('deploy-sim: candidate unrelated → exit 2, state untouched, 0 compose up', () => {
  const r = runSim('floor-candidate-unrelated');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/);
  assert.match(r.out, /STATUS=ACTIVE/);
  assert.match(r.out, /ACTIVE_TAG=old/);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=2437646/);
  assert.match(r.out, /COMPOSE_UP_CALLS=0/);
});

test('deploy-sim: candidate missing OCI revision → exit 2, state untouched, 0 compose up', () => {
  const r = runSim('floor-candidate-missing-oci');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/);
  assert.match(r.out, /STATUS=ACTIVE/);
  assert.match(r.out, /ACTIVE_TAG=old/);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=2437646/);
  assert.match(r.out, /COMPOSE_UP_CALLS=0/);
});

test('deploy-sim: candidate valid 40-hex but missing Git object → exit 2, state untouched, 0 compose up', () => {
  const r = runSim('floor-candidate-missing-git');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/);
  assert.match(r.out, /STATUS=ACTIVE/);
  assert.match(r.out, /ACTIVE_TAG=old/);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=2437646/);
  assert.match(r.out, /COMPOSE_UP_CALLS=0/);
});

test('deploy-sim: unsafe rollback target → exit 2 до transition, 0 compose up', () => {
  const r = runSim('floor-unsafe-rollback');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/);
  assert.match(r.out, /STATUS=ACTIVE/);
  assert.match(r.out, /ACTIVE_TAG=old/);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=2437646/);
  assert.match(r.out, /COMPOSE_UP_CALLS=0/);
});

test('deploy-sim: rollback target підмінено перед auto-rollback → exit 3, rollback compose не викликаний', () => {
  const r = runSim('floor-rollback-tampered');
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STATUS=CRITICAL/);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=2437646/, 'floor збережений у CRITICAL');
  assert.match(r.out, /COMPOSE_UP_CALLS=1/, 'лише candidate compose up, rollback відсутній');
});

test('deploy-sim: floor-enabled successful auto-rollback', () => {
  const r = runSim('floor-auto-rollback-success');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /STATUS=ROLLED_BACK/);
  assert.match(r.out, /ACTIVE_TAG=rollback-pre-/);
  assert.match(r.out, /LAST_FAILED_TAG=abc1234/);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=2437646/);
  assert.match(r.out, /COMPOSE_UP_CALLS=2/);
});

// ── secure runtime/backup permissions (fix/secure-runtime-backup-permissions) ─

test('backup-db.sh sets umask 077 and forces restrictive dir/archive modes', () => {
  const b = read('scripts/backup-db.sh');
  assert.match(b, /^umask 077\b/m, 'backup-db.sh must set umask 077');
  assert.match(b, /chmod 700 "\$DEST_DIR"/, 'backup dir must be chmod 700 (fix stale 0755)');
  assert.match(b, /chmod 600 "\$DEST\.gz"/, 'db archive must be chmod 600');
  assert.match(b, /chmod 600 "\$ARCHIVE"/, 'content archive must be chmod 600');
});

test('backup-sim: generated archives are 0600 and the dir is 0700 even if it pre-existed 0755', () => {
  const out = execFileSync('bash', [path.join(ROOT, 'tests', 'backup-sim.sh')], {
    encoding: 'utf8',
  });
  assert.match(out, /DEST_DIR_MODE=700/, 'backup dir must end up 0700');
  assert.match(out, /DB_GZ_MODE=600/, 'db archive must be 0600 (full DB dump — secret at rest)');
  assert.match(out, /CONTENT_GZ_MODE=600/, 'content archive must be 0600');
});

test('deploy-lib defines a permission preflight that allows grafana read but forbids world-write', () => {
  const lib = read('scripts/deploy-lib.sh');
  assert.match(lib, /check_perms\(\)/, 'deploy-lib must define check_perms');
  assert.match(lib, /_world_writable\(\)/, 'deploy-lib must define _world_writable');
  // The live SQLite is intentionally allowed to be group/other READABLE (grafana
  // datasource uid 472) — the preflight only forbids world-WRITE there.
  assert.match(lib, /spyglass\.db-wal/, 'preflight must cover the live -wal');
  assert.ok(
    !/spyglass\.db.*world-readable/.test(lib),
    'preflight must NOT require the live DB to be non-readable (would break grafana)',
  );
});

test('deploy.sh runs the permission preflight before any transition (abort exit 5)', () => {
  const d = read('scripts/deploy.sh');
  assert.match(
    d,
    /check_perms "\$ENV_FILE" "\$STATE_FILE" "\$DATA_DIR"/,
    'deploy must call check_perms',
  );
  assert.match(d, /exit 5/, 'unsafe permissions must abort with exit 5');
  // It must run before the content seed / state write.
  const preIdx = d.indexOf('check_perms "$ENV_FILE"');
  const seedIdx = d.indexOf('rsync -a --ignore-existing');
  assert.ok(preIdx > 0 && preIdx < seedIdx, 'preflight must run before the content seed');
});

test('deploy-sim: unsafe .env permissions block the deploy before any transition (exit 5)', () => {
  const r = runSim('unsafe-perms');
  assert.equal(r.code, 5, r.out);
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/, '.env must be untouched when the preflight blocks');
  assert.match(r.out, /\(no state\)/, 'no deploy-state may be written on an unsafe-perms abort');
});

// ── secure Grafana SQLite access (fix/secure-grafana-sqlite-access, v1.1.7) ───

test('Dockerfile runs the app with umask 027 via exec (so SIGTERM reaches node)', () => {
  const d = read('Dockerfile');
  assert.match(
    d,
    /CMD \["sh", "-c", "umask 027 && exec node server\.js"\]/,
    'CMD must set umask 027 and `exec node server.js` (node stays PID 1)',
  );
});

test('deploy-lib check_db_perms enforces owner/group/mode exactly (pass + fail, rootless)', () => {
  const lib = read('scripts/deploy-lib.sh');
  assert.match(lib, /check_db_perms\(\)/, 'deploy-lib must define check_db_perms');
  // Disposable: use the test user's OWN uid/gid (no root) to exercise the logic.
  const harness = [
    'set -e',
    `cd ${JSON.stringify(ROOT)}`,
    '. scripts/deploy-lib.sh',
    'd="$(mktemp -d)"; U="$(id -u)"; G="$(id -g)"',
    'chgrp "$G" "$d" 2>/dev/null; chmod 2710 "$d"',
    'umask 027; : > "$d/spyglass.db"; : > "$d/spyglass.db-wal"; : > "$d/spyglass.db-shm"',
    'chgrp "$G" "$d"/spyglass.db* 2>/dev/null',
    'check_db_perms "$d" "$U" "$G" 2710 || { echo PASS-CASE-FAILED; exit 1; }',
    'chmod 0644 "$d/spyglass.db-wal"', // re-introduce 'other' read
    'if check_db_perms "$d" "$U" "$G" 2710 >/dev/null 2>&1; then echo OTHER-BIT-NOT-CAUGHT; exit 1; fi',
    'chmod 0640 "$d/spyglass.db-wal"',
    'chmod 0750 "$d"', // drop setgid
    'if check_db_perms "$d" "$U" "$G" 2710 >/dev/null 2>&1; then echo DIRMODE-NOT-CAUGHT; exit 1; fi',
    'rm -rf "$d"',
  ].join('\n');
  assert.doesNotThrow(
    () => execFileSync('bash', ['-c', harness], { stdio: 'pipe' }),
    'check_db_perms logic simulation failed',
  );
});

test('deploy.sh ALWAYS runs check_group + check_db_perms before build (exit 6, no bypass)', () => {
  const d = read('scripts/deploy.sh');
  assert.match(
    d,
    /check_group "\$SPYGLASS_DB_GID" "\$SPYGLASS_DB_GROUP"/,
    'deploy must verify the group',
  );
  assert.match(
    d,
    /check_db_perms "\$DATA_DIR" "\$SPYGLASS_APP_UID" "\$SPYGLASS_DB_GID" "\$SPYGLASS_DIR_MODE"/,
    'deploy must call check_db_perms with the 4 contract params',
  );
  assert.match(d, /exit 6/, 'a contract mismatch must abort exit 6');
  // No bypass: the check must NOT be wrapped in an "if GID is set" skip.
  assert.ok(
    !/if \[ -n "\$SPYGLASS_DB_GID" \]/.test(d),
    'the SQLite contract must be unconditional (no SPYGLASS_DB_GID="" skip)',
  );
  const buildIdx = d.indexOf('docker compose build');
  const chkIdx = d.indexOf('check_db_perms "$DATA_DIR"');
  assert.ok(chkIdx > 0 && chkIdx < buildIdx, 'check_db_perms must run BEFORE the build/recreate');
});

test('provision-spyglass-ro.sh is root-only, backup-first, NON-recursive, dry-run default', () => {
  const p = read('scripts/provision-spyglass-ro.sh');
  assert.match(p, /require_root/, 'must be root-only');
  assert.match(p, /backup-db\.sh/, 'must back up before changing perms');
  assert.match(p, /collision/, 'must guard against a GID collision');
  assert.match(p, /DRY-RUN/, 'must default to a dry-run');
  assert.match(p, /--rollback/, 'must provide a rollback path');
  assert.ok(
    !/chgrp\s+-R|chmod\s+-R/.test(p),
    'must NEVER recurse over AppData (no chgrp -R / chmod -R)',
  );
  assert.ok(
    /content-posts (NOT|untouched|never)/i.test(p),
    'must explicitly leave content-posts untouched',
  );
});

test('provision verify FAILS CLOSED, aborts on missing setpriv, and rolls back with APP_GID (not APP_UID)', () => {
  const p = read('scripts/provision-spyglass-ro.sh');
  // verify returns non-zero on any mismatch and apply must not claim success.
  assert.match(p, /VERIFY FAILED/, 'verify must print VERIFY FAILED on mismatch');
  assert.match(
    p,
    /PROVISION FAILED[\s\S]*exit 1/,
    'apply must exit non-zero (no success claim) on verify failure',
  );
  assert.match(p, /require_setpriv/, 'must abort (not skip) when setpriv is missing');
  assert.match(p, /setpriv not available/, 'missing setpriv must abort with a clear message');
  // A distinct app group is defined and used for rollback chgrp (never APP_UID).
  assert.match(p, /APP_GID=/, 'must define a separate APP_GID');
  assert.match(
    p,
    /chgrp "\$APP_GID" "\$APPDATA"/,
    'rollback must chgrp AppData to APP_GID, not APP_UID',
  );
  assert.ok(
    !/chgrp "\$APP_UID" "\$APPDATA"/.test(p),
    'rollback must NOT chgrp AppData to APP_UID (gid≠uid)',
  );
  assert.match(
    p,
    /chmod g-s/,
    'rollback must clear the dir setgid symbolically (numeric chmod cannot clear a dir setgid on GNU)',
  );
  // 1-byte read probe, never a full DB read.
  assert.match(
    p,
    /dd if=.*bs=1 count=1/,
    'access probe must read at most 1 byte (no full DB read)',
  );
});

test('deploy-lib check_group requires the GID to exist with the canonical name', () => {
  assert.match(
    read('scripts/deploy-lib.sh'),
    /check_group\(\)/,
    'deploy-lib must define check_group',
  );
  const harness = [
    'set -e',
    `cd ${JSON.stringify(ROOT)}`,
    '. scripts/deploy-lib.sh',
    'G="$(id -g)"; N="$(id -gn)"',
    'check_group "$G" "$N" || { echo CORRECT-REJECTED; exit 1; }', // exists + right name → ok
    'if check_group "$G" "sg-nope-$$" >/dev/null 2>&1; then echo WRONGNAME-NOT-CAUGHT; exit 1; fi',
    'if check_group 99999 "spyglass-ro" >/dev/null 2>&1; then echo MISSING-NOT-CAUGHT; exit 1; fi',
  ].join('\n');
  assert.doesNotThrow(
    () => execFileSync('bash', ['-c', harness], { stdio: 'pipe' }),
    'check_group logic simulation failed',
  );
});

test('deploy-sim: empty SPYGLASS_DB_GID does NOT bypass the contract (falls back to 2472 → exit 6)', () => {
  const r = runSim('empty-gid');
  assert.equal(r.code, 6, r.out);
  assert.match(r.out, /\(no state\)/, 'must abort before any transition');
});

test('deploy-sim: a wrong group name aborts (exit 6)', () => {
  const r = runSim('wrong-group');
  assert.equal(r.code, 6, r.out);
  assert.match(r.out, /\(no state\)/, 'must abort before any transition');
});

// ── rollback.sh privacy floor guard flow simulation ─────────────────────────
function runRollbackSim(scenario, tagArg = '') {
  try {
    const out = execFileSync(
      'bash',
      [path.join(ROOT, 'tests', 'rollback-floor-sim.sh'), scenario, tagArg],
      {
        encoding: 'utf8',
      },
    );
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('rollback-sim: empty runtime floor → baseline enforced; a baseline-DESCENDANT target is allowed', () => {
  // Fail-closed: an empty runtime floor no longer means "allow-any" — the immutable
  // baseline still applies. floor-empty uses a baseline-descendant candidate, so it
  // is allowed; the PRE-baseline case is covered by rollback-sim floor-empty-prefloor
  // (tests/privacy-floor.test.js).
  const r = runRollbackSim('floor-empty');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /STATUS=ROLLED_BACK/);
  assert.match(r.out, /ENV_SPYGLASS_TAG=targettag/);
  assert.match(
    r.out,
    /PRIVACY_FLOOR_BUILD_SHA=\s*$/m,
    'runtime floor stays empty in state (baseline is in code)',
  );
});

test('rollback-sim: candidate == floor → allowed', () => {
  const r = runRollbackSim('candidate-eq-floor');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /STATUS=ROLLED_BACK/);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=2437646/);
  assert.match(r.out, /ENV_SPYGLASS_TAG=targettag/);
});

test('rollback-sim: candidate descendant → allowed', () => {
  const r = runRollbackSim('candidate-descendant');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /STATUS=ROLLED_BACK/);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=2437646/);
  assert.match(r.out, /ENV_SPYGLASS_TAG=targettag/);
});

test('rollback-sim: candidate ancestor → rejected (no mutation)', () => {
  const r = runRollbackSim('candidate-ancestor');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /ABORT: target image/);
  assert.match(r.out, /STATUS=ACTIVE/, 'state must not be mutated');
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/, '.env must not be mutated');
});

test('rollback-sim: unrelated candidate → rejected (no mutation)', () => {
  const r = runRollbackSim('unrelated-candidate');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /ABORT: target image/);
  assert.match(r.out, /STATUS=ACTIVE/, 'state must not be mutated');
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/, '.env must not be mutated');
});

test('rollback-sim: missing OCI revision → rejected (no mutation)', () => {
  const r = runRollbackSim('missing-label');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /ABORT: target image/);
  assert.match(r.out, /STATUS=ACTIVE/, 'state must not be mutated');
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/, '.env must not be mutated');
});

test('rollback-sim: malformed OCI revision → rejected (no mutation)', () => {
  const r = runRollbackSim('malformed-label');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /ABORT: target image/);
  assert.match(r.out, /STATUS=ACTIVE/, 'state must not be mutated');
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/, '.env must not be mutated');
});

test('rollback-sim: missing Git object → rejected (fail closed, no mutation)', () => {
  const r = runRollbackSim('missing-git-object');
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /ABORT: target image/);
  assert.match(r.out, /STATUS=ACTIVE/, 'state must not be mutated');
  assert.match(r.out, /ENV_SPYGLASS_TAG=old/, '.env must not be mutated');
});

test('rollback-sim: critical failure → floor preserved in critical state', () => {
  const r = runRollbackSim('rollback-up-fail');
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /STATUS=CRITICAL/);
  assert.match(r.out, /PRIVACY_FLOOR_BUILD_SHA=2437646/);
});

test('deploy-lib image_contains_privacy_floor with production-shaped parameters (real git, mock docker)', () => {
  const harness = [
    'set -e',
    `cd ${JSON.stringify(ROOT)}`,
    '. scripts/deploy-lib.sh',
    'd="$(mktemp -d)"; BIN="$d/bin"; mkdir -p "$BIN"',
    'cat >"$BIN/docker" <<\'EOD\'',
    '#!/bin/sh',
    'if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then',
    '  case "$*" in',
    '    *Labels*org.opencontainers.image.revision*)',
    '      echo "24376462c3fd1988447b26ee69a897190bdeac1a"',
    '      exit 0',
    '      ;;',
    '    *)',
    '      exit 0',
    '      ;;',
    '  esac',
    'fi',
    'exit 0',
    'EOD',
    'chmod +x "$BIN/docker"',
    'export PATH="$BIN:$PATH"',
    'image_contains_privacy_floor "adtech-spyglass:candidate" "2437646" || { echo "Failed: candidate == floor should be allowed"; exit 1; }',
    'image_contains_privacy_floor "adtech-spyglass:candidate" "a43adad" || { echo "Failed: ancestor floor should be allowed"; exit 1; }',
    'cat >"$BIN/docker" <<\'EOD\'',
    '#!/bin/sh',
    'if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then',
    '  case "$*" in',
    '    *Labels*org.opencontainers.image.revision*)',
    '      echo "a43adad666b8eb8601391fa95c6a2b4aad699f63"',
    '      exit 0',
    '      ;;',
    '    *)',
    '      exit 0',
    '      ;;',
    '  esac',
    'fi',
    'exit 0',
    'EOD',
    'if image_contains_privacy_floor "adtech-spyglass:candidate" "2437646" 2>/dev/null; then',
    '  echo "Failed: candidate ancestor of floor should be rejected"; exit 1;',
    'fi',
    'rm -rf "$d"',
  ].join('\n');
  assert.doesNotThrow(
    () => execFileSync('bash', ['-c', harness], { stdio: 'pipe' }),
    'production-shaped floor guard verification failed',
  );
});
