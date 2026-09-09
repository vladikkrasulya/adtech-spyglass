# Maintenance verification

## Pre-implementation gate — 2026-09-09

Baseline `2bd93d6`, app 1.21.0. Local authored work is isolated from the user's original checkout. Production readback confirmed the baseline image healthy; no production account data was read.

Spec Kit 0.16.2 and empty extension hooks verified. `setup-plan.sh`, `setup-tasks.sh` and `check-prerequisites.sh --json --require-tasks --include-tasks` resolved feature 032. Requirements checklist passed. Read-only cross-artifact analysis covered all 16 requirements across 40 unique tasks; no unresolved placeholders, unmapped tasks or critical/high conflicts. The explicit compatibility decision covers degradation, side metadata, preserved legacy price IDs and currency-only response projection.

Independent read-only Core/UI/infrastructure investigations reproduced the current defects and identified broader-than-original details: redirect alias field validation, pop value-domain parity, initial in-flight edit/cancel races, onboarding grid placement, plugin applies containment and filtering-resistant incomplete state. These are included before implementation.

`npm ci` completed successfully. Final verification and release gates remain pending.

## HTTP/auth/catalog phase

`node --test tests/maintenance-http.test.js tests/analyze-location-api.test.js tests/health.test.js tests/event-log.test.js` passed 49 tests at the first settled HTTP checkpoint. Additional URL/mixed-version/raw-both-side cases were then added. `node --test tests/maintenance-http.test.js tests/analyze-location-api.test.js tests/auth.test.js tests/site-auth.test.js` passed 88 tests. Focused ESLint on the authored backend/test files passed.

The tests cover logout local cleanup and safe localized durable-failure reporting, absent-cookie behavior, catalog parse/read/shape failure and repair, individual side metadata and legacy prefix compatibility, identical duplicate-key paths in two documents, URL/invalid scalar/mixed-version sides and filtered completeness propagation. Fault data is synthetic; notifications are stubbed or unconfigured. The initial test pass also exposed and corrected test-harness stubs; its failing count is not claimed as a count of product defects.

## Settled component and independent review gates

Core: 430 focused tests passed across the named validation/view/fault/VAST suites; an additional 188 handoff/catalog/plugin checks passed. UI: 137 focused checks passed, with the final error-edit and normative audio-slot integration passing 105 checks. Existing clear/creative/push/interface browser safety passed all five scenarios. Infrastructure: 13 owned-process/ID-policy/inventory checks and five real-browser runner checks passed. These focused totals overlap and are not added into a fabricated unique test count. All owners reported clean ESLint/typecheck and generated mirror parity.

Independent cross-lane review identified and repaired four integration details before full CI: mixed incomplete-envelope fallback retained the selected 2.x adapter; unlocated findings retain authoritative sides membership without invented navigation; 3.0 UI audio/security/MIME facts use a bounded UI projection; editing after a failed analysis clears stale error artifacts. Each has an executable regression. Root review additionally made failed catalog loads `no-store`, including failed spec-reference reads. The reviewed HTTP/auth gate passed 89 tests.

Linux verification is prepared in an isolated full-history clone on vkbox at the baseline, with Node 22, installed workspace dependencies, executable Chrome, rsync and SQLite. Production configuration and data are absent. Full CI, normative corpus, hosted package/Docker and deployment remain pending.

## First complete corpus and CI discovery

The first corpus run completed all nine phases: Core 255 pass/3 not-applicable, HTTP 258 pass, browser 201 pass/56 fail/1 not-applicable, UX 12 fail, accessibility 19 pass. It is a failed diagnostic run, not release evidence. Browser failures reproduced a side-provenance mismatch in the evidence adapter: it ignored structured `origin.side` on unprefixed root findings. The adapter now consumes that field before its legacy text fallback; the same audio case failed before and passed after, with an explicit provenance regression. Fixture expectations, exact row matching and known gaps were not relaxed. UX failures identified an extra application console error on an intentionally rejected fetch, addressed under T042.

The first Linux CI passed formatting, lint and typecheck but found that the new runner forced analytics off even for explicitly configured synthetic collectors. Removing that override preserves caller opt-out; a runtime unset/0/1 collector regression and the existing collector/event-log tests pass. The run also caught the feature status and ADR required-heading format; the status is now `Verification`, the ADR includes Alternatives/Related, and governance tests pass. The owned runner was interrupted after these actionable failures; original attempt logs and its interrupted outcome are retained. No failure is labeled environmental.

The first formal convergence pass appended T041/T042: visible partner-count failure and narrow analysis transport failure handling. All 16 FR, five SC, 20 acceptance scenarios, eight plan decisions and eight constitution principles were checked; release execution remains tracked by T039/T040. A second convergence pass and fresh full gates are required after these changes.

## Final implementation convergence

T041 and T042 pass their 48 focused checks and the unchanged 12-scenario UX matrix. A second convergence pass added only T043: change the two new Ukrainian/Russian logout retry strings to informal singular. The two-word correction passed 23 locale/UI checks, formatting and ESLint. A test-fixture type-inference error was repaired without changing its invalid-response scenarios; whole local typecheck and its focused tests pass.

The final `speckit-converge` pass reports **converged**, zero missing/partial/contradicting/unrequested buildable gaps across 16 FR, five SC, 20 acceptance scenarios, eight plan decisions and eight constitution principles. Tasks remained byte-identical (SHA256 `94820de7dde280c69bd56ddd3c4ee0b1626f2d236ed25c92fa61af7a93ed2836`); no convergence phase was appended. Empty extension hooks were checked before and after. Operational release gates T039/T040 remain separate from this implementation conclusion.

## Fresh normative corpus

The fresh nine-phase corpus run completed successfully: `auditComplete: true`, `productConformant: true`, no problems. Core: 255 pass and three not-applicable; HTTP: 258 pass; browser: 257 pass and one not-applicable; UX: 12 pass; accessibility: 19 pass. Every layer reports zero failures, known gaps, skips and missing outcomes. The report directory is `ortbtools-audit-crS3gO` within the external maintenance evidence bundle; runner output is the count authority. No fixture expectations, corpus oracle or known-gap ledger was relaxed to obtain this result.

The final Linux source patch is SHA256 `6bfd38432b87d6499e1dd3f3422e43b617a34210ac7dd1392f231f8e574ad7b0`. It includes the final locale wording and test-fixture type correction. The subsequent changes to this verification record are documentation only; exact-commit hosted gates will verify the complete release commit.

## Settled Linux repository gate

`CHROME_BIN=/usr/bin/google-chrome-stable npm run ci` passed in the isolated full-history vkbox clone on the exact source patch above. Formatting, ESLint and whole TypeScript checks passed. The runner completed all 181 Node and 27 serial browser files without a failed attempt or retry. Unit output reports 3,799 pass, zero fail and three suite-declared skips; browser files completed successfully. Logged gate duration was approximately 12m28s. These are this execution's observations, not fixed project test totals.

The final source, independent convergence and normative corpus gates are green. At this commit, exact-commit hosted package/Docker gates, the fresh canonical backup and deployment are still pending; they must not be inferred from the local result.

## Desktop onboarding follow-through

Independent real-Chrome QA covered 60 first-visit combinations: 1024×768, 1280×720, 1366×768, 1440×900, 1536×864, 1600×900, 1920×1080, 2560×1440, 3440×1440 and 3840×2160, each in EN/UK/RU and light/dark, with onboarding and verification banners together. Layout passed throughout. This review found a stale reference to the former example control and its immediate pair-loading behavior. T044 updates only the three onboarding text values to name the current sample menu and ask the user to choose a sample.

After that copy correction, the same 60-case matrix passes again: zero horizontal overflow, collisions, clipping or page errors; banner text stays 13px. Six actual menu-click checks verify its visible label, selector opening and unchanged empty editors before a sample is chosen. Existing locale/onboarding tests pass 20/20, and full formatting/lint/typecheck plus governance checks pass. Before/after measurements and four representative desktop screenshots per run are retained externally. This copy-only follow-up is verified separately from the earlier full Linux patch; the final release SHA must receive its own hosted gate before deployment.

The final follow-through convergence is clean: T044 verified, zero findings or appended tasks, and tasks.md remains byte-identical with SHA256 `a2e061c660cde12c9a8cffab0527f08ddcc9f7bc34da2a9f3e589e31836b3c0c`. The full buildable intent inventory remains satisfied; T039/T040 still track release execution.
