# Contract & Compatibility Checklist: Vendor Ext-Key Role Alphabet

**Purpose**: Formal requirements-quality gate before `/speckit-tasks`. Validates that the public
contract change — nine new storable role labels, the `ambiguous` response variant, and the widened
resolution path — is specified completely, unambiguously and consistently enough to implement
without inventing policy. Also covers the adjudication process's own requirements, because that
process is the largest irreversible manual commitment in the feature.

**Created**: 2026-08-29
**Verified**: 2026-08-29 (adversarial pass — see Verification record)
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [contracts/](../contracts/)

**Gate rule**: no task is generated until every item is closed or explicitly waived with a recorded
reason. This is a contract change under Constitution Principle IV, so an unclosed item is a blocker,
not a note.

**These are unit tests for the requirements, not for the code.** Each item asks whether something is
_written_ well enough, not whether it works.

**Marker convention**: bracketed tags are quality dimensions and scenario classes, **not** section
citations. A citation always reads `Spec §…`, `Plan §…` or `Contract §…`. `Exception Flow` and
`Edge Case` are scenario classes; the spec's corresponding heading is `### Edge Cases`.

---

## Verification record

Every item asserting a gap was put to an independent adversarial pass instructed to **refute** it, and
each verdict was then re-checked by hand against the spec. Results:

| Outcome                                      | Items                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| Gap confirmed, survives refutation           | CHK017, CHK036, CHK002 (refutation itself rejected — see below)        |
| **False gap — closed, spec is right**        | CHK010, CHK024, CHK030, CHK038                                         |
| Reason wrong, defect real — restated         | CHK004 → superseded by CHK047                                          |
| Answered in the feature package, not spec.md | CHK019, CHK033 — closed by cross-reference                             |
| Miscited or mis-dimensioned, repaired        | CHK006, CHK009, CHK016, CHK018, CHK023, CHK026, CHK027, CHK031, CHK035 |

**CHK002's refutation was rejected.** The refuter argued FR-021's "behave exactly as it does today"
specifies the saved-mapping response. It cannot: measured in `modules/ai-label/handler.js`, the
suggest-label route consults no saved mapping today at all — its only mention of `dialect_mappings`
is a comment stating it never writes one. The saved-mapping row is a **new** outcome on a route with
no prior behaviour, so a freeze clause has nothing to freeze. The item stands.

---

## Requirement Completeness — the extended contract

- [ ] CHK001 Are the nine new storable role IDs enumerated in exactly one normative place, so no surface can derive a different set? [Completeness] [Spec §FR-019]
- [ ] CHK002 Is the response shape of a **saved-mapping hit** specified? The precedence matrix says only "Saved mapping; stop", and the suggest route has no prior behaviour to inherit. [Gap] [Spec §Resolver precedence]
- [ ] CHK003 Are requirements defined for what an operator may save **from** an `ambiguous` answer — may they pick a candidate, must they choose manually, or is saving blocked? [Gap] [Spec §Public response compatibility]
- [x] CHK004 ~~Is the source of "independent value evidence" named anywhere?~~ **Closed: the stated reason was wrong.** FR-002 and FR-009 do name admissible sources (existing format words, format-naming truthy flags, established shape flags). The real defect is narrower — see CHK047. [Superseded]
- [ ] CHK005 Are version-bump obligations stated as requirements, or deliberately delegated to the plan? FR-020 requires "a recorded compatibility decision" but names no SemVer consequence; `spec.md` contains zero occurrences of "SemVer". [Ambiguity] [Spec §FR-020]
- [ ] CHK006 Are requirements defined for **removing or renaming** a role after release, given stored mappings would then carry a label the accepted set no longer contains? [Gap] [Recovery scenario class]
- [ ] CHK007 Is the CLI stated to be in or out of scope? Widening a Core enum forces a `@ortbtools/core` minor bump, which drags the CLI dependency range and the lockfile — a consequence this repo has hit before. `spec.md` contains zero occurrences of the substring "cli". [Gap] [Spec §FR-024]
- [ ] CHK008 FR-024 requires every export surface to be **updated** with the label set. Is the export's behaviour toward an **older reader** encountering a new role specified, or only the update obligation? [Gap] [Spec §FR-024]
- [ ] CHK009 Is the timing of ADR-015 relative to code landing stated as a requirement anywhere in the feature package, or does FR-020 require only that the decision exist? [Ambiguity] [Spec §FR-020, Plan §Gate consequences]
- [x] CHK010 ~~Is the claim-aware exemption specified for all nine new labels or only the fixtured one?~~ **Closed: false gap.** FR-008 states the rule role-agnostically — "MUST NOT constrain role-only claims resting on the key name" — with `identifier @ 0.70` appearing only as the concrete fixture. The requirement already generalises. [Verified 2026-08-29]

## Requirement Clarity — contract terms that must not be interpreted

- [ ] CHK011 Is "presented identically wherever an operator meets it" defined measurably — same display string, same ordering, same descriptions, or only the same set? [Ambiguity] [Spec §FR-023]
- [ ] CHK012 Does "carry its meaning in all three supported languages" require a localized description, or is a localized name sufficient? [Ambiguity] [Spec §FR-023]
- [ ] CHK013 Is "retain exactly its current meaning" decomposed into the observable behaviours that constitute meaning — suppression, format recognition, display, export? [Clarity] [Spec §FR-021]
- [ ] CHK014 Is a strictness level stated for the preserved-legacy response — identical field set, or merely a compatible shape? [Clarity] [Contract §suggest-label-api]
- [ ] CHK015 Is the term "public contract" scoped — the HTTP response, the Core export, the stored value set, the model schema, or all four? [Clarity] [Spec §FR-020]
- [ ] CHK016 When a named rule and a corpus adjudication disagree on state for the same exact key, is the winner stated? "One runtime identity per exact key" fixes identity but not precedence. [Ambiguity] [Spec §Frozen snapshot construction] _(CHK035 folded in here — same underlying gap.)_

## Requirement Consistency — cross-section alignment

- [ ] CHK017 Do the roles FR-019 forbids storing exist in the canonical vocabulary? **Verified defect**: `unknown` is a `valueStatus` member (Spec:293), and backtick-quoted `` `other` `` occurs exactly once in the whole file — inside the prohibition itself (Spec:359). The canonical role table (Spec:384-395) holds ten roles and neither. [Conflict] [Spec §FR-019 vs §Closed role vocabulary]
- [ ] CHK018 Is the canonical role count consistent wherever it is derivable — ten roles, nine storable, twenty storable labels? The number twenty appears in no spec section; it is derived by the reader. [Consistency] [Spec §Closed role vocabulary, §FR-019]
- [x] CHK019 ~~Do FR-016's dialect scope and the unchanged request agree?~~ **Closed by cross-reference.** The gap is real in `spec.md` alone — zero occurrences of "default" — but Phase 0 names it explicitly ("a real hole") and resolves it: server-side resolution from the authenticated operator's default dialect, with the limitation recorded. [Research §R-11]
- [ ] CHK020 Does the suppression matrix agree with FR-022's prose on whether a new role suppresses non-question findings? [Consistency] [Spec §Suppression and format-recognition semantics]
- [ ] CHK021 Do the precedence matrix and the response-compatibility section agree on which outcomes produce which response variant, with no outcome unmapped? [Consistency] [Spec §Resolver precedence vs §Public response compatibility]
- [ ] CHK022 Is FR-002's prohibition on value dictionaries consistent with its carve-out for format words, truthy flags and shape flags, with the boundary stated rather than implied? [Consistency] [Spec §FR-002]

## Compatibility & migration coverage

- [ ] CHK023 Are requirements defined for a client that predates the `ambiguous` variant and receives one — graceful degradation, or is the variant gated? [Gap] [Exception scenario class]
- [x] CHK024 ~~Is the `confidence` omission on `ambiguous` stated as intentional?~~ **Closed: false gap.** Spec:468-470 states it directly and names the variant "the intentional contract extension that the compatibility decision and boundary tests MUST record". [Verified 2026-08-29]
- [ ] CHK025 Are the pre-existing eleven labels enumerated normatively, so the SC-010 compatibility floor has an unambiguous subject? [Completeness] [Spec §SC-010]
- [ ] CHK026 Is the absence of a storage migration stated as a requirement, rather than left inferable from the column type? [Completeness] [Spec §Deferred Decisions]
- [ ] CHK027 When the model returns one of the nine new role labels for a signal the deterministic layer resolved differently, is the reconciliation stated? The precedence matrix routes to the model only after every deterministic source abstains, so the case may be unreachable — if so, is that stated? [Coverage] [Spec §Resolver precedence]

## Acceptance criteria quality — measurability

- [ ] CHK028 Can "no fixture answered deterministically before may newly reach the model" be evaluated without ambiguity about what counts as "answered deterministically"? [Measurability] [Spec §SC-002]
- [ ] CHK029 Are the five route counts defined with mutually exclusive, collectively exhaustive membership rules, so every answer lands in exactly one? [Measurability] [Spec §SC-002]
- [x] CHK030 ~~Is D0's pre-change capture point a requirement?~~ **Closed: false gap.** SC-002 is a mandatory success criterion and states the ordering in its own words: "`D0` records final deterministic answers before the change and `D1` after the change" (Spec:655-656). [Verified 2026-08-29]
- [ ] CHK031 Is "the same exact score across process restarts and locales" stated with an observable procedure? The determinism sentence lives in the confidence oracle, not in FR-007's two fixed values. [Measurability] [Spec §Confidence and authority oracle]
- [ ] CHK032 Is `D1 > D0` guarded against a degenerate pass — one additional resolution satisfying the inequality while coverage regresses elsewhere? [Measurability] [Spec §SC-002]

## Scenario & edge-case coverage on the contract path

- [x] CHK033 ~~Is the no-default-dialect case defined?~~ **Closed by cross-reference.** Absent from `spec.md`, resolved in Phase 0: no default dialect means no saved-mapping precedence, and routing proceeds at the next matrix row. [Research §R-11]
- [ ] CHK034 Are requirements defined for a stored mapping whose label was valid at save time but whose role has since been re-adjudicated to a different state? [Edge Case] [Gap]
- [x] CHK035 **Folded into CHK016** — the saved-mapping dimension is already settled by FR-016, leaving the named-rule vs corpus precedence question, which CHK016 now carries. [Merged]
- [ ] CHK036 Are requirements defined for the manifests being absent, truncated or unparseable at load time — does the feature degrade to today's behaviour or fail loudly? [Gap] [Exception scenario class]

## Adjudication process requirements

- [ ] CHK037 Is "two independent review passes" specified as to who qualifies as a reviewer, and whether an agent may serve as one or both? [Gap] [Spec §Frozen snapshot construction]
- [x] CHK038 ~~Is a partially reviewed manifest rejected or may unreviewed names ship as `abstain`?~~ **Closed: false gap.** Spec:613 — the generator "rejects missing, extra, duplicate, unreviewed, score-mismatched, or silently flattened records". [Verified 2026-08-29]
- [ ] CHK039 Are the triggers for **re-review** specified — a new corpus snapshot, a changed authority oracle, a disputed role — or is review a one-time event? [Gap]
- [ ] CHK040 Is the escalation path for reviewer disagreement specified beyond "an explicit maintainer resolution with rationale", including who may act as maintainer? [Clarity] [Spec §Frozen snapshot construction]
- [ ] CHK041 Are requirements defined for the review record's own retention and auditability, given reviewer IDs and decisions are retained in a committed artifact? [Gap] [Constitution III]
- [ ] CHK042 Is the adjudication effort bounded or staged in the requirements — 322 names plus every partition, twice — or is completeness assumed achievable in one pass? [Assumption] [Spec §FR-025]

## Dependencies, assumptions & governance

- [ ] CHK043 Is the assumption that the model privacy allowlist does not expand stated as a **requirement** implementation must satisfy, rather than only as an assumption? [Assumption] [Spec §Assumptions]
- [ ] CHK044 Are the attribution obligations specified concretely enough to know what "travels with the table into the product" means — a file, a UI surface, or both? [Clarity] [Spec §FR-005]
- [ ] CHK045 Is the dependency on an out-of-tree corpus stated with its failure mode — what a contributor without the corpus can and cannot do? [Dependency] [Spec §FR-017]
- [ ] CHK046 Is the relationship to CL-001 stated as a requirement that nothing here creates a value-independent mapping, in a place implementation will read? [Traceability] [Spec §Deferred Decisions]

## Added by verification

- [ ] CHK047 Does any row of the precedence matrix, or any other requirement, ever produce `valueStatus: resolved`? The evidence sources FR-002 preserves route to "preserve the current specific-format verdict", not to a role-layer answer — so the enum member may be defined in three places and reachable from none. [Conflict] [Spec §Resolver precedence vs §Public response compatibility] _(supersedes CHK004)_
- [ ] CHK048 Is `Exception Flow` / `Edge Case` established anywhere as spec vocabulary, or does the spec use only `### Edge Cases`? Scenario-class names used in review must map to something the spec actually names. [Traceability] [Spec §Edge Cases]

## Notes

- Check items off as completed: `[x]`. Record a waiver inline with its reason; never delete an item.
- **Four items were closed as false gaps by the verification pass** (CHK010, CHK024, CHK030,
  CHK038) and one had a wrong reason (CHK004 → CHK047). They are kept, struck and explained rather
  than removed, because the record of what was checked and found sound is itself evidence.
- **CHK017 and CHK002 are the two confirmed defects that need a spec edit.** CHK047 is the third, in
  its corrected form. CHK019 and CHK033 need only a cross-reference to Research R-11.
- Absence claims in CHK005, CHK007 and CHK018 were measured, not assumed: `spec.md` contains zero
  occurrences of "SemVer", "rollback", "deprecat\*", "migrat\*" and even the bare substring "cli",
  and exactly one of "export" — which FR-024 does use substantively, so CHK008 was narrowed
  accordingly.
