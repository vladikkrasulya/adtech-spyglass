# Feature Specification: The Analyze Boundary Survives Malformed and Oversized Input

**Feature Branch**: `main` (direct defect-repair workflow, per the 012/013/021/022 precedent)

**Created**: 2026-09-08

**Status**: Complete

**Input**: Owner instruction, 2026-09-08, after [022](../022-crosscheck-price-floor/spec.md) shipped:
close the transport and shape-robustness defects DEF-115, DEF-204, DEF-300 and DEF-303 recorded by
the [020 audit](../020-ad-format-verification-matrix/defects.md). All four are the same failure of
the public analyze boundary: a payload that is syntactically valid JSON, but malformed or oversized,
made the product crash, silently drop input, or reset the socket instead of answering with the
structured findings and documented envelopes the contract promises.

- **DEF-115**: the HTTP category decode walked `imp`, `seatbid` and each seat's `bid` with a bare
  `(x || []).forEach`, so a response whose `bid` or `seatbid` was a non-array object threw
  `forEach is not a function`. `POST /api/analyze` answered `400 bad_request` with an internal
  message instead of its 200 success envelope and structured validation findings.
- **DEF-204**: the Inspector's winning-bid selection read `seatbid.bid[0].cur` before it POSTed to
  Analyze. A null first bid, an empty first `bid[]`, or a `bid` supplied as a non-array object made
  that read throw `Cannot read properties of … (reading 'cur')` in the browser, so the analysis
  never started and the operator saw a broken tab rather than the findings the payload deserved.
- **DEF-300**: the analyze handler treated `bidRes` as present only when it was a non-empty object,
  so a bare scalar (for example the JSON number `42`) was dropped as though no response had been
  submitted. Core's own `validate()` rejects a scalar root with `payload.invalid_root`; the HTTP
  contract answered a clean, response-free analysis and an empty crosscheck instead.
- **DEF-303**: when a body exceeded the 2 MiB cap, `readJson` destroyed the socket mid-upload, so a
  standard client observed an `ECONNRESET` and never received the `400 payload_too_large` envelope
  the HTTP API documents.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A malformed bid shape still yields structured findings (Priority: P1)

An operator pastes a syntactically valid response whose `bid` or `seatbid` is the wrong JSON type — a
broken adapter emitting `"bid": {}` instead of `"bid": []`, a null first bid, or an empty first seat.
The server must keep its 200 success envelope with the real validation findings, and the Inspector
must reach that analysis instead of throwing before it starts.

**Why this priority**: A `400 bad_request` carrying an internal `forEach is not a function` string,
or a browser tab that dies before the Analyze call, tells the operator nothing about the payload they
pasted. The structured error the validator already produces is the answer they came for.

**Independent Test**: Post a pair whose `seatbid[0].bid` is `{}`, `[]`, or `[null]`: the HTTP status
stays 200, the envelope carries the validation findings (for example `response.seatbid.empty`), and
the crosscheck reports no positive per-bid verdict. Open the same pairs in the Inspector: each
reaches a completed analysis with a visible verdict and no console `TypeError`.

**Acceptance Scenarios**:

1. **Given** a response whose `seatbid[0].bid` is a non-array object, **When** it is posted to
   `/api/analyze`, **Then** the status is 200 and the envelope holds the validator's structured
   findings, not `bad_request`.
2. **Given** a response whose `seatbid` is a non-array object, **When** it is posted, **Then** the
   status is 200 and the envelope holds `response.seatbid_or_nbr_required`.
3. **Given** a null first bid or an empty first `bid[]`, **When** the pair is analyzed in the
   Inspector, **Then** the analysis completes and no `Cannot read properties of … (reading 'cur')`
   error is raised before the POST.
4. **Given** any of the above, **When** the payload's `imp`, `seatbid` or `bid` are the correct array
   types, **Then** category decoding and bid selection behave exactly as before.

---

### User Story 2 - A scalar response is validated, not silently dropped (Priority: P1)

An operator pastes a valid request and, in the response pane, a bare JSON scalar — a number returned
by a broken endpoint. The Inspector already refuses the scalar before it posts; the HTTP API must
also refuse it, because Core's validator refuses it when called directly.

**Why this priority**: A response that comes back as "clean, nothing to crosscheck" over a value the
validator would have rejected is a false all-clear at the exact boundary an auditor trusts.

**Independent Test**: Post `{ bidReq: <valid banner request>, bidRes: 42 }`: the envelope carries
`payload.invalid_root` for the response side and `crosscheck.no_response`, and the HTTP status stays 200. Call `validate(42)` directly: it returns `payload.invalid_root` with status `invalid`, the same
verdict the HTTP path now surfaces.

**Acceptance Scenarios**:

1. **Given** a present scalar `bidRes` alongside a valid request, **When** the pair is posted,
   **Then** the response side is validated and `payload.invalid_root` appears in the envelope.
2. **Given** the same pair, **When** it is posted, **Then** the crosscheck reports
   `crosscheck.no_response` at crit and no per-bid verdict.
3. **Given** the same scalar, **When** `validate()` is called directly, **Then** it produces the
   identical `payload.invalid_root` verdict, so the HTTP and Core layers agree.
4. **Given** an absent (`undefined` or `null`) `bidRes`, **When** a request-only body is posted,
   **Then** the request-only behaviour is unchanged.

---

### User Story 3 - An oversized body returns the documented error (Priority: P2)

An operator, or an automated client, sends a body larger than the 2 MiB analyze cap. The server must
return the `400 payload_too_large` envelope the API documents, not reset the connection.

**Why this priority**: A connection reset reaches a standard client as a transport failure with no
status and no body, so the documented error contract is unobservable exactly when it matters.

**Independent Test**: Post a body just over 2 MiB and a body twenty times the cap: both receive HTTP
`400` with `code: "payload_too_large"` in the error envelope, and memory stays flat.

**Acceptance Scenarios**:

1. **Given** a body over the 2 MiB cap, **When** it is posted to `/api/analyze`, **Then** the client
   receives `400` with `code: "payload_too_large"` and `success: false`.
2. **Given** a body many times the cap, **When** it is posted, **Then** the same envelope is returned
   and the server does not accumulate the discarded bytes.
3. **Given** a body within the cap, **When** it is posted, **Then** parsing and validation are
   unchanged.

### Edge Cases

- A `bid` array whose first element is a valid object behaves exactly as before; the guards only
  change the null, empty, and non-array shapes.
- A `bidRes` supplied as an empty object `{}` remains treated as absent, unchanged: the scalar branch
  covers only present non-object values, not the empty-container case.
- An oversized body whose upload never completes is bounded by the per-IP analyze rate limiter and by
  the client-side timeout; the drain discards bytes without buffering, so memory stays flat.
- A malformed `imp`/`seatbid`/`bid` that is a valid array of malformed members is out of scope here:
  each member is validated by the existing rules; only the container-type crash is closed.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The category traversal in Core MUST guard `imp`, `seatbid` and each seat's `bid` with
  an array-type check, so a non-array value yields no decoded categories rather than throwing, and
  `POST /api/analyze` keeps its 200 success envelope and structured findings for a malformed shape.
- **FR-002**: The Inspector's winning-bid selection MUST tolerate a `seatbid`/`bid` that is not an
  array and a first bid that is null or a non-object, resolving the bid to an empty object so a
  malformed first bid reaches structured validation without a client-side `cur` dereference.
- **FR-003**: The analyze handler MUST treat a present scalar `bidRes` (a number, string or boolean
  that is neither `undefined` nor `null`) as a submitted response, so `validate()` surfaces
  `payload.invalid_root` and `crosscheck` reports `crosscheck.no_response`, matching Core's own
  direct behaviour; an absent or empty-object `bidRes` MUST keep its prior treatment.
- **FR-004**: An analyze body over the 2 MiB cap MUST receive the documented `400 payload_too_large`
  error envelope, delivered without resetting the connection, and the server MUST NOT buffer the
  discarded bytes.
- **FR-005**: No finding id MUST be added, removed or renamed, and no message text MUST change in any
  locale; the HTTP status codes and error `code` strings involved are the ones already documented.
- **FR-006**: Every changed behaviour MUST be pinned at the public boundary by the 020 corpus in the
  same change: the six affected cases lose their ledger records and pass normatively, while every
  other recorded deviation keeps its exact signature in both directions.
- **FR-007**: The Core package MUST take a SemVer minor bump with the CLI dependency range and the
  lock file, because the public category-decode surface changes from throwing to returning empty
  categories; the HTTP API and validator contracts MUST record the before/after.
- **FR-008**: The unbounded drain introduced for FR-004 MUST be documented at the code boundary as a
  deliberate trade-off, naming the per-IP rate limiter and the flat-memory measurement that bound it.

### Key Entities _(include if feature involves data)_

- **Submitted response**: a `bidRes` that is present for validation — a non-empty object, an array,
  or a present scalar; an absent or empty-object value is not submitted.
- **Structured envelope**: the 200 `{ success: true, validation, crosscheck, meta }` body, or the
  4xx `{ success: false, error, code }` body, that the HTTP contract promises for every input.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The six audit cases recorded under DEF-115, DEF-204, DEF-300 and DEF-303 pass
  normatively on their applicable Core, HTTP and browser corpus layers with their ledger records
  retired.
- **SC-002**: Every other corpus case carrying a recorded deviation still reports exactly that
  deviation, with no signature re-pinned and no guard failing in either direction.
- **SC-003**: No finding id, level or message changes; the locale-parity and severity-registry suites
  pass unchanged.
- **SC-004**: `npm run ci` exits 0 with zero failures and zero runner retries.

## Assumptions

- A `bidRes` of exactly `{}` stays "absent"; widening that is a separate opinion the audit did not
  record, and no case exercises it.
- The HTTP corpus harness models the public contract; teaching it to represent a scalar response side
  is part of the boundary under test, not a weakening of the oracle. The per-side `invalid` status
  that a merged envelope cannot express stays asserted at the Core layer, the same treatment `type`
  and `version` already receive.
- No new decision record is created: the governing policy is unchanged. The durable rules — malformed
  shapes decode to empty categories, a present scalar is validated, an oversized body returns its
  envelope — are recorded in the [HTTP API contract](../000-platform-baseline/contracts/http-api.md),
  the [validator contract](../000-platform-baseline/contracts/core-validator.md) and the
  [public-boundary contract](./contracts/analyze-input-boundary.md) for this feature.
- Deployment is a separate release decision; this feature ends at the pushed commit with hosted CI.
