# Verification: ad format matrix

The final integrated audit completed on 2026-09-08: **184 corpus scenarios, 12 locale/theme/viewport journeys and 19 accessibility/state scenarios**, with no unexpected failures, missing observations or browser skips. All eight phases exited 0 without retries. Execution is complete; product conformance is not: `auditComplete: true`, `productConformant: false`. Known gaps preserve unmet expectations and are never counted as passing product checks.

## Reproduction and evidence

Product baseline: `a61fc258c3ec8cc8bda5e2512df125a358bc08a4` plus this feature's test, script and documentation changes. App 1.19.4, Core 0.38.0, CLI 0.1.3; Node v22.23.2, Chrome/151.0.7922.137. No product code, dependencies, public contracts or production deployment changed.

```sh
CORPUS_REPORT_DIR=/home/vk/.local/share/ortbtools-research/2026-09-08-final-corpus/runs npm run test:corpus
npm run ci
```

Final run: `2026-09-08T05:45:38.871Z`–`2026-09-08T05:51:08.328Z`. The [persistent report directory](/home/vk/.local/share/ortbtools-research/2026-09-08-final-corpus/runs/ortbtools-audit-ct2VXk) contains `run.json`, `report.json`, per-layer JSONL, `ux-a11y-findings.json`, generated matrices and 234 screenshots. Evidence is from isolated local servers and Chromium, not from production or live ad delivery. The checked-in [case matrix](coverage-matrix.md) and [coverage axes](coverage-axes.md) are copied from this measured run.

| Layer   | Pass | Known gap | Not applicable | Unexpected failure | Skipped / missing |
| ------- | ---: | --------: | -------------: | -----------------: | ----------------: |
| core    |  105 |        76 |              3 |                  0 |             0 / 0 |
| http    |  104 |        80 |              0 |                  0 |             0 / 0 |
| browser |   94 |        89 |              1 |                  0 |             0 / 0 |
| ux      |    0 |        12 |              0 |                  0 |             0 / 0 |
| a11y    |   17 |         2 |              0 |                  0 |             0 / 0 |

Three Core cases are inapplicable because lexical JSON parsing or the HTTP body limit precedes the data-to-data API. The single browser exception is the oversized HTTP-envelope probe: it tests the server's transport cap independently of the Inspector editor. Every other browser case executes. The 12 UX journeys reproduce DEF-200 and DEF-205; the accessibility/state catalogue has 17 passing scenarios and two known gaps (DEF-260 and the existing all-bid limitation DEF-201).

| Phase                                  | Exit | Seconds |
| -------------------------------------- | ---: | ------: |
| `tests/corpus-lib.test.js`             |    0 |     0.3 |
| `tests/corpus-report.test.js`          |    0 |     0.7 |
| `tests/corpus-axes.test.js`            |    0 |     0.2 |
| `tests/corpus-core.test.js`            |    0 |     0.4 |
| `tests/corpus-http.test.js`            |    0 |     1.5 |
| `tests/corpus-browser.test.js`         |    0 |   227.9 |
| `tests/corpus-ux-browser.test.js`      |    0 |    57.2 |
| `tests/corpus-ux-a11y-browser.test.js` |    0 |    41.3 |

The first three phases run 45 harness, report and applicability tests. They exercise exact known-gap matching/retirement, required scenario coverage, unknown/duplicate/missing records and the separation of observed coverage from product conformance. A missing Chromium executable fails the dedicated command. Fresh run directories and no automatic retry prevent stale observations or hidden reruns from satisfying this audit.

## Corpus and portable file

The [single portable JSON](/home/vk/.local/share/ortbtools-research/2026-09-08-final-corpus/ad-format-corpus.json) contains **89 base examples and 95 materialized mutations**, with request/response bodies, raw lexical inputs where relevant, expectations, source attribution, adaptations, the 42-group ledger, 25 public source records and 77 embedded offline assets. It is 10,227,773 bytes; SHA-256: `07c7a60797288a444af5d84a88ba44b7cce5a27e95d3016eec4b51f3ab8e78f4`. The adjacent `.sha256` file permits integrity checking.

| Format | Qualified pairs | Provisional pairs | Standalone probes | Mutations |
| ------ | --------------: | ----------------: | ----------------: | --------: |
| banner |              14 |                 0 |                 0 |        78 |
| video  |              13 |                 0 |                 0 |         8 |
| audio  |              11 |                 0 |                 1 |         2 |
| native |              12 |                 0 |                 0 |         6 |
| push   |               6 |                 1 |                 4 |         0 |
| pop    |              12 |                 2 |                 1 |         1 |
| inpage |              10 |                 0 |                 2 |         0 |

The minimum is satisfied for all seven formats: 78 qualified pairs in total, plus three provisional Adon3 pairs and eight standalone probes. “89 base examples” does not mean 89 request/response pairs. Cases are synthetic adaptations of cited public specifications, vendor documentation and public adapter examples, not captured customer traffic. Source versions, license notes, redactions and adaptations are preserved. In-page widget carriers remain explicitly non-IAB shapes; their missing standard media object must still be rejected by baseline IAB validation.

Mutations cover commercial conditions (12), identity (10), multiplicity (12), format mismatch (9), media (9), field shape (15), encoding/limits (15) and input shape (13). This is representative coverage; proprietary push/inpage negative schemas and many cross-product combinations remain unverified. OpenRTB 3.0 includes banner, video, audio and corrected structured Native probes; DOOH includes banner and video; DAAST includes request negotiation and inline audio probes. The matrices name applicability and remaining coverage.

The original 38-case archive remains [available separately](/home/vk/.local/share/ortbtools-research/2026-09-07-codex-corpus/ad-format-corpus.json), SHA-256 `b5299ee8e072231bdc3f8334231efd7ad5ae12418a43fddba70d29b5afd146d7`. Normal repository runs use normalized fixtures and 65 stored assets. Twelve media bodies are embedded in the private portable archives, with integrity metadata and `stored: false` manifest entries in the repository; the interceptor reports these unavailable instead of contacting a network. The current preview policy forbids media playback, so no successful rendering assertion relies on unavailable media bytes.

## Creative, UI/UX and accessibility evidence

Browser checks perform the actual Analyze action and transaction, inspect visible findings and crosscheck rows, reveal creatives, measure loaded/visible images, and verify identity through visible text or a decoded image source. Original bid/seat indices are preserved; absent selection controls are reported rather than simulated by reordering payloads. Each observed bid has one record, including an explicit identity explanation for a declared empty render or deliberately blank inert input. VAST text visibility, media readiness and actual playback are distinct; sandbox refusals are admitted only through fixed popup/navigation refusal classifiers. CSP remains unchanged.

The 12 UX journeys cover EN/UK/RU × light/dark × desktop/mobile, including keyboard analysis, loading, source navigation, reset/reanalysis, network failure, structured 429 and clean input following duplicate-key JSON. The 19 additional scenarios cover four viewport sizes, two contrast themes, accessible names, keyboard order/actions, empty/unsupported/request-only/response-only/partial/warning/error/large-JSON states and two scaling probes. Ten visible alpha-composited contrast samples pass their unrounded thresholds; they are samples, not a complete contrast or WCAG certification. Device scale 2 and CSS scale 150% are measured explicitly and are not represented as actual browser zoom.

Independent screenshot review confirms that desktop and mobile controls remain visible and the representative banner is revealed. It also records mobile tab-edge clipping and stacked notifications over findings as qualitative usability follow-ups. DEF-260 is independently verified through Chromium's accessibility tree: the rendered frame is exposed but has an empty accessible name. Automated names/focus/contrast checks do not replace real screen-reader or user testing.

## Findings and cleanup

The [defect report](defects.md) describes **42 ledger groups**, including validation/API defects, vendor support gaps, preview limitations and a provisional reference group. These are not 42 interchangeable confirmed IAB bugs. Exact per-case/layer signatures live in `tests/corpus/known-gaps.json`, its shards and fixture metadata. New deviations fail; disappearance of a recorded deviation requires deliberate retirement.

Priority follow-ups include price/floor/deal and format-selection errors, malformed-input failures, stale results after structured HTTP errors (DEF-200), stale lexical input after repasting (DEF-205), unavailable later bids (DEF-201), and the unnamed creative iframe (DEF-260). The empty first bid array now independently reproduces DEF-204 before the Analyze POST. Scalar/array root rejections are correctly explained preflight paths and are not mistaken for that TypeError defect.

The separate [cleanup backlog](cleanup-backlog.md) contains 23 consolidated items across functional behavior, capabilities, UI/UX and refactoring, plus ten retained architecture proposals. It records affected paths, evidence, priority, proposed changes and regression criteria. Preliminary proposals and projection-only observations are labeled; public finding IDs and exports must retain compatibility. Product fixes and cleanup implementation are separate follow-up scope.

## Review and repository gates

Before final acceptance, source review corrected several invalid test assumptions: grouped seats need not cover every impression; Site/App/Device presence is recommended rather than mandatory; Native 1.2 permits object exchange by agreement; duplicate Bid IDs are not asserted to violate a nonexistent uniqueness rule; structured AdCOM Native uses the documented nesting. Retired DEF-193/196 and merged DEF-199 are documented in the ledger report. The blank creative and root-shape harness checks now distinguish absent identity, explained preflight rejection and actual runtime crashes.

The diagnostic integrated run `ortbtools-audit-9fSncA` is retained with its nine unexpected browser failures. Review separated two expected root-shape rejections, a missing blank-input identity contract, and exact browser manifestations of existing product gaps. A focused ten-case rerun passed before the final full run above; no runtime fix or weakened normative finding was used to make the audit green. DEF-302 signatures were narrowed to exact aggregate findings so an unrelated error cannot be hidden by a wildcard.

Final `npm run ci` exited 0: formatting, lint, typechecking and coverage-enabled tests passed. The runner executed 160 nonbrowser and 25 browser files. Final accepted outcomes are 3,767 tests/subtests: 3,608 passed, 156 expected-failure markers and three explicit nonapplicable Core skips; zero unresolved failures or cancellations. One existing `macro-evaluator-browser.test.js` attempt failed with Chrome protocol error `Runtime.callFunctionOn: Promise was collected`; the runner's announced retry passed without code changes. The [CI summary](/home/vk/.local/share/ortbtools-research/2026-09-08-final-corpus/ci-final-summary.json) retains that failed attempt separately; `ci-final.log` contains both attempts. These are runner counts, not unique payload counts. The dedicated audit above had no retries.

An earlier repository gate found one literal BOM in the source JSON fixture `encoding-adm-bom-prefixed-vast.json`. It was replaced by the visible Unicode escape, with parsed JSON equality asserted; the materialized test input and portable archive are unchanged. The diagnosed initial CI was stopped and is retained in `ci-initial.log` / `ci-initial-outcome.json`; the successful full CI above started afresh. The control-character guard also passed directly after the repair.

Final convergence checked nine functional requirements, four success criteria, three user stories, seven plan decisions and eight governing principles. No buildable audit gaps remained. No tasks were appended, and tasks.md stayed byte-for-byte unchanged during assessment (SHA-256 `19bdf84e13baa7035daec96546a74415aa6a05945d03a136c8ded20247fd8899`). Normal completion bookkeeping records T018/T020 as complete and updates the feature/index/roadmap; product fixes and cleanup implementation remain follow-up scope. Documentation/governance checks passed again on the closed records. The mandatory pre-push gate reruns local CI, and hosted CI independently owns package and Docker smoke; their exact-SHA outcomes are retained with the delivery evidence. The earlier 81-case first-pass report is retained as [historical evidence](/home/vk/.local/share/ortbtools-research/2026-09-08-final-corpus/verification-before-final.md) and does not describe current counts.

Remaining combinations and complementary existing suites are listed in [coverage-inventory.md](coverage-inventory.md). This audit does not certify arbitrary payloads, every custom dialect/Core option, every format in Mirror/Migrate/history/sharing, other browser engines, real devices, external wrappers, live bidding/tracking or sustained concurrency.
