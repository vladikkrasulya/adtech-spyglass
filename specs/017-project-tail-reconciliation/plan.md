# Implementation Plan: Project Tail Reconciliation

**Branch**: `main` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-project-tail-reconciliation/spec.md`

## Summary

Reconcile the mechanically closable results of the project-wide loose-end inventory without
silently deciding owner-only questions. The delivery corrects canonical documentation, completes an
evidence-bounded set of release references, repairs rollback-image retention to use actual creation
time, archives one exact legacy backup tree without deleting it, and refreshes dependency PR #4
through the normal repository and image gates.

## Technical Context

**Language/Version**: Markdown; Bash on the production Linux host; Node.js `>=22.13.0` for repository
verification

**Primary Dependencies**: Git, GitHub CLI/API, Docker CLI/daemon, Prettier, ESLint, TypeScript/JSDoc,
Node test runner

**Storage**: Git refs and working tree; GitHub tags/releases/PR state; local Docker image metadata;
host backup filesystem

**Testing**: `git diff --check`, Prettier, `npm run lint`, `npm run typecheck`, Node test suite,
package smoke, Docker production smoke, shell syntax checks, and external-state readback

**Target Platform**: Repository CI plus the existing Linux production host

**Project Type**: Maintenance across repository documentation, release metadata, and host operations

**Performance Goals**: Cleanup remains bounded to the repository's image inventory and completes in
one scheduled maintenance run; no application-path performance changes

**Constraints**: Preserve unrelated work and all owner-decision items; do not publish npm packages,
restore/migrate data, change production alerting, rename the repository, force-push, or deploy; never
invent historical release mappings; preserve archived backup bytes

**Scale/Scope**: 27 evidence-backed releases, one dependency PR, one legacy backup tree, one host
cleanup script, and the deduplicated mechanically closable documentation findings

## Constitution Check

_GATE: Passed before research and re-checked after design._

- **I — Spec Kit memory**: PASS. This package owns the accepted cleanup and separates it from the
  still-open owner decisions.
- **II — Evidence-backed truth**: PASS. Every status, release mapping, runtime claim, and PR outcome
  requires repository or live-state readback.
- **III — Privacy/security**: PASS. No payload, secret, production record, or backup contents enter
  tracked artifacts. The named backup tree is moved intact and content-hashed for integrity, never
  restored or copied into the repository.
- **IV — Compatibility**: PASS. The maintenance commit does not change application contracts. The
  dependency proposal remains isolated and gate-controlled.
- **V — Bounded architecture**: PASS. Existing documentation, GitHub, Docker, and host-maintenance
  paths are corrected; no new framework or service is introduced.
- **VI — Locale parity**: PASS. The change reconciles documentation for all three supported locales
  and the existing fallback contract; it adds no new UI copy.
- **VII — Reproducible verification**: PASS. Narrow readbacks precede the complete repository,
  package, and production-image gates.
- **VIII — Traceable releases**: PASS. Only proven version/revision pairs receive immutable metadata.
  The user's explicit continuation authorizes the named GitHub and archival actions; normal
  non-force commit/push gates remain mandatory. No deployment or npm publication is in scope.

Post-design re-check: PASS. The artifacts below add no exception to the constitution and keep the
dependency proposal separate from the maintenance commit until its own hosted checks are green.

## Project Structure

### Documentation (this feature)

```text
specs/017-project-tail-reconciliation/
├── checklists/
│   └── requirements.md
├── contracts/
│   └── reconciliation.md
├── data-model.md
├── plan.md
├── quickstart.md
├── research.md
├── spec.md
└── tasks.md
```

### Changed surfaces

```text
docs/
├── OPERATIONS.md
└── USER_GUIDE.md
packages/
├── cli/README.md
└── core/README.md
scripts/
├── assemble-adjudication.js
├── ci-docker-smoke.sh
└── cleanup-rollback-tags.sh
specs/
├── 009-inspector-defect-repair/tasks.md
├── 010-button-confirmation-fit/tasks.md
├── 016-ext-key-alphabet/{spec.md,tasks.md}
├── 017-project-tail-reconciliation/
└── ROADMAP.md
tests/
├── cleanup-rollback-tags.test.js
└── immutable-image.test.js
walkthrough.md

host-only:
/home/vk/.local/bin/cleanup-server.sh
/srv/DATA/Backups/{ortbtools,archive}/

external:
Git tags and GitHub Releases for the 27 proven mappings
GitHub dependency PR #4
```

**Structure Decision**: Repository changes stay with their existing canonical owners. The installed
host cleanup script delegates rollback retention to a repository-owned helper so failure behavior is
regression-tested; the legacy backup tree moves to the established backup root's explicit archive
directory, and external release/PR state is verified by readback rather than mirrored into a new
application subsystem.

## Complexity Tracking

No constitution violations require justification.
