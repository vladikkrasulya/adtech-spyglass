# Quickstart: Validate the Dependency and Sentry Refresh

Run from the repository root on the feature branch. Do not use a production DSN.

## 1. Confirm Feature and Diff Scope

```bash
.specify/scripts/bash/check-prerequisites.sh --json
git diff --stat main
git diff main -- package.json package-lock.json
```

Expected: feature 002 resolves; the only direct manifest update is compatible `@sentry/node` 10.x;
retired root architecture/roadmap files are not restored; no package publication or deployment file
changes appear.

## 2. Install the Locked Graph

```bash
npm ci
npm ls --all
node --test tests/dependency-security.test.js
node -e "const lock=require('./package-lock.json'); for (const name of [
  'node_modules/@sentry/node',
  'node_modules/@opentelemetry/core',
  'node_modules/@opentelemetry/instrumentation',
  'node_modules/@opentelemetry/resources',
  'node_modules/@opentelemetry/sdk-trace-base',
  'node_modules/brace-expansion',
  'node_modules/undici'
]) console.log(name, lock.packages[name]?.version, lock.packages[name]?.engines || {})"

docker run --rm --volume "$PWD:/repo:ro" node:22.13.0-alpine sh -lc '
  apk add --no-cache python3 make g++ >/dev/null &&
  mkdir -p /tmp/app &&
  cp /repo/package.json /repo/package-lock.json /tmp/app/ &&
  cp -R /repo/packages /tmp/app/packages &&
  cd /tmp/app &&
  npm_config_engine_strict=true npm ci --omit=dev &&
  node --version &&
  node -e "require(\"@sentry/node\"); require(\"better-sqlite3\")"
'
```

Expected: clean install, offline advisory-floor guard, and tree validation exit zero; inspected
versions are fixed; the disposable exact-floor container completes an engine-strict production
install and loads the native/runtime dependencies.

## 3. Audit Full and Production Graphs

These commands query the npm advisory service and require network access:

```bash
npm audit
npm audit --omit=dev
```

Expected: both commands report zero findings. Record them separately in `tasks.md`.

## 4. Run Focused Observability Tests

```bash
NODE_ENV=test LOG_LEVEL=silent node --test --test-reporter=spec \
  tests/logger.test.js tests/health.test.js
npx eslint lib/logger.js modules/health/handler.js tests/logger.test.js \
  tests/health.test.js tests/dependency-security.test.js
npm run typecheck
```

Expected: production-shaped disabled/unset, malformed, valid in-memory transport, capture/flush, and
both injected health states pass. The child helper removes inherited `SENTRY_DSN` for the unset case;
no test uses a real target or external request.

## 5. Run Truth and Packaging Gates

```bash
node --test tests/docs-truth.test.js tests/privacy-claims.test.js \
  tests/spec-kit-contract.test.js tests/npm-pack-manifest.test.js
bash scripts/npm-pack-smoke.sh
```

Expected: retained/canonical documentation stays truthful, privacy and Spec Kit ownership remain
intact, and Core/CLI package contents remain valid without publishing.

## 6. Run Complete CI and Production-Shaped Smoke

```bash
npm run ci
bash scripts/ci-docker-smoke.sh
git diff --check
```

Expected: all repository gates pass; the disposable Docker smoke loads the production dependency
graph and checks application health without contacting production or deploying an image. If Docker
is unavailable in the current environment, record that limitation and require the GitHub Docker gate
before PR readiness.

## 7. Converge

The pre-implementation `speckit.analyze` result must already be recorded in `tasks.md`. After all
verification, re-run the non-destructive consistency review, resolve every critical/high finding,
then run `speckit.converge`. If convergence appends tasks, implement and verify them before repeating
convergence. Update `spec.md`, `tasks.md`, and `specs/ROADMAP.md` with current status and exact
evidence.

Updating draft PR #57 requires a separately confirmed lease-protected push. Merge, npm publication,
production configuration, real Sentry delivery verification, and deployment are not part of this
quickstart.
