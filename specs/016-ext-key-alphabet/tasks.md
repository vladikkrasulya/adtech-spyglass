# Tasks: Vendor Ext-Key Role Alphabet

**Input**: Design documents from `/specs/016-ext-key-alphabet/`

**Prerequisites**: plan.md, spec.md (34 FR, frozen oracles), research.md (R-01…R-11), data-model.md,
contracts/ (key-role-layer, suggest-label-api, manifests), quickstart.md, checklists/contract.md
(closed 48/48).

**Tests**: included — they are not optional here. The 14-scenario oracle, the ceiling pair, the
routing matrix and the compatibility floor are frozen contracts in the spec, and Constitution VII
requires a regression test for every behaviour change.

**Organization**: by user story, after two blocking phases. Story phases are independently testable;
US1 deliberately needs only the named-rule manifest, so it ships before the 322-name adjudication
(US2) is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable — different files, no dependency on an incomplete task
- **[Story]**: US1–US4, matching spec.md's four stories

## Hard ordering constraints (from the spec, not from taste)

1. **T004 (ADR-015) blocks every code task**: FR-028 — the compatibility decision MUST exist in the
   repository before any code that widens the label set lands.
2. **T010 (baseline freeze) blocks every resolver and persona change**: R-09/SC-002/FR-011 —
   `D0` and the bench "before" run are measured against pre-change code and committed; captured
   later they prove nothing. Slice B (partition fixtures) lands after T008 and gates only US2.
3. The calibration bench (T031/T038) runs only against the live host model — maintainer operation,
   never CI (ADR-012).

---

## Phase 1: Setup

**Goal**: nothing to install — no new dependencies (plan §Technical Context). Setup is the decision
record and the working skeleton.

- [x] T001 Create `packages/core/dialects/data/` directory with a `README.md` stub naming the four
      manifests, their versioning rule, and the regeneration command
- [x] T002 [P] Copy Apache-2.0 attribution into `packages/core/dialects/data/ATTRIBUTION.md` from
      `~/.local/share/ortbtools-research/prebid-2026-08-20/ATTRIBUTION.md`, pinned digests included
      (FR-005; digest `06ab88a6…` per contracts/manifests.md)
- [x] T003 [P] Add redacted synthetic replicas of the two live observations (`ad_type=30`,
      `subage=18` on a native imp) as fixtures in `tests/fixtures/kadam-replica.json` — synthetic
      values, no live payload bytes (FR-012, Constitution III)

## Phase 2: Foundational (blocks all user stories)

**Goal**: the decision record, the vocabulary, the manifests, and the frozen baseline. Nothing here
changes runtime resolution behaviour yet — that is what makes T010's baseline honest (T013 widens
the save route's accepted set, which the baseline does not measure).

- [x] T004 Author `specs/decisions/ADR-015-storable-roles-and-response-variants.md`: names the four
      contract surfaces (FR-028), the nine labels, the three response variants (resolved, ambiguous,
      saved-mapping), the Core MINOR consequence with CLI follow-through, withdrawal policy
      (FR-029), the same-image deployment property (FR-031), and the no-migration statement (FR-032), satisfying FR-020's recorded-decision obligation; index it in `specs/DECISIONS.md`
- [x] T005 [P] Implement `packages/core/dialects/key-role-vocabulary.js`: `CANONICAL_ROLES` (10),
      `STORABLE_LABELS` (20), `FORMAT_LABELS` (explicit allowlist), `projectRoleToLabel()` with
      JSDoc types; contract per contracts/key-role-layer.md
- [x] T006 [P] Implement the authority-oracle pure function in
      `packages/core/dialects/key-role-authority.js`: evidence → exact score
      {0.90, 0.80, 0.70, 0.60, 0.40} with every cap from spec §Confidence and authority oracle — the FR-007 exact-band rule and the FR-026 evidence-strength authority rule
- [x] T007 Implement `scripts/build-key-role-corpus.js`: reads the out-of-tree corpus, reproduces
      every frozen assertion (272/697/289/279, histogram 364/824/42/2/1, 133→128, 95,
      194+33+95=322, digests), records per-entry coverage class per FR-025, writes `key-role-corpus.v1.json`, and REJECTS on any mismatch —
      never runs in CI (FR-017, R-03)
- [x] T008 Generate adjudication skeleton and run the review: first pass may be an agent, second
      pass is the maintainer, per spec §review rules (two distinct reviewer IDs, pseudonymous);
      output `packages/core/dialects/data/key-role-adjudication.v1.json` covering exactly 322 names + partitions; conflicting credible roles become `ambiguous` per FR-027, and `abstain` is a valid reviewed state and deliberately cheap
- [x] T009 [P] Author `packages/core/dialects/data/key-role-named-rules.v1.json`: exactly the rules
      frozen in the spec's oracles, with `condition` predicates (digit-only `build`) and four
      outcome kinds including `cap` for bare `type`/`format` (data-model §5); roles only, no value dictionary of any kind (FR-002)
- [x] T010 (slice A + bench "before" 2026-09-02; slice B appended post-T008 the same day) Freeze every pre-change baseline against CURRENT code, in two slices plus the bench.
      Slice A (blocks US1): routing-matrix fixtures for every named rule, all 47 collision-group
      spellings, unlisted-casing and absent-key controls in both namespaces, with their `D0`, into
      `packages/core/dialects/data/key-role-routing-matrix.v1.json`. Slice B (after T008, blocks
      US2 only): one fixture per adjudication partition, appended to the same manifest with its own
      `D0` — SC-002's full-matrix claim is asserted at US2, so the MVP does not wait for the
      322-name adjudication. Bench: run `node scripts/label-calibration.js` against the live host
      model NOW, before any persona or resolver change, and record the "before" run in
      `specs/016-ext-key-alphabet/bench-evidence.md` (R-09; FR-011; maintainer operation)
- [x] T011 Write `tests/key-role-manifests.test.js`: all seven CI assertion groups from
      contracts/manifests.md — set equality, partition, digests, score double-entry (recompute via
      T006), review completeness, named-rule consistency, routing-fixture coverage — with NO corpus
      dependency
- [x] T012 [P] Write `tests/key-role-vocabulary.test.js`: 20 storable labels, nine new IDs absent
      from `FORMAT_LABELS`, non-labels rejected (`format-declaration`, resolution states,
      valueStatus members — FR-019), projection rules, `valueStatus: resolved` never produced in v1
      (FR-010)
- [x] T013 Widen the save route in `modules/dialects/handler.js`: `SEMANTIC_LABELS` imports from
      key-role-vocabulary (single source, FR-024); extend `tests/dialects.test.js` with the
      compatibility floor — all eleven pre-existing labels store/read/behave identically (FR-021,
      SC-010) and the nine new labels are accepted

**Checkpoint**: `npm run ci` green with manifests committed; no runtime resolution behaviour has
changed yet; `D0` is frozen data.

## Phase 3: User Story 1 — role for an unreadable numeric code (P1)

**Goal**: `ad_type=30` answers `format-declaration → custom @ 0.90` deterministically, role and
code separated in the reason, no model call.

**Independent test**: quickstart §4 — the 14-scenario oracle rows for named-rule keys pass without
the 322-name adjudication being consulted at all.

- [x] T014 [P] [US1] Implement `packages/core/dialects/key-role-alphabet.js`: exact-case
      `lookupKeyRole()` over named rules + adjudication, never-null (explicit `abstain` with
      evidence), scores only on `resolved`, named rule wins recorded disagreements (R-01, spec
      §snapshot identity); manifests `require`d once at module scope; missing/unparseable manifest
      throws at load (loud startup failure per spec); an opaque numeric code under a format-declaring key resolves deterministically to `format-declaration`→`custom` (FR-006)
- [x] T015 [P] [US1] Add `classifySignal()` to `packages/core/dialects/signal-lexicon.js` returning
      `{kind, suggestion}`; reimplement `resolveSignal()` as a thin projection with byte-identical
      behaviour, verified by the existing test suite untouched (R-05)
- [x] T016 [US1] Implement `packages/core/dialects/resolve-precedence.js`: `combine({savedMapping,
legacy, role})` per the FR-001 matrix with FR-016's unconditional saved-mapping precedence; `saved` → saved-mapping variant, `legacy` → unchanged
      shape, abstain never demotes a deterministic answer to a model call
- [x] T017 [US1] Write `tests/key-role-precedence.test.js`: every matrix row as its own case;
      the two load-bearing guarantees called out in quickstart §3 (`popunder=1` stays terminal;
      abstain-over-broad-heuristic preserves legacy, no model)
- [x] T018 [US1] Route `modules/ai-label/handler.js` through the precedence matrix: resolve
      savedMapping server-side via `getDefaultDialectForUser` + `loadUserDialect` +
      `lookupMapping(normalizedPath, serializedValue)` (R-11); no default dialect ⇒ null; response
      variants per contracts/suggest-label-api.md including A0 saved-mapping and required routing
      evidence on model answers; the handler still never writes a mapping (FR-014)
- [x] T019 [P] [US1] Add localized `reason` sentences for role-layer answers to
      `packages/core/messages/{en,uk,ru}.json`: resolved (role vs unknown code separated, FR-010),
      ambiguous, saved-mapping; three locales in the same change (Constitution VI)
- [x] T020 [US1] Write `tests/key-role-oracle.test.js`: all 14 frozen scenarios (exact role, label,
      valueStatus, exact confidence, route) + the `publisher_account_ref` ceiling pair with its
      negative-control assertions (spec §oracles)
- [x] T021 [US1] Update `lib/ollama.js`: response-schema enum imports the widened label set from
      key-role-vocabulary; prompt payload UNTOUCHED — add `tests/key-role-privacy-boundary.test.js`
      asserting the assembled prompt contains exactly the ADR-012 §6 items (FR-033); schema-level guard that no numeric value can yield a specific format label (FR-009)
- [x] T022 [US1] Edit `lib/label-persona.js` ONCE (R-07): claim-aware ceiling (numeric ceiling
      constrains only value-decoding claims, role-only exempt — FR-008) + locale repair (the
      CLOSING language instruction hardened so low-evidence answers compose in the requested
      language — FR-018); do not run the bench yet, T031 owns it
- [x] T023 [US1] Extend `tests/ai-label.test.js`: enum equality across all surfaces via the single
      source, the model-output validator accepting `identifier @ 0.70` on a numeric value, and
      `bad_model_output` unchanged semantics
- [x] T024 [US1] Update `tests/model-free-contract.test.js`: the role layer is deterministic and
      opens no new model reachability; intel/news paths still model-free (ADR-003 scope)

**Checkpoint**: `ad_type=30` through the real endpoint returns the US1 answer; oracle green in CI.

## Phase 4: User Story 2 — adjudicated keys resolve without a model call (P1)

**Goal**: the 322-name alphabet answers deterministically with provenance; `D1` measured; the five
route counts reported.

**Independent test**: quickstart §4b — matrix run reports `D1 > D0`, zero demotions, five counts.

- [x] T025 [US2] Write `tests/key-role-alphabet.test.js`: exact-case identity (listed spelling
      resolves, different casing abstains — the 22 collision groups), resolved/ambiguous/abstain
      state semantics, provenance completeness, unverified status surfaced literally
- [x] T026 [US2] Write `tests/key-role-routing-matrix.test.js`: full-matrix run computing `D1`,
      asserting `D1 > D0`, no-demotion per fixture (requires T010 slice B complete), zero model calls on resolved/ambiguous, and
      the five separate route counts (partition rule from SC-002)
- [x] T027 [P] [US2] Wire the dialects-questions rule's skip-path:
      `packages/core/rules/dialects-questions/index.js` continues to ask questions (never suppresses
      — FR-022), but finding params gain the role-layer state so the UI can show "роль відома" on
      the card without a second request
- [x] T028 [US2] Surface provenance in the suggest response: evidence entries carry source, precise
      citation, coverage class, literal verification status (FR-003/FR-004); the impression-shape verdict appears in the local explanation only, never in confidence or a decoded value (FR-013); extend
      `tests/ai-label.test.js` with a provenance-shape assertion
- [x] T029 [P] [US2] Format-recognition allowlist: `packages/core/non-iab-formats.js` and
      `packages/core/dialects/user-dialect-runtime.js` consult `FORMAT_LABELS` membership, never
      "is an accepted stored label"; per-role inertness asserted in `tests/dialects.test.js`
      (FR-022, the quiet failure mode)
- [x] T030 [US2] Suppression semantics per matrix: saved new-role labels suppress only the exact
      matching question, never beyond the exact dialect+path+value triple (FR-034); extend `tests/rules-dialects-questions.test.js` per role (all nine)
- [x] T031 [US2] Maintainer bench "after" run: `node scripts/label-calibration.js` post-T022
      against the live host model; compare with T010's recorded "before" run, revise the
      numeric-case bands deliberately per FR-011 (notably `counter`), and complete
      `specs/016-ext-key-alphabet/bench-evidence.md` with both runs side by side

**Checkpoint**: SC-002 measurable — `D1 > D0` recorded with route counts.

## Phase 5: User Story 3 — the operator sees they are writing the vendor's dictionary (P2)

**Goal**: the form separates role (supplied, with source) from value (the operator's); the scope
warning tells the truth; all twenty labels speak three languages.

**Independent test**: quickstart §9 by hand — the Kadam replica payload end-to-end.

- [x] T032 [P] [US3] Generate `public/core/key-role-vocabulary.js` browser mirror (IIFE, no
      require) from Core's export; write `tests/key-role-browser-mirror.test.js` asserting set
      equality byte-for-byte (R-10, FR-024); unknown IDs pass through verbatim in any export/reader path (FR-030)
- [x] T033 [US3] Rework `public/modules/inspector/dialect-label.js`: render resolved answers as
      role + value split (only the value is the operator's decision), ambiguous answers with
      candidates and nothing preselected, saved-mapping answers with their stored label and no
      score, provenance and verification status visible, source badges distinct (lexicon / model /
      saved-mapping — ADR-012 §4)
- [x] T034 [P] [US3] Localize all twenty labels with display names AND one-line descriptions in
      `public/modules/inspector/dialect-label.i18n.js` for en/uk/ru from the shared catalog
      (FR-023, R-06); picker shows localized names, stores raw IDs
- [x] T035 [US3] Fix the scope warning in `public/modules/inspector/dialect-label.js` and its i18n:
      "цей діалект, цей шлях, це точне значення" — never "all future traffic" (FR-015); update
      `tests/ui-audit.test.js` accordingly
- [x] T036 [US3] Extend `tests/i18n-audit.test.js` — the test that owns three-locale parity for
      module dictionaries: key parity for every new key, calque guard over the new strings

**Checkpoint**: the manual quickstart §9 walkthrough passes in all three locales.

## Phase 6: User Story 4 — the assistant answers in the operator's language (P3)

**Goal**: the Story 4 breach is closed and covered by a test the bench cannot fake.

**Independent test**: quickstart §6 — low-evidence signal at `locale: ru` returns Russian prose.

- [x] T037 [US4] Write the locale regression: low-evidence model answer at each locale contains no
      cross-alphabet contamination (reuse 015's letter-set scan against model `reason` fixtures);
      lives with the ai-label tests, mocked transport, CI-safe
- [x] T038 [US4] Maintainer live check: three locales × two low-evidence signals against the real
      host model; record in `specs/016-ext-key-alphabet/bench-evidence.md` (the bench cannot see
      language — research §cross-cutting)

## Phase 7: Polish & release

- [x] T039 [P] Extend HOLDOUT in `scripts/label-calibration.js` with post-change cases authored
      fresh (FR-012); note in the file header that the deterministic layer now shrinks the bench
      population and the oracle owns those cases
- [x] T040 [P] Update `specs/000-platform-baseline/contracts/core-validator.md`: the classified
      resolver, the role layer, the widened label set, the response variants
- [x] T041 Version bumps per FR-028 and the 013/014 lessons: `@ortbtools/core` 0.37.0 → 0.38.0,
      CLI dependency range + `package-lock.json` follow; app 1.18.0 → 1.19.0 with
      `public/version.js`, per-locale HTML version refs, and the baseline record
- [x] T042 Update `CHANGELOG.md` and `specs/ROADMAP.md` (016 row: implemented, evidence links)
- [x] T043 Full gate + release through the standing path: fresh verified backup, `scripts/deploy.sh`
      from clean `HEAD == main == origin/main`, smoke, report version/tag/SHA/gates (Constitution
      VIII); rollback stays armed
- [x] T044 Post-deploy verification: quickstart §9 against production with the synthetic replica,
      three locales; record PASS/defects in the 016 package

---

## Dependencies

```text
Phase 1 ──→ Phase 2 ──→ US1 (Phase 3) ──→ US2 (Phase 4) ──→ Polish (Phase 7)
                              │                    │
                              ├──→ US3 (Phase 5) ──┤
                              └──→ US4 (Phase 6) ──┘
```

- T004 (ADR-015) blocks T005+ — every code task (FR-028).
- T010 slice A + the bench "before" run block T014–T018 — every resolver or persona change (R-09,
  FR-011). Slice B waits for T008 and blocks only T026/US2, so the MVP chain is
  T004 → T010A → US1 with no adjudication on it.
- T008 (adjudication) blocks T010 slice B and T025; named-rule-only rows of the oracle (T020) do
  NOT wait for it — that is what makes US1 independent.
- T022 (persona) blocks T031 (the "after" bench run) and T037/T038.
- US3 depends on US1's response variants (T018); US4 depends on T022 only.
- T041–T044 close the feature and depend on everything above.

## Parallel opportunities

- Phase 2: T005 ∥ T006 ∥ T009 after T004; T007→T008 chain runs beside them.
- Phase 3: T014 ∥ T015 ∥ T019 after T010; T017/T020 after their subjects.
- Phase 5: T032 ∥ T034 beside T033.
- Phase 7: T039 ∥ T040 beside T041.

## Implementation strategy

**MVP = Phase 1 + Phase 2 + US1.** That alone turns `ad_type=30` from a dead end into
`format-declaration @ 0.90` with an honest reason, using only the named-rule manifest — the 322-name
adjudication (T008, the largest manual effort) gates US2, not the MVP. Ship US1, measure, then let
the adjudication land as its own increment with `D1` as its acceptance number.

## Phase 8: Convergence

- [x] T045 [US2] Render the role badge on the question finding card in `public/ortbtools.app.js`
      from the params the rule already ships (`role_state`/`role`/`role_confidence`/
      `role_candidates`): localized role name from the mirror catalog for `resolved`, a candidates
      hint for `ambiguous`, nothing for `abstain` — so "роль відома" is visible without a second
      request, per T027, US2/AC1
- [x] T046 [US3] Give the stored dialect view a real surface for labels: a minimal mappings list in
      the account cabinet (`public/account.js`) showing each mapping's localized label name from
      the mirror catalog beside path=value — or, if the maintainer prefers, a recorded decision
      that the JSON export is the read-back surface — per FR-023/SC-009
