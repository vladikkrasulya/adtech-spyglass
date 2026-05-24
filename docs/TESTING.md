# Spyglass — Testing

This document covers the test stack, how to run tests, where they live,
CI gate configuration, and how to add new tests. For the codebase map
read [ARCHMAP](./ARCHMAP.md) first.

---

## Test stack

Spyglass uses **Node 20's built-in `node --test`** runner. No Jest, no Mocha,
no Vitest. Zero extra test-runner dependencies — the same Node binary that runs
the server runs the tests.

The assertion library is `node:assert/strict` (built-in). Test structure uses
`test()` from `node:test`, with `describe()` used sparingly where grouping
aids readability. If you're coming from Jest, the API is familiar enough:
`test('name', () => { ... })`, `assert.equal`, `assert.deepEqual`,
`assert.throws`, `assert.rejects`.

---

## Running tests

```bash
# Full suite, LOG_LEVEL silenced so test output isn't swamped by server logs.
npm test

# Watch mode — re-runs on file save. Useful when iterating on a single rule.
npm run test:watch

# Experimental coverage report (Node built-in, no lcov).
npm run test:coverage
```

The full suite currently runs in ~8-10 seconds on the development machine
(i7-7700, cold-start). No network calls are made during tests — external
services are either mocked or skipped.

To surface server-level log output during a failing test, override the log
level:

```bash
LOG_LEVEL=debug npm test
```

To run a single test or a named subset, use the `--test-name-pattern` filter:

```bash
node --test --test-name-pattern="crosscheck" tests/
node --test --test-name-pattern="pop-request" tests/pop-fixtures.test.js
```

Pattern is a substring match (or regex) against the full test name string
passed to `test(...)`.

---

## Where tests live

All tests are under `tests/` at the repo root. Node's discovery glob is
`tests/` — every `*.test.js` file there is picked up automatically.

| File                               | What it covers                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `validator.test.js`                | Core `validate()` and `crosscheck()` — ~50 request cases, ~40 crosscheck cases, detectType / detectVersion |
| `format-detect.test.js`            | `detectFormat()` — banner / video / native / pops / push classification + VAST sniff (~30 cases)           |
| `behavior.test.js`                 | `behavior.analyze()` — synthetic event stream inputs → expected finding set                                |
| `ortb30.test.js`                   | oRTB 3.0 request + response envelope rules (~36 cases)                                                     |
| `dialects.test.js`                 | ext-rtb vendor and vendor dialect overlays applied over IAB baseline                                       |
| `rules-dialects-questions.test.js` | Dialect question-bank coverage for the UI's dialect-hint surface                                           |
| `rules-plugins.test.js`            | Plugin rule registry — client-hints, imp-secure, pop-request, pop-response                                 |
| `pop-fixtures.test.js`             | Pin the four synthetic pop JSON fixtures to their expected finding sets                                    |
| `mirror.test.js`                   | `mirror()` generator — both directions, round-trip, best-practice mode                                     |
| `categories.test.js`               | IAB category decoder                                                                                       |
| `corpus-matrix.test.js`            | Confusion-matrix runner (lib/corpus-matrix.js) — precision/recall math                                     |
| `replay.test.js`                   | Bulk replay pipeline (lib/replay.js) — routing, rollup, top-findings                                       |
| `db.test.js`                       | SQLite model layer — create/list/scope/destroy, FK cascade                                                 |
| `auth.test.js`                     | bcrypt verify, rate-limiter accounting                                                                     |
| `tokens.test.js`                   | HMAC token sign / verify / expiry                                                                          |
| `crypto.test.js`                   | Browser-side zero-knowledge crypto (PBKDF2 + AES-GCM round-trip)                                           |
| `router.test.js`                   | lib/router.js — exact, :id param, trailing-\* dispatch                                                     |
| `health.test.js`                   | `/api/health` endpoint shape                                                                               |
| `api-stability.test.js`            | Public API surface contract — validate() / crosscheck() output ordering, dedup, disabledRules              |
| `spec-refs.test.js`                | Every finding id emitted by the test suite must have an entry in `packages/core/spec-refs.json`            |
| `shape-fingerprint.test.js`        | Payload shape fingerprinting                                                                               |
| `decoders-infrastructure.test.js`  | Low-level decoder helpers                                                                                  |
| `email.test.js`                    | Email wrapper mock                                                                                         |
| `notify.test.js`                   | Notification dispatch mock                                                                                 |
| `intel.test.js`                    | Intel walker + cluster + temp-dialect                                                                      |
| `logger.test.js`                   | Pino logger wrapper                                                                                        |
| `mirror.test.js`                   | Mirror generator (see above)                                                                               |
| `proxy.test.js`                    | Proxy module handler                                                                                       |
| `vast.test.js`                     | VAST 2.x/3.x/4.x rules (~34 cases)                                                                         |
| `fixtures.js`                      | Not a test file — exports reusable payload factories (`validRequest()`, `validResponse()`, etc.)           |

Most tests are integration-style: they import `@kyivtech/spyglass-core`
directly and call the public API. They don't mock the validator internals.
Server-level tests (auth, health, router, db) spin up the relevant module
in isolation with injected dependencies, not a full HTTP server.

---

## CI script

`npm run ci` is the gate used by the pre-push hook and any CI runner:

```bash
npm run format:check && npm run lint && npm run typecheck && npm test
```

All four steps must pass. A failure in any one blocks the push.

| Step           | What it checks                                               |
| -------------- | ------------------------------------------------------------ |
| `format:check` | Prettier formatting — fails if any file would be reformatted |
| `lint`         | ESLint — `no-var`, no unused catch bindings, custom rules    |
| `typecheck`    | `tsc --noEmit` over JSDoc annotations (no `.ts` files)       |
| `test`         | Full `node --test tests/` suite                              |

---

## Pre-push hook

The pre-push hook is installed manually. If it isn't present at
`.git/hooks/pre-push`, create it:

```bash
cat > .git/hooks/pre-push << 'EOF'
#!/bin/sh
npm run ci
EOF
chmod +x .git/hooks/pre-push
```

The hook runs `npm run ci` synchronously; if it exits non-zero the push is
aborted. Don't use `--no-verify` to bypass it. If the hook fails, investigate:
the error output from `format:check` / `lint` / `typecheck` / the test runner
pinpoints the exact file and line.

**Typical failure modes after a long WIP stack** (all four surfaced together
in the v0.41.3 batch after several sessions without running `npm run ci`):

1. **Prettier complaints** — reformatted files. Fix: `npm run format`, then
   re-stage the formatted files.
2. **ESLint `no-var` warnings** — `var` snuck in somewhere. Fix:
   `npm run lint:fix` catches most; the rest are manual.
3. **JSDoc typecheck errors** — a `@param` type annotation diverged from
   actual usage, or a `// @ts-check` file has a type mismatch. Fix: align
   the annotation with the actual shape.
4. **Unused catch-variable warnings** — `catch (e) { }` where `e` is never
   used. Fix: `catch (_e)` or `catch { }` (Node 20+ bare catch).

Run them individually to triage which step is failing rather than running
`npm run ci` and scrolling back through combined output.

---

## Test patterns

### Assertions

Tests import `node:assert/strict` and use `assert.equal`, `assert.deepEqual`,
`assert.ok`, `assert.throws`, `assert.rejects`. Strict mode means `==` is
never used; all equality is `===` / structural deep-equal.

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate, TYPES } = require('@kyivtech/spyglass-core');

test('validate: missing imp returns error', () => {
  const result = validate({ id: 'r1', site: { domain: 'x.com' } });
  const err = result.findings.find((f) => f.id === 'request.imp_required');
  assert.ok(err, 'imp_required finding must be present');
  assert.equal(err.level, 'error');
});
```

Findings are **always asserted by stable `id` and `path`**, never by message
text. Message text is locale-dependent; finding ids are not.

### Fixture factories

Shared payload fixtures live in `tests/fixtures.js` as factory functions
(`validRequest()`, `validResponse()`, `nativeRequest()`, etc.). Each factory
returns a fresh object — tests mutate freely with `delete obj.field` or
`obj.field = value` without affecting other tests. JSDoc `@returns {any}`
is intentional: it suppresses TypeScript narrowing so mutations don't
require type assertions.

When you need a fixture for a new rule, add a factory to `fixtures.js` or
use the existing ones as a base and mutate inline.

### File-based fixtures

Some tests load JSON fixtures from `samples/` using `fs.readFileSync`:

```js
const SAMPLES = path.join(__dirname, '..', 'samples');
const load = (name) => JSON.parse(fs.readFileSync(path.join(SAMPLES, name), 'utf8'));
const req = load('synthetic-pop-clean-request.json');
```

This pattern is used where the payload is too large to inline, or where the
fixture doubles as a stream/replay seed and must stay in sync with the
generator.

---

## What NOT to test

- **Production SQLite**: `tests/db.test.js` creates a temporary database via
  the existing test setup (Node test isolation). Never point at the real
  `/data/spyglass.db` in a test.
- **External network**: Ollama, Resend, and Sentry are either fail-open by
  design or mocked in tests. Don't write tests that require a live external
  service to pass.
- **Container runtime**: tests import the packages directly; they don't boot
  the HTTP server. Test the server's HTTP surface only where the module
  boundary is the HTTP handler itself (e.g. `health.test.js`, `router.test.js`).

---

## Adding a new test

Example: you've added a plugin rule `rules/my-check/` that emits
`imp.my_check.field_required` when a required field is absent.

```js
// tests/my-check.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const myCheck = require('@kyivtech/spyglass-core/rules/my-check');
// OR test via the full validate() pass:
// const { validate } = require('@kyivtech/spyglass-core');

test('my-check: emits field_required when field absent', () => {
  const req = {
    id: 'r1',
    imp: [{ id: 'i1', banner: { w: 300, h: 250 } }],
    site: { domain: 'x.com' },
  };
  const findings = myCheck.validate(req);
  const f = findings.find((f) => f.id === 'imp.my_check.field_required');
  assert.ok(f, 'finding must be present');
  assert.equal(f.level, 'error');
});

test('my-check: clean when field present', () => {
  const req = {
    id: 'r1',
    imp: [{ id: 'i1', banner: { w: 300, h: 250 }, myfield: 'value' }],
    site: { domain: 'x.com' },
  };
  const findings = myCheck.validate(req);
  const f = findings.find((f) => f.id === 'imp.my_check.field_required');
  assert.equal(f, undefined, 'no finding on clean input');
});
```

Then add `imp.my_check.field_required` to `packages/core/spec-refs.json`
(even if the spec URL is `null` — the gate requires the key to exist) or
`tests/spec-refs.test.js` will fail.

---

## Debugging a failing test

**Filter by name** to isolate the failure:

```bash
node --test --test-name-pattern="my-check" tests/
# or target a specific file directly:
node --test tests/my-check.test.js
```

**Surface log output** — the test command runs with `LOG_LEVEL=silent`. To see
server/module log lines during the failing test, run:

```bash
LOG_LEVEL=debug node --test --test-name-pattern="my-check" tests/
```

**Check the spec-refs gate separately** if you get a cryptic failure in
`spec-refs.test.js` — it means a finding id emitted during the suite run has
no entry in `packages/core/spec-refs.json`. The error message names the
offending id.

**`node --test` output format**: the runner emits TAP-like output with `ok N`
/ `not ok N` lines. A failure includes the assertion message and a stack trace.
If the stack trace points into `assert.js` itself rather than your test file,
look one frame up for the actual call site.
