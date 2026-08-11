# Implementation Plan: Dependency and Sentry Refresh

**Branch**: `chore/dependencies-sentry-rebase` | **Date**: 2026-08-11 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from `specs/002-dependency-sentry-refresh/spec.md`

## Summary

Refresh the reviewed dependency graph from the current Spec Kit-enabled `main`, using a compatible
`@sentry/node` 10.x update and bounded transitive resolutions to remove all current npm audit
findings. Preserve the existing health response shape while redefining `sentry.ready` precisely as a
locally accepted SDK destination, not an upstream reachability or delivery probe. Replay only the
valid code, lockfile, test, environment, and operations changes from draft PR #57; do not restore the
retired root architecture or roadmap files. Verify the result through isolated no-egress Sentry
tests, clean lockfile installation, dependency-tree and audit gates, package/application smoke, full
CI, and Spec Kit convergence.

## Technical Context

**Language/Version**: JavaScript on Node.js `>=22.13.0`; JSON npm manifests/lockfile; Markdown

**Primary Dependencies**: `@sentry/node` `^10.70.0`; transitive OpenTelemetry 2.10.x;
`brace-expansion` `5.0.9`; `undici` `7.29.0`; existing Pino logger and `node:http` health handler

**Storage**: npm `package-lock.json`; no application database, browser storage, analytics, or schema
change

**Testing**: `node:test`, isolated child processes, an in-memory Sentry transport, `npm ci`, `npm ls`,
full and production-only `npm audit`, npm package smoke, application/Docker smoke, and `npm run ci`

**Target Platform**: Linux production container and local/CI Node.js environments at the declared
runtime floor or newer

**Project Type**: Brownfield Node.js web application with Core and CLI npm workspaces

**Performance Goals**: No new tracing or telemetry volume; Sentry-disabled boot and health remain on
their current synchronous paths; verification uses bounded child-process and flush timeouts

**Constraints**: No real DSN or network egress in tests; no payload/PII capture; no unrelated direct
major upgrades; no public response-shape change; no package publication, merge, deployment, or
production configuration mutation

**Scale/Scope**: One direct runtime dependency, its affected transitive graph, two runtime modules,
five focused or contract test files, retained environment/operations documentation, and canonical
Spec Kit feature/baseline/roadmap artifacts

## Constitution Check

_GATE: Passed before Phase 0 research and re-checked after Phase 1 design._

| Principle                              | Gate                                                                                                            | Result |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| I. Spec Kit Is the Working Memory      | Feature 002 owns spec, plan, research, contracts, tasks, evidence, and convergence                              | PASS   |
| II. Truth Is Evidence-Backed           | Baseline audits were rerun against npm; lockfile and old PR are treated as evidence, not intent                 | PASS   |
| III. Privacy and Security Boundaries   | Tests use a synthetic DSN and in-memory transport; no payloads, secrets, PII, or private incidents are recorded | PASS   |
| IV. Deterministic Public Contracts     | `/api/health` shape and logger exports remain compatible; semantics are pinned by boundary tests                | PASS   |
| V. Explicit and Bounded Architecture   | Existing Pino/Sentry wrapper and injected health handler are retained; no tracing or proxy redesign             | PASS   |
| VI. Locale Meaning Moves Together      | No end-user localized surface changes; operator wording changes only in retained English runbooks/config        | PASS   |
| VII. Proportional Verification         | Targeted tests precede clean install, audits, package/app smoke, full CI, analysis, and convergence             | PASS   |
| VIII. Traceable Releases and Mutations | No SemVer bump, publication, merge, deploy, or real destination verification is authorized                      | PASS   |

## Project Structure

### Documentation (this feature)

```text
specs/002-dependency-sentry-refresh/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/
│   ├── requirements.md
│   └── security-release.md
├── contracts/
│   ├── dependency-refresh.md
│   └── sentry-health.md
└── tasks.md
```

### Repository Changes

```text
package.json
package-lock.json
.prettierignore

lib/logger.js
modules/health/handler.js

tests/logger.test.js
tests/health.test.js
tests/dependency-security.test.js
tests/docs-truth.test.js
tests/spec-kit-contract.test.js

.env.example
docs/OPERATIONS.md
specs/ROADMAP.md
specs/000-platform-baseline/
├── plan.md
└── contracts/
    ├── http-api.md
    └── release-deploy.md
```

The old PR's edits to deleted root `ARCHITECTURE.md` and `ROADMAP.md` are not replayed. Any still-valid
current-state statement is reconciled into the feature contracts, canonical baseline, or
`specs/ROADMAP.md`. The machine-local, gitignored `.specify/feature.json` pointer is excluded from
repository-wide formatting so deterministic Spec Kit pointer refreshes cannot break CI.

**Structure Decision**: Keep telemetry initialization behind `lib/logger.js`, keep health reporting
inside the existing injected handler contract, and make the lockfile the reproducible dependency
authority. Feature contracts own the exact change; the platform baseline is updated only where the
as-built release/observability contract changes.

## Implementation Phases

1. Run `speckit.analyze` on the complete design/task package and resolve every critical/high finding
   before changing runtime or dependency files.
2. Reconcile the old draft commit against current `main` without restoring retired documentation.
3. Refresh the manifest and lockfile only to the reviewed compatible versions needed for zero audit
   findings; inspect the complete lock diff and declared engine ranges.
4. Tighten local Sentry configuration detection and add no-egress subprocess/health tests.
5. Remove target-specific deployment assumptions from logger comments and update retained
   operator/environment wording plus canonical Spec Kit baseline/API/roadmap truth.
6. Run targeted checks, exact-floor clean install, dependency-tree/audit gates, package/app smoke, and
   full CI.
7. Re-run the non-destructive consistency review, converge, record exact evidence, then update draft
   PR #57 only after
   confirming the intended lease-protected rewrite from local `chore/dependencies-sentry-rebase` to
   remote `chore/dependencies-sentry`.

## Complexity Tracking

No constitution violations require justification. The in-memory transport and child process are
necessary test boundaries because Sentry configuration is evaluated at module load and must be
verified with the actual SDK without external network access.
