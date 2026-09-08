# Verification: Complete the Audio Repair

**Date**: 2026-09-08
**Status**: Complete — verified isolated local delivery.

## Scope and Provenance

The owner authorized completing Gemini’s audio repair while preserving active Claude Code and Cursor work. This feature adopts the exact 35-file Gemini snapshot from baseline `82c04260f8e18f226cf8dea782ae8863f95a47ca`, preserved as `adopted-gemini.patch` and `adopted-gemini-snapshot.json` in the evidence directory below. Feature planning and read-only analysis preceded the newly authored repairs, not Gemini’s earlier implementation.

All source, tests and feature records were completed in the isolated `codex/023-audio-repair` worktree. Delivery is a local commit and reviewable patches. Shared-main integration, hosted CI, npm publication and production deployment are separate states and were not performed. Versions are app1.19.4, Core 0.42.0 and CLI0.1.3 with Core dependency^0.42.0.

## Verified Behavior

The repair completes audio MIME validation and protocol/media detection, makes malformed XML attribute scanning terminate, corrects helper JSDoc/typecheck, excludes MediaFile-shaped vendor-extension metadata, and pins the two new MIME references to the correct OpenRTB Audio anchor. A schema-valid VAST4.1 extension example now retains only its actual video signal. The three-language preview caption identifies VAST / DAAST ad XML and explicitly states that playback is unavailable. DAAST content remains inert document text.

Independent fixture/ledger comparison against the baseline confirms exactly 17 affected fixtures with no payload or normative-expectation changes. Only DEF-101/102/112 were retired; unrelated ledger records and guards are unchanged. Sixteen audio cases are fully normative. `audio-web-26-multi-imp-reversed` retains only browser DEF-201, the independent second-bid selection issue. The merged ledger leaves 34 groups after integration; this does not certify separate crosscheck, vendor, Native or cleanup work.

## Final Gates

| Gate                       | Result                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run ci`               | Exit0: format, lint, typecheck and coverage suite pass; 163 non-browser +25 browser files. Settled totals: 4,014 tests/subtests, 3,879 pass, 132 expected-failure markers, three transport skips, zero unresolved failures/cancellations. One browser file required the existing runner’s single retry. |
| npm package smoke          | Exit0: packed Core 0.42.0 and CLI0.1.3 install and CLI behavior pass. Package inputs are unchanged by the subsequent caption-only correction.                                                                                                                                                           |
| Docker smoke               | Exit0 against the final caption and production image build, using only disposable smoke resources.                                                                                                                                                                                                      |
| Final documentation checks | Prettier, the 10-test Spec Kit contract suite and whitespace/diff check; logs recorded in the external delivery receipt.                                                                                                                                                                                |

All 256 corpus cases have an outcome in each layer:

| Layer   | Pass | Known gap | Not applicable | Unexpected failures |
| ------- | ---- | --------- | -------------- | ------------------- |
| Core    | 198  | 55        | 3              | 0                   |
| HTTP    | 197  | 59        | 0              | 0                   |
| Browser | 185  | 70        | 1              | 0                   |

The 17 affected audio cases pass Core and HTTP. Browser results are 16 normative passes plus the exact retained DEF-201. Known gaps are measured mismatches against unchanged normative expectations, not claims of working behavior. The Core transport skips and browser transport exclusion are explicitly recorded in the JSONL evidence.

Additional focused evidence: six new public-boundary/termination regression groups pass; all 12 independent original review controls pass; the broader focused run records 878 tests/subtests, 743 passes, 132 expected-failure markers, three Core transport skips and zero unexpected failures. The final-caption browser selection records 18 passing tests/subtests covering the 17 cases. Malformed XML probes run in child processes with 64MB heap, a 5s watchdog and Unix core dumps disabled; timeout, crash, signal or nonzero exit fail the test. There are no new parser dependencies or weakened assertions.

## Integration onto shared main (2026-09-08, orchestrating session)

This feature was authored and verified in isolation against baseline `82c0426`. It was rebased onto
`main` at `208cd27` (feature 022, which closed DEF-110 / DEF-104 / DEF-105 in `crosscheck.js`) and
delivered from there. Four conflicts were resolved, none of them in product code:

- `packages/core/package.json` — both features independently bumped Core `0.40.0` → `0.41.0`, and
  git merged the identical value silently. Two different changes cannot share one version, so this
  feature now ships **Core 0.42.0**, with the CLI dependency range and `package-lock.json` corrected
  to match. Every version reference in this package and in the platform contracts was updated with
  it. The conflicting `description` line kept main's escaped form.
- `tests/corpus/known-gaps.json` — the two features retire disjoint records; the resolution is their
  union, so DEF-101/102/112 and DEF-110/104/105 are all gone and nothing else changed.
- `specs/000-platform-baseline/contracts/core-validator.md` and
  `specs/020-ad-format-verification-matrix/defects.md` — both sides appended; both entries kept, in
  chronological order.

The per-layer table and the ledger count above are the numbers measured **after** the rebase, on the
delivered tree. The original isolated-run figures (Core 189/64, HTTP 188/68, browser 176/79, 37
groups) were correct for baseline `82c0426` and are preserved in the evidence directory; they differ
only because feature 022 had already retired three further records and made nine more cases
normative. Post-integration corpus totals: 697 tests, 580 passes, zero failures, three transport
skips and 114 expected-failure markers on the non-browser layers, and 256 of 256 browser cases with
an outcome.

## Reproduction and Process Isolation

Evidence directory: `/home/vk/.local/share/ortbtools-research/2026-09-08-023-audio-repair/`.

From its `worktree/`, the exact complete gate is preserved by:

```bash
bash /home/vk/.local/share/ortbtools-research/2026-09-08-023-audio-repair/run-isolated-ci.sh
bash scripts/npm-pack-smoke.sh
bash scripts/ci-docker-smoke.sh ortbtools-ci-smoke:audio-023-20260908-accepted
git diff --check
```

The CI wrapper sets `CORPUS_REQUIRE_BROWSER=1` and its own `CORPUS_REPORT_DIR`, then executes `npm run ci` with `unshare --user --map-current-user --pid --fork --mount-proc`. It loads the external `profile-isolation.cjs` and prepends `ci-bin/pgrep` to PATH. Those two environment helpers change only temporary Chrome profile prefixes and the corresponding cleanup match. The normal runner still cleans its own orphan browsers inside its private PID namespace. Product code, browser flags, assertions and runner retry policy are unchanged. This protects peer browser processes and prevents host-wide peer cleanup from matching these private profiles.

`ci-input-snapshot.json` pins the tested candidate. Runtime, test, fixture and package hashes remained unchanged after that run; final feature completion bookkeeping is checked separately with Prettier, the Spec Kit contract tests and `git diff --check`. Package smoke installs the packed Core and CLI together and checks CLI help and invalid-input exit behavior. Docker smoke uses a disposable image, container and data volume, not production.

## Convergence and Delivery

Convergence covered 10 functional requirements, five success criteria, 12 acceptance scenarios, six plan decisions and eight constitution principles. It retained the original R1 boundary of OpenRTB 2.x bid.mtype versus actual MediaFile evidence; full 3.0 media-contradiction analysis is outside this bounded repair. The only buildable residual was the misleading video-only XML caption, recorded as T014 and repaired in all three locales without changing the preview kind. Final convergence found no additional buildable work; all 14 tasks are accounted for.

The external `delivery.json` records the final commit, branch, patch hashes, gate summaries and shared-worktree preservation check. `INTEGRATION.md` identifies the complete patch and the repair delta over the exact adopted Gemini snapshot. The current shared working copy still contains the earlier uncommitted Gemini patch; a clean, verified isolated commit does not itself update that checkout or the running site.

## Earlier Attempts and Limitations

The initial complete attempt exposed an unsupported feature-status spelling and a lost Chrome connection; it was stopped only inside its own PID namespace. The supported feature status and private profile names addressed those verification issues. A subsequent complete pre-caption gate passed 4,014 tests/subtests with no retries and is preserved under `pre-caption-gates/`.

The first generic ad-XML caption lacked the family prefix used by the existing corpus observer and failed that observation contract. Its failed attempt is retained under `generic-caption-gates/`. The final VAST / DAAST caption preserves the truthful family prefix and passes the unchanged observer. These historical attempts are not presented as final acceptance.

The final complete run recorded one first-attempt `Runtime.callFunctionOn` timeout in the unrelated `clear-resets-results-browser.test.js`. The unchanged runner repeated that file once; both tests passed (2/2), and CI exited0. The settled totals above replace that file’s initial outcome with its successful retry. Raw attempted totals are 4,016 tests/subtests with one historical failure; `verification-results.json` records first-attempt, retry and settled counts separately. No failed run was discarded or silently counted as green.

Remaining limitations are explicit: DAAST/VAST previews show XML without playback or wrapper fetching; DEF-201 and other audit groups remain open; separate cleanup proposals are unchanged. Local verification does not establish hosted or deployed behavior.
