# Feature Specification: Vendor Ext-Key Role Alphabet

**Feature Branch**: `main` (direct defect-repair workflow, per the 012/013/014/015 precedent)

**Created**: 2026-08-28

**Status**: Draft

**Input**: Operator observation on a live Kadam→Admobex push payload, plus evidence gathered in the
same session against the resident `gemma4-prod` host model at `temperature: 0`, and a feasibility
read of the out-of-tree research corpus at `~/.local/share/ortbtools-research/`.

The dialect labelling assistant answers two different questions with one number, and the number
measures the wrong one. Asked about `imp[0].ext.ad_type = 30` it returns `custom @ 0.30` with
"a vendor dictionary is needed". The label is right and the number is not: `custom` in the
assistant's own vocabulary means _"this IS a format declaration, but which format cannot be
established"_ — a claim that rests on the key name `ad_type`, not on the code `30`. The 0.3 ceiling
was written to cap **value decoding** and is applied to a label that makes no decoding claim. The
operator reads the number, sees 30%, and learns nothing from a field whose role is in fact plain.

## Evidence

### The assistant already draws the line the contract lacks

All twelve numeric-value cases available — ten from the calibration bench, two real signals from the
operator's payload — replayed through the production path at `temperature: 0`:

| Label returned                                                                                     | Cases | Confidence | Numeric ceiling (≤0.3) |
| -------------------------------------------------------------------------------------------------- | ----: | ---------- | ---------------------- |
| `custom` (`adtype=8`, `ad_type=70`, `format=12`, `creative_type=3`, `mode=2`, `t=1`, `ad_type=30`) |     7 | 0.2–0.3    | holds 7/7              |
| `informational` / `ignore` (`imp_count=3`, `ttl=300`, `flag=1`, `limit=1`, `subage=18`)            |     5 | 0.3–0.7    | breached 4/5           |

The ceiling binds perfectly on format claims and leaks on non-format claims. The assistant is
already separating "I am naming a format" from "I am naming a role"; the contract it is given has no
such separation, so the ceiling bites hardest exactly where it is wrong.

### The bench already records the missing rule, as an aside

The calibration bench's `counter` case (`imp[0].ext.imp_count = 3`) carries `band: [0.4, 0.9]` with
the justification `'counter; numeric but key is clear'`. That band's floor sits **above** the
contract's ceiling, so the case cannot be satisfied by a compliant answer and passes only because
the assistant disobeys. The distinction this feature introduces is therefore not new policy; it is
an annotation that was written down once, never promoted into the contract, and has been silently
carrying a bench case ever since.

### The corpus supports an alphabet of keys, and refuses one of values

Verified on disk, outside the repository:

- **322 unique key names are available** — 289 from the pinned Prebid Server bidder-parameter
  schemas (279 carrying human-written descriptions) and 128 extension keys from the derived adapter
  ruleset (1233 rules across 232 adapters, each rule carrying file-and-line evidence and a
  verification status), intersecting in 95.
- **Licence clears**: Apache-2.0 at a pinned commit, attribution file present, absent from the
  research quarantine list.
- **Numeric value dictionaries are effectively absent**: exactly 2 rules of 1233 carry one. One
  vendor publishes `1=banner, 2=interstitial-banner, 5=native, 7=rewarded-video,
8=interstitial-video` (unverified); another maps a string to a private integer with a silent
  fallback to banner (verified). The first enumeration stops at 8 and therefore cannot decode an
  observed `30` from a different vendor.

Key roles are shared across vendors and documented. Values are private and undocumented, because
numeric format codes live in exchange-to-bidder integrations that the public corpus does not cover
at all. This asymmetry is the feature's central constraint, not an incidental limitation.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The operator learns the role of a field whose code is unreadable (Priority: P1)

An operator pastes a payload carrying `imp[0].ext.ad_type = 30`. Today the assistant tells them a
vendor dictionary is needed and offers 30% confidence — a dead end that reads as "I cannot help".
The operator's own reading is that the field almost certainly declares an ad type, and only _which_
type is genuinely unknown. The assistant should say the same thing, with the confidence attached to
the claim it is actually making.

**Why this priority**: This is the reported defect and the most common shape of unknown vendor
signal in real exchange-to-bidder traffic. It is also the case where the current answer is not
merely imprecise but actively discouraging: the operator is told the tool cannot help with the exact
task the tool exists for.

**Independent Test**: Request a suggestion for a format-declaring key carrying a numeric value; the
answer names the field's role with confidence proportional to the strength of the key name, states
separately that the code itself is vendor-private, and does not name a specific ad format.

**Acceptance Scenarios**:

1. **Given** a signal whose key is a strong format-declaring name and whose value is numeric,
   **When** the operator requests a suggestion, **Then** the answer resolves without consulting the
   model, labels the signal as an undetermined format declaration with high confidence, and its
   stated reason distinguishes the known role from the unknown code.
2. **Given** the same signal, **When** the answer is displayed, **Then** no specific ad format is
   named and no numeric value is decoded.
3. **Given** a signal whose key is a weak or generic name (a bare `type` or `format`) carrying a
   numeric value, **When** the operator requests a suggestion, **Then** the confidence returned is
   materially lower than for a strong name, reflecting that the key alone does not settle the role.

---

### User Story 2 - Recognised keys resolve without a model call (Priority: P1)

Most unknown extension keys are not mysterious. An operator's payload carries `placementId`,
`zoneId`, `region`, `token`, `bidfloor` — names the wider ecosystem documents and uses
consistently. Today every one of them is either a model call or a question with no answer behind it.

**Why this priority**: This is what makes the assistant's remaining model calls worth making. Every
key the alphabet resolves is a signal removed from the model's scope, answered deterministically,
identically on every run, with a citable source. It also makes the assistant faster and cheaper on
the payloads operators actually paste.

**Independent Test**: Take a payload carrying several ecosystem-standard extension keys; every key
present in the alphabet resolves deterministically with its role and its source citation, and no
model call is made for it.

**Acceptance Scenarios**:

1. **Given** an extension key present in the alphabet, **When** a suggestion is requested,
   **Then** the answer is produced by the deterministic layer, is marked as coming from a table
   rather than a model, and cites the source and verification status behind the entry.
2. **Given** an extension key absent from the alphabet, **When** a suggestion is requested,
   **Then** the request proceeds to the model as it does today, and the model's answer is marked as
   a model answer.
3. **Given** an alphabet entry derived from an unverified corpus rule, **When** its answer is
   displayed, **Then** the answer states that its evidence was not independently confirmed.

---

### User Story 3 - The operator sees they are writing the vendor's dictionary (Priority: P2)

The assistant says a vendor dictionary is needed. The operator is, at that moment, writing exactly
that dictionary: a saved mapping is stored per dialect, per signal path, per value. The interface
never says so, and the low-confidence warning tells them a saved guess "will silently apply to all
further traffic" — which overstates the blast radius by a wide margin and discourages the very
action the feature exists to collect.

**Why this priority**: It changes the operator's risk calculus with no engineering risk of its own,
and it converts a dead end into an invitation. It is P2 rather than P1 because the assistant is
useful without it once Stories 1 and 2 land.

**Independent Test**: Open the labelling form for a numeric-coded signal; the form separates the
role (supplied, with its source) from the value (the operator's to fill), and the warning states the
actual scope of a saved mapping.

**Acceptance Scenarios**:

1. **Given** a signal whose role the alphabet supplies but whose value it cannot decode, **When**
   the labelling form opens, **Then** the role and the value are presented as two distinct things,
   only one of which the operator must decide.
2. **Given** an operator about to save a mapping, **When** the scope warning is shown, **Then** it
   states the mapping's real scope rather than implying it applies to all future traffic.

---

### User Story 4 - The assistant answers in the operator's language on every path (Priority: P3)

Feature 015 established that the assistant answers in the operator's locale. It closed that gap for
the deterministic path. On the model path the fix does not hold where it matters most: replayed at
`locale: ru`, the `ad_type = 30` answer came back in Ukrainian prose. The instruction naming the
answer language is one closing sentence appended to a body written entirely in Ukrainian, and on
low-evidence answers the model echoes the body's own wording instead of composing in the requested
language.

**Why this priority**: It is a live breach of a contract closed one day earlier, but it affects
presentation rather than correctness, and it is confined to the same artifact this feature already
edits. Repairing it here avoids editing and re-calibrating that artifact twice.

**Independent Test**: Request suggestions in each supported locale for a signal that reaches the
model and has little evidence behind it; each answer's prose is in the requested language.

**Acceptance Scenarios**:

1. **Given** a low-evidence signal that reaches the model, **When** the request names a non-Ukrainian
   locale, **Then** the returned prose is in that locale's language, with no Ukrainian fragments.
2. **Given** the locale contract's existing regression coverage, **When** this repair lands,
   **Then** coverage is extended to the low-evidence model answers where the breach was observed.

---

### Edge Cases

- **A key is in the alphabet but the ecosystem disagrees with the payload.** A name documented as a
  publisher-side identifier appears in a context where it plainly is not one. The alphabet states a
  role, not a certainty; where the impression's shape contradicts the entry, the answer must
  surface the disagreement rather than let the table overrule the payload in front of the operator.
- **The same key name carries different roles at different vendors.** The alphabet must express how
  broadly a name is attested, so a name used consistently across many sources is not presented with
  the same authority as one seen once.
- **A key is in the alphabet AND the operator has already mapped it.** The operator's own dialect
  wins; the alphabet never overrides a saved mapping.
- **An alphabet entry's source rule is unverified.** The majority of corpus rules were not read by a
  second reader. An answer built on one must say so rather than presenting all entries as equally
  established.
- **A value is numeric but the impression's shape is unambiguous.** The shape may point at a family
  while the code remains undecodable. The shape belongs in the explanation, never in a raised
  confidence and never as a decoded value.
- **The alphabet grows to cover a key the model currently handles well.** Movement is one-way by
  contract: growing the table removes signals from the model's scope and never adds them.
- **An operator saved a mapping before roles were storable.** It keeps working and keeps meaning
  what it meant. The operator is not asked to restate it, and nothing rewrites it for them.
- **A stored role is not a format, and something downstream treats it as one.** Roles that do not
  declare a format must be inert to format recognition. This is the failure mode most likely to pass
  review unnoticed, because a plausible role name reads as harmless where a wrong format label does
  not.
- **A name is admitted to the table on weak evidence and the operator's traffic disagrees.** The
  entry states weak evidence, resolves at low confidence, and never silences the question on its own
  authority.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST resolve the ROLE of a vendor extension key from a deterministic table
  consulted before any model call.
- **FR-002**: The table MUST carry key roles only. It MUST NOT carry, infer, or present the meaning
  of a value. Cross-vendor transfer of value meanings is prohibited.
- **FR-003**: Every table entry MUST carry its provenance — the source it was derived from, a
  citation precise enough to re-check, and whether that evidence was independently verified.
- **FR-004**: Answers derived from the table MUST be distinguishable by the operator from answers
  produced by the model, and MUST surface the entry's provenance and verification status.
- **FR-005**: The source material's attribution obligations MUST travel with the table into the
  product, not remain only in the out-of-tree research directory.
- **FR-006**: A key that declares an ad format and carries a numeric value MUST resolve
  deterministically to an undetermined-format declaration rather than being passed to the model.
- **FR-007**: The confidence returned with that resolution MUST reflect the strength of the key
  name: names that unambiguously declare a format rank materially higher than generic names that
  merely may.
- **FR-008**: The confidence value MUST measure the claim the answer actually makes. A ceiling
  justified by an undecodable value MUST constrain only claims that decode a value, and MUST NOT
  constrain claims resting on the key name.
- **FR-009**: The assistant MUST NOT name a specific ad format on the strength of a numeric value
  alone, in any locale, at any confidence.
- **FR-010**: Every answer MUST state, in the operator's language, which part of its claim is
  established and which part remains unknown.
- **FR-011**: The confidence contract MUST be re-measured against the calibration bench before and
  after the change, and any bench expectation revised MUST be revised deliberately and recorded,
  never silently relaxed to make a run pass.
- **FR-012**: The bench's hold-out set MUST be extended with cases authored after the change, so it
  continues to measure generalisation rather than the change that produced it.
- **FR-013**: The impression-shape assessment the engine already computes MUST be available to the
  model as context, and MUST influence only the explanation offered, never the confidence returned
  or the label chosen.
- **FR-014**: The assistant MUST continue to propose only. Nothing in this feature may write a
  dialect mapping on the operator's behalf.
- **FR-015**: The operator-facing warning about a saved mapping's consequences MUST state that
  mapping's actual scope.
- **FR-016**: A saved operator mapping MUST take precedence over any table entry for the same
  signal.
- **FR-017**: The table MUST be reproducible from its source corpus by a recorded procedure, and
  that procedure MUST NOT become a continuous-integration dependency on material that lives outside
  the repository.
- **FR-018**: Prose returned by the model MUST be in the locale the request names, including on
  answers with little evidence behind them.

#### Storable roles (from CL-002)

- **FR-019**: The set of labels an operator may save MUST be extended so that a role — what kind of
  field this is — can itself be stored, rather than collapsing into a nearest-fit existing label.
- **FR-020**: Extending that set is a public contract change and MUST be accompanied by a recorded
  compatibility decision that names what changes, what stays, and why the existing definition was
  insufficient.
- **FR-021**: Every mapping already stored MUST retain exactly its current meaning and MUST continue
  to behave exactly as it does today. No stored mapping may be rewritten, reinterpreted, or
  invalidated by this change.
- **FR-022**: Each added role MUST have explicitly stated behaviour for whether it silences a
  question and whether it participates in format recognition. A role that is not a format
  declaration MUST NOT influence format recognition, and this MUST be asserted by test rather than
  assumed from the role's name.
- **FR-023**: The extended set MUST be presented identically wherever an operator meets it — the
  suggestion, the manual picker, and the stored dialect view — and MUST carry its meaning in all
  three supported languages in the same change.
- **FR-024**: Any interface, export, or stored form that enumerates the label set MUST be updated
  together with it, so that no surface can present or accept a set that disagrees with another.

#### Coverage and evidence strength (from CL-003)

- **FR-025**: The table MUST admit every available key name, and MUST record for each entry the
  strength of the evidence behind it — attested in an extension position, known only from
  publisher-side configuration, or attested by both.
- **FR-026**: An entry's confidence and its presentation to the operator MUST follow its evidence
  strength. A name known only from publisher-side configuration MUST NOT be presented with the same
  authority as one observed in an extension position.
- **FR-027**: Where a name is known to carry different roles in different contexts, its entry MUST
  express that ambiguity rather than asserting one role, and MUST NOT resolve deterministically at
  high confidence.

### Key Entities

- **Alphabet entry**: One extension key name and the role it plays. Carries how broadly the name is
  attested across sources, the strength of that attestation, a citation, and whether the underlying
  evidence was independently verified. Carries no value meanings.
- **Key role**: What kind of thing a field is — a format declaration, a bookkeeping identifier, a
  piece of metadata, a pricing or targeting parameter — as distinct from what any particular value
  of it means. A role is a first-class thing an operator can save, not a hint that is discarded at
  save time.
- **Evidence strength**: How well an alphabet entry is attested. Distinguishes a name observed in an
  extension position, a name known only from publisher-side configuration, and a name attested by
  both. Governs the entry's confidence and how it is presented.
- **Signal answer**: What the operator is shown for one unknown signal: a label, a confidence, an
  explanation, the source that produced it, and, where applicable, the entry's provenance.
- **Confidence**: A statement about the returned label's reliability, and about nothing else. It is
  explicitly not a statement about whether a value was decoded.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For a format-declaring key carrying an unreadable numeric code, the operator is told
  the field's role and told separately that the code is vendor-private — where today they are told
  only that a dictionary is needed.
- **SC-002**: The share of unknown extension keys answered without any model call rises measurably
  against a recorded before-measurement on the same set of payloads.
- **SC-003**: Every answer sourced from the table can be traced by the operator to the material it
  came from, without leaving the product.
- **SC-004**: No answer, in any supported locale, decodes a numeric vendor value into a specific ad
  format.
- **SC-005**: Confidence values on non-format claims become reproducible: repeated runs of the same
  signal return the same confidence band, where today four of five such claims fall outside the band
  the contract states.
- **SC-006**: The calibration bench's numeric cases are internally consistent — no case remains that
  a fully compliant answer could not satisfy.
- **SC-007**: Answers returned to a non-Ukrainian locale contain no Ukrainian prose, on the
  low-evidence answers where the breach is currently observable.
- **SC-008**: Operators can complete a mapping for a numeric-coded signal without needing to know
  anything the product did not tell them, other than the vendor-specific meaning of the value
  itself.
- **SC-009**: An operator can save what a field actually is, rather than the nearest available
  approximation of it — and reading their dialect back shows that same thing.
- **SC-010**: Every mapping saved before this change behaves identically after it, demonstrated by
  regression coverage over the pre-existing label set rather than by inspection.
- **SC-011**: Every available key name is present in the table, and each one's displayed authority
  can be traced to the strength of the evidence behind it rather than to its mere presence.

## Assumptions

- The research corpus is not versioned with the product and is not present in continuous
  integration. The table therefore ships as a committed, generated artifact accompanied by a
  recorded regeneration procedure that runs outside the integration gates — the same arrangement the
  calibration bench already uses for its dependence on a live host model.
- Growing the deterministic table is already sanctioned by the accepted decision governing model
  assist, which states that growth moves signals out of the model's scope and never into it. This
  feature is an application of that clause, not an amendment to it.
- The prohibition on promoting vendor-specific values into shared semantics is already accepted
  policy. This feature restates it as an explicit boundary because an alphabet is exactly the shape
  of artifact that could quietly breach it.
- The locale repair is scoped to the model path only; the deterministic path was repaired by the
  preceding feature and is not reopened.
- No change to how, where, or by whom the model runs is contemplated. It stays local, it stays
  bounded to this one path, and unavailability stays a supported state.
- Admitting every available name (CL-003) is safe only because authority follows evidence (FR-025 to
  FR-027). Breadth without that stratification would be the failure this feature exists to prevent,
  arriving from a different direction: a table that answers confidently about names it barely knows.
- Extending the savable label set (CL-002) touches a public contract, so this feature carries a
  decision record of its own. It is an addition, not a redefinition: nothing already storable
  changes meaning, and the existing labels keep their current behaviour unchanged.

## Deferred Decisions

The following is identified, evidenced, and deliberately NOT resolved in this specification, because
resolving it changes a stored contract and requires its own recorded decision:

**Value-independent mappings.** A saved mapping is stored against a signal path _and_ a value, and
the stored value cannot be empty. Labelling a bookkeeping key such as a request identifier therefore
silences exactly one identifier, and the same question returns on the next payload carrying a
different one. For that class of key the question is inexhaustible by construction. Separately, the
rule that raises these questions never consults the deterministic table at all, so the engine asks
questions it can already answer. The alphabet is precisely what would make a value-independent
mapping safe for roles where the key settles the meaning and the value is irrelevant — but such a
mapping widens the accepted definition of what an operator maps, and changes a storage contract.
That requires an explicit compatibility decision rather than an inference drawn inside an
implementation.

## Clarifications

Resolved with the maintainer on 2026-08-28, before planning.

- **CL-001** [Scope] — _Should value-independent mappings join this feature or follow it?_
  **Resolved: they follow it.** This feature builds the table; the table is then the evidence that
  justifies a value-independent mapping for roles where the key settles the meaning. The stored
  mapping contract and the rule that raises questions are untouched here. Recorded under
  `Deferred Decisions` above.

- **CL-002** [Scope] — _Is a role advisory context, or is it what gets stored?_
  **Resolved: roles become storable.** The savable label set is extended to carry roles, rather than
  roles remaining a display-only hint that collapses into `ignore` or `informational` on save. A
  dialect should record that a field is an identifier or a price or a consent signal, because that
  is what the operator actually learned. This is a public contract change and carries the
  obligations in FR-019 through FR-024 — a recorded compatibility decision, unchanged meaning for
  every mapping already stored, and explicit suppression semantics for each added role.

- **CL-003** [Scope] — _How broad is the initial table?_
  **Resolved: maximum coverage, correctly stratified.** All 322 names are admitted, but a name's
  authority follows its evidence rather than its presence. Names attested in an extension position
  by adapter evidence outrank names known only from publisher-side configuration schemas, and names
  attested by both outrank either alone. Breadth is achieved by admitting weak entries as weak, not
  by presenting every entry as equally established. See FR-025 and FR-026.
