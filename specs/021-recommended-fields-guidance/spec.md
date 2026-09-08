# Feature Specification: Recommended Fields Are Guidance, Not Errors

**Feature Branch**: `main` (direct defect-repair workflow, per the 012/013 precedent)

**Created**: 2026-09-08

**Status**: Complete

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
deviations (DEF-101, DEF-151).

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

---

### User Story 3 - The audit ledger tells the truth after the fix (Priority: P3)

A maintainer running the 020 corpus must see the resolved deviations disappear from the ledger and
every remaining guard still hold: no record may claim a deviation that no longer exists, and no
case may pass by accident.

**Why this priority**: The corpus is the regression net for every later fix; a stale record would
make the guard "deviation is still the recorded one" lie.

**Independent Test**: Run the Core, HTTP and browser corpus layers over the 21 resolved cases and
the 8 re-pinned cases: the 21 pass normatively on every layer, the 8 report only their remaining
recorded deviations, and the merged ledger has four fewer groups.

**Acceptance Scenarios**:

1. **Given** the four ledger records DEF-100, DEF-103, DEF-114 and DEF-302 are removed and their
   cases carry no `knownGap`, **When** the corpus layers run, **Then** those cases pass with zero
   failures on Core, HTTP and browser.
2. **Given** the eight cases whose recorded signatures contained the device lines, **When** the
   corpus layers run, **Then** their guards pass against signatures that contain only the audio
   (DEF-101) and Native 3.0 (DEF-151) deviations.

### Edge Cases

- `device` present with a non-object value: the 2.x rule keeps the single id
  `request.device_required` at warning level (no new finding id is introduced by this feature);
  the 3.0 rule already has `request.30.context.device_invalid` at error level and keeps it.
- `dooh` together with `site` or `app` is still the ambiguous-channel warning and keeps the
  site/app level for `ip`/`ua`, because a real client is claimed.
- `seatbid` that is not an array (an object, `null`, a string) is not a no-bid: the validator's
  no-signal error and the crosscheck "no response" remain.
- `nbr` present with an empty `seatbid` is unchanged: `response.no_bid` info with the reason.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: A 2.x request with none of `site`, `app`, `dooh` MUST produce
  `request.no_site_or_app` at warning level; the omission alone MUST NOT yield status `errors`.
- **FR-002**: A 2.x request without a `device` object MUST produce exactly one device finding,
  `request.device_required`, at warning level, and no `request.device.ip_required`,
  `request.device.ua_required` or `request.device.language_missing` for the absent object.
- **FR-003**: A 2.x `device` without `ip`/`ipv6` or without a string `ua` MUST produce
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
- **FR-006**: Crosscheck MUST treat an empty `seatbid` array as a no-bid: it MUST still report
  `crosscheck.id_match` or `crosscheck.id_mismatch` and MUST NOT report `crosscheck.no_response`;
  `crosscheck.no_response` MUST remain for a response with neither a `seatbid` array nor `nbr`.
- **FR-007**: No finding id MUST be added, removed or renamed. The English, Ukrainian and Russian
  texts of the ten affected ids MUST state the normative basis (recommended or optional, with the
  section for OpenRTB 2.6 and the object name for AdCOM 1.0 / OpenRTB 3.0) and the operational
  consequence, and MUST NOT call the omission required.
- **FR-008**: Every changed level MUST be pinned by a regression test at the public boundary, and
  the 020 corpus MUST be updated in the same change: the 21 resolved cases lose their ledger
  records, the 8 partially affected signatures are re-pinned, and every guard passes.
- **FR-009**: The Core package MUST take a SemVer minor bump with the CLI dependency range and the
  lock file in the same change, and the validator contract and decision index MUST record the
  level policy.

### Key Entities _(include if feature involves data)_

- **Finding level policy**: the mapping from a specification qualifier (required, recommended,
  optional) to a validator level (error, warning, info) recorded in ADR-016.
- **Known-gap record**: a ledger entry with per-case, per-layer anchored signatures; four are
  retired and eight are re-pinned by this feature.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The 21 audit cases previously recorded under DEF-100, DEF-103, DEF-114 and DEF-302
  pass normatively on the Core, HTTP and browser corpus layers with zero unexpected failures.
- **SC-002**: The 8 re-pinned cases report only their DEF-101 / DEF-151 deviations on every layer,
  and no "deviation is still the recorded one" guard fails anywhere in the corpus.
- **SC-003**: No finding id is added, removed or renamed; the locale parity suite passes; the ten
  affected texts exist in all three locales.
- **SC-004**: `npm run ci` exits 0 with zero failures and zero runner retries on the settled tree,
  and the merged ledger has 40 groups (44 minus 4).

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
