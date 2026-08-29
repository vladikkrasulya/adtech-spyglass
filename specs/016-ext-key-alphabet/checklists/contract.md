# Contract & Compatibility Checklist: Vendor Ext-Key Role Alphabet

**Purpose**: Formal requirements-quality gate before `/speckit-tasks`. Validates that the public
contract change — nine new storable role labels, the `ambiguous` response variant, and the widened
resolution path — is specified completely, unambiguously and consistently enough to implement
without inventing policy. Also covers the adjudication process's own requirements, because that
process is the largest irreversible manual commitment in the feature.

**Created**: 2026-08-29
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [contracts/](../contracts/)

**Gate rule**: no task is generated until every item is closed or explicitly waived with a recorded
reason. This is a contract change under Constitution Principle IV, so an unclosed item is a blocker,
not a note.

**These are unit tests for the requirements, not for the code.** Each item asks whether something is
_written_ well enough, not whether it works.

## Requirement Completeness — the extended contract

- [ ] CHK001 Are the nine new storable role IDs enumerated in exactly one normative place, so no surface can derive a different set? [Completeness, Spec §FR-019]
- [ ] CHK002 Is the response shape of a **saved-mapping hit** specified? The precedence matrix says only "Saved mapping; stop" without stating what the operator receives. [Gap, Spec §Resolver precedence]
- [ ] CHK003 Are requirements defined for what an operator may save **from** an `ambiguous` answer — may they pick a candidate, must they choose manually, or is saving blocked? [Gap, Spec §Public response compatibility]
- [ ] CHK004 Is the source of "independent value evidence" that would let `format-declaration` project to a specific format label named anywhere? Without one, `valueStatus: resolved` may be unreachable by construction. [Gap, Spec §Closed role vocabulary]
- [ ] CHK005 Are version-bump obligations stated as requirements for a change that widens a public Core enum? The spec mentions SemVer nowhere. [Gap, Constitution VIII]
- [ ] CHK006 Are requirements defined for **removing or renaming** a role after release, given stored mappings would then carry a label the accepted set no longer contains? [Gap, Exception Flow]
- [ ] CHK007 Is the CLI stated to be in or out of scope for the widened label set? `@ortbtools/core` is a CLI dependency and the spec never mentions the CLI. [Gap, Spec §FR-024]
- [ ] CHK008 Is the dialect **export** surface's behaviour with a new role label specified — what an older reader receives, and whether export is versioned? [Gap, Spec §FR-024]
- [ ] CHK009 Are requirements defined for when ADR-015 must exist relative to code landing, or only that it must exist? [Gap, Spec §FR-020]
- [ ] CHK010 Is the claim-aware ceiling exemption specified for **all nine** new role labels, or only for the one role the ceiling oracle fixtures? [Coverage, Spec §Claim-aware model-ceiling oracle]

## Requirement Clarity — contract terms that must not be interpreted

- [ ] CHK011 Is "presented identically wherever an operator meets it" defined measurably — same display string, same ordering, same descriptions, or only the same set? [Ambiguity, Spec §FR-023]
- [ ] CHK012 Does "carry its meaning in all three supported languages" require a localized description, or is a localized name sufficient? [Ambiguity, Spec §FR-023]
- [ ] CHK013 Is "retain exactly its current meaning" decomposed into the observable behaviours that constitute meaning — suppression, format recognition, display, export? [Clarity, Spec §FR-021]
- [ ] CHK014 Is "byte-compatible" or an equivalent strictness level stated for the preserved-legacy response, or only that the shape is unchanged? [Clarity, Contract §suggest-label-api]
- [ ] CHK015 Is the term "public contract" scoped — does it cover the HTTP response, the Core export, the stored value set, the model schema, or all four? [Clarity, Spec §FR-020]
- [ ] CHK016 Is "one runtime identity per exact key" stated precisely enough to settle which provenance class wins when a named rule and a corpus entry disagree on state? [Ambiguity, Spec §Frozen snapshot construction]

## Requirement Consistency — cross-section alignment

- [ ] CHK017 Do the roles FR-019 forbids storing exist in the canonical vocabulary? `unknown` is a `valueStatus` member, and `other` is defined nowhere in the specification. [Conflict, Spec §FR-019 vs §Closed role vocabulary]
- [ ] CHK018 Is the canonical role count consistent across every place it is stated — ten roles, nine storable, twenty storable labels? [Consistency, Spec §Closed role vocabulary, §FR-019]
- [ ] CHK019 Do FR-016's "for the same dialect" and the unchanged request agree on where the dialect comes from? FR-016 scopes precedence to a dialect the request does not carry. [Conflict, Spec §FR-016]
- [ ] CHK020 Does the suppression matrix agree with FR-022's prose on whether a new role suppresses non-question findings? [Consistency, Spec §Suppression and format-recognition semantics]
- [ ] CHK021 Do the precedence matrix and the response-compatibility section agree on which outcomes produce which response variant, with no outcome unmapped? [Consistency, Spec §Resolver precedence vs §Public response compatibility]
- [ ] CHK022 Is FR-002's prohibition on value dictionaries consistent with the carve-out preserving format words, truthy flags and shape flags, with the boundary stated rather than implied? [Consistency, Spec §FR-002]

## Compatibility & migration coverage

- [ ] CHK023 Are requirements defined for a client that predates the `ambiguous` variant and receives one — is graceful degradation required, or is the variant gated? [Gap, Exception Flow]
- [ ] CHK024 Is the omission of the `confidence` field on `ambiguous` answers stated as an intentional, permitted compatibility change for existing consumers? [Gap, Spec §Public response compatibility]
- [ ] CHK025 Are the pre-existing eleven labels enumerated normatively, so the SC-010 compatibility floor has an unambiguous subject? [Completeness, Spec §SC-010]
- [ ] CHK026 Are requirements stated that no storage migration is needed, rather than leaving it inferable from the column type? [Clarity, Spec §Deferred Decisions]
- [ ] CHK027 Are requirements defined for the model returning a new role label that the deterministic layer would have resolved differently? [Coverage, Gap]

## Acceptance criteria quality — measurability

- [ ] CHK028 Can "no fixture answered deterministically before may newly reach the model" be evaluated without ambiguity about what counts as "answered deterministically"? [Measurability, Spec §SC-002]
- [ ] CHK029 Are the five route counts defined with mutually exclusive, collectively exhaustive membership rules, so every answer lands in exactly one? [Measurability, Spec §SC-002]
- [ ] CHK030 Is `D0`'s capture point specified as a requirement — measured against pre-change code — rather than only as a plan-level note? [Gap, Spec §SC-002]
- [ ] CHK031 Is "the same exact score across process restarts and locales" stated with an observable procedure, or does it rely on the reader inferring one? [Measurability, Spec §FR-007]
- [ ] CHK032 Is `D1 > D0` guarded against a degenerate pass — for example a single additional resolution satisfying the inequality while coverage regresses elsewhere? [Measurability, Spec §SC-002]

## Scenario & edge-case coverage on the contract path

- [ ] CHK033 Are requirements defined for the operator having **no** default dialect, so saved-mapping precedence cannot be evaluated at all? [Coverage, Gap]
- [ ] CHK034 Are requirements defined for a stored mapping whose label was valid at save time but whose role has since been re-adjudicated to a different state? [Edge Case, Gap]
- [ ] CHK035 Are requirements defined for a signal that is simultaneously a named rule, a corpus entry, and covered by a saved mapping? [Coverage, Spec §Resolver precedence]
- [ ] CHK036 Are requirements defined for the manifests being absent, truncated or unparseable at load time — does the feature degrade to today's behaviour or fail loudly? [Gap, Exception Flow]

## Adjudication process requirements

- [ ] CHK037 Is "two independent review passes" specified as to who qualifies as a reviewer, and whether an agent may serve as one or both? [Gap, Spec §Frozen snapshot construction]
- [ ] CHK038 Are requirements defined for a **partially reviewed** manifest — is a partial artifact rejected outright, or may unreviewed names ship as `abstain`? [Gap, Exception Flow]
- [ ] CHK039 Are the triggers for **re-review** specified — a new corpus snapshot, a changed authority oracle, a disputed role — or is review a one-time event? [Gap]
- [ ] CHK040 Is the escalation path for reviewer disagreement specified beyond "an explicit maintainer resolution with rationale", including who may act as maintainer? [Clarity, Spec §Frozen snapshot construction]
- [ ] CHK041 Are requirements defined for the review record's own retention and auditability, given reviewer IDs and decisions are retained in a committed artifact? [Gap, Constitution III]
- [ ] CHK042 Is the adjudication effort bounded or staged in the requirements — 322 names plus every partition, twice — or is completeness assumed achievable in one pass? [Assumption, Spec §FR-025]

## Dependencies, assumptions & governance

- [ ] CHK043 Is the assumption that the model privacy allowlist does not expand stated as a **requirement** that implementation must satisfy, rather than only as an assumption? [Assumption, Spec §Assumptions]
- [ ] CHK044 Are the attribution obligations specified concretely enough to know what "travels with the table into the product" means — a file, a UI surface, or both? [Clarity, Spec §FR-005]
- [ ] CHK045 Is the dependency on an out-of-tree corpus stated with its failure mode — what a contributor without the corpus can and cannot do? [Dependency, Spec §FR-017]
- [ ] CHK046 Is the relationship to CL-001 stated as a requirement that nothing here creates a value-independent mapping, in a place implementation will read? [Traceability, Spec §Deferred Decisions]

## Notes

- Check items off as completed: `[x]`
- Record a waiver inline, with its reason, rather than deleting an item
- **CHK017, CHK019 and CHK002** are the three grounded in verified defects rather than suspicion:
  `other` is named as forbidden but never defined and `unknown` belongs to a different enum;
  FR-016 scopes precedence to a dialect the unchanged request does not carry; and the saved-mapping
  row of the precedence matrix has no response shape at all. Each needs a spec edit, not a task.
- **CHK005 through CHK009** cover surfaces the specification never mentions: SemVer, rollback of a
  role, the CLI, export, and ADR timing. Zero occurrences of "SemVer", "rollback", "CLI" and
  "deprecat*" in `spec.md` was measured, not assumed.
