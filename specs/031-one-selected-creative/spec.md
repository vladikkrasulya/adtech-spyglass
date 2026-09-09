# Feature Specification: One Selected Creative, One Reading of the Response

**Feature Branch**: `fable/031-selection-truth`

**Created**: 2026-09-09

**Status**: Complete

**Input**: Independent review of the 020 closure, 2026-09-09. The review confirmed the ledger closure
and the release, and reproduced two defects in a real browser on valid input that no corpus case
could have caught. A third, of the same family, was found while reproducing them. All three come
from one structural fact: creative resolution existed in two divergent copies, and the panel around
it read the response a third way.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The price is in the currency the response named (Priority: P1)

An analyst opens an OpenRTB 3.0 pair whose response declares `EUR` and whose bid is 1.25. The
winning-bid chip must say `€1.25`.

**Why this priority**: a number with the wrong currency symbol is not a rounding error, it is a
different amount of money. The tool exists to be trusted about exactly this.

**Independent Test**: analyse a 3.0 pair with a non-USD currency; the chip shows that currency, and
so does the macro context the preview resolves against.

**Acceptance Scenarios**:

1. **Given** a 3.0 response declaring a currency, **When** the bid is previewed, **Then** the price
   chip uses that currency.
2. **Given** a 3.0 bid that declares its own currency, **When** it is previewed, **Then** the bid's
   own currency wins over the response's, exactly as it does under 2.x.
3. **Given** a 3.0 pair, **When** the macro context is built, **Then** the identifiers it carries
   are read from the 3.0 payload rather than left empty because they were looked for under 2.x
   names.

---

### User Story 2 - The creative on screen is the one the selector says is selected (Priority: P1)

An analyst opens a response carrying several materials of different kinds. Before touching anything,
the material marked as selected and the material rendered must be the same material.

**Why this priority**: the selector's whole purpose is to say which of several creatives is on
screen. When it points at one and the panel shows another, every downstream reading — the creative,
its destination, its price — is attributed to the wrong material, and nothing on screen reveals it.

**Independent Test**: analyse a response whose first material is a vendor Native card and whose
second is a push notification; before any click, the rendered creative is the first material's.

**Acceptance Scenarios**:

1. **Given** a multi-material response of mixed kinds, **When** the analysis first renders, **Then**
   the creative shown is the one whose selector control is marked selected.
2. **Given** the same response, **When** the analyst clicks the already-selected control, **Then**
   nothing on screen changes.
3. **Given** the same response, **When** the analyst selects another material, **Then** the
   creative, its destination and its price all move to that material together.

---

### User Story 3 - Every resolved material shows its own price (Priority: P2)

An analyst steps through a multi-material response. Each material carries its own price on the wire.
Each must show it.

**Why this priority**: a placeholder where a number belongs reads as "this material has no price",
which is a claim about the response that is not true.

**Independent Test**: analyse a vendor Native material carrying `cpc`; the chip shows that amount,
not a placeholder.

**Acceptance Scenarios**:

1. **Given** a resolved material carrying a price under any documented alias, **When** it is
   previewed, **Then** the chip shows that price.
2. **Given** a resolved material carrying no price at all, **When** it is previewed, **Then** the
   chip says so rather than inventing a number.

---

### User Story 4 - A test that says "the whole corpus" sweeps the whole corpus (Priority: P1)

A maintainer reads a regression test asserting that a predicate reaches exactly N cases across the
corpus. That claim must be true.

**Why this priority**: this is the honesty of the evidence, not a convenience. A guard that silently
covers half of what it names gives false confidence precisely where confidence was the point.

**Independent Test**: the corpus-wide guards enumerate the same case set the corpus loader does, and
the same material set the product resolves.

**Acceptance Scenarios**:

1. **Given** a guard that claims corpus-wide reach, **When** it runs, **Then** it iterates every
   case the loader materializes, mutations included, not only the cases that store a literal
   response in their own file.
2. **Given** a response carrying several materials, **When** a corpus-wide guard measures reach,
   **Then** it examines every material, not only the first.

---

### Edge Cases

- A 3.0 response with no declared currency falls back exactly as a 2.x one does.
- A response with no candidates at all still renders and still reports its own state.
- A material carrying a price of `0` shows `0` — zero is a real price, not a missing one.
- A single-material response renders that material and offers no selector, as before.

## Requirements _(mandatory)_

- **FR-001**: There MUST be exactly one definition of "the creative at index (seat, bid)", used by
  the first render and by every later selection alike.
- **FR-002**: The set of candidates the selector enumerates and the set that definition can resolve
  MUST be the same set, for every response shape the product accepts.
- **FR-003**: The first render MUST resolve the first enumerated candidate.
- **FR-004**: Currency, price, identifiers and every other panel derived from the response MUST be
  read from the same resolved reading of it — including through the OpenRTB 3.0 envelope.
- **FR-005**: Under OpenRTB 3.0, each identifier the preview's macro context carries MUST be read
  from its 3.0 field, or be left explicitly empty where 3.0 has no equivalent; none may be silently
  read from a 2.x field name that does not exist there.
- **FR-006**: The price shown MUST come from the resolved candidate itself, under any price alias
  the product already documents.
- **FR-007**: The corpus MUST be able to assert the displayed price, per case and per candidate.
- **FR-008**: A guard claiming corpus-wide reach MUST enumerate through the corpus loader and MUST
  examine every material of every response.
- **FR-009**: The In-Page Push call-to-action role, which the preview contract already lists, MUST
  appear in the rendered card.

### Success Criteria

- **SC-001**: A 3.0 pair declaring a non-USD currency shows that currency, asserted by the corpus at
  the browser layer.
- **SC-002**: A mixed multi-material response renders its first material first, asserted by the
  corpus at the browser layer before any selection is made.
- **SC-003**: Each material of that response shows its own price, asserted per candidate.
- **SC-004**: The corpus-wide guards cover every case the loader materializes and every material of
  every response, and the numbers they assert are measured over that full set.
- **SC-005**: No existing corpus case changes verdict at any layer, and the ledger stays empty.
- **SC-006**: The full repository gate passes.

## Assumptions

- The corpus browser harness already measures the price chip; only an assertion was missing.
- Where OpenRTB 3.0 has no equivalent of a 2.x identifier, leaving it empty is correct and is not a
  defect to be papered over with a plausible-looking substitute.

## Out of Scope

- Any change to `packages/core/`.
- Rendering remote creative assets that the sealed preview blocks by policy.
