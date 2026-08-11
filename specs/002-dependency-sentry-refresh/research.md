# Research: Dependency and Sentry Refresh

## Decision 1: Refresh From Current `main`, Not the Old PR Base

**Decision**: Build feature 002 from the Spec Kit-enabled `main` and replay the valid content of draft
PR #57. Do not merge or rebase the old commit blindly.

**Rationale**: PR #57 was green on the pre-foundation base and edits root `ARCHITECTURE.md` and
`ROADMAP.md`, which are now retired. Starting from current `main` preserves the canonical document
ownership model and makes conflicts explicit.

**Alternatives considered**:

- Merge the old draft as-is: rejected because it can restore competing truth owners and its CI did
  not cover current governance tests.
- Close the old PR and open an unrelated replacement: rejected because the existing PR remains a
  useful review thread and can be updated safely with a lease-protected push after local proof.

## Decision 2: Use a Compatible Sentry 10.x Update

**Decision**: Raise the direct `@sentry/node` range from `^10.53.0` to `^10.70.0` and regenerate the
lockfile without `--force` or unrelated direct major upgrades.

**Rationale**: On 2026-08-11 the current lockfile produced seven audit findings: five moderate and two
high. The production-only graph produced six: five moderate and one high. The production chain starts
at `@sentry/node@10.53.0`, includes vulnerable OpenTelemetry Core versions below 2.8.0, and includes
`brace-expansion@5.0.7`. The full graph additionally includes development-only `undici@7.28.0` through
`jsdom`. A compatible Sentry 10.x refresh resolves the production telemetry graph, while ordinary
lockfile resolution selects fixed `brace-expansion@5.0.9` and `undici@7.29.0` without changing their
direct parents' major versions.

**Alternatives considered**:

- Run `npm audit fix --force`: rejected because it can introduce unrelated breaking majors and makes
  the intended graph difficult to review.
- Upgrade `better-sqlite3`, `jsdom`, TypeScript, or the toolchain majors: rejected as unrelated scope.
- Add broad npm overrides: rejected because compatible upstream resolution is available and easier
  to maintain.

## Decision 3: Treat the Lockfile and Clean Install as Authorities

**Decision**: Validate the committed `package-lock.json` with `npm ci`, `npm ls --all`, both npm audit
modes, explicit vulnerable-package inspection, and package smoke.

**Rationale**: The existing `node_modules` directory can differ from the checked-in lockfile. During
planning it already contained newer Sentry/transitive packages while the lockfile still pinned the
vulnerable graph. Only a clean lockfile install proves what CI and a production build will receive.

**Alternatives considered**:

- Rely on `npm ls` from the current worktree: rejected because it can reflect a previous branch's
  install.
- Trust a green Dependabot PR from an older base: rejected because audit data and transitive advisory
  ranges can change.

## Decision 4: Keep the Health Shape and Narrow Its Meaning

**Decision**: Keep `sentry: { ready: boolean }`, but set it true only when the initialized SDK client
retains a parsed DSN. Document it as valid local SDK configuration, never as upstream health.

**Rationale**: The current wrapper sets readiness immediately after `Sentry.init()`, but the SDK can
log and tolerate malformed DSNs without throwing. `Sentry.getClient()?.getDsn()` is the narrow local
fact available at boot. A syntactically valid DSN can still be unreachable or rejected, so a boot
health endpoint cannot truthfully promise delivery.

**Alternatives considered**:

- Rename or reshape the public health field: rejected because a compatible semantic correction is
  sufficient and avoids dashboard/API churn.
- Probe the configured target on every health request: rejected because it adds latency, credentials,
  network coupling, and a new failure dependency.
- Call the field end-to-end ready after a synthetic production event: rejected because delivery is
  an operator verification step, not a persistent local invariant.

## Decision 5: Test the Real SDK Without Network Egress

**Decision**: Use isolated Node child processes for module-load configuration cases and replace the
SDK transport with an in-memory test transport for the valid-DSN capture/flush scenario.

**Rationale**: `lib/logger.js` reads environment variables and initializes Sentry once at module
load. Child processes isolate module cache and environment state. A custom transport exercises the
actual Sentry 10.x initialization, scope/context, capture, and flush APIs without contacting any
external service or recording a real DSN.

The child helper must delete inherited `SENTRY_DSN` when a case requests an unset value; merely
spreading the parent shell environment would make the disabled case non-hermetic.

**Alternatives considered**:

- Mock the whole Sentry module: rejected because it would not verify the upgraded SDK contract.
- Use a local HTTP listener: unnecessary; an in-memory transport is smaller and proves zero socket
  dependency.
- Send a test event to production: prohibited without separate authorization and inappropriate for
  deterministic CI.

## Decision 6: Leave Tracing and the Browser Proxy Untouched

**Decision**: Preserve `tracesSampleRate: 0`, explicit error capture, `sendDefaultPii: false`, and the
existing browser-ingest proxy state. Do not change import ordering or add automatic instrumentation.

**Rationale**: This feature removes findings and corrects readiness semantics. Tracing and browser
ingest are separate architecture/privacy concerns with different test and deployment requirements.

**Alternatives considered**:

- Use the dependency refresh to enable tracing: rejected as scope and privacy drift.
- Remove all legacy browser-proxy code: rejected because it is an independent cleanup feature.

## Decision 7: Separate Repository Proof From Production Delivery

**Decision**: Require offline/local configuration tests, package/application smoke, and full CI for
this feature. Leave real target delivery and production `sentry.ready` verification to a separately
authorized post-deploy operator procedure.

**Rationale**: Repository tests can prove configuration parsing and SDK API compatibility, but cannot
prove a target's credentials, routing, retention, or availability. The roadmap already tracks
production error reporting as an external verification step.

**Alternatives considered**:

- Make merge contingent on a production event: rejected because it mixes code review with production
  mutation and secret use.

## Decision 8: Treat the Readiness Correction as a Compatible Bug Fix

**Decision**: Preserve the health JSON shape, status behavior, and logger export signatures; correct
only the false-positive state for malformed local configuration. No app, Core, or CLI SemVer bump is
required.

**Rationale**: Consumers already receive a boolean described as readiness. Returning false when the
SDK did not retain a parsed destination narrows the result to the truthful subset of the existing
promise. It adds no field, removes no field, and changes no success/status branch. The exact meaning
is now documented in the public HTTP baseline and feature contract.

**Alternatives considered**:

- Bump app SemVer for a response correction: rejected because the public shape and supported behavior
  are compatible and this is not a release event.
- Add a second health field: rejected because it would introduce API surface without adding a fact
  the process can verify locally.
