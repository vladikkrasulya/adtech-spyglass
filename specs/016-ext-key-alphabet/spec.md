# Feature Specification: Vendor Ext-Key Role Alphabet

**Feature Branch**: `main` (direct defect-repair workflow, per the 012/013/014/015 precedent)

**Created**: 2026-08-28

**Status**: Complete

**Input**: Two redacted operator observations from a live Kadam→Admobex push payload, plus evidence
gathered in the same session against the resident `gemma4-prod` host model at `temperature: 0`, and
an audited feasibility read of the out-of-tree research corpus at
`~/.local/share/ortbtools-research/`. The live observations are session evidence, not
repository-reproducible fixtures; this specification requires redacted synthetic replicas before
their behaviour becomes a regression claim.

The dialect labelling assistant answers two different questions with one number, and the number
measures the wrong one. Asked about `imp[0].ext.ad_type = 30` it returns `custom @ 0.30` with
"a vendor dictionary is needed". The label is right and the number is not: `custom` in the
assistant's own vocabulary means _"this IS a format declaration, but which format cannot be
established"_ — a claim that rests on the key name `ad_type`, not on the code `30`. The 0.3 ceiling
was written to cap **value decoding** and is applied to a label that makes no decoding claim. The
operator reads the number, sees 30%, and learns nothing from a field whose role is in fact plain.

## Evidence

### The assistant already draws the line the contract lacks

All fourteen numeric-classified scenarios available in the session — twelve calibration-bench records
and two redacted live observations — replayed through the production path at `temperature: 0`. The
bench contains eleven JSON-number records, including two distinct `adtype=8` contexts, plus
`build="20260812"`, a digit-only string that production also classifies as numeric:

| Label returned                                                                                                          | Cases | Confidence | Numeric ceiling (≤0.3) |
| ----------------------------------------------------------------------------------------------------------------------- | ----: | ---------- | ---------------------- |
| `custom` (`adtype=8` in two contexts, `ad_type=70`, `format=12`, `creative_type=3`, `mode=2`, `t=1`, live `ad_type=30`) |     8 | 0.2–0.3    | holds 8/8              |
| `informational` / `ignore` (`imp_count=3`, `ttl=300`, `flag=1`, `limit=1`, `build="20260812"`, live `subage=18`)        |     6 | 0.3–0.7    | breached 5/6           |

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

- **The frozen evidence universe contains 322 exact-case names**: 289 names from 272 pinned
  bidder-parameter schemas (279 with at least one non-empty description) and 128 adapter-derived
  extension names, intersecting in 95. The adapter corpus contains 1233 rules in 270 bidder records;
  233 bidders have at least one rule. Of those rules, 1230 are eligible evidence; two citations are
  unresolvable and one rule was deleted by verification.
- **Identity is case-sensitive**: ASCII lowercasing would reduce the universe to 297 buckets. There
  are 22 collision buckets containing 47 exact spellings, so the current runtime's lowercased key
  lookup cannot be reused as the table's identity rule.
- **Licence clears**: Apache-2.0 at pinned Prebid Server commit
  `0ba352315253f6692af6497d553cfb12909a1b8b`, attribution is present, and the material is absent
  from the research quarantine list.
- **Ad-format value evidence is sparse and outbound-only**: only two of the 1233 rules expose an
  ad-format code conversion. One injects private codes
  `1=banner, 2=interstitial-banner, 5=native, 7=rewarded-video, 8=interstitial-video`; another maps
  ad-type strings to private integers with a banner fallback. Other numeric dictionaries exist for
  non-format fields, so these are not the only numeric mappings. Neither rule decodes arbitrary
  incoming codes or supplies a Kadam→Admobex meaning for `30`.

Key names recur across vendors and often carry source-written descriptions. The corpus nevertheless
supplies neither a shared semantic-role taxonomy nor an adjudicated key-to-role map; those roles must
be reviewed and versioned separately. It covers Prebid adapter behaviour, including two outbound
format-code conversions, rather than no exchange-to-bidder behaviour at all. The supportable
asymmetry is narrower and still decisive: key-role evidence is broad enough to review, while private
numeric value meanings are too sparse and non-transferable to decode across vendors.

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
answer names canonical role `format-declaration` with confidence proportional to the strength of the
key name, projects it to existing storable label `custom`, states separately that the code itself is
vendor-private, and does not name a specific ad format.

**Acceptance Scenarios**:

1. **Given** a signal whose key is a strong format-declaring name and whose value is numeric,
   **When** the operator requests a suggestion, **Then** the answer resolves without consulting the
   model, returns `role: format-declaration`, `label: custom`, and high role confidence, and its stated
   reason distinguishes the known role from the unknown code.
2. **Given** the same signal, **When** the answer is displayed, **Then** no specific ad format is
   named and no numeric value is decoded.
3. **Given** a signal whose key is a weak or generic name (a bare `type` or `format`) carrying a
   numeric value, **When** the operator requests a suggestion, **Then** any singular role is exactly
   `0.40` while the strong-name case is exactly `0.90`; if the evidence does not establish one role,
   the table returns ambiguity or abstains instead.
4. **Given** the deliberately absent key `imp[0].ext.publisher_account_ref` with numeric value `42`,
   and every deterministic source abstains, **When** the request reaches the model, **Then** an
   `identifier @ 0.70` replay is accepted unchanged rather than clamped to `0.30`; the confidence
   measures the role named by the key and does not claim to decode `42`.

---

### User Story 2 - Adjudicated keys resolve without a model call (Priority: P1)

Most unknown extension keys are not mysterious. An operator's payload carries `placementId`,
`zoneId`, `region`, `token`, `bidfloor` — names the wider ecosystem documents, sometimes consistently
and sometimes in conflicting roles that the operator should see. Today every one of them is either a
model call or a question with no evidence behind it.

**Why this priority**: This is what makes the assistant's remaining model calls worth making. Every
key the alphabet resolves is a signal removed from the model's scope, answered deterministically,
identically on every run, with a citable source. It also makes the assistant faster and cheaper on
the payloads operators actually paste.

**Independent Test**: Take a payload carrying several ecosystem-standard extension keys whose
reviewed entries establish one role; each resolves deterministically with its role and citations,
and no model call is made. Then exercise a documented conflict and an evidence-only row: the former
returns deterministic ambiguity without a model guess, while the latter explicitly abstains and
retains whichever legacy deterministic or model fallback the precedence matrix requires.

**Acceptance Scenarios**:

1. **Given** an exact key entry whose reviewed evidence establishes one role, **When** a suggestion
   is requested, and no higher-priority saved mapping or exact-format evidence applies, **Then** the
   table returns `resolved`, one role, its mechanically required exact role-confidence score, all
   applicable provenance and no model call.
2. **Given** an exact key entry with two credible roles or payload context that contradicts its
   otherwise applicable role, **When** a suggestion is requested, **Then** the table returns
   `ambiguous`, shows the supported candidates and evidence, preselects no savable label and makes
   no model call.
3. **Given** a role-layer `abstain` for which the broad legacy resolver has an `ignore` or
   `informational` answer, **When** a suggestion is requested, **Then** that deterministic answer is
   preserved and the model is not called.
4. **Given** a name-only row whose evidence does not establish a role, or an exact key absent from
   the alphabet, and every existing deterministic rule also abstains, **When** a suggestion is
   requested, **Then** the request proceeds to the model as it does today, marked as a model answer.
5. **Given** an alphabet entry with unverified evidence, **When** any table result is displayed,
   **Then** that evidence retains its literal unverified status and is not presented as independently
   confirmed.

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
   states that the mapping applies only to the selected dialect, the normalized signal path and the
   exact serialized value; it does not imply application to other values, paths, dialects or all
   future traffic.

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
  role, not a certainty; where allowlisted payload context contradicts the entry, the answer returns
  deterministic ambiguity, no singular confidence and no preselected label rather than letting the
  table overrule the payload in front of the operator.
- **The same key name carries different roles at different vendors.** The alphabet must express how
  broadly a name is attested. An exact vendor/path context may select a reviewed partition; otherwise
  all credible candidates remain visible and first-, last- and majority-wins resolution are forbidden.
- **Two keys differ only by case.** Exact spelling is identity. `placementId` and `placementid` do
  not share evidence or roles, and an unlisted casing does not inherit either entry through a
  lowercase fallback.
- **A key is in the alphabet AND the operator has already mapped it.** The operator's own dialect
  wins; the alphabet never overrides a saved mapping.
- **An alphabet entry's source rule is unverified.** The majority of corpus rules were not read by a
  second reader. An answer built on one must say so rather than presenting all entries as equally
  established.
- **A `format-declaration` value is numeric but the impression's shape points at one family.** The
  code remains undecodable. Under FR-013 the shape belongs in the explanation, never in raised role
  confidence and never as a decoded value.
- **The alphabet grows to cover a key the model currently handles well.** Movement is one-way by
  contract for reviewed `resolved` and `ambiguous` entries: those signals leave the model's scope.
  A row whose evidence establishes only that the name exists remains an explicit `abstain`, so table
  membership alone does not manufacture a role.
- **An operator saved a mapping before roles were storable.** It keeps working and keeps meaning
  what it meant. The operator is not asked to restate it, and nothing rewrites it for them.
- **A stored role is not a format, and something downstream treats it as one.** Roles that do not
  declare a format must be inert to format recognition. This is the failure mode most likely to pass
  review unnoticed, because a plausible role name reads as harmless where a wrong format label does
  not.
- **A name is admitted to the table on weak evidence and the operator's traffic disagrees.** The
  entry states weak evidence and returns low-confidence resolution, deterministic ambiguity or
  abstention as its reviewed evidence warrants. A suggestion never silences a finding; suppression
  starts only after the operator explicitly saves a mapping.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST combine the existing deterministic resolver and the key-role layer by
  the precedence matrix below before any model call. Exact saved mappings still win; accepted exact
  format flags stay terminal; alphabet roles may supersede only broad legacy `ignore`/
  `informational` heuristics; and alphabet abstention MUST NOT turn a previously deterministic answer
  into a model call.
- **FR-002**: The key-role alphabet MUST carry roles only. It MUST NOT carry a vendor-specific value
  dictionary, infer the private meaning of an opaque numeric code, or transfer such a meaning across
  vendors. This boundary MUST NOT remove the existing deterministic recognition of explicit format
  words, format-naming truthy flags, or established shape flags; those are separate, already accepted
  resolver evidence rather than entries in a private value dictionary.
- **FR-003**: Every role-layer entry or named rule MUST retain every contributing provenance record —
  source path, precise citation, source commit/digest where applicable, coverage class, and literal
  verification status. Generation MUST NOT discard conflicts or let one source overwrite another.
- **FR-004**: `resolved`, `ambiguous`, `abstain` routing and model answers MUST be distinguishable to
  the operator. Every role-layer answer MUST surface all evidence supporting its displayed role
  candidate(s), including unverified status, without making the operator leave the product.
- **FR-005**: The source material's attribution obligations MUST travel with the table into the
  product, not remain only in the out-of-tree research directory. Concretely: the attribution file
  ships beside the committed manifests in the repository, and the operator-facing provenance display
  names the source and its licence — the obligation is met in both the repository and the running
  product, not in either alone.
- **FR-006**: An opaque numeric code carried by a role-declaring key that does not itself name a
  specific format — for example `ad_type = 30` — MUST resolve deterministically to a
  `format-declaration` role projected to `custom`, rather than being passed to the model. A numeric or
  boolean value used only to enable a format-naming key or an established shape flag — for example
  `popunder = 1` or `allowShock = 1` — is not an opaque code and MUST retain its existing deterministic
  behaviour.
- **FR-007**: The confidence returned with that resolution MUST follow the closed bands and authority
  rules below. An opaque numeric code under `adtype`, `ad_type`, `adformat` or `ad_format` MUST be
  exactly `0.90`; a bare `type` or `format` MUST be capped at exactly `0.40` if singular. The
  difference is therefore a testable `0.50` and spans non-overlapping confidence bands rather than an
  undefined "material" gap.
- **FR-008**: The confidence value MUST measure the claim the answer actually makes, on both the
  deterministic and model paths. A ceiling justified by an undecodable value MUST constrain only
  claims that decode that value and MUST NOT constrain role-only claims resting on the key name. In
  particular, the model prompt/contract MUST state that exemption, and the model-output validator
  and any post-processing MUST accept `identifier @ 0.70` unchanged for the numeric claim-aware
  fixture below; a blanket `numeric => confidence <= 0.30` rule is non-conforming.
- **FR-009**: The shared alphabet and model MUST NOT name a specific ad format on the strength of an
  opaque numeric value alone, in any locale, at any confidence. An exact saved operator mapping or an
  existing evidence-backed vendor-dialect mapping MAY retain its scoped behaviour; neither may be
  promoted into cross-vendor shared semantics.
- **FR-010**: Every singular key-role-layer answer MUST carry `resolutionStatus: resolved`, a
  canonical `role`, `roleConfidence`, `valueStatus`, and the proposed storable `label` separately.
  `valueStatus` is `resolved`, `unknown` or `not-applicable`; only `resolved` may carry a specific
  `valueLabel`. In v1 `valueStatus: resolved` is a RESERVED state that no resolution path produces:
  the evidence classes able to resolve a value (explicit format words, format-naming truthy flags,
  established shape flags) are terminal in the precedence matrix and never reach the role layer, so
  the role layer never has a resolved value to report. A test MUST assert the role layer never emits
  it; the state exists so that future value evidence extends the contract instead of changing it.
  The answer MUST state in the operator's language which claim is established and which
  remains unknown. Existing exact-format and model response fields remain unchanged when the role
  layer does not produce the answer.
- **FR-011**: The confidence contract MUST be re-measured against all twelve existing numeric-classified
  bench records before and after the change. Any expectation revised MUST be revised deliberately and
  recorded, never silently relaxed to make a run pass.
- **FR-012**: Redacted synthetic replicas of the two live observations and hold-out cases authored
  after the change MUST extend the bench, so the reported 14-scenario behaviour becomes reproducible
  without retaining a live payload and the hold-out still measures generalisation.
- **FR-013**: Once an opaque numeric signal is resolved to canonical role `format-declaration`, an
  impression shape that merely suggests a specific family MAY be surfaced as context but is not a
  contradiction: it MUST NOT change the role/state, raise role confidence, or decode the value.
  Outside that exact case, allowlisted context retains its accepted power to corroborate or contradict
  a claim; a contradiction with a non-format role follows FR-027 and returns `ambiguous`. For a
  non-numeric field whose `format-declaration` role remains established but whose explicit value and
  shape conflict, the role may remain resolved while `valueStatus` becomes `unknown` and the conflict
  is surfaced.
- **FR-014**: The assistant MUST continue to propose only. Nothing in this feature may write a
  dialect mapping on the operator's behalf.
- **FR-015**: The operator-facing warning MUST state that a saved mapping applies only within the
  selected dialect to the normalized signal path and exact serialized value. It MUST NOT imply that
  other values, paths, dialects or all future traffic are affected.
- **FR-016**: An exact saved operator mapping MUST take precedence over every table state and model
  answer for the same dialect, normalized signal path and serialized value.
- **FR-017**: The committed corpus snapshot, 322-name adjudication manifest, and distinct repo-backed
  named-rule manifest MUST be reproducible and complete under the frozen contracts below. Continuous
  integration MUST verify their exact sets, provenance, digests and invariants without depending on
  the out-of-tree corpus; external corpus regeneration is a separate maintainer operation. A
  contributor without the research corpus can run every repository gate and change every runtime
  surface; the only operation closed to them is manifest regeneration, and nothing in the gates may
  assume the corpus is present.
- **FR-018**: Prose returned by the model MUST be in the locale the request names, including on
  answers with little evidence behind them.

#### Resolver precedence

The current deterministic resolver is evaluated as evidence, not treated as one indivisible stage.
Its result is classified as a terminal exact-format flag/shape verdict, a specific-format string
verdict, a guarded specific-format candidate rejected by contradictory shape, a broad legacy
`ignore`/`informational` heuristic, or abstention. The role layer comprises the 322-name corpus
alphabet plus the separately sourced named rules in this specification.

| Existing deterministic result                                                                                 | Applicable role-layer result                       | Required combined outcome                                                                      |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Exact saved mapping                                                                                           | Any                                                | Return the stored mapping as the saved-mapping response variant below; stop                    |
| Accepted format-naming truthy flag or established shape flag (`popunder`, `push`, `allowShock`, `sizeID=[0]`) | Any                                                | Preserve the current exact-format verdict; stop                                                |
| Specific-format string verdict                                                                                | `resolved: format-declaration` or `abstain`/absent | Preserve the current specific-format verdict and its existing shape calibration; stop          |
| Specific-format string verdict                                                                                | Resolved non-format role or `ambiguous`            | Return deterministic `ambiguous` with the conflicting evidence; do not guess or call the model |
| Guarded string/shape contradiction                                                                            | `resolved: format-declaration`                     | Return the role projected to `custom`, `valueStatus: unknown`, and surface the conflict; stop  |
| Guarded string/shape contradiction                                                                            | Resolved non-format role or `ambiguous`            | Return deterministic `ambiguous` with both evidence sets; stop                                 |
| Guarded string/shape contradiction                                                                            | `abstain`/absent                                   | Preserve the current model fallback                                                            |
| Broad legacy `ignore`/`informational` heuristic                                                               | `resolved`                                         | Return the more specific alphabet role; stop                                                   |
| Broad legacy `ignore`/`informational` heuristic                                                               | `ambiguous`                                        | Return alphabet ambiguity; stop                                                                |
| Broad legacy `ignore`/`informational` heuristic                                                               | `abstain`/absent                                   | Preserve the legacy deterministic answer; stop                                                 |
| Existing resolver abstains                                                                                    | `resolved` or `ambiguous`                          | Return the role-layer result; stop                                                             |
| Existing resolver abstains                                                                                    | `abstain`/absent                                   | Call the model                                                                                 |

Thus `request_uuid`, `token`, `version` and `currency` can become `identifier`, `credential`,
`metadata` and `pricing` instead of being pre-empted by broad old heuristics. Conversely, a weak
alphabet row cannot send a signal that the current resolver safely answers into the model path. The
existing structural guard that prevents an identifier value such as `"video-42"` from becoming a
format verdict remains part of the specific-format evaluation.

#### Storable roles (from CL-002)

- **FR-019**: The set of labels an operator may save MUST be extended with exactly the nine new
  non-format role IDs defined below. The closed role-vocabulary table in this specification is the
  single normative enumeration of the canonical roles and their stored projections; every surface
  that lists labels derives from it and none defines its own. Canonical role `format-declaration` is
  projected to the existing `custom` label when the value is unknown, or to an existing specific
  format label only when separate evidence resolves the value (see FR-010 for why no v1 path does).
  Identifiers this specification uses that are not labels — the neutral role `format-declaration`,
  the resolution states `resolved`/`ambiguous`/`abstain`, and the `valueStatus` members `unknown`
  and `not-applicable` — MUST NOT be accepted as semantic labels.
- **FR-020**: Extending that set and introducing a discriminated ambiguous-answer variant are public
  contract changes. A recorded compatibility decision MUST name both changes, the compatibility
  treatment below, what stays, and why the existing definition was insufficient.
- **FR-021**: Every mapping already stored MUST retain exactly its current meaning and MUST continue
  to behave exactly as it does today. "Current meaning" decomposes into four observable behaviours,
  each of which MUST be unchanged for every pre-existing label: what the mapping suppresses, whether
  it participates in format recognition, how it is displayed, and how it serializes in any export or
  API response. No stored mapping may be rewritten, reinterpreted, or invalidated by this change.
- **FR-022**: Suppression and format-recognition behaviour MUST follow the matrix below. Every new
  role is inert to format recognition and, after an explicit save, suppresses only the exact matching
  `question`; this MUST be asserted per role rather than inferred from its name.
- **FR-023**: The extended set MUST be presented identically wherever an operator meets it — the
  suggestion, the manual picker, and the stored dialect view. "Identically" is measurable: the same
  closed set, the same relative ordering, and the same localized display name and one-line localized
  description, all drawn from one shared catalog. Every label MUST carry both the name and the
  description in all three supported languages in the same change; a localized name alone does not
  satisfy this requirement.
- **FR-024**: Any interface, model-output validator, prompt, export, or stored form that enumerates
  the label set MUST be updated together with it, so that no surface can present or accept a set that
  disagrees with another.

#### Closed role vocabulary and stored projection

The canonical key-role enum is the following closed set: exactly ten canonical roles, of which nine
are storable. The stored label vocabulary is exactly twenty labels — the eleven pre-existing
semantic labels plus the nine new non-format IDs below. `format-declaration` is a neutral
role, not a stored label: it projects to existing `custom` when the private value is unknown and to an
existing specific format label only when independent value evidence establishes that format.

| Canonical role ID    | Proposed stored label                   | Meaning                                                                                                                                                        | Representative keys                           |
| -------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `format-declaration` | `custom` while value meaning is unknown | The field declares or selects an ad format; the role itself says nothing about which format the current value means.                                           | `ad_type=30`, `format=12`                     |
| `identifier`         | `identifier`                            | An opaque reference to an account, publisher, site, placement, zone, request, user, creative or other entity.                                                  | `placementId`, `zoneId`, `request_uuid`       |
| `credential`         | `credential`                            | An authentication or integration credential, token, key or signature.                                                                                          | `apiKey`, `access_token`, `signkey`           |
| `metadata`           | `metadata`                              | Descriptive integration, inventory, environment, locale, version, vendor or partner context that does not itself control price, targeting, delivery or format. | `partnerName`, `version`, `integrationType`   |
| `media-property`     | `media-property`                        | A creative/media capability, constraint, asset property or presentation parameter; it does not by itself establish the selected ad format.                     | `sizes`, `mimes`, `protocols`, `maxduration`  |
| `pricing`            | `pricing`                               | A monetary value or commercial rule such as a floor, reserve, currency, multiplier or price type.                                                              | `bidfloor`, `floorPrice`, `currency`          |
| `targeting`          | `targeting`                             | A criterion that includes, excludes or selects traffic by audience, content, category, keyword, geography or a similar property.                               | `audiences`, `keywords`, `category`           |
| `privacy-consent`    | `privacy-consent`                       | A privacy, consent, cookie or regulated-processing signal.                                                                                                     | `consent`, `noCookies`                        |
| `delivery-control`   | `delivery-control`                      | A switch, limit, timeout, mode, route, endpoint, test/debug option or other parameter that changes integration or delivery behaviour.                          | `ttl`, `rateLimit`, `endpoint`, `debug`       |
| `measurement`        | `measurement`                           | An observed counter, metric, tracking, attribution or reporting value; it reports behaviour rather than controlling it.                                        | `imp_count`, `viewabilityPercentage`, `track` |

`custom` therefore keeps its existing stored meaning without being mistaken for the role itself.
A new canonical role or stored label requires the same compatibility decision as any other public
enum extension. A key name alone MUST NOT force one role where ordinary usage supports several:
`token` may be an identifier or credential, while `region` may be metadata, targeting or delivery
control. Such a name resolves only when cited evidence and applicable context settle the distinction.

#### Suppression and format-recognition semantics

An alphabet answer is a suggestion and suppresses nothing. Suppression begins only after an explicit
operator save, and no role introduced here creates the value-independent mapping deferred by CL-001.
The pre-existing labels are exactly: `pop`, `native`, `banner`, `video`, `audio`, `in-page-push`,
`push`, `interstitial-banner`, `ignore`, `informational`, `custom` — this list is the normative
subject of the compatibility floor in FR-021 and SC-010.

| Stored-label group                      | Suppresses exact matching `question` after save | Suppresses non-question findings | Participates in format recognition |
| --------------------------------------- | ----------------------------------------------- | -------------------------------- | ---------------------------------- |
| Pre-existing specific format labels     | Yes                                             | Exactly as today                 | Exactly as today                   |
| Pre-existing `ignore` / `informational` | Yes                                             | Exactly as today                 | No                                 |
| Pre-existing `custom`                   | Yes                                             | No                               | No                                 |
| Each of the nine new role labels        | Yes                                             | No                               | No                                 |

Format recognition MUST use an explicit allowlist of the pre-existing format labels. It MUST NOT
treat every accepted stored label as a format. Existing stored rows are not rewritten; every
pre-existing label retains its current public meaning and runtime behaviour.

#### Coverage and evidence strength (from CL-003)

- **FR-025**: The corpus evidence snapshot MUST admit all 322 exact-case names and MUST record each
  entry's coverage (`schema-only`, `extension-only`, or `both`) separately from adapter verification
  strength. A complete, separately versioned adjudication manifest MUST cover the same exact set and
  every reviewed namespace/vendor/path partition. Repo-backed named rules outside that 322-name set
  MUST use a separate provenance class and the frozen regression oracle below, never inflate the
  corpus count.
- **FR-026**: Confidence and presentation MUST follow the authority oracle below. Publisher-schema
  evidence alone MUST NOT receive the same authority as consistent extension-position evidence;
  unverified evidence remains visible but cannot raise an authority tier.
- **FR-027**: Where source records, independent adjudicators, or allowlisted payload context establish
  credible conflicting roles, the entry MUST return deterministic `ambiguous`: all candidate roles
  and evidence, no overall role confidence, no preselected label, no majority vote and no model guess.
  A reviewed exact namespace/vendor/path partition MAY resolve only within that partition. The
  format-family context scoped out by FR-013 is not a contradiction to `format-declaration`.

#### Contract scope, versioning and change management

- **FR-028**: The public contract this feature changes comprises exactly four surfaces: the
  suggest-label HTTP response, Core's exported label and role enums, the stored `semantic_label`
  value set, and the model-output schema. The recorded compatibility decision MUST name all four,
  MUST record the version consequence — a MINOR bump of the Core line under Constitution VIII, with
  the CLI dependency range and the lockfile following in the same change — and MUST exist in the
  repository before any code that widens the label set lands.
- **FR-029**: Withdrawing or renaming a storable label after release is a public contract change
  requiring its own recorded decision. Whatever that decision says, a stored mapping carrying a
  withdrawn label MUST continue to load, suppress and display (as its raw ID when no catalog entry
  remains) exactly as before. Likewise, re-adjudication of a role in a later manifest version never
  rewrites, re-scopes or invalidates a saved mapping: FR-016 precedence is unconditional and
  survives any table change.
- **FR-030**: The CLI ships no labelling surface and gains none here; its only obligation is the
  dependency-range follow-through in FR-028. Any export or stored form carries labels as opaque IDs,
  and a reader encountering an ID it has no catalog entry for MUST pass it through verbatim rather
  than fail or translate it.
- **FR-031**: The Inspector UI is the only consumer of the suggest-label response and ships in the
  same immutable image as the server, so no deployed client can predate the new variants; this
  deployment property MUST be recorded in the compatibility decision, and any future external
  consumer of the route inherits the variants as documented API rather than as a surprise.
- **FR-032**: This feature requires no storage migration. The nine new labels are new accepted
  values of the existing `semantic_label` column; a schema change of any kind is out of scope.
- **FR-033**: The model prompt payload is frozen. Implementation MUST NOT add any field to what
  travels to the model beyond the ADR-012 §6 allowlist, and a regression test MUST assert the
  assembled prompt contains exactly the allowlisted items. The impression-shape verdict is surfaced
  locally only. (This promotes the corresponding assumption to a requirement.)
- **FR-034**: Nothing in this feature may create or emulate a value-independent mapping: the save
  route continues to require a non-empty exact serialized value, and no role's suppression extends
  beyond the exact dialect + normalized path + serialized value triple. CL-001 remains deferred, and
  this boundary is a requirement implementation reads, not only a deferred-decision note.

#### Resolution states

Table membership and successful role resolution are different facts. For the observed context, an
entry has exactly one of these states:

- **`resolved`**: exactly one role is supported by semantically explicit evidence, with no applicable
  conflict. The table returns that role, its mechanically required exact confidence score and all
  provenance; the model is not called.
- **`ambiguous`**: two or more credible roles are supported, or the payload contradicts the otherwise
  applicable role. The table returns candidates and evidence, but no singular role, overall role
  confidence or preselected label; the model is not asked to erase documented disagreement.
- **`abstain`**: the row proves that the exact name exists but not what role it has in this context.
  A schema name without semantic evidence, a generic name supported only by lexical inference, or
  evidence that does not transfer into the observed namespace belongs here. No table role is
  returned; routing resumes at the precedence matrix, which preserves a broad legacy deterministic
  answer if present and calls the model only if every deterministic source abstains.

Weak evidence is not a fourth role. Every source's literal verification status remains visible in
all three states. When `abstain` ultimately reaches the model, the existing `source: model` response
contract remains intact and the preceding table abstention is additive routing evidence.

#### Public response compatibility

The role layer adds discriminated response variants without redefining existing exact-format or
model suggestions. Preserved deterministic answers are field-identical to today's — the same
required fields, no additions and no removals, not merely a compatible superset. A role-layer singular answer uses `resolutionStatus: resolved`, canonical
`role`, `roleConfidence`, `valueStatus`, and a projected storable `label`. The pre-existing
`confidence` field remains for compatibility and equals `roleConfidence` on these answers because
their projected label makes no specific value claim: `custom` explicitly includes "value unknown",
while each new non-format label has `valueStatus: not-applicable`. `label` is therefore a projection,
not an alias of the canonical role; specifically, `role: format-declaration` projects to
`label: custom` while the numeric code stays unknown.

An `ambiguous` answer carries `resolutionStatus: ambiguous`, canonical `roleCandidates`, no singular
role/confidence, and no preselected label. From an `ambiguous` answer the operator may save any
storable label through the ordinary manual picker, including one of the displayed candidates; the
answer itself preselects nothing and blocks nothing. This new variant is the intentional contract
extension that the compatibility decision and boundary tests MUST record.

A **saved-mapping hit** — new behaviour on this route, which today consults no mapping — returns the
stored mapping itself: `label` is the stored `semantic_label`, `source` is `saved-mapping`, the
stored notes travel if present, and no numeric confidence is attached, because the operator
confirmed this mapping and a score would misrepresent certainty as measurement. No model call is
made. This variant is part of the same recorded compatibility decision.

The precedence matrix's outcomes map onto response variants one-to-one and exhaustively: a
saved-mapping hit returns the saved-mapping variant; every "preserve" row returns the pre-existing
deterministic shape unchanged; role-layer `resolved` and `ambiguous` return their variants; only the
final row's model call returns a model answer. No outcome is unmapped. `abstain` is routing metadata, not a
fabricated answer; existing model success/unavailable/timeout/error required fields and semantics
remain unchanged, while additive routing evidence records a preceding table abstention.

The model's accepted-label enum gains the same nine new storable role labels so fallback suggestions
can stop collapsing them into `ignore`/`informational`. A conflict between a model answer and a
deterministic resolution is unreachable by construction — the model runs only after every
deterministic source abstains, so there is never a deterministic answer to disagree with; routing
evidence showing otherwise is a precedence-matrix defect, not a reconciliation question. Its existing singular
`label`/`confidence`/`source` response shape and calibrated, non-deterministic confidence semantics
otherwise remain unchanged; the numeric ceiling becomes claim-aware under FR-008 and may not clamp a
role-only label merely because its observed value is numeric.

#### Confidence and authority oracle

Role confidence uses only these non-overlapping bands: `high` is `0.90–0.95`, `medium` is
`0.60–0.80`, `low` is `0.31–0.50`, and `unestablished` is `0–0.30`. The deterministic role layer
returns only exact scores `0.90`, `0.80`, `0.70`, `0.60`, or `0.40`; the remaining values are
available only to the existing model calibration contract. Equal role-layer inputs MUST return the
same exact score across process restarts and locales.

For a corpus-derived role, take the highest row whose conditions are met, then apply every stated
cap. The result is required, not a maximum the adjudicator may lower arbitrarily.

| Strongest consistent trusted role support                                                                                                                                | Required exact score/state |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Source-written semantics in both schema and extension positions, at least two independent vendor attestations, and at least one verified or confirmed extension citation | `0.90`                     |
| Extension-position semantics from at least two independent vendors                                                                                                       | `0.80`                     |
| Publisher-configuration semantics from at least two independent source-written descriptions                                                                              | `0.60`                     |
| One admissible semantic attestation, or unverified-only support that still establishes one role                                                                          | `0.40`                     |
| No evidence establishing a singular role                                                                                                                                 | `abstain`; no role score   |

Repeated observations from one vendor do not increase breadth. Unverified evidence may support a
candidate but cannot raise the score above `0.40`. A generic key cap is `0.40`; conflict prohibits a
singular score and yields `ambiguous`. Otherwise the highest consistent trusted support wins and the
lowest applicable cap is applied. The opaque numeric value does not itself raise or lower role
confidence. Lexical/name-only inference abstains unless the exact name is one of the independently
reviewed normative rules below.

The following separately sourced repo/key rules carry their own exact score: `adtype`, `ad_type`,
`adformat`, and `ad_format` establish `format-declaration @ 0.90`; `creative_type` establishes it at
`0.70`; generic `type` and `format` are capped at `0.40`. Existing format-naming truthy flags such as
`popunder=1`, `push=1`, and `allowShock=1` remain terminal prior-resolver evidence rather than
numeric-code decoding. Separately reviewed, repo-grounded specification rules set
`imp_count → measurement @ 0.70`, `ttl → delivery-control @ 0.70`, digit-only
`build → metadata @ 0.70`, and `subage → measurement @ 0.90`. Bare `flag` and `limit` are
`ambiguous`; `mode` and `t` abstain.

Those four role IDs and exact scores are specification-frozen adjudications, not taxonomy or scores
claimed to come from the repository. Their grounding is recorded separately: the bench calls
`imp_count` a counter, calls `ttl` only a numeric technical parameter, and calls `build` a build-number
metadata field; the Ext-RTB contract defines `subage` as subscription age in days. In particular,
`delivery-control @ 0.70` for `ttl` is an explicit reviewed specification rule, not a corpus fact.

#### Frozen 14-scenario regression oracle

The two `adtype=8` rows are different bench contexts, not duplicates. "Live replica" means the
required redacted synthetic fixture, never the original payload.

| Origin       | Signal/context                | Role-layer source/state               | Canonical role or candidates                        | Projected `label`  | `valueStatus`    | Required role confidence / final route                           |
| ------------ | ----------------------------- | ------------------------------------- | --------------------------------------------------- | ------------------ | ---------------- | ---------------------------------------------------------------- |
| Tune         | `adtype=8`, banner context    | corpus + named / `resolved`           | `format-declaration`                                | `custom`           | `unknown`        | `0.90`; no model                                                 |
| Tune         | `ad_type=70`, video context   | named / `resolved`                    | `format-declaration`                                | `custom`           | `unknown`        | `0.90`; no model                                                 |
| Tune         | `format=12`, banner context   | corpus + named / `resolved`           | `format-declaration`                                | `custom`           | `unknown`        | `0.40`; no model                                                 |
| Tune         | `adtype=8`, pop-shape context | corpus + named / `resolved`           | `format-declaration`; pop shape is explanation only | `custom`           | `unknown`        | `0.90`; no model                                                 |
| Tune         | `limit=1`                     | named / `ambiguous`                   | `delivery-control`, `pricing`, `format-declaration` | absent             | absent           | no overall confidence; no model                                  |
| Tune         | `flag=1`                      | named / `ambiguous`                   | `delivery-control`, `format-declaration`            | absent             | absent           | no overall confidence; no model                                  |
| Tune         | `mode=2`                      | named / `abstain`                     | none                                                | absent             | absent           | model; label `delivery-control`, `custom`, or `ignore`; `0–0.30` |
| Tune         | `imp_count=3`                 | repo-grounded named rule / `resolved` | `measurement`                                       | `measurement`      | `not-applicable` | `0.70`; no model                                                 |
| Hold-out     | `creative_type=3`             | named / `resolved`                    | `format-declaration`                                | `custom`           | `unknown`        | `0.70`; no model                                                 |
| Hold-out     | `ttl=300`                     | repo-grounded named rule / `resolved` | `delivery-control`                                  | `delivery-control` | `not-applicable` | `0.70`; no model                                                 |
| Hold-out     | `build="20260812"`            | repo-grounded named rule / `resolved` | `metadata`                                          | `metadata`         | `not-applicable` | `0.70`; no model                                                 |
| Hold-out     | `t=1`                         | named / `abstain`                     | none                                                | absent             | absent           | model; label `custom` or `ignore`; `0–0.30`                      |
| Live replica | `ad_type=30`                  | named / `resolved`                    | `format-declaration`                                | `custom`           | `unknown`        | `0.90`; no model                                                 |
| Live replica | `subage=18`                   | repo-grounded named rule / `resolved` | `measurement`                                       | `measurement`      | `not-applicable` | `0.90`; no model                                                 |

#### Claim-aware model-ceiling oracle

The fourteen historical scenarios above remain a closed replay set. One additional post-change,
synthetic pair tests FR-008 on the fallback path and is not counted as session evidence:

| Fixture        | Signal                                       | Deterministic route                        | Replayed model candidate | Required acceptance                |
| -------------- | -------------------------------------------- | ------------------------------------------ | ------------------------ | ---------------------------------- |
| Numeric        | `imp[0].ext.publisher_account_ref=42`        | every deterministic source abstains; model | `identifier @ 0.70`      | accept unchanged; no numeric clamp |
| String control | `imp[0].ext.publisher_account_ref="acct-42"` | every deterministic source abstains; model | `identifier @ 0.70`      | accept unchanged                   |

`publisher_account_ref` is an exact-case negative control: fixture generation MUST assert that it is
absent from the frozen 322-name corpus, the separately named rules, saved mappings, and legacy
deterministic rules. The deterministic model-adapter replay freezes the same valid candidate for both
values so the test isolates post-processing from model variance. `identifier` describes the field;
neither answer interprets `42` or `"acct-42"`. A prompt-contract test MUST also assert that a
role-only `identifier` answer is permitted in the `0.60–0.80` medium band for the numeric fixture;
exact production-model bytes or an exact production-model score are not required.

#### Frozen snapshot construction and identity

The v1 snapshot MUST use Prebid Server commit
`0ba352315253f6692af6497d553cfb12909a1b8b`, the 272 files matching
`static/bidder-params/*.json`, and `derived/adapter-rules-2026-08-20.json` at SHA-256
`73d067fa6ea9689b09167104db7bb1a72ff950446db8275b41bd54e32193598b`. Its manifest records every
schema file and digest; the aggregate schema-list digest is
`8279e69f439f91b1e9d44274db139f2a3bd38261776b248b4b020d225767a3d5`, computed as SHA-256 over the
UTF-8 byte stream of lexicographically sorted `<file-sha256><two spaces><basename><newline>` rows.
The derived rules' declared source commit MUST match the pinned checkout. The manifest also pins the
source `LICENSE` digest
`9d130cc11efd232f041473f0cd62c43806b9389d63b599c8ee0862b699e8bc58`, attribution digest
`06ab88a60ff471b4dfb9592fdcbaaeea773ba8e82ed2504a25cddaea5b481e1d`, and research quarantine
digest `4e5bb17122c8a592ef1f8559ef1dcae446cda0acb1ea15e099e21b0737c7ea88`.

Schema candidates are exact names under each document's top-level `properties`; nested properties
are not traversed. The frozen assertions are 697 occurrences, 289 exact names and 279 names with at
least one non-empty description. Adapter rules with literal status `verified`, `unverified` or
`confirmed-omission` are eligible. `evidence-unresolvable` and `deleted-by-verification` records
remain in the audit report but MUST NOT support an entry. The status histogram is 364 verified, 824
unverified, 42 confirmed omissions, two evidence-unresolvable and one deleted-by-verification.

For each eligible adapter rule, split `field` on literal `.` and locate the leftmost segment exactly
equal to `ext`. Emit its immediate child; when that child is exactly `bidder` and another segment
follows, emit that next parameter too. A path ending at `ext` emits nothing. After exact
deduplication, remove exactly `data`, `dsa`, `eids`, `gpid` and `schain`. The assertions are 133 raw
adapter names, 128 after exclusion, 95 shared exact spellings, and the exact-case partition
194 schema-only + 33 extension-only + 95 both = 322.

Exact code-point spelling is canonical identity. Generation, adjudication and runtime lookup MUST
NOT lowercase, trim, separator-fold or merge names. The runtime exact-matches within the supported
signal namespace (`ext.<key>` or `imp[].ext.<key>`); reviewed vendor/path partitions may further
narrow an entry. V1 has no case-fold alias fallback: an unlisted casing abstains. An ASCII-lowercase
diagnostic index records 297 buckets and the 22 collision buckets containing 47 exact spellings, but
never selects a role or merges provenance. Generated exact entries are sorted by UTF-8 byte order.

Every entry retains all schema and eligible adapter attestations. Coverage and verification are
independent dimensions. Schema provenance includes the relative file, escaped `/properties/<name>`
JSON pointer, source commit and description-presence flag. Adapter provenance includes bidder,
original rule field, disposition, exact evidence citation, literal status, source commit and corpus
digest. Because the source corpus does not supply role truth, a separately versioned and reviewed
adjudication manifest MUST cover exactly all 322 names and every declared context partition. Each
record includes canonical role candidate(s), state, applicable namespaces/vendor/path constraints,
source-record IDs, the mechanically derived exact authority score when singular, and a concise
semantic rationale explaining why the evidence establishes, conflicts on, or fails to establish the
role.

Every record receives two independent review passes whose reviewer IDs and decisions are retained.
The two passes MUST be by different reviewers, identified by stable pseudonymous IDs that carry no
personal data; an automated agent MAY serve as at most one of the two, never both. "Maintainer"
means the repository owner, and the escalation path for reviewer disagreement is exactly one step:
the maintainer resolves it with a recorded rationale or the record stays `ambiguous`. Review is not
a one-time event — a new corpus snapshot version, a change to the authority oracle, or a recorded
dispute reopens the affected records, and only those. The effort is bounded by design: `abstain` is
itself a reviewed state and is deliberately cheap to confirm, so completeness means every name has
a reviewed record, not that every name has a resolved role.
`resolved` requires reviewer agreement on the singular role/context or an explicit maintainer
resolution of a recorded disagreement with rationale. Otherwise source or reviewer disagreement is
`ambiguous`; absence of citable semantic evidence is `abstain`. Majority voting, lexical plausibility
alone, and generator inference cannot establish a role. The generator rejects missing, extra,
duplicate, unreviewed, score-mismatched, or silently flattened records. Automated checks validate
this schema and set equality; the recorded independent review is the semantic acceptance oracle that
digests alone cannot provide.

A missing, truncated or unparseable committed manifest is a startup failure of the affected
process, never a silent degradation: the role layer MUST refuse to load rather than answer from a
partial table, and the pre-existing resolver alone MUST NOT be presented as if it were the full
combined behaviour.

The repo-backed named-rule manifest lists exactly the rules frozen in the confidence and 14-scenario
oracles, with repository citation or explicit specification-rule provenance and the required score,
ambiguity, or abstention. A named key that overlaps the 322 corpus names retains both provenance
classes but only one exact runtime identity; where the named rule and the corpus adjudication
disagree on state or score for that key, the named rule wins — it is the narrower,
specification-frozen adjudication — and the disagreement MUST be recorded on the entry rather than
silently resolved. A named key outside the corpus remains outside the
322-count assertions.

### Key Entities

- **Alphabet entry**: One exact-case extension key identity, optionally partitioned by supported
  namespace and reviewed vendor/path context. It retains all attestations, role candidates,
  adjudication state, aliases-for-diagnostics and authority band. It carries no private value
  meanings.
- **Key role**: One member of the closed canonical enum: neutral `format-declaration` or one of the
  nine new non-format role IDs. It describes what kind of field this is, never what a particular
  value means. Stored `custom` is the unknown-value projection of `format-declaration`, not the role.
- **Evidence strength**: Two independent dimensions — source coverage (`schema-only`,
  `extension-only`, `both`) and literal adapter verification strength. They constrain authority but
  never silently collapse conflicts into one score.
- **Signal answer**: What the operator sees for one signal. A role-layer answer has discriminated
  `resolutionStatus`, zero or more canonical role candidates, role confidence only for singular
  `resolved`, value status, projected label, localized explanation, source class, routing evidence,
  and provenance. An ambiguous answer preselects no label. Existing exact-format and model answers
  retain their accepted response shape and source marker.
- **Confidence**: For the deterministic role layer, an exact reproducible score and named band about
  the singular role only. It is never a statement that a private value was decoded and is absent when
  no singular role is established. Existing model confidence remains calibrated rather than
  byte-deterministic.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For the named `ad_type=30` synthetic fixture, the operator sees canonical role
  `format-declaration`, projected label `custom`, role confidence exactly `0.90`, value status
  `unknown`, an explicit vendor-private explanation, no specific format, and zero model invocations.
- **SC-002**: A frozen routing matrix contains at least one fixture for every adjudication
  namespace/vendor/path partition covering all 322 exact corpus names, every separately named
  repo-backed rule, every member of each case-collision group, unlisted-casing controls, and an opaque
  absent-key control in both supported namespaces. On that same `N`-fixture matrix, `D0` records final
  deterministic answers before the change and `D1` after the change. `D1 > D0`; no fixture answered
  deterministically before may newly reach the model; every role-layer `resolved`/`ambiguous` outcome
  makes zero model calls; and `abstain` follows the precedence matrix rather than automatically calling
  the model. Results report exact-format, role-resolved, role-ambiguous, preserved-legacy, and model
  route counts separately. "Answered deterministically" means the fixture's final combined route is
  any of the four non-model routes; the five counts partition the matrix — membership is decided by
  the single final outcome, so every fixture lands in exactly one. Together, `D1 > D0` and the
  no-demotion clause make the pass non-degenerate: no fixture may leave the deterministic set, so
  the set grows strictly and a regression in one class cannot hide behind growth in another.
  Determinism is asserted by procedure, not assumption: the same matrix run in two separate
  processes and in each of the three locales MUST yield identical routes and identical exact scores.
- **SC-003**: Every displayed role candidate sourced from the role layer exposes its source, precise
  citation, coverage and literal verification status in-product, and a reviewer can re-find the
  frozen record from that information without external navigation.
- **SC-004**: Across the full numeric bench and every supported locale, no shared table or model
  answer decodes an opaque numeric vendor value into a specific format. Exact saved or existing
  vendor-dialect mappings remain confined to their recorded scope.
- **SC-005**: For every deterministic role-layer fixture, repeated requests in `en`, `uk` and `ru`
  before and after a fresh process start return byte-identical state, roles/candidates, exact role
  confidence, value status, projected label, evidence and routing; only localized prose differs.
  Ambiguous/abstain states carry no overall role confidence. Model-only confidence remains subject to
  its calibration bands, not byte identity.
- **SC-006**: Every row of the frozen 14-scenario oracle returns its stated state, canonical role or
  candidates, projected label, value status, exact deterministic score or accepted model band, and
  final route. The separate claim-aware model-ceiling pair accepts the frozen `identifier @ 0.70`
  candidate unchanged for both numeric and string values. No row remains that a fully compliant
  answer cannot satisfy; tuning, hold-out, live replicas and the synthetic pair are reported
  separately.
- **SC-007**: For the `mode=2`, `t=1`, and numeric `publisher_account_ref=42` model-fallback fixtures,
  responses in English and Russian contain no Ukrainian prose, and all three supported locale runs
  use only their requested language.
- **SC-008**: Operators can complete a mapping for a numeric-coded signal without needing to know
  anything the product did not tell them, other than the vendor-specific meaning of the value
  itself, and the warning names the exact dialect + normalized path + serialized-value scope.
- **SC-009**: An operator can save what a field actually is, rather than the nearest available
  approximation of it — and reading their dialect back shows that same thing.
- **SC-010**: Every mapping saved before this change behaves identically after it, demonstrated by
  regression coverage over the pre-existing label set rather than by inspection.
- **SC-011**: Generation reproduces exact set equality for the 322-name corpus subset, all frozen
  counts/digests, all 22 case-collision groups, and per-entry provenance. The adjudication manifest has
  two recorded reviews, rationale and a routing fixture for every context partition; the separately
  named repo rules retain distinct provenance. Continuous integration validates the committed
  artifacts without the research corpus, and external regeneration reproduces their recorded digests.

## Assumptions

- The research corpus is not versioned with the product and is not present in continuous
  integration. The evidence snapshot and reviewed adjudication therefore ship as committed artifacts
  accompanied by a recorded external regeneration procedure; integration gates validate the frozen
  artifacts and manifest without reaching outside the repository.
- Growing the deterministic table is already sanctioned by the accepted decision governing model
  assist, which states that growth moves signals out of the model's scope and never into it. This
  feature is an application of that clause, not an amendment to it.
- Resolver precedence is the normative matrix above, not a blanket "old resolver before alphabet"
  order. Saved mappings and terminal exact format flags stay first; specific-format strings are
  reconciled with role evidence; alphabet roles supersede only broad legacy non-format heuristics;
  and those heuristics remain the fallback when the alphabet abstains. Only a signal on which all
  deterministic sources abstain reaches the model.
- The prohibition on promoting vendor-specific values into shared semantics is already accepted
  policy. This feature restates it as an explicit boundary because an alphabet is exactly the shape
  of artifact that could quietly breach it.
- The existing deterministic resolver's locale behaviour stays unchanged. Every new alphabet state,
  role name, provenance label and explanation is nevertheless new UI and therefore ships in English,
  Ukrainian and Russian; the observed wrong-language repair remains scoped to the model path.
- No change to how, where, or by whom the model runs is contemplated. It stays local, it stays
  bounded to this one path, and unavailability stays a supported state.
- Admitting every exact name (CL-003) does not mean asserting a role for every name. The separately
  reviewed state may be `abstain`; this is the safety valve that keeps coverage from becoming
  fabricated semantic certainty. Authority follows both source coverage and verification, and
  conflicts remain explicit.
- Extending the savable label set (CL-002) touches a public contract, so this feature carries a
  decision record of its own. It is an addition, not a redefinition: nothing already storable
  changes meaning, and the existing labels keep their current behaviour unchanged.
- The model privacy allowlist does not expand. Alphabet lookup and provenance rendering are local;
  when the alphabet abstains, the model receives only the already accepted signal path/value,
  allowlisted impression sketch and sibling key names. No live payload body or operator identifier
  is retained in the snapshot or synthetic regression fixtures.

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

### Session 2026-08-28

- **CL-001** [Scope] — _Should value-independent mappings join this feature or follow it?_
  **Resolved: they follow it.** This feature builds the table; the table is then the evidence that
  justifies a value-independent mapping for roles where the key settles the meaning. The stored
  mapping's dialect + normalized-path + serialized-value identity and the value-dependent question
  rule remain unchanged here. Recorded under `Deferred Decisions` above.

- **CL-002** [Scope] — _Is a role advisory context, or is it what gets stored?_
  **Resolved: non-format roles become storable.** The savable label set is extended to carry those
  roles, rather than leaving them as display-only hints that collapse into `ignore` or
  `informational` on save. Neutral `format-declaration` projects to the existing `custom` label while
  its private value remains unknown. A dialect should record that a field is an identifier or a price
  or a consent signal, because that is what the operator actually learned. This is a public contract
  change and carries the obligations in FR-019 through FR-024 — a recorded compatibility decision,
  unchanged meaning for every mapping already stored, and explicit suppression semantics for each
  added role.

- **CL-003** [Scope] — _How broad is the initial table?_
  **Resolved: maximum coverage, correctly stratified.** All 322 names are admitted, but a name's
  authority follows its evidence rather than its presence. Names attested in an extension position
  by adapter evidence outrank names known only from publisher-side configuration schemas, and names
  attested by both outrank either alone. A weak row may resolve low, return deterministic ambiguity or
  abstain; membership alone never supplies a role. See FR-025 through FR-027.

- **CL-004** [Resolution order] — _Should the key-role alphabet augment the current resolver,
  preserving deterministic recognition of explicit string values and format-naming flags while
  limiting no-decode and shape-neutral rules to opaque numeric codes?_ **Resolved: yes.** Preserve
  saved-mapping precedence and accepted exact-format evidence. Apply the resolver matrix: terminal
  flags remain terminal, string-format verdicts are reconciled with role evidence, specific alphabet
  roles supersede only broad `ignore`/`informational` heuristics, and an alphabet abstention preserves
  those heuristics. The model runs only after every deterministic source abstains.
