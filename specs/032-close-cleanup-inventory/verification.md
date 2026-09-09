# Maintenance verification

**Complete — deployed 2026-09-09.** App v1.22.0, Core 0.47.0 and CLI 0.1.4 shipped from `9899191699ae2a2cb7fd782ad3430cbfd31debae` as `ortbtools:9899191`. All 26 originally open maintenance records are closed, the extra negative-floor defect is fixed, and CL-08/09 have individual evidence-backed dispositions. All T001–T044 tasks are complete. Earlier sections preserve checkpoint history; the final release receipt below owns the current operational state.

## Pre-implementation gate — 2026-09-09

Baseline `2bd93d6`, app 1.21.0. Local authored work is isolated from the user's original checkout. Production readback confirmed the baseline image healthy; no production account data was read.

Spec Kit 0.16.2 and empty extension hooks verified. `setup-plan.sh`, `setup-tasks.sh` and `check-prerequisites.sh --json --require-tasks --include-tasks` resolved feature 032. Requirements checklist passed. Read-only cross-artifact analysis covered all 16 requirements across 40 unique tasks; no unresolved placeholders, unmapped tasks or critical/high conflicts. The explicit compatibility decision covers degradation, side metadata, preserved legacy price IDs and currency-only response projection.

Independent read-only Core/UI/infrastructure investigations reproduced the current defects and identified broader-than-original details: redirect alias field validation, pop value-domain parity, initial in-flight edit/cancel races, onboarding grid placement, plugin applies containment and filtering-resistant incomplete state. These are included before implementation.

`npm ci` completed successfully. Final verification and release gates were pending at this checkpoint.

## HTTP/auth/catalog phase

`node --test tests/maintenance-http.test.js tests/analyze-location-api.test.js tests/health.test.js tests/event-log.test.js` passed 49 tests at the first settled HTTP checkpoint. Additional URL/mixed-version/raw-both-side cases were then added. `node --test tests/maintenance-http.test.js tests/analyze-location-api.test.js tests/auth.test.js tests/site-auth.test.js` passed 88 tests. Focused ESLint on the authored backend/test files passed.

The tests cover logout local cleanup and safe localized durable-failure reporting, absent-cookie behavior, catalog parse/read/shape failure and repair, individual side metadata and legacy prefix compatibility, identical duplicate-key paths in two documents, URL/invalid scalar/mixed-version sides and filtered completeness propagation. Fault data is synthetic; notifications are stubbed or unconfigured. The initial test pass also exposed and corrected test-harness stubs; its failing count is not claimed as a count of product defects.

## Settled component and independent review gates

Core: 430 focused tests passed across the named validation/view/fault/VAST suites; an additional 188 handoff/catalog/plugin checks passed. UI: 137 focused checks passed, with the final error-edit and normative audio-slot integration passing 105 checks. Existing clear/creative/push/interface browser safety passed all five scenarios. Infrastructure: 13 owned-process/ID-policy/inventory checks and five real-browser runner checks passed. These focused totals overlap and are not added into a fabricated unique test count. All owners reported clean ESLint/typecheck and generated mirror parity.

Independent cross-lane review identified and repaired four integration details before full CI: mixed incomplete-envelope fallback retained the selected 2.x adapter; unlocated findings retain authoritative sides membership without invented navigation; 3.0 UI audio/security/MIME facts use a bounded UI projection; editing after a failed analysis clears stale error artifacts. Each has an executable regression. Root review additionally made failed catalog loads `no-store`, including failed spec-reference reads. The reviewed HTTP/auth gate passed 89 tests.

Linux verification is prepared in an isolated full-history clone on vkbox at the baseline, with Node 22, installed workspace dependencies, executable Chrome, rsync and SQLite. Production configuration and data are absent. Full CI, normative corpus, hosted package/Docker and deployment were pending at this checkpoint.

## First complete corpus and CI discovery

The first corpus run completed all nine phases: Core 255 pass/3 not-applicable, HTTP 258 pass, browser 201 pass/56 fail/1 not-applicable, UX 12 fail, accessibility 19 pass. It is a failed diagnostic run, not release evidence. Browser failures reproduced a side-provenance mismatch in the evidence adapter: it ignored structured `origin.side` on unprefixed root findings. The adapter now consumes that field before its legacy text fallback; the same audio case failed before and passed after, with an explicit provenance regression. Fixture expectations, exact row matching and known gaps were not relaxed. UX failures identified an extra application console error on an intentionally rejected fetch, addressed under T042.

The first Linux CI passed formatting, lint and typecheck but found that the new runner forced analytics off even for explicitly configured synthetic collectors. Removing that override preserves caller opt-out; a runtime unset/0/1 collector regression and the existing collector/event-log tests pass. The run also caught the feature status and ADR required-heading format; the status is now `Verification`, the ADR includes Alternatives/Related, and governance tests pass. The owned runner was interrupted after these actionable failures; original attempt logs and its interrupted outcome are retained. No failure is labeled environmental.

The first formal convergence pass appended T041/T042: visible partner-count failure and narrow analysis transport failure handling. All 16 FR, five SC, 20 acceptance scenarios, eight plan decisions and eight constitution principles were checked; release execution was tracked by T039/T040. A second convergence pass and fresh full gates were required after these changes.

## Final implementation convergence

T041 and T042 pass their 48 focused checks and the unchanged 12-scenario UX matrix. A second convergence pass added only T043: change the two new Ukrainian/Russian logout retry strings to informal singular. The two-word correction passed 23 locale/UI checks, formatting and ESLint. A test-fixture type-inference error was repaired without changing its invalid-response scenarios; whole local typecheck and its focused tests pass.

The final `speckit-converge` pass reports **converged**, zero missing/partial/contradicting/unrequested buildable gaps across 16 FR, five SC, 20 acceptance scenarios, eight plan decisions and eight constitution principles. Tasks remained byte-identical (SHA256 `94820de7dde280c69bd56ddd3c4ee0b1626f2d236ed25c92fa61af7a93ed2836`); no convergence phase was appended. Empty extension hooks were checked before and after. Operational release gates T039/T040 remain separate from this implementation conclusion.

## Fresh normative corpus

The fresh nine-phase corpus run completed successfully: `auditComplete: true`, `productConformant: true`, no problems. Core: 255 pass and three not-applicable; HTTP: 258 pass; browser: 257 pass and one not-applicable; UX: 12 pass; accessibility: 19 pass. Every layer reports zero failures, known gaps, skips and missing outcomes. The report directory is `ortbtools-audit-crS3gO` within the external maintenance evidence bundle; runner output is the count authority. No fixture expectations, corpus oracle or known-gap ledger was relaxed to obtain this result.

The final Linux source patch is SHA256 `6bfd38432b87d6499e1dd3f3422e43b617a34210ac7dd1392f231f8e574ad7b0`. It includes the final locale wording and test-fixture type correction. The subsequent changes to this verification record are documentation only; exact-commit hosted gates will verify the complete release commit.

## Settled Linux repository gate

`CHROME_BIN=/usr/bin/google-chrome-stable npm run ci` passed in the isolated full-history vkbox clone on the exact source patch above. Formatting, ESLint and whole TypeScript checks passed. The runner completed all 181 Node and 27 serial browser files without a failed attempt or retry. Unit output reports 3,799 pass, zero fail and three suite-declared skips; browser files completed successfully. Logged gate duration was approximately 12m28s. These are this execution's observations, not fixed project test totals.

The final source, independent convergence and normative corpus gates are green. At this checkpoint, exact-commit hosted package/Docker gates, the fresh canonical backup and deployment were still pending; their later outcomes are recorded below.

## Desktop onboarding follow-through

Independent real-Chrome QA covered 60 first-visit combinations: 1024×768, 1280×720, 1366×768, 1440×900, 1536×864, 1600×900, 1920×1080, 2560×1440, 3440×1440 and 3840×2160, each in EN/UK/RU and light/dark, with onboarding and verification banners together. Layout passed throughout. This review found a stale reference to the former example control and its immediate pair-loading behavior. T044 updates only the three onboarding text values to name the current sample menu and ask the user to choose a sample.

After that copy correction, the same 60-case matrix passes again: zero horizontal overflow, collisions, clipping or page errors; banner text stays 13px. Six actual menu-click checks verify its visible label, selector opening and unchanged empty editors before a sample is chosen. Existing locale/onboarding tests pass 20/20, and full formatting/lint/typecheck plus governance checks pass. Before/after measurements and four representative desktop screenshots per run are retained externally. This copy-only follow-up is verified separately from the earlier full Linux patch; the final release SHA must receive its own hosted gate before deployment.

The final follow-through convergence was clean: T044 verified, zero findings or appended tasks, and tasks.md stayed byte-identical during that review with SHA256 `a2e061c660cde12c9a8cffab0527f08ddcc9f7bc34da2a9f3e589e31836b3c0c`. The full buildable intent inventory remains satisfied; T039/T040 still tracked release execution at this checkpoint; they are now complete as recorded below.

## Final release receipt — 2026-09-09

[Hosted CI 34338793220](https://github.com/vladikkrasulya/adtech-spyglass/actions/runs/34338793220) passed for the exact release commit `9899191699ae2a2cb7fd782ad3430cbfd31debae`: all 181 Node and 27 browser files, npm pack smoke and Docker production smoke succeeded, with no runner retry. The job took 13m38s within its 15-minute limit. The preceding candidate `537a629` was superseded by the T044 copy follow-up; its run was cancelled by the newer push and is not used as the final release gate.

Local main, origin/main and the clean production checkout matched the release commit before deployment. Immediately before `scripts/deploy.sh`, the canonical `backup-db.sh --pre-deploy` created fresh SQLite and content archives at 12:28:27 CEST. The database gzip stream passed validation and its isolated restore returned `PRAGMA integrity_check = ok`; the content tar listing passed. Both timestamped archives were nonempty and fresh (3,171,115 and 1,814 bytes respectively). Verification temporary files were removed.

Canonical deployment succeeded with image `ortbtools:9899191`; OCI labels read back version `1.22.0` and full revision `9899191699ae2a2cb7fd782ad3430cbfd31debae`. Readiness completed, the container was healthy with restart policy `always` and zero restarts, and its only bind mount was `/data`. Canonical local smoke passed 18/18, including expected build SHA and container checks; the public HTTPS smoke passed all 16 applicable HTTP checks and reported the same build SHA.

A synthetic public `POST /api/analyze` verified HTTP 200, independent request/response side results, `floor.negative` at `imp[0].bidfloor`, and suppression of a satisfied-floor verdict for a negative floor. The operational probe first used the nonexistent `/api/v1/analyze` and received 404; correcting that probe URL to the source-declared endpoint produced the successful result. This was a probe setup error, not a product regression. No account or saved-library data was read.

Public first-visit QA then passed eight layout cases: Inspector and Library at 1366×768 and 1920×1080, each in UK light/dark. All returned HTTP 200 with zero horizontal overflow, page JavaScript errors, failed requests or bad HTTP responses. Library title links measured 13px Onest, heading 20px Geologica, metadata 11px and cells/filters 12px. The corrected onboarding copy and menu passed. Fresh isolated sessions read only the public catalog; non-GET/HEAD requests were blocked locally.

The public console retained one Cloudflare Insights beacon refusal under the site's CSP per page. This is not counted as a page JavaScript failure or concealed as a clean console. `server.js`, including the relevant policy, is byte-identical between baseline `2bd93d6` and release `9899191`; neither revision's server or three shell templates references the beacon. No feature-032 source regression was found, while the historical timing of external edge injection cannot be established from repository evidence. The policy was not relaxed. Public measurements, eight screenshots and the bounded CSP comparison are retained under `public-9899191/`.

Raw evidence is retained outside Git in the maintenance bundle: `hosted-ci-34338793220.json`, `hosted-ci-34338793220-log-metadata.txt`, `backup.log`, `deploy.log`, `production-readback.log`, `public-smoke.log`, `production-probe.json` and `release-evidence.json`. This closure record is a subsequent documentation-only commit; the deployed image remains the exact tested release commit above.
