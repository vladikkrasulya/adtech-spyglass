---
description: 'Task list for feature 005: dialect signal labeller'
---

# Tasks: Dialect Signal Labeller

**Input**: Design documents from `/specs/005-dialect-signal-labeller/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md)

**Tests**: Included. The spec's confidence and privacy requirements are not verifiable by inspection,
so their tests are part of the work rather than optional.

**Organization**: Tasks are grouped by user story. Every task carries the commit that satisfied it,
or is unchecked because nothing satisfies it yet.

**Record order**: tasks T001–T018 were completed **before** this list existed and are reconstructed
from the commits, not from memory. They are marked complete because the evidence column names the
change that did them, and each was verified against the deployed image or a test run. T019 onward is
genuine remaining work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: the boundary and the wiring every story depends on.

- [x] T001 Define the accepted label set once and assert the three copies agree — lexicon, model
      client, and dialect store — in `packages/core/dialects/signal-lexicon.js`,
      `lib/ollama.js`, `tests/ai-label.test.js` — FR-010 (`cd609b3`)
- [x] T002 Implement the deterministic first stage as a pure, network-free resolver that abstains
      rather than guesses, in `packages/core/dialects/signal-lexicon.js` — FR-001 (`cd609b3`)
- [x] T003 Implement the redaction allowlist `redactImp()` in `modules/ai-label/handler.js`:
      structural impression fields and sibling key names only — FR-004, FR-011 (`cd609b3`)
- [x] T004 [P] Gate the endpoint behind authentication and a per-operator rate limit in
      `server.js` and `modules/ai-label/handler.js` — FR-008 (`cd609b3`)
- [x] T005 Constrain model output to the accepted label set at decode time and re-check it in the
      handler before it reaches the operator, in `lib/ollama.js` — FR-010 (`cd609b3`)
- [x] T006 Wire the container to the host model over the docker host-gateway alias in
      `docker-compose.yml`. **This is what `cd609b3` omitted**, leaving the feature answering 503
      to every request for two days — FR-012 (`650f071`)
- [x] T007 Move the persona into the repository as `lib/label-persona.js` and send it per request,
      so the text that separates a useful suggestion from a confident wrong one is versioned and
      reviewable — FR-005 (`650f071`)
- [x] T008 Target the shared fleet model rather than a derived one, and document why the name is
      hardcoded, in `lib/ollama.js` — FR-012 (`650f071`)

**Checkpoint**: the boundary is defined, the wiring reaches the model, and nothing beyond the
allowlist can travel. Covers SC-002 (a signal the lexicon answers never reaches a model) and
SC-006 (no path in this feature writes a mapping).

---

## Phase 2: User Story 1 — Name an unknown vendor signal (Priority: P1) 🎯 MVP

**Goal**: an operator meeting an unrecognised `ext` key gets a labelled proposal with visible
provenance, and nothing is written.

**Independent Test**: analyse a payload with an unrecognised `ext` key, request a proposal, confirm
label + confidence + reason + provenance return and the dialect is unchanged.

- [x] T009 [US1] Implement `POST /api/dialects/suggest-label` as two stages — lexicon, then model
      only on abstention — in `modules/ai-label/handler.js` — FR-001, FR-003 (`cd609b3`)
- [x] T010 [US1] Return `source` on every suggestion and render the distinction in the browser, in
      `public/modules/inspector/dialect-label.js` — FR-002 (`cd609b3`)
- [x] T011 [US1] Offer the affordance from a question finding and carry the analysed signal on the
      control rather than re-deriving it at click time, in `public/ortbtools.app.js` — FR-003 (`cd609b3`)
- [x] T012 [P] [US1] Ship every user-visible string in en/uk/ru in
      `public/modules/inspector/dialect-label.i18n.js` and `public/i18n.js` — FR-013 (`cd609b3`)
- [x] T013 [P] [US1] Test the lexicon's resolutions and abstentions, and the redaction allowlist,
      in `tests/ai-label.test.js` — FR-004 (`cd609b3`)
- [x] T014 [US1] Test that the labelling path is wired to a reachable host and not to the container
      itself, in `tests/model-free-contract.test.js` — FR-012 (`650f071`)

**Checkpoint**: US1 works end to end against the deployed image; verified on `650f071` from inside
a throwaway container on the production image. Covers SC-001.

---

## Phase 3: User Story 2 — Trust the number beside the answer (Priority: P1)

**Goal**: confidence tracks evidence instead of sitting at a constant.

**Independent Test**: run the bench across strong, weak, and absent evidence and confirm the
distribution moves with the evidence and never reaches certainty.

- [x] T015 [US2] Build the calibration bench with confidence bands as well as labels, and report
      mean deviation rather than a pass count, in `scripts/label-calibration.js` — SC-003, SC-004 (`5323537`)
- [x] T016 [US2] Add a HOLDOUT set written after the persona was frozen, so a change that helps only
      the tuning set is visible as overfitting, in `scripts/label-calibration.js` — SC-003 (`5323537`)
- [x] T017 [US2] Extend the scale to govern every label, make the ceilings a final pass, and state
      that a ceiling is a maximum rather than a target, in `lib/label-persona.js` — FR-005, FR-006, FR-007, SC-004 (`5323537`)

**Checkpoint**: tuning set 19/19 labels at 0.011 mean deviation; holdout 9/10 at 0.005; no answer at
exactly 1.0 on either set.

---

## Phase 4: User Story 3 — Keep working when the model is not there (Priority: P2)

**Goal**: unavailability is a stated outcome with a manual route, not an error.

**Independent Test**: make the model unreachable, request a proposal, confirm the copy names the
condition and the manual builder still opens on the same signal.

- [x] T018 [US3] Distinguish unreachable, missing-model, timeout, and bad-output outcomes, and map
      each to copy the operator can act on, in `modules/ai-label/handler.js` and
      `public/modules/inspector/dialect-label.js` — FR-009, SC-005, SC-007 (`cd609b3`, reason names corrected in `650f071`)

**Checkpoint**: US3 is the only story that was actually exercised in production before `650f071` —
by every request.

---

## Phase 5: Record & Remaining Work

**Purpose**: what the Constitution Check marked Partial or Violated, plus known gaps.

- [x] T019 Record the decision that should have preceded the code, amending one clause of ADR-003,
      in `specs/decisions/ADR-012-bounded-model-assist-on-dialect-labelling.md`. — this change
- [x] T020 Mark ADR-003 amended in place and add ADR-012 to `specs/DECISIONS.md`, as that index
      requires. — this change
- [x] T021 Write this feature package — `spec.md`, `plan.md`, `tasks.md`, `checklists/`. — this
      change
- [x] T022 Add the missing release notes to `CHANGELOG.md` for `650f071`, `5323537`, and `84cc6ea`.
      Principle VIII is Partial until this lands. — this change
- [x] T023 Add this feature to `specs/ROADMAP.md` with its true status and next gate, and state that
      the package was written after the work, as the roadmap does for 004. — this change
- [ ] T024 [US2] Close the two known calibration misses: a bare boolean under a generic key returns
      0.6 where the persona's own ceiling is 0.5, and `sticky_bottom` is labelled
      `interstitial-banner`. The second is a lexicon vocabulary question, not a confidence one, and
      may belong in `packages/core/dialects/signal-lexicon.js` rather than the persona.
- [ ] T025 Verify the finding-card layout in the expanded state and in the light theme at widths
      above 1500px. `84cc6ea` repaired the collapsed state only; Principle VII is Partial until
      this is checked by looking, not only by measuring.
- [ ] T026 Decide whether the shared-model coupling needs a health signal of its own. Today a rename
      or rebuild of the fleet model surfaces as an operator-facing unavailable state plus a 5xx
      alert; that may be sufficient, and this task may close as "no change needed".

---

## Dependencies & Execution Order

- **Phase 1 (Foundational)** blocks every story. T006 in particular blocked all three in production
  without anyone noticing, because the browser degraded exactly as US3 specifies.
- **US1 (Phase 2)** depends only on Phase 1.
- **US2 (Phase 3)** depends on US1 existing — there is no confidence value to calibrate until there
  is an answer — and on T007, because a persona outside the repository cannot be revised under
  review.
- **US3 (Phase 4)** is independent of US1's success path and was reachable first.
- **Phase 5** depends on nothing technical; it is record-keeping and known gaps.

### Parallel Opportunities

- T022, T023, T025 and T026 touch different files and can proceed in parallel.
- T024 must not run in parallel with any other change to `lib/label-persona.js`: the bench compares
  one persona against a fixed set, and two concurrent edits make the result unattributable.

---

## Notes

- Editing `lib/label-persona.js` without running `scripts/label-calibration.js` before and after is
  a regression risk with no CI backstop. Watch the HOLDOUT set specifically.
- Do not send runner-level options such as `num_ctx` with a request; that reloads the shared model
  and reimposes eviction cost on every other caller on the host.
- The bench needs a live model and must stay out of `npm run ci`.
