'use strict';

/**
 * Container hardening that the image scanner (Trivy, 2026-10-29) asked for.
 *
 * The base image ships npm/corepack/yarn with their own dependency trees; 13
 * CRITICAL/HIGH findings were all inside them, none reachable from
 * `node server.js`. The runtime stage must not carry them, while the builder
 * stage (which does `npm ci`) must keep working.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');

const [builder, runtime] = dockerfile.split(/^FROM /m).filter((part) => part.startsWith('node:'));

test('the builder stage still installs dependencies with npm', () => {
  assert.match(builder, /npm ci --omit=dev/);
  assert.doesNotMatch(builder, /rm -rf \/usr\/local\/lib\/node_modules\/npm/);
});

test('the runtime stage removes npm, npx, corepack and yarn before the app is copied in', () => {
  const removal = runtime.indexOf('rm -rf /usr/local/lib/node_modules/npm');
  assert.ok(removal >= 0, 'runtime stage must delete the bundled npm');
  for (const target of [
    '/usr/local/lib/node_modules/corepack',
    '/usr/local/bin/npm',
    '/usr/local/bin/npx',
    '/usr/local/bin/corepack',
    '/usr/local/bin/yarn',
    '/opt/yarn-*',
  ]) {
    assert.ok(runtime.includes(target), `runtime stage must remove ${target}`);
  }
  assert.ok(removal < runtime.indexOf('COPY --from=builder'), 'remove before copying the app');
});

test('the container runs without capabilities or privilege escalation', () => {
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /pids_limit:\s*\d+/);
});
