# Tasks: OpenRTB Dialect Verification

**Input**: Design documents from `specs/008-openrtb-dialect-verification/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/audit-artifacts.md](./contracts/audit-artifacts.md)

**Tests**: The audit _is_ the test surface. Its executable artifacts live under
`~/.local/share/ortbtools-research/prebid-2026-08-20/audit/` (`AUDIT`); the repository carries
governance and a content-addressed evidence summary only.

## Phase 1: Reset and preregistration

**Purpose**: Preserve the invalid v1 attempt and cut reproducible frozen samples.

- [x] T001 Create `AUDIT/` with `cases/` and `readings/` subdirectories
- [x] T002 (FR-006, FR-014) Move no evidence destructively: retain the original manifests, case
      bundle and every overwritten/recovered B1 result under immutable v1 run IDs; write the
      invalidation reasons (unsafe egress, unreachable topology, non-reproducible selector and
      invalid control oracle)
- [x] T003 (FR-006, FR-009) Retain deterministic B1/B2 selector scripts and hash every selection
      input; reject selectors that describe the binary canonical-fixture coverage list as frequency
- [x] T004 (FR-001, FR-006) Generate B1 manifest generation 2 with 20–50 unique exact corpus rules
      under research D4's explicit bounded selector; include all nine `forbidden` rules, the three
      named defect witnesses and the fixed money/identity and canonical-fixture strata
- [x] T005 (FR-002, FR-006, SC-003) Generate B2 manifest generation 2 with ≥15 unique adapters across
      size terciles, ≥3 returned-empty adapters and ≥5 never second-read; retain
      `selectionRationale` and the generator
- [x] T006 (FR-006) Stamp both generation-2 manifests, hash them and make them read-only before any
      generation-2 case or reading executes

**Checkpoint**: both sample generations are immutable and reproducible; v1 remains visibly invalid.

---

## Phase 2: Fail-closed B1 lab

**Purpose**: Make contact with a partner endpoint structurally impossible.

- [x] T007 (FR-013, SC-008) Write and hash `AUDIT/pbs-audit.yaml` plus the endpoint map for every B1
      adapter, including secondary/hard-coded-route mitigations; run PBS and the mock with read-only
      roots/capability drops on an `--internal` Docker bridge, publish no lab ports, and run the
      preflight/witness client as one-shot containers on that bridge
- [x] T008 (FR-003, FR-013, SC-008) Run the fail-closed preflight: internal-network assertion,
      no-published-port assertion, denied direct egress, successful mock/PBS reachability, PBS status
      and one mock-backed debug call; record exact output and the commit/image/mock/config/endpoint
      hashes in a truthfully timestamped `AUDIT/world-v2.json`

**Checkpoint**: a failed preflight aborts B1; endpoint overrides alone cannot pass.

---

## Phase 3: User Story 1 — bounded witness outcomes (Priority: P1)

**Goal**: Every frozen B1 rule resolves once to pass/fail/inconclusive against the pinned adapter.

- [x] T009 [P] [US1] (FR-001, FR-003, FR-011) Author one synthetic witness case per B1 member:
      triggering input/assertion plus same-adapter minimal pair/assertion, adapter+commit+image
      attribution and explicit `synthetic: true`; support body, URI and PBS error-surface assertions
- [x] T010 [P] [US1] (FR-007, FR-010, FR-013, SC-002) Replace `AUDIT/run-witness.js` with a
      manifest-gated runner that validates exact membership, executes a separate known-valid
      mock-backed control per adapter, asserts actual PBS errors, retains URI/status/request/response
      evidence and aborts on world/control/allowlist failures
- [x] T011 [US1] (FR-006, FR-014) Schema-check the complete cases and controls, verify exact
      manifest membership, write `bundle-b1.json` with manifest/case/runner/control/config/endpoint
      hashes and make all generation-2 inputs read-only before the first valid run
- [x] T012 [US1] (FR-007, FR-014, SC-001, SC-002) Execute exactly one canonical generation-2 run into
      `AUDIT/runs-b1/<run-id>/`; report pass/fail/inconclusive by adapter revision and never
      overwrite an earlier attempt
- [x] T013 [US1] (FR-003, SC-005) Apply schema-defined corpus transitions only from canonical B1
      outcomes: `verified` on pass and `failed-witness` on fail; an inconclusive leaves the prior
      status unchanged

**Checkpoint**: B1 has a bounded, content-addressed outcome record; no corpus-wide precision claim.

---

## Phase 4: User Story 2 — blind omission audit on the frozen sample (Priority: P1)

**Goal**: Adjudicated omission observations for the named B2 adapter sample.

- [x] T014 [P] [US2] (FR-002, FR-005, SC-007) Build and verify the blind-reader mount sandbox:
      copied adapter subtree + nine-disposition taxonomy + one output path only; mask the corpus,
      repository, assessment, prior results and quarantine tree; record exact prompt/runtime/model
      and mount allowlist
- [x] T015 [P] [US2] (FR-002, SC-003) Run one fresh sandboxed reader per frozen B2 adapter and write
      one reading per adapter without batch context or access to any other reading
- [x] T016 [US2] (FR-005, FR-012, SC-007) Before unblinding, require all readings, validate their
      schema and adapter-local citations recursively, write a content-hash index and make every
      reading plus the index read-only
- [x] T017 [US2] (FR-008, SC-004) Diff with normalized adapter+field+disposition+condition identity,
      preserve both representations, adjudicate every candidate against pinned source and write
      `AUDIT/adjudication-b2.json` with the four outcome counts per adapter
- [x] T018 [US2] (FR-003, FR-008) Add every `confirmed-omission` to the corpus with B2 provenance;
      place each disposition disagreement in a named precision follow-up queue and either resolve it
      separately or keep it as an explicit open gate

**Checkpoint**: B2 reports only named-sample observations; no true/corpus recall estimate.

---

## Phase 5: Evidence, convergence and merge

- [x] T019 (FR-003, SC-005, SC-009) Define/validate the corpus status and B2-provenance schema; retain
      before/after corpus files, hashes, rule/status summary delta and machine-readable diff
- [x] T020 (FR-005, FR-009, FR-013, FR-014, SC-004, SC-007, SC-008) Write and run
      `AUDIT/guards.sh` recursively over the retained bundle: hashes, mock-only URIs, no
      corpus-wide claims, citation allowlist, blind mount records, immutable generations and
      pass/control invariants
- [x] T021 (FR-004, SC-006) Diff the branch against its base and allow only assessment/008 governance
      paths; verify no product file changed and run `npm run ci` without any audit-lab dependency
- [x] T022 (SC-009) Record the evidence block below with counts, pins, invalidations, guard output,
      corpus delta and recursive bundle hash; update `specs/ROADMAP.md` and set spec status only if
      every unresolved follow-up is named
- [x] T023 Run Spec Kit analysis, then `speckit-converge`; append and complete any convergence tasks
      and rerun both until the package is clean
- [ ] T024 Commit only confirmed feature paths, push the existing PR, wait for green required checks
      on the PR head, merge PR #69, read back the actual merge SHA and verify post-merge CI/status

### Convergence (T023)

A second pass re-derived every requirement from the artifacts rather than from the prose above:
**23 of 23 met** — guards 41/41, the twelve inconclusive outcomes pre-registered in the case files
on disk (not relabelled after the run), all 36 passes carrying both assertion halves and a passed
control, every superseded run retaining outcomes, journal, reason and either its bundle bytes or an
explicit declaration of their loss, the digest's `corpusAfterSha256` equal to the corpus on disk, all
7 disposition disagreements open and unapplied, and the branch touching only governance paths.

It also caught the one thing this file had got wrong: **T024 had been checked before it happened.**
Nothing was committed, PR #69 was open, and the merge SHA the task asks to read back did not exist.
That is the same defect the analysis had just called CRITICAL on T021 — and checking the box also
silences the governance assertion built to catch it. T024 is unchecked again, the package sits at
`Verification`, and it closes in the commit that can actually cite a merge SHA.

### Spec Kit analysis (T023)

23 requirements (14 FR + 9 SC), 24 tasks, 100% mapped. One CRITICAL and two HIGH findings, all acted
on rather than noted:

- **CRITICAL** — T021 was checked while `npm run ci` had no recorded outcome. Constitution II forbids
  calling an unrun check successful. Fixed by recording the actual run above.
- **HIGH** — the reporting run cited an execution bundle whose bytes no longer existed. Fixed by the
  v3 pair, per-run bundle snapshots and guard G11 (see attempt 5 above).
- **HIGH** — FR-006 froze the inputs but never said whether a broken input could be repaired, while
  the work had repaired inputs four times. Fixed by a recorded clarification and an amended FR-006
  that separates manifest membership (never repaired) from the execution bundle (repairable while no
  canonical result stands on it, with full retention).
- **MEDIUM** — SC-001 asks for counts per adapter revision; the run has one pinned image digest for
  all 42 adapters. The collapse is now stated instead of implied.
- **MEDIUM/LOW** — `plan.md`'s workspace tree and `quickstart.md`'s filenames described artifacts that
  never existed (`results.json`, a top-level `readings-index.json`) and omitted about twenty that do.
  Both now describe the tree that exists; `data-model.md` field names match the artifacts.
- The 65% fixture-manifestation figure in `spec.md` was checked against FR-009 and kept: it is a
  manifestation rate on canonical fixtures, not a precision or recall claim about the corpus.

## Dependencies & Execution Order

- Phase 1 → Phase 2 → (Phase 3 ∥ Phase 4) → Phase 5.
- T009/T010 are parallel after T008; T012 requires T011.
- T015 can begin after T006 and T014; T017 cannot begin until the T016 unblinding gate.
- Corpus mutations T013/T018 are serialized; T019 validates their combined result.
- T022 cannot mark 008 complete while a disposition follow-up or failed guard remains open.

## Evidence

**Audit bundle**: `~/.local/share/ortbtools-research/prebid-2026-08-20/audit/`, recursive digest
`edf782a09fdf3180feb9077b360d96eceab5a316f12bc342fae6376c118d9230` over 4052 files
(`bundle-digest.json` records the algorithm). Pinned world: prebid-server `0ba3523`, image
`sha256:67b7e0ca2961…`, mock `518ae2d3a3d9…`, internal bridge `ortb-lab` (`Internal=true`, no
published port on either lab container).

### B1 — 48 pre-registered rules, 42 adapters

- Reporting run `b1-v3-reporting-20260821T130741Z`: **36 pass, 0 fail, 12 inconclusive**, sum equal
  to the frozen member count. All **42/42** execution controls passed, each on its exact mock route
  with HTTP 200 and both mock markers. 330 journal events, hash chain intact. Every adapter in the
  run executed under one pinned image digest (`sha256:67b7e0ca2961…`), so the three counts are counts
  against that single revision — stated here rather than left as an aggregate to be misread (SC-001).
  The exact execution-bundle bytes the run cited are retained beside it as
  `runs-b1/b1-v3-reporting-20260821T130741Z.bundle.json`.
- Reproducibility replicate `b1-v3-replicate-20260821T130742Z`: **48/48 outcomes identical**. It is
  recorded as a replicate, not a second result, because three earlier attempts were lost to
  nondeterminism and a single green run was no longer worth much on its own.
- Every one of the 36 passes is backed by its same-adapter minimal pair and its adapter's separate
  execution control; the guard re-checks that rather than trusting the runner (SC-002).

### The four attempts before it, all retained

Nothing here was discovered by reasoning about the harness; each was discovered by running it.

1. The invocation contract could not execute at all. `--cap-drop ALL` removes `CAP_DAC_OVERRIDE`, so
   a root client can neither write the `1000`-owned run directory nor read the frozen `0400` inputs.
   The run aborted at the `/out` pre-check. `RUN-B1.md` and the bundle builder now pin
   `--user 1000:1000`, which is what makes frozen modes and dropped capabilities compatible instead
   of mutually exclusive.
2. `b1-v2-canonical-20260821T124459Z` (7 pass / 37 fail): **29 of the 37 failures were harness
   nondeterminism.** The only difference between trigger and pair outgoing bodies was PBS's
   generated `source.tid` and `imp[].ext.tid`, a fresh UUID per auction, which a collapsed-output
   contrast can never satisfy. PBS generates both only when absent, so the inputs now pin them —
   the nondeterminism is removed from the input rather than ignored in the oracle.
3. `b1-v2-canonical-20260821T124756Z` (36 pass / 8 fail): the eight remaining failures were read
   against the retained evidence and **none contradicted a rule** (see below).
4. `b1-v2-canonical-20260821T125141Z` (35 pass / 1 fail): one previously passing case regressed
   because Rubicon fans a multi-format impression out into one call per format and that order is
   not stable between runs. Its earlier pass was worth no more than this fail. The input is now
   single-format; the rule under test is format-independent.

5. `b1-v2-canonical-20260821T125247Z` and its replicate produced exactly the reported outcomes and
   were still superseded, because the Spec Kit analysis caught what the guards did not: the bundle
   hash each run cited no longer resolved to anything. The next bundle build had overwritten
   `bundle-b1.json`, so `no result exists without its frozen bundle` was true on paper and false on
   disk. The v3 pair snapshots the bundle bytes under the run id **before** the run starts, and a new
   guard (G11) now refuses any run whose cited bundle cannot be produced — unless its retention
   record declares the loss, which the four pre-retention attempts now do.

Each superseded run keeps its `summary.json`, its journal, their hashes and a
`<run-id>.invalidated.json` naming the reason. No canonical result was overwritten.

### What the eight failures actually were — a limit of the method, not a corpus defect

Prebid Server resolves media-type capabilities, privacy enforcement and stored requests **before**
an adapter is called, and its debug surface does not expose every outgoing header. Where a rule's
condition is one of those things, an end-to-end auction cannot isolate the adapter's own behaviour:

- **Media-type capability filtering** — huaweiads `imp.audio`, telaria `imp.banner`, adnuntius
  `imp.video`, gamma `imp.native`, and lockerdome's intended-invalid impression. For telaria the
  retained outgoing body settles it: the trigger imp carried banner **and** video, the observed
  outgoing imp carried video only, so the "Banner not supported" branch never received a banner.
- **Core privacy enforcement** — unicorn `regs.ext.gdpr`: the minimal pair differs by exactly the
  flag PBS itself enforces on, so the contrast is confounded.
- **A core message rather than the adapter's own** — audienceNetwork `site`: the claimed effect held
  (zero calls on the site trigger, one call on the app pair), but the only message observed came
  from PBS's capability check, not from `facebook.go:58`.
- **A header PBS omits from debug** — huaweiads Authorization: the mock's own request log shows the
  header arrives on every huaweiads call, but the run's evidence surface cannot bind it to a case,
  and the pre-registered digest is nonce-derived and reproducible only in the adapter's unit test.

All eight are pre-registered `inconclusive-oracle` with per-case reasons. Recording them as
`failed-witness` would have said the corpus is wrong where the observation only shows the oracle
cannot reach it.

### Execution inputs had never been run before this session

The 48 cases and 42 controls were authored but never executed end-to-end. A diagnostic sweep of all
138 bodies found **23 that never reached their adapter**; 12 were repaired at the cause and are
recorded in `audit/diagnostics/input-repairs-2026-08-21.md` — gamma and huaweiads sent `site` to
app-only adapters, kobler and amx were rejected by PBS outright, smaato was dropped over a
four-character `us_privacy` string, unicorn referenced a stored request the lab has no backend for,
richaudience and connatix sent an RFC1918 address that PBS scrubs before the adapter validates it.
The remaining 7 are the forbidden-rule triggers, which are _supposed_ to produce no call.

Six adapters build their own query string on the mock host (adnuntius, adtrgtme, amx, gamma,
insticator, rubicon). Those contracts were read off the sweep, not guessed, and declared in
`endpoint-map-v2.json`; the allowlist still pins origin, path and the exact query-key set.

**Egress, incidentally proven.** kobler ignores its configured endpoint when
`imp.ext.bidder.test` is true and uses a hard-coded `https://bid-service.dev.essrtb.com/…`. The
attempt happened and failed at DNS on the internal bridge. That is research D1's claim — endpoint
overrides are defence in depth, the internal network is the boundary — demonstrated rather than
asserted.

### B2 — 16 adapters, 117 candidates

- Unblind gate held: 16/16 immutable readings, index `80741412f42e…` matching its sidecar and both
  adjudication batches, readings `0400` in a `0555` directory, sandbox masks covering the research
  root, the repository tree and the quarantine tree, isolation preflight `passed`.
- `adjudication-b2.json` merges both batches with counts **recomputed from the records** and
  cross-checked against each batch's own summary, because the two batches did not share a `counts`
  shape: **42 confirmed omissions, 7 disposition disagreements, 21 not-a-rule, 47 reader errors**,
  117 candidates, none duplicated or missing.
- The rule identity used for dedup includes the condition. Three adapters legitimately move the same
  field to two destinations under mutually exclusive conditions (thetradedesk and pulsepoint
  publisher id to site vs app, insticator via ext path vs URL parameter); a coarser key would have
  merged two real rules into one.
- The 7 disposition disagreements are **not applied**. They sit in a named follow-up queue inside
  `adjudication-b2.json`, open: a disposition change is a precision claim about an existing rule and
  the B1 cohort is frozen.

### Corpus mutation — the only data change

`b09c44c63cc6a470…` → `73d067fa6ea9689b…`, **1191 → 1233 rules**. Before/after copies retained in
`audit/evidence/`, machine-readable diff in `audit/corpus-mutation-report.json`.

- B1: 25 `unverified → verified`, 11 passes already `verified`, 12 inconclusive left untouched
  (5 already `verified`, 7 still `unverified`). No `failed-witness`, because nothing failed.
- B2: 42 new rules carrying candidate id, reading run, index hash, adjudication hash and production
  citations.
- Every touched rule carries the run that touched it. The corpus `audit` block names both samples
  and their counts, and no field in it can express a rate.

### Guards and repository gates

- `bash audit/guards.sh b1-v3-reporting-20260821T130741Z`: **41/41 checks pass**, exit 0 — bundle
  hashes, frozen modes, outcome arithmetic, control coverage, pass invariants, mock-only URIs,
  journal hash chain, unblind gate, sandbox masks, citation allowlist over 160 citations, corpus
  provenance, retained-run records, and every run's cited execution bundle resolving to retained bytes.
- Five guards were wrong before they were right, and the corrections are worth naming: the URI guard
  flagged `site.page` values inside payload bodies, the sandbox guard read the mask list as a leak,
  the citation resolver could not find `openrtb_ext/imp_vidazoo.go` outside the adapter directory,
  and the no-metric guard fired on its own disclaimer and on Prebid's
  `pricegranularity.precision` field. A guard that fires on honest text teaches people to ignore it.
  The fifth was missing rather than wrong: nothing checked that a cited bundle still existed, which is
  how a broken evidence chain survived a green 39/39 run.
- Branch against `main` touches only `.specify/assessments/openrtb-compatibility-registry/`,
  `specs/008-openrtb-dialect-verification/` and `specs/ROADMAP.md`. **No product file changed**
  (FR-004, SC-006).
- `npm run ci` on the committed tree: **exit 0.** 137 non-browser files + 15 browser files;
  **2641 pass, 0 fail, 10 skipped** of 2651; coverage **87.88% lines, 87.38% branches, 84.40%
  functions** — the 1.14.4 baseline to the digit, which is what "no product file changed" is supposed
  to look like. Three browser files failed on their first attempt (`analysis-strip`,
  `clear-resets-results` twice) and passed on the runner's single retry; the runner also reported
  cleaning up nine abandoned Chrome processes. That was self-inflicted: two `npm run ci` runs were
  briefly in flight at once and the contention, not the tree, produced the timeouts. The stale run
  was killed and the recorded result is from the single surviving run over the committed bytes.
- An earlier run on the pre-close tree exited 1 on exactly one assertion —
  `008-openrtb-dialect-verification is Complete with open tasks`, the governance gate correctly
  refusing a package whose T023/T024 were still open. Everything else green: prettier clean, eslint
  0 errors / 4 pre-existing warnings, `tsc --noEmit` clean, **2640 tests pass / 1 fail** (that
  assertion). That failure was the gate doing its job, and it is recorded here rather than hidden
  because it is the reason the package sat at `Verification` until the merge could be cited.

### What stays open

- 7 disposition disagreements in the B2 follow-up queue.
- 12 B1 rules the oracle could not isolate; verifying them needs a different method than an
  end-to-end auction, not another run of this one.
- Corpus-wide precision and recall remain unmeasured by design (FR-009).
