# Implementation Plan: Close audited project debt

**Branch**: `main` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

## Summary

Repair the audited cache, UI and email-verification gaps; integrate reviewed dependencies; reconcile exact release evidence and safely preserved local work. Owner decisions remain explicit dependencies, not implied approvals.

## Technical Context

**Language/Version**: vanilla Node.js >=22.13.0, CommonJS server and native browser modules.
**Primary Dependencies**: existing workspace, Sentry, Puppeteer; no new runtime framework.
**Storage**: no schema changes; synthetic test stores only; local recovery archives outside Git.
**Testing**: node:test, real Chrome, ESLint, Prettier, JSDoc TypeScript, package and Docker smoke.
**Target Platform**: existing Linux immutable-image deployment; supported browser layouts/locales.
**Performance Goals**: preserve current immutable caching for verified resources; no new network lookup on analysis.
**Constraints**: payload privacy, authenticated creative boundary, module cleanup and exact-SHA deployment.
**Scale/Scope**: four user stories; audited Q1/Q5/Q6/Q7, email tests, three PRs, two release records, local artifacts and owner choices.

## Constitution Check

I: active package, analysis before implementation, task/evidence updates.
II: browser/HTTP/release readbacks distinguish historical and current evidence.
III: synthetic tests; private recovery archives outside Git; no raw payload or secret persistence.
IV: stable Core/API/storage contracts; cache identity is repaired at its owning HTTP boundary.
V: preserve existing Node/static handler and explicit module lifecycle. A bounded select enhancement is justified by Q5; no framework or global event facade.
VI: three locales, both themes and native semantic values stay synchronized.
VII: focused regressions precede full CI, package/browser/image gates. Full runner is serialized because its Chrome cleanup can affect other browser tests.
VIII: reviewed clean main, hosted checks, fresh canonical backup, deploy and readback; owner-only external actions require their specific choice.

Pre-research and post-design assessment: pass for independent correction scope. Pending owner choices are isolated in the inventory and do not expand scope.

## Design

### Resource delivery (US1)

Use a new version-token namespace to avoid reusing previously cached immutable URLs. Canonical asset identity is derived from exactly delivered bytes, including rewritten relative imports and injected module identities. Coupled module templates/styles share a deterministic bundle identity incorporating filenames and content boundaries. Accept immutable requests only on an exact supported token; reject stale/invalid/duplicate tokens with a non-cacheable 409. Unversioned requests remain revalidated. Never redirect stale versions to incompatible current bytes.

Load required styles and templates coherently, propagate aborts, and only use locale fallback for an absent translation (404). A failed deferred update must retain existing work and offer a localized recovery action rather than forcing a reload.

### Interface and locale (US2)

Unlock uses one modal-owned form with account username and current-password, a single guarded submit listener and preserved cleanup/session behavior.

Q5 uses one explicit select-only combobox enhancement for Inspector native selects: underlying select/options remain the source of truth; themed listbox provides accessible name/state, arrow/Home/End/typeahead, Enter/Space commit, Escape cancel, Tab dismissal, disabled handling and synchronized dynamic options. Component owns cleanup and integrates inside the existing Inspector mount, not a new shell-wide observer.

Q6 removes mismatched tab margins and applies shared geometry while preserving count meaning, colors and mobile reachability. Email tests invoke all three handlers with supported, unsupported and missing locale sources.

### Maintenance (US3)

Dependency review preserves Sentry minimum 10.72.0 and stable caret-major constraints, exact manifest/lock agreement and locked version >= requested floor; advisory checks remain independent. Combine PRs only after review and finish their GitHub dispositions after integrated gates.

Release records use exact tag revisions and existing changelog sections. Reconcile current status without rewriting historical outcomes. Inventory all local WIP using metadata and private archives; compare against current implementation before proposing restoration or cleanup. Apply received owner answers; absent an answer, retain the explicitly stated existing repository/npm/monitoring baseline and keep future capabilities in a separate development plan. This assumption does not authorize external changes.

## Project Structure

- `server.js`, optional `lib/static-assets.js`: one static-resource identity owner.
- `public/core/registry.js`, `public/modules/inspector/index.js`, `public/shell-boot.js`: loading/recovery.
- `public/modules/inspector/select-control.js`, `inspector.css`, `public/ortbtools.app.js`: explicit selection enhancement and tab repair.
- `public/modules/unlock/index.js`: credential form ownership.
- `tests/asset-version-contract.test.js`, `tests/asset-deploy-browser.test.js`, `tests/inspector-ui-closure-browser.test.js`, `tests/auth.test.js`, `tests/dependency-security.test.js`: regression owners.
- `specs/019-close-project-debt/`: research, contract, inventory, tasks and verification evidence.
- Existing baseline, privacy, operations, release and feature records: canonical status updates.

## Phases and Ownership

Foundation precedes three independent implementation lanes: resource delivery, UI, dependency review. Parent owns email tests, inventory, documents, versioning and all GitHub/release/deployment mutations. Shared files are coordinated before edits; agents never update the same tasks file or version surfaces. Integration is serial after the lanes finish.

## Complexity Tracking

No constitution exception. The select component is scoped to an existing reported interface contract and retains native data semantics. Static helpers may be extracted only to test the existing pipeline in isolation, not to introduce a bundler.

## Confirmed adjacent Blog closure (US4)

Added after the D22 evidence gate: Admin renders arbitrary draft URLs; promote accepts rejected status and a stored traversal locale, overwrites existing articles, and admits frontmatter keys through title line breaks. Scope is the previously named boundary, not a CMS redesign. Validate at the promotion handler before side effects, preserve supported state transitions explicitly, require public-route-compatible slug/locale/category, create files exclusively, and serialize scalar metadata so both current readers preserve text without admitting new keys. Share the existing frontmatter parser if needed to prevent API/SSR divergence. Admin source links accept unambiguous HTTP(S) only. All probes use synthetic temporary content and mocked ClickHouse. No production content migration or new network destination.

Owned by the Blog lane: modules/admin/blog.js, public/modules/admin-blog/index.js, existing lib/blog-service.js and modules/blog/handler.js parser seams if necessary, and focused promotion/Admin DOM tests. Parent independently traced the boundary and owns baseline/privacy updates. Complete T027–T030 before final integration T021–T026.

## Event-log verification closure

The first full runner exposed ten explicitly disabled SQLite-era tests in tests/event-log.test.js. FR-014/SC-008 replace that retired contract with synthetic HTTP-boundary checks of the existing ClickHouse implementation: observable outgoing batches, input bounds, filters, returned row mapping, failure/no-op behavior and server-owned TTL retention. Do not create a fake SQL engine or require production services; preserve the existing auth-event privacy suite. A disposable ClickHouse container can separately validate actual Blog mutation/readback syntax against the locally available production-line image; keep its content and credentials synthetic and remove its resources afterward.
