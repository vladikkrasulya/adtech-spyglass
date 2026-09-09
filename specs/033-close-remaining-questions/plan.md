# Implementation Plan: Close the remaining product questions

**Branch**: `codex/close-remaining-questions-20260909` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

## Summary

Deliver the eight accepted residual outcomes in one tracked feature, with independently owned phases and a single integrated release. Evidence-backed design is recorded in [research.md](research.md) and [ADR-019](../decisions/ADR-019-residual-product-boundaries.md). Pending credentials or physical-device execution stay open while independent implementation continues.

## Technical Context

- Language/runtime: existing Node 22+, CommonJS Core and native browser modules; no new application framework.
- Dependencies: existing better-sqlite3, bcrypt, Puppeteer, jsdom and owned runner. Official Firefox/Safari automation and Go 1.25.0 are verification tools, not application dependencies.
- Storage: existing SQLite schema; mapping row version2 uses existing columns. A private bounded auth recovery checkpoint is added under the existing application data directory. No raw payload or cookie logging.
- Platforms: immutable Linux production image on vkbox, isolated Linux full CI, native macOS browsers and available physical devices.
- Tests: Node public-boundary regressions, real process restart/fault tests, browser user journeys, normative corpus and a network-disabled direct-adapter witness harness against pinned retained sources.
- Performance: no network in Core; no new background asset fetch; existing resource, request and storage caps remain enforced. Bounded revocation maintenance is tied to session expiry.
- Scope: eight stories, nineteen pinned dialect witnesses, explicit SChain controls and a measured browser/device matrix. External observations are not represented as synthetic passes.

## Constitution Check

1. I: one active033 package, pinned Spec Kit0.16.2, empty hooks, explicit tasks and evidence; prior032 completion remains historical.
2. II: real SQLite/browser reproductions confirm logout revival and timing assumptions; push style loss is reproduced; sources and source hashes back D18/D19; final state depends on actual runs.
3. III: auth persistence, mapping scope and asset disclosure update privacy/security contracts and fault tests in the same change. All tracked fixtures/evidence are synthetic or redacted.
4. IV: preserve legacy finding IDs and exact mapping interpretation. New fields/routes and optional-field severity corrections are explicit ADR decisions. Core remains deterministic.
5. V: reuse auth, handler modules, action-modal lifecycle, native styles, existing asset fetch and plugin registration. The recovery checkpoint is a narrowly justified security component.
6. VI: all visible controls, failures and findings have EN/UK/RU parity and informal UK/RU address.
7. VII: focused checks precede integrated Linux CI/corpus/package/Docker and exact hosted gates. Real browser/device evidence is distinct from emulation.
8. VIII: authored commits/nonforce main push and canonical verified backup/deploy/rollback only after their gates. No registry publication or direct production data inspection. Routine first-installation session invalidation is an explicit auth behavior change, not a payload migration.

No constitution exception is proposed. Post-design review must independently challenge failure and compatibility boundaries before implementation. A fresh security-review agent could not be created because the tool reported an agent thread limit; a separate read-only boundary pass by an existing investigator and root tracing supply the documented fallback required by fix-finding.

## Design and Ownership

### Auth and test synchronization — desktop_matrix

Own `auth.js`, the Sessions section of `db.js`, new `lib/session-recovery.js`, shutdown/auth composition in `server.js`, auth handler changes and focused auth/restart tests. Own the sample-readiness helper and `tests/clear-resets-results-browser.test.js`.

Use strict versioned recovery state, atomic write+file/directory fsync, an exclusive owned-process boundary and a durable dirty-start fence armed before hydration or session creation. A known session's revocation intent precedes DB deletion. Hot denial and cookie/DEK cleanup remain unconditional. Clean shutdown is only possible after HTTP drain and durable accounting for every revocation. Uncertain recovery invalidates old sessions durably before authentication; failed recovery cannot hydrate or issue sessions. Expiry, dedup and known-token-only recording bound the journal.

Persist versioned HMAC lookup keys instead of raw bearer tokens; retain the protected key across orderly restarts, with no raw-token fallback. Initial legacy-session rows are durably invalidated. Older images cannot authenticate newly issued raw cookies; lost recovery state cannot silently restore legacy rows. Test restart, crash, total-write failure, unknown token flood, ordinary continuity and older-code hydration explicitly. Password reset keeps its existing atomic data transaction and shares the revocation boundary; stale pre-reset credential proof cannot mint a later session.

The browser test waits for the specific synthetic sample response, matching editor content and enabled Analyze after the real menu action. Held responses establish the regression; never replace it with a longer fixed delay. Timeout diagnostics are bounded stage/length/counter/state data.

### Mappings and creative resources — ui_consistency_audit

Own mapping CRUD/import/export in `modules/dialects/handler.js`, DialectMappings sections of `db.js`, mapping runtime/resolution changes, account/mapping UI and public creative-asset collection/render lifecycle. Coordinate `db.js` by named section and `public/ortbtools.app.js` by functional boundary; never revert peer edits.

Mapping API adds `match_scope: value|path`; omission preserves legacy exact semantics. Row version1 stays exact. Version2 means a normalized-path role and canonical empty `signal_value`, with meaning derived exclusively from version. Only nine non-format roles allow path scope. Exact wins, duplicate path scope is deterministic, unknown versions never broadly match. Exports containing path rows use schema2; schema1 remains accepted and exact-only exports remain compatible. Full CRUD/readback, cache invalidation, activation and private-value omission are observable user behavior.

Extend the existing collector/rewrite into a per-render resource manifest for raster img/poster, responsive image slots and inline/embedded CSS images. Preserve full-document head/styles/doctype. Never inspect script/text as resource code or fetch remote CSS/fonts/scripts/frames/media. Surface hosts/roles/caps/individual outcomes and retry unresolved resources only; cancellation stops queued work and late responses cannot replace a later creative. Use the existing authenticated pinned-address raster endpoint unchanged unless a proven boundary fix requires a coordinated amendment. Enable the same explicit action for synthetic Native.

### SChain and dialect evidence — linux_gate

Own SChain pure parser/inspection and rule modules, Core public exports/options and message/spec-reference changes, declared-route pure evaluation/profile data, nineteen direct-adapter witnesses and supported corpus corrections. Root integrates HTTP; coordinate mapping-related Core files with the UI owner.

Pure inspection accepts structured chains, raw serialized chains or an explicit serialized query parameter; it performs no fetch. Preserve field/node boundaries before decoding and reject ambiguous repeated parameters. Compare valid copies semantically, preserving node order; normalize seller domains only, not seller-account case. Report duplicate identity and declared-sender mismatch without inferring inventory ownership. Retain legacy optional-field IDs under corrected nonblocking guidance where applicable; no fabricated four-node video rule. Source-backed supplied-type errors remain.

Freeze the19 witness IDs before execution, deep-clone each input and inspect MakeRequests output without HTTP. Pin source revision, Go toolchain, dependencies and network-none execution. Transformation functions and identity-based fanout are separate explicit oracles. Preserve original36pass/12inconclusive history, add a new measured generation, and alter only witnessed corpus claims.

Declared-route context is `{adapterId,direction,revision,provenance:'declared'}`. Missing/unsupported/incompatible contexts yield unknown. Return source-linked profile applicability, never actual-traffic prevalence or inferred vendor ownership. Profile metadata is a bounded pinned public catalog.

### Integration, browser matrix and release — root

Own the new bounded inspection HTTP module, composition integration outside the auth shutdown block, user-facing inspection actions in coordination with the UI owner, cross-browser/saved-history test harness, current docs/ADR/version/release ownership, Cloudflare saved setting and deployment. The exact endpoint contract is [inspection.md](contracts/inspection.md).

Use isolated temporary accounts/data and fixture resources. Run native installed browsers through owned test sessions; install official Firefox tooling if needed. Native zoom uses actual browser controls and records their indication; VoiceOver records actual announced behavior. Probe available physical devices; unavailable ones remain open. Do not use private production saved records. Cloudflare auto-injection is disabled for the single site, with saved-state and real-browser readback; no-transform is not substituted because it affects unrelated CDN transforms/security behavior.

The owner's2026-09-09 execution constraint moves every further browser run to vkbox. All owned laptop browser/driver processes are stopped; the laptop must not be activated for Safari or VoiceOver. Server Chromium/Firefox use isolated profiles, synthetic data and virtual displays. Linux WebKit, if used, must be identified as that engine and cannot be counted as native Safari or VoiceOver. Preserve already executed macOS receipts separately from subsequent Linux receipts.

## Project Structure

- Feature: spec, plan, tasks, inventory, research, data-model, quickstart, verification, checklists and contracts under033.
- Runtime: existing root auth/server/db, `lib/`, `modules/`, `packages/core/`, `public/modules/` and `public/ortbtools.app.js`.
- Evidence: external task bundle for raw captures, fault logs, screenshots and archived-adapter harness output; only synthetic bounded manifests/results enter Git.

## Integration Sequence

Research and ADR/contracts precede implementation. Auth/tests, mapping/assets and SChain/witnesses run in parallel with root browser preparation. Integrate the declared context and inspection UI after pure/HTTP contracts exist. Then update baseline/public docs and independent versions (planned app1.23.0, Core0.48.0, CLI0.1.5), run focused combined checks, full Linux CI and corpus, independent convergence, exact hosted gate, backup and canonical deploy. Verify public behavior and reconcile records without pretending an unavailable check passed.

## Complexity Tracking

The recovery checkpoint is required by the reproduced inability to persist a DB revocation; an in-memory denylist does not survive restart and a fallback file alone cannot prove safety after total-write failure. Versioned keyed DB identities preserve safe downgrade behavior. No other new framework/service/storage system is introduced.

### Process ownership lock

The private recovery directory also contains a fixed-path SQLite ownership sidecar using the existing better-sqlite3 dependency. A lifetime `BEGIN EXCLUSIVE` transaction supplies an OS-released crash-safe lock on Linux and macOS; it contains no application tables or rows. Acquisition uses a bounded busy timeout and fails closed. No PID-file stale-lock recovery is used. Concurrent-owner and actual crash-release regressions cover the boundary. This is an ownership mechanism, not an additional application data store.
