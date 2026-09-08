# Contract: Validation and Crosscheck Semantics

**Owner**: Assigned Core semantic validators and crosscheck. **Target release**: Core 0.45.0.

## Public compatibility

Existing public function signatures, output shapes, finding identifiers, sort/dedup/filter semantics and CLI exit policy are preserved. New semantic findings are additive and can alter verdicts, which justifies the reserved minor Core release. Every added ID must have en/uk/ru text with equal parameters and an authoritative `spec-refs.json` entry; emit levels inline in `makeFinding`/`makeCross` calls for the static severity registry. The final delivered ID inventory is recorded alongside verification after implementation.

The baseline [Price and Floor Resolution](../../000-platform-baseline/contracts/core-validator.md#price-and-floor-resolution-022-core-0410) contract remains unchanged: no price coercion, one imported `resolveDealFloor` authority, 3.0 `flrcur`, and paired response-plugin projection limited to `{cur}`.

## Wave A: paired media

- Resolve the bid's actual matched impression and selected media before applying media-specific constraints. Valid selection on mixed inventory must not trigger unselected banner or Native requirements.
- Explicit contradictory `mtype`, selected family or actual creative evidence remains diagnosable. Absence of a declaration does not invent one.
- For supplied video VAST, compare actual available rendition MIME, parsed duration and document protocol against explicit selected video constraints. A permitted rendition is sufficient for the MIME axis; absent evidence is not a fabricated match. Keep mismatch findings on the affected bid/creative path.
- Banner/audio impressions receive corresponding content-shape checks. Unknown inline content does not receive an unsupported compatible verdict. Wrapper URLs are not resolved remotely.
- Response seat identities honor explicit `wseat`/`bseat`; absent/unusable identities do not become synthetic matches. Ordinary unrestricted/allowed seats retain their prior behavior.
- Valid InLine NonLinearAds-only content does not require a Linear MediaFile. Actual Linear content remains subject to that requirement; metadata text cannot count as an actual creative node.

## Wave B: response and supplied fields

- Supplied OpenRTB 2.x `mtype` must be integer 1–4. A valid declared family incompatible with the matched impression is a crosscheck contradiction. Invalid supplied value/type is a validator error; omission remains optional.
- Supported 2.x `bid.native` objects and 3.0 AdCOM structured Native content satisfy creative representation presence while retaining required asset/content checks. They do not require an additional serialized display markup field. SSP convention support does not redefine IAB serialization requirements.
- Duplicate explicit seat identities across response SeatBid groups receive a diagnostic; multiple bids in one SeatBid remain valid.
- Whitespace-only `adm` is absent creative content. Existing supplied invalid-type errors remain independent from absence guidance.
- The recognized documented EXADS popunder request form may omit standard media objects. The exception must not turn an ordinary media-less interstitial into a valid IAB impression.
- A pop bid with absent inline content and the already-supported notice-only completeness form does not receive `bid.pop.adm_not_redirect` solely for omission. Supplied non-redirect inline content retains the existing error and ID.
- Supplied integer `nbr` outside 0–17 and 500+ receives an unassigned-value warning; noninteger/wrong-type values retain an error. Supplied `regs.coppa` outside integer 0/1 receives an error; omission remains optional.

## Corpus retirement and authority

The fourteen groups are DEF-113/194/111/192/130 in wave A and DEF-195/151/150/190/198/109/170/301/197 in wave B. Their twenty-five case references are inventoried from the existing merged registry. Normative payloads and expectations remain independent of current output. Existing unrelated signatures must remain exact across the real `loadCorpus()` result; a group record hiding a separate browser deviation must preserve that deviation under its actual owner.

## Version and delivery

Core 0.45.0 is reserved; CLI's Core range becomes `^0.45.0` with workspace lock metadata aligned. Existing app and CLI version lines remain independent. Read actual values after any reconciliation because equal version edits can merge silently. The user authorized two branch pushes, one per settled wave, with local and hosted gates. Main integration is owned by the maintainer; no npm publication or production deployment is part of this contract.

## Expectation identity binding and peer-owned observations

Existing fixture IDs prefixed `expected.` are unbound semantic symbols, not shipped finding IDs. Bind only the selected affected symbols to implemented public IDs, retaining every payload, severity, path and parameter assertion. The corpus harness/oracle stays unchanged; the real 256-case loader comparison proves the bounded impact. DEF-151 additionally has recognition/preview expectations owned by another agent; those observations must pass before its record is retired. Assigned-file implementation can proceed while that ownership coordination remains explicit.
