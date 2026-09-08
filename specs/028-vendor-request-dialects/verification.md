# Verification: Vendor request dialects and Core recognition

**Phase**: Core/backend implemented and local gates passed; hosted delivery pending, 2026-09-08.

## Starting state and ownership

Implementation began after main and origin/main were independently verified at `d3173a5a7b6bf647564ca5d915685066112f8c7c`, including PR #83. Branch: `codex/028-vendor-request-dialects`. Core is 0.46.0; CLI remains 0.1.3 with Core range `^0.46.0`; app remains 1.19.4. No public source, shared oracle or runner was changed.

Spec/plan/checklist/tasks and read-only coverage analysis preceded runtime work: 18 functional requirements, four success criteria and 26 tasks, with no uncovered requirement or critical/high conflict. The initial missing roadmap link was subsequently added and the governance gate passed.

The real corpus loader captured 256 materialized cases before implementation. Scope is the brief's five groups/24 cases plus five supplemental DEF-151 recognition cases. The initial Core/HTTP baseline had 575 tests: 514 passes, zero failures, three skips and 58 expected-failure markers.

## Measured impact

All 256 materialized payloads, normative expectations and provenance remain unchanged. All 227 unrelated cases retain their exact failure signatures. Only two unrelated Core observations gain an inpage tag: `cover-preview-inpage-blocked-media` and `cover-preview-inpage-unidentified-inert`, which already contain the explicit widget/card evidence recognized by this feature. Every other observation in those cases remains unchanged.

Core and HTTP satisfy 27 of the 29 scoped expectations. The two Kadam cases retain the exact `expected [inpage], got [push]` signature: the wire contains no distinguishing placement evidence and the requested source correction has no recorded owner approval. No format assertion was changed.

The isolated browser run measured all 256 cases, with no skip. Its initial failing test result correctly rejected stale recorded deviations after Core repairs. The unchanged deviation evaluator then verified all 256 observations against mechanically reduced metadata: zero unexpected or missing signatures. Twenty-one browser cases retain admitted deviations: seventeen in this scope plus four untouched DEF-245 cases.

Twelve scoped cases pass all three layers and have their individual markers retired. The complete DEF-108 group is retired only because all three provisional references pass through the current browser as well as Core/HTTP. Their documented-reference provenance, coverage exclusion and explicit provisional warning remain intact.

| Record  | Cases still open | Measured residual                                                                       |
| ------- | ---------------: | --------------------------------------------------------------------------------------- |
| DEF-106 |                1 | EXADS banner preview is empty                                                           |
| DEF-107 |                4 | Two PPCmate pop title identities; two unchanged Kadam hidden-placement assertions       |
| DEF-180 |                5 | Extension-card preview/identity, including four peer-owned empty-preview contradictions |
| DEF-441 |                2 | Kadam Native preview and title identity                                                 |
| DEF-151 |                5 | AdCOM Native preview, embedded image and title identity                                 |
| DEF-108 |                0 | All three layers pass; support remains explicitly provisional                           |

Current ledger totals are six active groups and 21 cases, including untouched DEF-245. This is Core delivery with explicit UI dependencies, not a claim that the whole site or every vendor contract is complete.

## Verification receipts

| Check                                                      | Observed result                                                                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| New vendor/format/Adon3/URL tests plus spec references     | 72 passed before the additional review regressions; no failures                                                                         |
| URL family regressions plus existing decoder/URL tests     | 122 passed                                                                                                                              |
| Independent integration review                             | Malformed-IAB and prior-feed precedence preserved; generic zone-only inference removed; public regression probes pass                   |
| Full Core/HTTP corpus after metadata reduction             | 521 tests: 514 passed, zero failed, three transport-only skips, four retained expected-failure markers                                  |
| Full browser corpus                                        | 256 observations, no skips; all observations fit the reduced exact signatures; final repository gate re-executed the layer successfully |
| Settled vendor/format/catalog/corpus-contract selection    | 99 passed, zero failed or skipped                                                                                                       |
| Real HTTP vendor boundary controls                         | Five passed, zero failed; one isolated server                                                                                           |
| Finding/locales, versions and SpecKit governance selection | 42 passed                                                                                                                               |
| Version/changelog/governance/CLI/Adon3 selection           | 46 passed                                                                                                                               |
| `npm run typecheck`                                        | Passed                                                                                                                                  |
| `bash scripts/npm-pack-smoke.sh`                           | Passed with packed Core 0.46.0 and CLI 0.1.3                                                                                            |
| `bash scripts/ci-docker-smoke.sh` with a private image tag | Passed: health, analyze, asset graph, Node 22 and native dependencies                                                                   |

Raw baseline/after observations, source snapshots and hashes, exact reductions, private Chrome namespace receipts and final gate logs remain in the machine-local research store. The tracked summary contains no raw payload bodies or private paths.

## Remaining delivery and handoff

Local `npm run ci` passed: 174 non-browser files and 25 browser files, with zero browser retries. Aggregate runner totals: 4,049 tests, 4,042 passes, zero failures, three transport-only skips and four retained expected-failure markers. The standalone package and Docker gates also passed. Final delivery requires the non-force branch push and hosted CI on the delivered revision; the exact hosted receipt is recorded in the [delivery pull request](https://github.com/vladikkrasulya/adtech-spyglass/pulls?q=is%3Apr+head%3Acodex%2F028-vendor-request-dialects). No hosted success is claimed before that receipt.

The final buildable-requirement review covered 18 functional requirements, four success criteria, 13 acceptance scenarios, the plan decisions and all eight constitution principles. No missing runtime work remained. The two conditional Kadam edits remain unapproved and unapplied; delivery verification continues under T024–T026.

Main advanced after the implementation start through documentation-only feature 027 (`5e2068b`); the final branch incorporates that documentation and rechecks its governance without changing the verified runtime patch.

Opus owns all public rendering fixes and DEF-245. The two Kadam assertion corrections remain separately gated; preserving them does not block independent Core delivery. Opus should use the per-case browser signatures above, preserve exact creative identity and resolve the four DEF-180 preview contradictions before removing those records.
