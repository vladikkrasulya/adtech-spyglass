# Verification: ad format matrix — coverage closure

The coverage-closure audit completed on 2026-09-08: **256 scenarios, 160/160 applicable pairwise cells and 56/56 applicable standard protocol/context triples**, with zero unverified cells, unexpected failures, missing observations or browser skips. All nine phases exited 0 without retries. `auditComplete: true`; `productConformant: false`. Reproduced product gaps remain unmet expectations, not passing product checks.

This supersedes the earlier 184-case representative run. The user's objection to its 52 remaining cells reopened this feature. Applicability review exposed six additional genuine gaps and corrected an already exercised inpage cell; 72 new cases now close the resulting set. See [the applicability review](coverage-closure-review.md). Nine pairwise states remain excluded by product contract, 48 are outside the documented projections, and four standard OpenRTB 2.5 × DOOH triples are N/A. The curated body-kind axes are bounded robustness coverage; their exclusions do not claim other malformed bodies are impossible.

## Reproduction and measured outcomes

Product state: `dd0e7681a7d1db5bd5e52f48f68c377af7602727` plus this test/corpus/documentation scope. App 1.19.4, Core 0.38.0, CLI 0.1.3; Node v22.23.2, Chrome/151.0.7922.137. Runtime code, dependencies, public contracts and deployed production are unchanged.

```sh
CORPUS_REPORT_DIR=/home/vk/.local/share/ortbtools-research/2026-09-08-coverage-closure/runs npm run test:corpus
npm run ci
```

The [measured run](/home/vk/.local/share/ortbtools-research/2026-09-08-coverage-closure/runs/ortbtools-audit-77LxpT) ran from `2026-09-08T07:59:40.610Z` to `2026-09-08T08:07:51.802Z`. It contains `run.json`, `report.json`, per-layer JSONL, `ux-a11y-findings.json`, both generated matrices and **301 screenshots**. The [case matrix](coverage-matrix.md) and [axes](coverage-axes.md) are copied from these observations. All execution used isolated local servers and offline assets.

| Layer   | Pass | Known gap | Not applicable | Unexpected failure | Skipped / missing |
| ------- | ---: | --------: | -------------: | -----------------: | ----------------: |
| core    |  151 |       102 |              3 |                  0 |             0 / 0 |
| http    |  150 |       106 |              0 |                  0 |             0 / 0 |
| browser |  140 |       115 |              1 |                  0 |             0 / 0 |
| ux      |    0 |        12 |              0 |                  0 |             0 / 0 |
| a11y    |   17 |         2 |              0 |                  0 |             0 / 0 |

Of the **72 additional scenarios, 46 pass and 26 reproduce known deviations on each of Core, HTTP and browser**. All have exactly one outcome per layer. The full corpus has three Core N/A cases for lexical JSON/HTTP-envelope rejection and one browser N/A case for the oversized HTTP-envelope probe. These are explicit transport boundaries, not skipped checks. All other 255 browser cases execute.

| Phase                                   | Exit | Seconds |
| --------------------------------------- | ---: | ------: |
| `tests/corpus-lib.test.js`              |    0 |     0.3 |
| `tests/corpus-report.test.js`           |    0 |     0.7 |
| `tests/corpus-axes.test.js`             |    0 |     0.3 |
| `tests/corpus-fixture-contract.test.js` |    0 |     0.7 |
| `tests/corpus-core.test.js`             |    0 |     0.4 |
| `tests/corpus-http.test.js`             |    0 |     1.6 |
| `tests/corpus-browser.test.js`          |    0 |   369.1 |
| `tests/corpus-ux-browser.test.js`       |    0 |    74.2 |
| `tests/corpus-ux-a11y-browser.test.js`  |    0 |    43.8 |

The axes gate rejects any reopened applicable cell or standard triple even when a focused run uses a case filter. Known-gap guards reject new failure signatures and already-fixed deviations. The new independent fixture-contract tests reject common source-data mistakes without consulting Core's validator output. A missing usable Chromium fails the dedicated audit.

## Source corpus and single-file delivery

[Download the portable JSON](/home/vk/.local/share/ortbtools-research/2026-09-08-coverage-closure/ad-format-corpus.json): **141 base examples and 115 materialized mutations = 256 cases**. It includes requests/responses, raw lexical inputs, expectations, provenance/adaptations, 44 ledger groups, 25 source-catalog records plus case-level references, and 77 embedded offline assets. Size: 10,836,348 bytes. SHA-256: `9fef49188de1af40495bd1276169b58d9c8e0a0fb785b06566ebc3d782b779ec`. The adjacent `.sha256` file verifies the artifact; `export-corpus.cjs` beside it reproduces the export from the normalized corpus and original asset archive.

| Format | Qualified pairs | Provisional pairs | Standalone probes | Mutations |
| ------ | --------------: | ----------------: | ----------------: | --------: |
| banner |              23 |                 0 |                 0 |        82 |
| video  |              21 |                 0 |                 2 |        12 |
| audio  |              20 |                 0 |                 2 |         4 |
| native |              22 |                 0 |                 3 |         9 |
| push   |               8 |                 1 |                 6 |         2 |
| pop    |              13 |                 2 |                 3 |         4 |
| inpage |              12 |                 0 |                 3 |         2 |

Every format has at least five qualified request/response pairs. There are 119 qualified pairs, three provisional Adon3 pairs and 19 standalone examples; base-case count is not pair count. Source placement intent remains distinct from detectable wire carrier (for example EXADS push/inpage using Native). No customer traffic or live ads are used. The original 38-case source archive and the earlier 184-case delivery remain retained separately; this file supersedes neither artifact's historical bytes.

Normal tests use 65 stored assets. Twelve media bodies remain embedded only in the private portable archives with `stored: false` repository manifest entries; the interceptor returns unavailable instead of making live requests. No successful playback or asset-loading claim depends on these absent bodies. Deliberately blocked new resource URLs need no fetched image/video bytes.

## Independent source checks

The new `tests/corpus-fixture-contract.test.js` has 19 source-property and negative-control tests. It checks 98 positive standard contexts and 21 AdCOM cases, including field types, actual context/metadata agreement, structured Native nesting/required assets and VAST 4.1/4.2 Inline serving identifiers. Checks run even with nonmatching corpus filters. This selected property guard is independent of product validation and is not an exhaustive OpenRTB schema certificate.

A separate [pinned XSD check](/home/vk/.local/share/ortbtools-research/2026-09-08-coverage-closure/vast-source-validation/final-results.json) validated **45/45 positive VAST documents** with `xmllint`, including the Native `video.vasttag`. Exact XML, schemas, hashes and the reproduction script are retained alongside the results. Schema revision: IAB VAST `e0858cd714474bf17ef61065097456d7643ff838`.

Source review corrected four inherited AdCOM fixtures (optional OS string fields, Audio MIME array, explicit video markup capability), six copies of an incomplete VAST 4.1 Inline body, and three older VAST element-order/required-attribute errors. Each correction has fixture provenance. These corrections repair test evidence; they are not counted as product fixes.

## Creative and UI/UX evidence

The browser uses the real Analyze POST, checks displayed findings and crosscheck rows, reveals the selected creative through a real pointer action, and verifies visible identity and loaded assets. New probes include standalone inputs, no-bid/empty/unidentified/JSON/URL bodies, full and partial markup, and blocked images/media. Original bid/seat indices remain intact; unsupported later-bid selection stays visible as DEF-201. VAST is measured as inert text; frame existence and media readiness never count as playback.

The 12 locale/theme/viewport journeys reproduce DEF-200 and DEF-205 across EN/UK/RU, light/dark, desktop/mobile. The 19 accessibility/state scenarios have 17 passing outcomes and two known gaps (DEF-260 unnamed iframe and DEF-201 later-bid selection). They include accessible names, keyboard actions, ten visible composited contrast samples, overflow, large input, device scale and CSS scaling. They do not certify actual browser zoom, screen-reader usage or complete WCAG conformance.

Visual review of the new video-HTML and pop partial previews confirms visible creative labels, blocked artwork and resource-refusal notices. One additional qualitative UX observation remains: the video/HTML mismatch shows a clean validation headline while the separate Crosscheck tab reports a warning. Clarifying which checks the headline summarizes merits follow-up; this is an observation rather than a new counted protocol defect. Earlier mobile tab clipping and notification overlays remain documented qualitative follow-ups.

## Defects, cleanup and delivery gates

The [defect report](defects.md) now has **44 groups**, including two new detection/vendor capabilities: DEF-441 (literal Kadam Native feed) and DEF-460 (standalone Native body without optional mtype). Context and carrier variants of existing defects were consolidated, preserving exact per-case/layer failures. The [cleanup backlog](cleanup-backlog.md) remains separate: 23 consolidated items plus ten retained architecture proposals. This audit does not implement those product fixes or refactors.

The dedicated audit, focused checks, source validation, lint and typecheck have passed. The initial repository CI found an invalid authored status label in spec.md; that diagnostic run was stopped, the status changed to the allowed `Verification` value, and the focused Spec Kit contract suite passed. The initial failure is retained in `ci-initial-doc-status.log`, not counted as successful CI. The final `npm run ci` exited 0 without runner retries: 161 nonbrowser and 25 browser files, 4,057 tests/subtests, 3,846 passes, 208 expected-failure markers and three explicit Core transport skips; zero unexpected failures or cancellations. `ci.log` and `ci-summary.json` retain the exact results. Final convergence found no unbuilt work across ten functional requirements, five success criteria, three user stories and eight governing principles; tasks.md stayed byte-for-byte unchanged during that assessment. Normal completion bookkeeping follows it. Commit, mandatory pre-push CI and hosted checks are the remaining operational delivery steps; final completion is reported only after their results are recorded. Evidence belongs under `/home/vk/.local/share/ortbtools-research/2026-09-08-coverage-closure`. The delivery receipt records final commit, clean-remote agreement and hosted CI separately from the measured working-tree baseline above.

[Coverage inventory](coverage-inventory.md) states the remaining boundaries: arbitrary extensions and higher-order combinations, every custom dialect/Core option, per-format Mirror/Migrate/history/sharing, other browser engines, real devices, external wrappers, live bidding/tracking and sustained concurrency. These are separate from the now-closed enumerated matrix.
