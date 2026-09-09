# Implementation Plan: Close the cleanup inventory

**Branch**: `codex/maintenance-cleanup-20260909` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

## Summary

Close every named open maintenance item with before/after evidence. Deliver Core correctness first, current-action UI ownership, explicit degraded behavior and trustworthy test infrastructure. Work runs in bounded ownership lanes, then converges in one governed release.

## Technical Context

Node 22 application, CommonJS Core, vanilla browser JavaScript and existing UMD browser generation. Existing node:test/Puppeteer, ESLint and TypeScript checks; no new dependency/framework/service. No storage schema changes. Scope is the original 26 IDs plus negative-floor and CL-08/09. Avoid payload copies except transient immutable analysis snapshots already required by processing. Existing browser generation and mount lifecycle remain authoritative.

## Constitution Check

I: feature spec/plan/tasks/checklist and pre-implementation analysis; phase evidence updated throughout.
II: isolated before/after assertions; distinguish decisions from implemented fixes and deployment from source.
III: no production records, payload logging, auth weakening, new creative fetch or retention.
IV: explicit [ADR-018](../decisions/ADR-018-maintenance-boundaries-and-degradation.md); legacy IDs/order/flat fields retained; additive metadata and fault semantics tested.
V: small modules within existing ownership, no new framework/router/pipeline; lifecycle cleanup remains scoped.
VI: EN/UK/RU messages and UI move together.
VII: focused tests before full settled Linux/corpus/browser/package/Docker/hosted gates.
VIII: authored-only commit/nonforce main push, exact-commit hosted success, fresh verified backup and canonical exact-SHA deployment.
Pre-research and post-design review: no constitution exception required. Extension hooks are empty.

## Project Structure and Ownership

- Core lane: `packages/core/auction-view.js`, its generated browser mirror/compatibility wrapper, `packages/core/index.js`, `crosscheck.js`, detection/feed/fingerprint/price/family rules, catalogs/spec refs, Core README/VAST docs and relevant tests. Own `scripts/gen-browser-core.js` and generated registry.
- UI lane: `public/ortbtools.app.js`, new `public/modules/inspector/analysis-run.js`, templates/CSS, partners/Intel/dialects/session utilities, web locales/shells and UI regression tests. Consume Core-generated auction/registry exports; do not edit their source.
- Infrastructure lane: `scripts/run-tests.js`, owned-process helper/tests, browser-only npm script, lint config, test-file lint corrections, finding-ID compatibility tests/docs.
- Root integration: `auth.js`, auth/findings/analyze HTTP handlers and tests; per-side metadata; current contracts/ADR/inventory/version surfaces; final review/gates/release.
  All workers are in one shared worktree and must not revert peer edits. File ownership changes require a handoff.

## Phase Design

1. Record spec, pinned normative mapping, compatibility choices and per-ID acceptance; analyze before implementation.
2. Core: dependency-free UMD auction view exports `classifyAuctionPayload`, `buildRequestView`, `buildResponseView`, `flattenBids`, `projectRequestForRules`, `projectResponsePairRequest`. Preserve original raw identity/path and old classifier wrapper. Generate dialect registry via the existing generator. Add explicit mappings rather than consumer-wide projections.
3. Preserve price IDs while sharing classification; add unusable negative floor and localized faults. Plugin applies and validate are both contained. Incomplete metadata survives filtering and prohibits a clean status.
4. UI: explicit run controller, current-owner commit checks, normalized matched item dimensions/slots/strip; preserve 031 vendor/selected-creative behavior. Restore owned onboarding slot, live region and exhaustive partner envelopes. Side provenance is structural.
5. HTTP: add `sides` without altering legacy combined behavior, carry incomplete metadata, factor existing prefix decoration. Logout failure remains observable after cleanup; catalog failures recover without process restart.
6. Infrastructure: scope process cleanup to owned run/attempt profiles/PIDs; preserve original retry logs; test interruption/concurrency/missing prerequisites. Correct all 18 lint sites with ownership split, then enable both rules.
7. Document retained APIs/naming, CL-08 boundary decision and CL-09 assertion-level inventory. Reconcile every original ID separately, preserving no-new-fix distinctions.
8. Converge, run full required gates and deploy. No incomplete task is hidden by a fresh suppression, known gap, guessed flake label or changed oracle.

## Validation Strategy

Each behavioral fix gets public-boundary regression evidence before closure. Dead selectors/keys/comments are statically verified and covered by existing suites instead of mirroring implementation. Preserve all 258 current corpus cases and their independently attributed expected behavior; actual runner output remains count authority. Browser tests use synthetic data and mock fault responses. Full CI runs once the final scope settles, using isolated Linux for GNU/Linux orchestration tests.

## Supporting Artifacts

[Research](research.md), [transient model](data-model.md), [compatibility](contracts/maintenance-compatibility.md), [quickstart](quickstart.md), [requirements checklist](checklists/requirements.md), [tasks](tasks.md).

## Complexity Tracking

No governance exception. Shared views/controller/process helper replace measured duplicated ownership within existing subsystems; ADR-018 documents their boundaries and alternatives.
