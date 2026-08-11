---
description: 'Evidence-backed capture and maintenance record for the current platform baseline'
---

# Tasks: Platform Baseline

**Observed**: 2026-08-11
**Status**: Current

This file records construction of the baseline and defines its maintenance triggers. It is not a
product backlog; proposed changes and ordering belong to a feature package and `specs/ROADMAP.md`.

## Initial Capture

- [x] B001 Verify declared app, Core, CLI, and Node versions from package manifests
- [x] B002 Verify Core exports, finding finalization, validation coverage limits, and CLI exit
      semantics from implementation and tests
- [x] B003 Verify backend router registration, route groups, access gates, request limits, and error
      boundaries from `server.js`, `lib/`, and `modules/`
- [x] B004 Verify lazy SPA registration, persistent chrome ownership, section cleanup order, and
      compatibility globals from `public/shell-boot.js`, `public/core/`, and `public/modules/`
- [x] B005 Verify SQLite schema v10 entities, foreign-key deletion rules, and separately initialized
      synthetic specimen cache
- [x] B006 Verify ClickHouse analytics/event/blog entities and their disabled/degraded behavior
- [x] B007 Verify raw browser history, per-tab crypto state, preferences, and derived discovery
      storage boundaries
- [x] B008 Verify hosted processing, official browser encryption, direct-client caveat, explicit
      Behavior Corpus retention, and deletion/wipe boundaries
- [x] B009 Verify locale routes, translation owners, independent SemVer surfaces, and version guards
- [x] B010 Verify hybrid content reads, default-deny indexability, SSR, canonical/hreflang ownership,
      sitemap, RSS, and real-404 behavior
- [x] B011 Verify immutable image contents, single runtime mount, release provenance, readiness/smoke
      commit point, and rollback state machine
- [x] B012 Map each conclusion to executable code, tests, or a retained conventional contract in
      `research.md`
- [x] B013 Author current scope, architecture, entities, and validation routing without historical
      backlog or production records
- [x] B014 Author Core/API, frontend, retention, content/SEO, release/deploy, and locale/version
      contracts
- [x] B015 Format every authored baseline file with the repository Prettier configuration
- [x] B016 Verify all local Markdown links and reject unresolved template/clarification markers

## Maintenance Triggers

Update this baseline in the same feature whenever a change alters one of these boundaries:

| Trigger                                                                                      | Required baseline update                                                      | Required companion evidence                    |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| Core export, finding shape/order, detector, dialect, or coverage                             | `contracts/core-validator.md`, and `spec.md` when product scope changes       | Core API/rule tests and compatibility decision |
| Route, method, access gate, error envelope, limit, or external integration                   | `contracts/http-api.md`, plus retained API docs for stable public changes     | Handler/router/API tests                       |
| Section registration, mount context, cleanup, storage, or compatibility global               | `contracts/frontend-modules.md`                                               | Re-entrancy/window/module tests                |
| Collection, plaintext/ciphertext boundary, schema, retention, deletion, backup, or telemetry | `data-model.md` and `contracts/data-retention.md`, plus privacy/security docs | Privacy, crypto, DB, and retention tests       |
| Canonical route, locale, landing, post source, indexability, SSR, sitemap, or RSS            | `contracts/content-seo.md`                                                    | Locale/SEO/content tests                       |
| User-visible language or app/Core/CLI version                                                | `contracts/locales-versioning.md`                                             | Locale parity and version tests                |
| Image contents, mount, readiness, deployment state, rollback, or backup path                 | `contracts/release-deploy.md`, plus operations docs                           | Immutable-image and shell simulation tests     |
| New subsystem, framework, database, service, or cross-cutting abstraction                    | `plan.md`, relevant contract, and an ADR                                      | Feature plan and architecture-specific tests   |

## Completion Rule

The baseline remains `Current` only while [checklists/baseline.md](./checklists/baseline.md) passes.
An accepted feature that intentionally changes current behavior updates the affected files before its
own tasks can converge. Evidence commands and their outcomes belong to that feature's `tasks.md`, not
as accumulating history here.
