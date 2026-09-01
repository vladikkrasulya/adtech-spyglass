# Contract & Compatibility Checklist: Vendor Ext-Key Role Alphabet

**Purpose**: Formal requirements-quality gate before `/speckit-tasks`. Validates that the public
contract change — nine new storable role labels, the `ambiguous` response variant, and the widened
resolution path — is specified completely, unambiguously and consistently enough to implement
without inventing policy. Also covers the adjudication process's own requirements, because that
process is the largest irreversible manual commitment in the feature.

**Created**: 2026-08-29
**Verified**: 2026-08-29 (adversarial pass — see Verification record)
**Closed**: 2026-08-29 — all 48 items resolved; 17 spec amendments (FR-005/010/017/019/021/023 edits,
new FR-028–FR-034, precedence-matrix row, response-compatibility additions, SC-002 definitions,
review-process rules), 4 closed as false gaps by verification, 6 closed by inspection or
cross-reference. The gate is open for `/speckit-tasks`.
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

- [x] CHK001 Are the nine new storable role IDs enumerated in exactly one normative place, so no surface can derive a different set? [Completeness] [Spec §FR-019] **Closed 2026-08-29**: FR-019 now names the closed role-vocabulary table as "the single normative enumeration" from which every surface derives.
- [x] CHK002 Is the response shape of a **saved-mapping hit** specified? The precedence matrix says only "Saved mapping; stop", and the suggest route has no prior behaviour to inherit. [Gap] [Spec §Resolver precedence] **Closed 2026-08-29**: the saved-mapping response variant is now specified in §Public response compatibility (stored `semantic_label`, `source: saved-mapping`, notes travel, no numeric confidence, no model call), and the matrix row points at it.
- [x] CHK003 Are requirements defined for what an operator may save **from** an `ambiguous` answer — may they pick a candidate, must they choose manually, or is saving blocked? [Gap] [Spec §Public response compatibility] **Closed 2026-08-29**: §Public response compatibility now states the operator may save any storable label from an `ambiguous` answer via the ordinary picker; nothing is preselected, nothing is blocked.
- [x] CHK004 ~~Is the source of "independent value evidence" named anywhere?~~ **Closed: the stated reason was wrong.** FR-002 and FR-009 do name admissible sources (existing format words, format-naming truthy flags, established shape flags). The real defect is narrower — see CHK047. [Superseded]
- [x] CHK005 Are version-bump obligations stated as requirements, or deliberately delegated to the plan? FR-020 requires "a recorded compatibility decision" but names no SemVer consequence; `spec.md` contains zero occurrences of "SemVer". [Ambiguity] [Spec §FR-020] **Closed 2026-08-29**: FR-028 records the version consequence — Core MINOR under Constitution VIII, CLI range and lockfile in the same change.
- [x] CHK006 Are requirements defined for **removing or renaming** a role after release, given stored mappings would then carry a label the accepted set no longer contains? [Gap] [Recovery scenario class] **Closed 2026-08-29**: FR-029 — withdrawal/rename is its own contract decision; a stored mapping with a withdrawn label keeps loading, suppressing and displaying (raw ID fallback).
- [x] CHK007 Is the CLI stated to be in or out of scope? Widening a Core enum forces a `@ortbtools/core` minor bump, which drags the CLI dependency range and the lockfile — a consequence this repo has hit before. `spec.md` contains zero occurrences of the substring "cli". [Gap] [Spec §FR-024] **Closed 2026-08-29**: FR-030 — the CLI ships no labelling surface; its only obligation is the FR-028 dependency-range follow-through.
- [x] CHK008 FR-024 requires every export surface to be **updated** with the label set. Is the export's behaviour toward an **older reader** encountering a new role specified, or only the update obligation? [Gap] [Spec §FR-024] **Closed 2026-08-29**: FR-030 — exports carry labels as opaque IDs; an older reader passes an unknown ID through verbatim rather than failing or translating.
- [x] CHK009 Is the timing of ADR-015 relative to code landing stated as a requirement anywhere in the feature package, or does FR-020 require only that the decision exist? [Ambiguity] [Spec §FR-020, Plan §Gate consequences] **Closed 2026-08-29**: FR-028 — the compatibility decision MUST exist in the repository before any code that widens the label set lands.
- [x] CHK010 ~~Is the claim-aware exemption specified for all nine new labels or only the fixtured one?~~ **Closed: false gap.** FR-008 states the rule role-agnostically — "MUST NOT constrain role-only claims resting on the key name" — with `identifier @ 0.70` appearing only as the concrete fixture. The requirement already generalises. [Verified 2026-08-29]

## Requirement Clarity — contract terms that must not be interpreted

- [x] CHK011 Is "presented identically wherever an operator meets it" defined measurably — same display string, same ordering, same descriptions, or only the same set? [Ambiguity] [Spec §FR-023] **Closed 2026-08-29**: FR-023 defines "identically" measurably — same closed set, same relative ordering, same localized name and description from one shared catalog.
- [x] CHK012 Does "carry its meaning in all three supported languages" require a localized description, or is a localized name sufficient? [Ambiguity] [Spec §FR-023] **Closed 2026-08-29**: FR-023 — both a localized name AND a localized one-line description are required; a name alone does not satisfy it.
- [x] CHK013 Is "retain exactly its current meaning" decomposed into the observable behaviours that constitute meaning — suppression, format recognition, display, export? [Clarity] [Spec §FR-021] **Closed 2026-08-29**: FR-021 decomposes "current meaning" into four observable behaviours: suppression, format-recognition participation, display, serialization.
- [x] CHK014 Is a strictness level stated for the preserved-legacy response — identical field set, or merely a compatible shape? [Clarity] [Contract §suggest-label-api] **Closed 2026-08-29**: §Public response compatibility — preserved answers are "field-identical to today's — no additions and no removals, not merely a compatible superset".
- [x] CHK015 Is the term "public contract" scoped — the HTTP response, the Core export, the stored value set, the model schema, or all four? [Clarity] [Spec §FR-020] **Closed 2026-08-29**: FR-028 scopes "public contract" to exactly four surfaces: HTTP response, Core enums, stored value set, model-output schema.
- [x] CHK016 When a named rule and a corpus adjudication disagree on state for the same exact key, is the winner stated? "One runtime identity per exact key" fixes identity but not precedence. [Ambiguity] [Spec §Frozen snapshot construction] _(CHK035 folded in here — same underlying gap.)_ **Closed 2026-08-29**: §Frozen snapshot construction — on disagreement the named rule wins (narrower, specification-frozen) and the disagreement is recorded on the entry.

## Requirement Consistency — cross-section alignment

- [x] CHK017 Do the roles FR-019 forbids storing exist in the canonical vocabulary? **Verified defect**: `unknown` is a `valueStatus` member (Spec:293), and backtick-quoted `` `other` `` occurs exactly once in the whole file — inside the prohibition itself (Spec:359). The canonical role table (Spec:384-395) holds ten roles and neither. [Conflict] [Spec §FR-019 vs §Closed role vocabulary] **Closed 2026-08-29**: FR-019 rewritten — the undefined `other` is gone; the prohibition now names the actual non-label identifiers by their own enums (neutral role, resolution states, valueStatus members).
- [x] CHK018 Is the canonical role count consistent wherever it is derivable — ten roles, nine storable, twenty storable labels? The number twenty appears in no spec section; it is derived by the reader. [Consistency] [Spec §Closed role vocabulary, §FR-019] **Closed 2026-08-29**: the vocabulary intro now states the counts normatively — ten canonical roles, nine storable, exactly twenty stored labels.
- [x] CHK019 ~~Do FR-016's dialect scope and the unchanged request agree?~~ **Closed by cross-reference.** The gap is real in `spec.md` alone — zero occurrences of "default" — but Phase 0 names it explicitly ("a real hole") and resolves it: server-side resolution from the authenticated operator's default dialect, with the limitation recorded. [Research §R-11]
- [x] CHK020 Does the suppression matrix agree with FR-022's prose on whether a new role suppresses non-question findings? [Consistency] [Spec §Suppression and format-recognition semantics] **Closed 2026-08-29 by inspection**: FR-022 ("suppresses only the exact matching question") and the matrix row for new roles (question: yes; non-question: no) agree; no edit needed.
- [x] CHK021 Do the precedence matrix and the response-compatibility section agree on which outcomes produce which response variant, with no outcome unmapped? [Consistency] [Spec §Resolver precedence vs §Public response compatibility] **Closed 2026-08-29**: §Public response compatibility now maps matrix outcomes to response variants one-to-one and exhaustively; no outcome is unmapped.
- [x] CHK022 Is FR-002's prohibition on value dictionaries consistent with its carve-out for format words, truthy flags and shape flags, with the boundary stated rather than implied? [Consistency] [Spec §FR-002] **Closed 2026-08-29 by inspection**: FR-002 states the carve-out explicitly ("This boundary MUST NOT remove the existing deterministic recognition…"); the boundary is stated, not implied.

## Compatibility & migration coverage

- [x] CHK023 Are requirements defined for a client that predates the `ambiguous` variant and receives one — graceful degradation, or is the variant gated? [Gap] [Exception scenario class] **Closed 2026-08-29**: FR-031 — the Inspector UI is the sole consumer and ships in the same immutable image, so no deployed client can predate the variants; recorded in the compatibility decision.
- [x] CHK024 ~~Is the `confidence` omission on `ambiguous` stated as intentional?~~ **Closed: false gap.** Spec:468-470 states it directly and names the variant "the intentional contract extension that the compatibility decision and boundary tests MUST record". [Verified 2026-08-29]
- [x] CHK025 Are the pre-existing eleven labels enumerated normatively, so the SC-010 compatibility floor has an unambiguous subject? [Completeness] [Spec §SC-010] **Closed 2026-08-29**: §Suppression semantics now enumerates the eleven pre-existing labels as the normative subject of FR-021/SC-010.
- [x] CHK026 Is the absence of a storage migration stated as a requirement, rather than left inferable from the column type? [Completeness] [Spec §Deferred Decisions] **Closed 2026-08-29**: FR-032 states it as a requirement — no storage migration; schema change of any kind is out of scope.
- [x] CHK027 When the model returns one of the nine new role labels for a signal the deterministic layer resolved differently, is the reconciliation stated? The precedence matrix routes to the model only after every deterministic source abstains, so the case may be unreachable — if so, is that stated? [Coverage] [Spec §Resolver precedence] **Closed 2026-08-29**: §Public response compatibility — the conflict is unreachable by construction (model runs only after every deterministic source abstains); routing evidence showing otherwise is a matrix defect.

## Acceptance criteria quality — measurability

- [x] CHK028 Can "no fixture answered deterministically before may newly reach the model" be evaluated without ambiguity about what counts as "answered deterministically"? [Measurability] [Spec §SC-002] **Closed 2026-08-29**: SC-002 defines "answered deterministically" as the final combined route being any of the four non-model routes.
- [x] CHK029 Are the five route counts defined with mutually exclusive, collectively exhaustive membership rules, so every answer lands in exactly one? [Measurability] [Spec §SC-002] **Closed 2026-08-29**: SC-002 — the five counts partition the matrix; membership is decided by the single final outcome, every fixture lands in exactly one.
- [x] CHK030 ~~Is D0's pre-change capture point a requirement?~~ **Closed: false gap.** SC-002 is a mandatory success criterion and states the ordering in its own words: "`D0` records final deterministic answers before the change and `D1` after the change" (Spec:655-656). [Verified 2026-08-29]
- [x] CHK031 Is "the same exact score across process restarts and locales" stated with an observable procedure? The determinism sentence lives in the confidence oracle, not in FR-007's two fixed values. [Measurability] [Spec §Confidence and authority oracle] **Closed 2026-08-29**: SC-002 states the procedure — the same matrix run in two separate processes and each of the three locales yields identical routes and exact scores.
- [x] CHK032 Is `D1 > D0` guarded against a degenerate pass — one additional resolution satisfying the inequality while coverage regresses elsewhere? [Measurability] [Spec §SC-002] **Closed 2026-08-29**: SC-002 — `D1 > D0` plus no-demotion make the pass non-degenerate: no fixture may leave the deterministic set, so the set grows strictly and one class cannot hide behind another.

## Scenario & edge-case coverage on the contract path

- [x] CHK033 ~~Is the no-default-dialect case defined?~~ **Closed by cross-reference.** Absent from `spec.md`, resolved in Phase 0: no default dialect means no saved-mapping precedence, and routing proceeds at the next matrix row. [Research §R-11]
- [x] CHK034 Are requirements defined for a stored mapping whose label was valid at save time but whose role has since been re-adjudicated to a different state? [Edge Case] [Gap] **Closed 2026-08-29**: FR-029 — re-adjudication in a later manifest version never rewrites, re-scopes or invalidates a saved mapping; FR-016 precedence is unconditional.
- [x] CHK035 **Folded into CHK016** — the saved-mapping dimension is already settled by FR-016, leaving the named-rule vs corpus precedence question, which CHK016 now carries. [Merged]
- [x] CHK036 Are requirements defined for the manifests being absent, truncated or unparseable at load time — does the feature degrade to today's behaviour or fail loudly? [Gap] [Exception scenario class] **Closed 2026-08-29**: §Frozen snapshot construction — a missing/truncated/unparseable manifest is a startup failure; the role layer refuses to load rather than answer from a partial table.

## Adjudication process requirements

- [x] CHK037 Is "two independent review passes" specified as to who qualifies as a reviewer, and whether an agent may serve as one or both? [Gap] [Spec §Frozen snapshot construction] **Closed 2026-08-29**: §Frozen snapshot construction — the two passes are by different reviewers with stable pseudonymous IDs; an automated agent may serve as at most one, never both.
- [x] CHK038 ~~Is a partially reviewed manifest rejected or may unreviewed names ship as `abstain`?~~ **Closed: false gap.** Spec:613 — the generator "rejects missing, extra, duplicate, unreviewed, score-mismatched, or silently flattened records". [Verified 2026-08-29]
- [x] CHK039 Are the triggers for **re-review** specified — a new corpus snapshot, a changed authority oracle, a disputed role — or is review a one-time event? [Gap] **Closed 2026-08-29**: §Frozen snapshot construction — re-review triggers are a new snapshot version, an authority-oracle change, or a recorded dispute; only affected records reopen.
- [x] CHK040 Is the escalation path for reviewer disagreement specified beyond "an explicit maintainer resolution with rationale", including who may act as maintainer? [Clarity] [Spec §Frozen snapshot construction] **Closed 2026-08-29**: §Frozen snapshot construction — "maintainer" is the repository owner; escalation is exactly one step, resolve with rationale or the record stays `ambiguous`.
- [x] CHK041 Are requirements defined for the review record's own retention and auditability, given reviewer IDs and decisions are retained in a committed artifact? [Gap] [Constitution III] **Closed 2026-08-29**: §Frozen snapshot construction — reviewer IDs are stable pseudonymous IDs carrying no personal data (Constitution III), retained in the committed manifest.
- [x] CHK042 Is the adjudication effort bounded or staged in the requirements — 322 names plus every partition, twice — or is completeness assumed achievable in one pass? [Assumption] [Spec §FR-025] **Closed 2026-08-29**: §Frozen snapshot construction — effort is bounded by design: `abstain` is a reviewed, deliberately cheap state; completeness means every name has a reviewed record, not a resolved role.

## Dependencies, assumptions & governance

- [x] CHK043 Is the assumption that the model privacy allowlist does not expand stated as a **requirement** implementation must satisfy, rather than only as an assumption? [Assumption] [Spec §Assumptions] **Closed 2026-08-29**: FR-033 promotes the assumption to a requirement — the prompt payload is frozen and a regression test asserts exact allowlist contents.
- [x] CHK044 Are the attribution obligations specified concretely enough to know what "travels with the table into the product" means — a file, a UI surface, or both? [Clarity] [Spec §FR-005] **Closed 2026-08-29**: FR-005 — the attribution file ships beside the manifests AND the provenance display names source and licence; met in repo and product both.
- [x] CHK045 Is the dependency on an out-of-tree corpus stated with its failure mode — what a contributor without the corpus can and cannot do? [Dependency] [Spec §FR-017] **Closed 2026-08-29**: FR-017 — a contributor without the corpus can run every gate and change every runtime surface; only regeneration is closed to them.
- [x] CHK046 Is the relationship to CL-001 stated as a requirement that nothing here creates a value-independent mapping, in a place implementation will read? [Traceability] [Spec §Deferred Decisions] **Closed 2026-08-29**: FR-034 — the no-value-independent-mapping boundary is now a requirement implementation reads, not only a deferred-decision note.

## Added by verification

- [x] CHK047 Does any row of the precedence matrix, or any other requirement, ever produce `valueStatus: resolved`? The evidence sources FR-002 preserves route to "preserve the current specific-format verdict", not to a role-layer answer — so the enum member may be defined in three places and reachable from none. [Conflict] [Spec §Resolver precedence vs §Public response compatibility] _(supersedes CHK004)_ **Closed 2026-08-29**: FR-010 — `valueStatus: resolved` is declared a RESERVED state no v1 path produces, with a test asserting the role layer never emits it; the enum member exists for forward compatibility instead of dangling.
- [x] CHK048 Is `Exception Flow` / `Edge Case` established anywhere as spec vocabulary, or does the spec use only `### Edge Cases`? Scenario-class names used in review must map to something the spec actually names. [Traceability] [Spec §Edge Cases] **Closed 2026-08-29 by inspection**: the spec uses only `### Edge Cases`; this checklist's marker convention (header note) defines `Exception Flow`/`Edge Case` as scenario classes, not citations. No spec edit needed.

## Notes

- Every item is closed; waivers were never needed. Items closed **by inspection** (CHK020, CHK022,
  CHK048) assert the spec already agreed with itself — re-verified during closure, not assumed.
- The four items the adversarial pass killed as false gaps (CHK010, CHK024, CHK030, CHK038) and the
  two closed by cross-reference (CHK019, CHK033) retain their original strikethrough records above.
- The closure notes name the exact FR or section each answer landed in, so `/speckit-analyze` can
  trace every item to its spec text without re-deriving it.
