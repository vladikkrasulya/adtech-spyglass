# Verification and delivery evidence

**Outcome: complete.** All 34 tasks are closed. Version 1.19.4 was released and deployed from source cut `e6c3d8e4d7ee2be639727e5c7d91f600f9321e0e`; all 2976 tests pass without failures or skips. [Release record](https://github.com/vladikkrasulya/adtech-spyglass/releases/tag/v1.19.4).

## Pre-implementation analysis — 2026-09-07

Spec Kit prerequisite check resolved this feature with spec, plan, research, data model, contract, quickstart and 26 tasks. Requirements checklist: 6 complete, 0 incomplete. Extension hooks: none.

Cross-artifact review: 12 functional requirements and 6 buildable success criteria have task coverage. US1 maps T006-T009; US2 maps T010-T014; US3 maps T015-T020; integration/closure maps T021-T026. FR-008/009/012 also map the inventory foundation. No unmapped tasks, critical/high contradictions or unresolved implementation choices. Owner-dependent actions are explicitly separated, and no owner approval is inferred. Implementation may proceed on the independent scope.

## Initial live and repository state

Read-only checks on 2026-09-07: local main and origin/main match GitHub main at 2f9c3a99074ac1e39c702c8730824e2c333a330c. Local and public /api/health report that build, database true and optional Sentry ready false. Container image ortbtools:2f9c3a9 reports application 1.19.3, healthy, restart always and zero restarts. Hosted CI 33959249196 is successful, including package and Docker smoke.

GitHub has zero open issues and three open dependency PRs 78-80. Tags 1.19.2 and 1.19.3 exist at 02e3a1d and 2f9c3a9 respectively; their Release records are absent. Current public stylesheet with an invented version returns 200 and immutable caching, confirming the resource contract defect.

## Implementation and release

Completed. The delivery checkpoint below records exact commands, gates, backup archives, runtime identity and release readback. Earlier sections retain the historical investigation sequence.

## Completed focused verification

- `node --test tests/auth.test.js tests/locale-routes.test.js`: 98 tests passed, zero failures/skips. All three email routes exercise eleven locale-source scenarios and assert exactly one correct email/token kind. The parser now ignores malformed percent encoding; shared server wiring is updated in the resource lane.
- Changed auth/parser files pass Prettier and ESLint.
- Dependency guard focused suite: 5 tests passed on both existing and combined dependency graph; five accepted and 28 rejected range/lock cases. Advisory predicates unchanged.
- Historical Releases v1.19.2 and v1.19.3 created and read back exactly: tags, full revisions, names, changelog bodies, draft=false and prerelease=false all match.

## D22 boundary investigation

Independent static trace and synthetic probes confirmed: Admin table creates executable-scheme hrefs; promote accepts a rejected draft, permits stored locale traversal, overwrites existing slug files, and allows title line breaks to inject indexability metadata. Unicode generated slugs can create articles the public route cannot read. SSR source-link filtering is already correct. Feature scope expanded with US4/FR-013/SC-007 and T027–T030 before patching. No production content or live ClickHouse was accessed.

## Monitoring preparation

Read-only container configuration check confirmed Telegram token and admin destination are present; Sentry is unconfigured. No credential values were printed. `node --test tests/notify.test.js tests/email.test.js` passed 19/19 with mocked HTTPS. Server fatal handlers and lib/http.js 5xx alerts call the existing notifier; this verifies local coverage, not actual upstream delivery. No unsolicited test message was sent.

## UI closure

The new populated browser regression passes across three locales, four widths and two themes, including Chrome accessibility-tree naming, keyboard/typeahead, disabled and dynamic options, touch, lifecycle cleanup, escaped account username, duplicate submission and canceled-dialog completion. Existing desktop-density, mobile-Inspector and shared-control browser suites pass 3/3; session/disclosure/lifecycle/window/modal checks pass 67/67. Populated desktop light/dark and phone screenshots were inspected. Scoped formatting/lint and repository TypeScript pass. All parallel UI browsers are stopped before the full runner.

## Resource closure

Focused asset/origin/site/lifecycle/window/session checks pass 76/76; new real-Chrome cross-release cases pass 4/4; existing creative-preview browser passes 1/1; asset and immutable-image cases pass 62/62. TypeScript, scoped ESLint/Prettier and diff whitespace checks pass. An independent AST inventory verifies all 80 actual static/dynamic imports and reexports receive versioned references. Warm production render identities reuse the immutable-image cache (representative 0.002–0.027 ms); mutable fixture/development roots verify actual bytes and directory membership.

Recovery preservation applies to clients with the repaired registry. An already-open pre-019 tab retains its old cached lifecycle code until refreshed; the server still refuses incompatible current bytes at its stale URLs. No claim is made that already delivered browser code can be remotely replaced.

## Independent integration review

A separate US1 review found an async-mount transition not covered by the initial passing cases: starting a failed navigation while the current mount still awaited data aborted that visible section through the shared pending pointer. Its DOM remained but its lifecycle was dead. T008/T009 reopened for the owner to correct this transition and add the observable regression before full gates.

## Review corrections and settled integration candidate

The active-mount regression now reproduces red before correction and passes with preserved input/listener/signal, candidate cleanup and eventual exactly-once teardown; 50 related lifecycle/window/session checks pass. Independent asset review rendered all 124 current JS/CSS/HTML assets and compared 80 imports across 90 JS files without another confirmed discrepancy.

The required fresh Blog candidate reviewer found two scalar representations: U+2028/U+2029 titles were dropped and prevented retry reconciliation; unconditional JSON decoding reinterpreted valid legacy backslash escapes. Parent independently reproduced both. New files now declare `frontmatter_encoding: json-v1`, escape both Unicode separators and decode only with that exact marker; unmarked legacy files retain their original grammar. The corrected focused ten-file suite passes 209/209, including both public readers and both uncertain-status retry modes. TypeScript and owned lint/syntax/whitespace checks pass. No production content was read or changed during patch verification.

First complete authored-candidate run exposed four outdated documentation/version guards and one browser guard measuring the now-hidden native selects. Version baselines and the Blog contract guard now express current behavior. The browser guard now measures the visible comboboxes and selects options with real clicks; it passes 1/1. No behavioral assertion was removed. The final complete run below uses the combined dependency graph.

Exact package patch bytes from PRs 78/79/80 are integrated together. `npm ci` succeeds; `npm ls --all` is valid; full and production `npm audit --json` each report zero vulnerabilities. npm pack smoke passes with Core 0.38.0 and CLI 0.1.3. The original PR heads will be merged by ancestry after the settled tree passes all gates; a tree-equality check will ensure that history integration changes no tested bytes.

## Convergence and backend verification debt

First convergence assessed 13 functional requirements, 7 success criteria, 15 acceptance scenarios and all eight constitution principles. One HIGH partial gap (FR-013/SC-007) was appended as T031: accepted uppercase write slugs conflicted with lowercase canonical routing. Admin now rejects noncanonical slugs before side effects; 58 focused promotion/API/locale checks pass, including preserved lowercase collisions and three-locale public-route readback. Legacy read grammar remains intact.

The complete combined-graph run passed 2956 cases as reported by the runner: 2946 passed, 10 skipped, zero failed (155 nonbrowser files, 22 browser files). The ten skips were explicitly retired SQLite event-log tests, not unavailable production integration. FR-014/SC-008 and T032–T034 now close that additional verified debt before release. New event-log tests use synthetic HTTP fixtures. Actual Blog backend verification uses an isolated ClickHouse instance; parent read only production column names/types and table-engine metadata to match its schema, with no content rows or credentials printed.

### Real ClickHouse result

Disposable ClickHouse 25.8.24.21, image `sha256:0fa332a9a05ce4138b16d883f9c9d124c8d9d81cf4e52046878d537558626e49`, passes actual-handler verification with the deployed column types and engine families. Pending promotion, Enum8/DateTime64 approvals, `mutations_sync=1` and readback, Unicode fields, both readers, identical retries, published-to-editorial conversion, rejected/uppercase refusals, collisions and a real intervening rejection all behave as required. Four mutations complete, zero pending. Existing API cache remains readable through its 60-second window; a fresh handler confirms Markdown source after promotion.

The exact owned container, anonymous volumes and synthetic content are absent after cleanup. Reproduction script, schema, probe, result, cleanup log and file digests are preserved under `/home/vk/.local/share/ortbtools-reconciliation/2026-09-07-090946/backend-verification/`. Copy that directory to a temporary location before rerunning `bash run-probe.sh /srv/DATA/Stacks/ortbtools`. This backend check does not rely on production data or alter production schema.

## Final code convergence

All 14 functional requirements, 8 success criteria, 16 user-story acceptance scenarios, scoped plan decisions and eight constitution principles were rechecked after T031 and the FR-014 addition. No remaining buildable gap or unrequested implementation was found; no additional convergence phase was appended. Delivery tasks remain explicit until their actual remote/backup/runtime evidence exists.

The event-log replacement contains 22 active HTTP-contract cases. Together with unchanged auth-event privacy coverage, 40/40 focused cases pass without skips. It tests batched JSONEachRow and auth headers, timing/high-water flush, bounds/context, escaped shared filters, pagination, async mapping/count/order, components, TTL no-op, disabled modes, HTTP/network failure and timeout abort. The fixture interprets no SQL and restores environment, module cache, timers, fetch and process listeners. TypeScript, lint, formatting and diff checks pass. The original password-manager autofill behavior was not reproduced directly; the new form ownership, single submission and cancellation boundaries are browser-verified.

## Settled release gate — 2026-09-07

`npm run ci` passes formatting, zero-warning lint, JSDoc TypeScript, coverage and serial real-browser tests: **2976 tests, 2976 passed, zero failed, zero skipped**, across 155 nonbrowser and 22 browser files. `bash scripts/npm-pack-smoke.sh` passes; `bash scripts/ci-docker-smoke.sh` passes on the final runtime source, including production Node 22.22.3, SQLite 13.0.3 and bcrypt 6.0.0. Full/production audits each report zero vulnerabilities and `npm ls --all` is valid. Both manifests match the independently reviewed combined dependency graph exactly except the intentional app version bump.

Release app version is 1.19.4; Core 0.38.0 and CLI 0.1.3 remain unchanged. Active baseline/version surfaces and all affected privacy/content/frontend/HTTP/operations contracts are reconciled. At that checkpoint, GitHub merge/readback, hosted gates, fresh backup, deployment and release closure remained. The delivery checkpoint below records their subsequent completion.

## Delivery checkpoint — 2026-09-07

- Authored change: `23da92d41b7e6acb6c9ec1f32c1aeeed116057f6`. The merge `e6c3d8e4d7ee2be639727e5c7d91f600f9321e0e` retains all three original dependency PR heads as parents; index and working-tree comparisons plus tree-object equality prove that the merge changed none of the tested bytes. GitHub readback reports PRs 78/79/80 MERGED at that exact revision.
- Ordinary clean-main push passed the mandatory pre-push full CI. [Hosted CI 34099107046](https://github.com/vladikkrasulya/adtech-spyglass/actions/runs/34099107046) then passed every job/step for that exact SHA, including package and production Docker smoke.
- Fresh canonical `sudo -n scripts/backup-db.sh --pre-deploy` created `ortbtools-2026-09-07T1016.db.gz` (3173070 bytes) and `content-posts-2026-09-07T1016.tar.gz` (1814 bytes). Freshness, root ownership, 0700/0600 modes, gzip integrity, restored temporary SQLite `PRAGMA integrity_check = ok` and tar readability were verified. The uncompressed verification copy was removed.
- `bash scripts/deploy.sh` completed with SMOKE OK and ACTIVE at 2026-09-07T10:16:49+02:00. Image `ortbtools:e6c3d8e`, OCI revision `e6c3d8e4d7ee2be639727e5c7d91f600f9321e0e`, version 1.19.4, healthy, restart always, zero restarts, only `/data` mounted. No rollback was needed.
- Both local and public health confirm build `e6c3d8e` and healthy SQLite. Both origins serve the current shell graph and an exact-byte immutable version asset; an invented version returns 409/no-store. Optional Sentry remains unconfigured under the stated baseline.
- GitHub Release `v1.19.4` and its immutable tag were created at the source cut and read back exactly: tag revision, target, name, corresponding changelog body, draft=false and prerelease=false. Historical Releases 1.19.2/1.19.3 are also complete.

These final bookkeeping changes affect only status/evidence documents. The immutable release tag continues to name the tested application source cut; later evidence-only commits do not bump the application version. Any deployment of that bookkeeping revision still uses the complete hosted/pre-push checks, a new canonical verified backup and exact-SHA deployment/readback. The final operator snapshots are retained at `/home/vk/.local/share/ortbtools-reconciliation/2026-09-07-090946/release-verification/`, including `current-live.json`; this avoids inventing a self-referential commit hash inside its own tracked evidence.

Closed scope: 14 functional requirements, 8 success criteria, 16 acceptance scenarios, 34 tasks and all 25 inventory dispositions. Future mappings, preview expansion, SChain and paused research remain the separately stated development plan. Repository identity, local package distribution and Telegram remain the existing maintenance baseline, not an invented owner decision. Additional Local Model Maximum experiments remain cancelled.
