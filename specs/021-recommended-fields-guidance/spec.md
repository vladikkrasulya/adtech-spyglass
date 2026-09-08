# Feature Specification: Recommended Fields Are Guidance, Not Errors

**Feature Branch**: `main` (direct defect-repair workflow, per the 012/013 precedent)

**Created**: 2026-09-08

**Status**: Complete

Implementation verification and operational delivery evidence are recorded in [verification.md](./verification.md).

**Input**: Owner instruction, 2026-09-08, after the [020 ad format verification matrix](../020-ad-format-verification-matrix/verification.md)
closed: "Починай з rules-request.js, DEF-100/302/103/114". The four ledger groups are one class of
defect. OpenRTB 2.6 §3.2.1 lists `site`, `app` and `device` as _recommended_ objects and `dooh` as a
plain optional object; §3.2.18 types `device.ua` and `device.ip` as optional strings; §4.2.1 types
`seatbid` as "1+ required if a bid is to be made" and `nbr` as optional. Core answered every one of
those omissions with an ERROR, so a spec-valid request without `device` or without a distribution
channel, and a spec-valid no-bid with an empty `seatbid`, rolled up to the blocking verdict `errors`.
The 3.0 rules repeated the same class for `request.context.device` and its `ip`/`ua`. The audit
reproduced the class on 21 cases in four ad formats (video 10, banner 7, native 3, audio 1) across
web, in-app, CTV, DOOH and unspecified contexts on OpenRTB 2.5, 2.6 and 3.0 (DEF-100: 12, DEF-302: 7, DEF-103: 1,
DEF-114: 1) and on eight further cases where the false device errors travelled with unrelated
deviations (DEF-101, DEF-151). Review of the first implementation found that omission checks also
accepted supplied values of the wrong type. The follow-up preserves omission guidance while
restoring blocking type errors. Of the 21 initially affected cases, 20 pass normatively on every
layer; one retains the independent browser deviation DEF-201. The eight other cases remain
re-pinned to their unrelated deviations.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A spec-valid request without recommended objects is not rejected (Priority: P1)

An integration operator pastes a bid request that carries impressions but no `device` object, or
no `site`/`app`/`dooh` object, or a `device` without `ip`/`ua`. The specification allows all of
these. The Inspector must keep telling the operator what is missing and why bidders care, but the
verdict must not be the blocking "errors" that is reserved for actual violations.

**Why this priority**: This is the reported defect and the largest false-positive class in the
audit — twenty-one cases in four ad formats, including every DOOH request and every request whose
context is unspecified. A false blocking verdict on valid input destroys trust in the verdicts that
are right.

**Independent Test**: Analyze a synthetic banner request with `site` and no `device`; then one with
`device` but no `ip`/`ua`; then one with neither `site` nor `app` nor `dooh`. Each yields status
`warnings`, the guidance finding is present at warning level, and no error-level finding names the
omission. A DOOH-only request yields the `ip`/`ua` guidance at info level. The same shapes in an
OpenRTB 3.0 envelope behave the same way.

**Acceptance Scenarios**:

1. **Given** a valid 2.x request without a `device` object, **When** it is analyzed, **Then** the
   verdict is `warnings`, exactly one device finding is present (`request.device_required`,
   warning) and no `ip`/`ua`/`language` finding restates the absent object.
2. **Given** a valid 2.x request with a `device` that lacks `ip`/`ipv6` and `ua`, **When** it is
   analyzed, **Then** `request.device.ip_required` and `request.device.ua_required` are warnings
   on a `site`/`app` request and info on a `dooh`-only request.
3. **Given** a valid 2.x request with none of `site`/`app`/`dooh`, **When** it is analyzed,
   **Then** `request.no_site_or_app` is a warning and the verdict is `warnings`.
4. **Given** an OpenRTB 3.0 request whose `context` lacks `device`, or whose `device` lacks
   `ip`/`ua`, or whose `context` names no channel, **When** it is analyzed, **Then** the same
   levels apply; a `device` of the wrong type remains an error.
5. **Given** a supplied `site`, `app`, `dooh` or `device` that is not a non-null, non-array object,
   or a supplied `device.ua`, `device.ip` or `device.ipv6` that is not a string, **When** a 2.x or
   3.0 request is analyzed, **Then** the offending field produces its error-level invalid-type
   finding, including for `null`, `false` and `0`. An absent property or explicit `undefined`
   retains omission guidance; an empty client-field string may retain the existing guidance.

---

### User Story 2 - An empty-seatbid no-bid is recognized as a no-bid (Priority: P2)

An operator pastes a bidder's no-bid answer that carries the request id and an empty `seatbid`
array without a reason code. The specification treats that as a no-bid. The Inspector must say so,
keep checking that the ids match, and must not call the response malformed or "missing".

**Why this priority**: It is one case in the audit but it sits on the crosscheck path: today the
pair is judged "no response" at critical level although the bidder answered correctly.

**Independent Test**: Analyze `{ id, seatbid: [] }` alone (status `clean`, one info finding) and
paired with its request (crosscheck reports only the id match). A response with neither `seatbid`
nor `nbr` still yields the no-signal error and the crosscheck "no response".

**Acceptance Scenarios**:

1. **Given** a 2.x response with an empty `seatbid` array and no `nbr`, **When** it is analyzed,
   **Then** `response.seatbid_empty_no_nbr` is info and the status is `clean`.
2. **Given** that response paired with a request of the same id, **When** the pair is crosschecked,
   **Then** the only finding is `crosscheck.id_match` (ok); with a different id it is
   `crosscheck.id_mismatch` (crit).
3. **Given** a 3.0 response with an empty `seatbid` array and no `nbr`, **When** it is analyzed,
   **Then** `response.30.seatbid_empty_no_nbr` is info and the status is `clean`.
4. **Given** a response with neither a `seatbid` array nor an `nbr`, **When** it is analyzed and
   crosschecked, **Then** the no-signal error and `crosscheck.no_response` are unchanged.
5. **Given** a supplied `nbr` that is not an integer, such as `"2"`, `{}`, `null`, `false` or
   `2.5`, **When** a 2.x or 3.0 response is analyzed, **Then** its `nbr_invalid` finding is an
   error, including with an empty `seatbid` array or with `nbr` as the only no-bid signal. An
   absent `nbr` or explicit `undefined` follows the existing omission behavior.

---

### User Story 3 - The audit ledger tells the truth after the fix (Priority: P3)

A maintainer running the 020 corpus must see the resolved deviations disappear from the ledger and
every remaining guard still hold: no record may claim a deviation that no longer exists, and no
case may pass by accident.

**Why this priority**: The corpus is the regression net for every later fix; a stale record would
make the guard "deviation is still the recorded one" lie.

**Independent Test**: Run the Core, HTTP and browser corpus layers over the 21 initially affected
cases and the 8 other re-pinned cases: 20 pass normatively on every layer; one passes Core and HTTP
but retains the exact browser DEF-201 signature; the 8 others report only their remaining recorded
deviations. The merged ledger has four fewer groups.

**Acceptance Scenarios**:

1. **Given** the four ledger records DEF-100, DEF-103, DEF-114 and DEF-302 are removed,
   **When** the corpus layers run, **Then** 20 of their cases carry no `knownGap` and pass
   normatively on Core, HTTP and browser; the remaining case passes Core and HTTP and retains
   only the independently recorded browser DEF-201 deviation.
2. **Given** the eight cases whose recorded signatures contained the device lines, **When** the
   corpus layers run, **Then** their guards pass against signatures that contain only the audio
   (DEF-101) and Native 3.0 (DEF-151) deviations.

### Edge Cases

- A supplied non-object `device` produces `request.device_invalid` (2.x) or the existing
  `request.30.context.device_invalid` (3.0) at error level, without child-field cascades.
  `null`, arrays, strings, booleans and numbers are invalid object values, including falsy values.
  An absent property and explicit `undefined` count as omitted; `null` does not.
- A supplied non-string `ua`, `ip` or `ipv6` is an error even if another client field is usable.
  Empty strings may retain existing omission guidance. This feature adds no address parsing or
  network-range validation.
- `dooh` together with `site` or `app` is still the ambiguous-channel warning and keeps the
  site/app level for `ip`/`ua`, because a real client is claimed.
- `seatbid` that is not an array (an object, `null`, a string) is not a no-bid: the validator's
  no-signal error and the crosscheck "no response" remain.
- An integer `nbr` with an empty `seatbid` keeps the existing no-bid info finding with its reason.
  Any supplied non-integer `nbr` produces an error; a no-bid shortcut cannot suppress that error.
  This feature does not add enum membership or numeric-range policy for `nbr`.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: A 2.x request with none of `site`, `app`, `dooh` MUST produce
  `request.no_site_or_app` at warning level; the omission alone MUST NOT yield status `errors`.
- **FR-002**: A 2.x request without a `device` object MUST produce exactly one device finding,
  `request.device_required`, at warning level, and no `request.device.ip_required`,
  `request.device.ua_required` or `request.device.language_missing` for the absent object.
- **FR-003**: A 2.x `device` with omitted or empty-string `ip`/`ipv6`, or omitted or empty-string
  `ua`, MUST produce
  `request.device.ip_required` / `request.device.ua_required` at warning level when `site` or
  `app` is present and at info level when `dooh` is the only channel; the ids are unchanged.
- **FR-004**: The OpenRTB 3.0 rules MUST apply the same levels: `request.30.context.no_site_or_app`
  and `request.30.context.device_required` at warning, `request.30.context.device.ip_required` /
  `ua_required` at warning (info for a `dooh`-only context); `request.30.context.device_invalid`
  stays an error.
- **FR-005**: A response whose `seatbid` is an empty array and whose `nbr` is absent MUST produce
  `response.seatbid_empty_no_nbr` (2.x) / `response.30.seatbid_empty_no_nbr` (3.0) at info level
  and roll up to status `clean`; a response with neither a `seatbid` array nor `nbr` MUST keep the
  error `response.seatbid_or_nbr_required` / `response.30.seatbid_or_nbr_required`.
- **FR-006**: Crosscheck MUST treat an empty `seatbid` array with absent or integer `nbr` as a
  no-bid: it MUST still report
  `crosscheck.id_match` or `crosscheck.id_mismatch` and MUST NOT report `crosscheck.no_response`;
  `crosscheck.no_response` MUST remain for a response with neither a `seatbid` array nor `nbr`.
- **FR-007**: Every existing finding id MUST be preserved without renaming. Exactly the 13
  error-level invalid-type ids enumerated in [the finding contract](contracts/finding-levels.md)
  MUST be added for the reviewed type-validation follow-up. The English, Ukrainian and Russian
  texts of the ten omission ids MUST state the normative basis (recommended or optional, with the
  section for OpenRTB 2.6 and the object name for AdCOM 1.0 / OpenRTB 3.0) and the operational
  consequence, and MUST NOT call the omission required. All 13 new ids MUST have messages in all
  three locales that identify the expected type.
- **FR-008**: Every changed level MUST be pinned by a regression test at the public boundary, and
  the 020 corpus MUST be updated in the same change: 20 initially affected cases become fully
  normative, one retains only browser DEF-201, the 8 other partially affected signatures are
  re-pinned, and every guard passes. Supplied-invalid-value regressions MUST be tested separately
  from valid omission controls.
- **FR-009**: The follow-up MUST bump Core from 0.39.0 to 0.40.0, set the CLI dependency range to
  `^0.40.0`, and update the lock file in the same change. The additive finding ids and newly
  blocking verdicts for malformed supplied inputs justify the minor bump. The validator contract
  and decision index MUST record the policy.
- **FR-010**: In 2.x requests and 3.0 request contexts, supplied `site`, `app`, `dooh` and `device`
  MUST be non-null, non-array objects; supplied `device.ua`, `device.ip` and `device.ipv6` MUST be
  strings. A value of the wrong type MUST produce the field-specific error id, including falsy
  values, regardless of any other valid channel or client field. An absent property or explicit
  `undefined` MUST follow omission rules; `null` MUST be treated as supplied and invalid. Empty
  client-field strings MAY keep existing omission guidance. Invalid Device objects MUST NOT
  trigger child-field cascades. Address parsing and network-range policy are out of scope.
- **FR-011**: A supplied response `nbr` MUST be an integer in both 2.x and 3.0 and MUST otherwise
  produce `response.nbr_invalid` / `response.30.nbr_invalid` at error level. This check MUST apply
  with non-empty or empty `seatbid`, or without `seatbid`; no-bid handling MUST NOT suppress it.
  An absent `nbr` or explicit `undefined` MUST remain omitted; `null` is invalid. This requirement
  validates the declared type only and adds no enum membership or numeric-range policy.

### Key Entities _(include if feature involves data)_

- **Finding level policy**: the mapping from a specification qualifier (required, recommended,
  optional) to omission levels (error, warning, info), with supplied wrong types remaining errors,
  recorded in ADR-016.
- **Known-gap record**: a ledger entry with per-case, per-layer anchored signatures; four are
  retired, one initially affected case retains browser DEF-201, and eight other cases are
  re-pinned by this feature.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Of the 21 audit cases previously recorded under DEF-100, DEF-103, DEF-114 and
  DEF-302, 20 pass normatively on Core, HTTP and browser; one passes Core and HTTP and retains
  only the exact browser DEF-201 signature. There are zero unexpected failures.
- **SC-002**: The 8 re-pinned cases report only their DEF-101 / DEF-151 deviations on every layer,
  and no "deviation is still the recorded one" guard fails anywhere in the corpus.
- **SC-003**: Every existing finding id is retained, exactly the 13 specified invalid-type ids are
  added, and the locale parity suite passes. The ten revised omission texts and all 13 new
  invalid-type texts exist in English, Ukrainian and Russian.
- **SC-004**: `npm run ci` exits 0 with zero failures and zero runner retries on the settled tree,
  and the merged ledger has 40 groups (44 minus 4).
- **SC-005**: Public-boundary regressions prove that supplied wrong object/client/`nbr` types
  produce the specified error ids and offending field paths in both protocol families, including
  falsy values and `null`. Omitted-value controls retain warning/info behavior. Explicit
  `undefined` is tested at the Core boundary; JSON omission controls cover the HTTP boundary.

## Assumptions

- `device.ua` and `device.ip` are optional in §3.2.18; keeping them at warning level on a
  `site`/`app` request (rather than info) is a product decision grounded in the same section's
  compatibility note ("exchanges are recommended to always populate `ua`") and in the operational
  fact that bidders key geo, fraud and browser detection on them. The DOOH info level from the
  2026-08-18 rules audit is retained.
- The 3.0 channel rule and the 3.0 empty-seatbid rule are included for parity although the audit
  recorded no 3.0 case for them: they are the same class in the sibling file, and leaving them
  would reintroduce the defect on the next 3.0 fixture.
- No production payload is used; every fixture is the synthetic corpus already committed by 020.
- Deployment is a separate release decision; this feature ends at the pushed commit with hosted CI.
