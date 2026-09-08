# Contract: Validation and Crosscheck Semantics

**Owner**: Assigned Core semantic validators and crosscheck. **Repository version**: Core 0.45.0. Both semantic waves are implemented in this branch; DEF-151 recognition/preview remains open.

## Public compatibility

Existing public function signatures, output shapes, finding identifiers, sort/dedup/filter semantics and CLI exit policy are preserved. New semantic findings are additive and can alter verdicts, which justifies the reserved minor Core release. Every added ID must have en/uk/ru text with equal parameters and an authoritative `spec-refs.json` entry; emit levels inline in `makeFinding`/`makeCross` calls for the static severity registry. Wave A adds seven IDs and wave B adds eight; the exact current inventory and paths are recorded in the [baseline Core contract](../../000-platform-baseline/contracts/core-validator.md#selected-media-and-buyer-seats-026-wave-a-core-0450). Reusing an existing Native finding at another supported field does not create a new ID.

The baseline [Price and Floor Resolution](../../000-platform-baseline/contracts/core-validator.md#price-and-floor-resolution-022-core-0410) contract remains unchanged: no price coercion, one imported `resolveDealFloor` authority, 3.0 `flrcur`, and paired response-plugin projection limited to `{cur}`.

## Wave A: paired media

- Resolve the bid's actual matched impression and selected media before applying media-specific constraints. Valid selection on mixed inventory must not trigger unselected banner or Native requirements.
- Explicit contradictory `mtype`, selected family or actual creative evidence remains diagnosable. Absence of a declaration does not invent one.
- For supplied video VAST, compare actual available rendition MIME, parsed duration and document protocol against explicit selected video constraints. A permitted rendition is sufficient for the MIME axis; absent evidence is not a fabricated match. Keep mismatch findings on the affected bid/creative path.
- Banner/audio impressions receive corresponding content-shape checks. Unknown inline content does not receive an unsupported compatible verdict. Wrapper URLs are not resolved remotely.
- Response seat identities honor explicit `wseat`/`bseat`; absent/unusable identities do not become synthetic matches. Ordinary unrestricted/allowed seats retain their prior behavior.
- Valid InLine NonLinearAds-only content does not require a Linear MediaFile. Actual Linear content remains subject to that requirement; metadata text cannot count as an actual creative node.

## Wave B: response and supplied fields

- Supplied OpenRTB 2.x `mtype` is integer 1–4. A valid declaration naming a family absent from the matched impression produces `crosscheck.bid.mtype_offered_mismatch` (`crit`); a supplied invalid declaration produces `response.bid.mtype_invalid_enum` (`error`). Omission remains optional.
- Explicit duplicate seat strings across SeatBid groups produce version-specific `response.seatbid_seat_duplicated`/`response.30.seatbid_seat_duplicated` errors. Multiple bids in one group remain valid; absent/malformed identities are not invented. Both versions import the same response-owned duplicate helper.
- A supplied nonempty whitespace-only 2.x `adm` receives `response.bid.adm_blank` (`warning`), including with a notice URL. The existing `response.bid.payload_missing` remains the separate omission finding. This dedicated blank-content verdict does not weaken supplied-type diagnostics or require duplicate warnings for the same absence.
- Supplied integer `nbr` outside 0–17 and 500+ receives the version-specific `response.nbr_code_unassigned`/`response.30.nbr_code_unassigned` warning. Supplied noninteger/wrong-type values retain the existing invalid-type errors. Both versions use the one response-owned domain helper. Optional omission remains valid.
- Supplied 2.x `regs.coppa` must be exactly 0 or 1 and otherwise receives `regs.coppa_invalid` (`error`); omission remains optional.
- Explicit `ext-rtb` dialect selection permits the documented EXADS `instl: 1` form only when all four standard media fields are absent/undefined. Supplied malformed media is not treated as omission; ordinary IAB media requirements remain.
- A pop-tagged bid with absent/undefined `adm` and a valid notice URL does not receive `bid.pop.adm_not_redirect`. The pop plugin imports the owning response URL predicate. Supplied non-redirect inline content retains that existing error, even with a valid notice URL.

### Structured Native

Supported 2.x `bid.native` objects and 3.0 AdCOM `media.ad.display.native` satisfy creative-presence checks without duplicated serialized markup. The SSP convention remains distinguished from the IAB serialization contract. For crosscheck, explicit structured content takes precedence over `adm`; neither a notice URL nor alternative markup hides a supplied malformed Native carrier.

The shared Native inner-object helper accepts a bare object or one explicit object-valued `native` wrapper. Null, false, zero, other non-object roots and malformed/nested wrappers receive the existing invalid Native crosscheck finding rather than a complete verdict, even with all optional requested assets. Supplied non-object AdCOM `display.native` independently reuses the existing `response.30.bid.native_invalid` error, including when `adm` is also present.

AdCOM request `nativefmt.asset` projects to `assets` with `req` mapped to `required`; response `native.asset` projects to `assets` with `image` mapped to `img`. A Native-only display placement does not imply an extra banner offer. The projection preserves caller payloads and the 022 currency-only response-plugin boundary. Existing affected paths remain, including 2.x bid `adm` and the 3.0 Ad object path.

Required IDs and asset kind/content/length/dimension fitness retain their existing finding IDs. Request asset containers must be nonempty arrays of objects with IDs. Supplied malformed response asset containers remain invalid; absent assets retain the required-ID missing-assets verdict. Required title, data and image URL content must be nonblank. This is bounded fitness checking, not exhaustive Native schema conformance.

The image URL field accepts nonempty syntactically valid base64 data with an explicit PNG/JPEG/GIF/WebP MIME header. This raster allowance does not extend to navigation URLs, SVG, HTML or malformed/empty bodies. Existing URL scheme checks elsewhere and sandbox/network behavior remain. It makes no image-byte decoding or playback claim.

## Corpus retirement and authority

The fourteen groups are DEF-113/194/111/192/130 in wave A and DEF-195/151/150/190/198/109/170/301/197 in wave B. Their twenty-five case references are inventoried from the existing merged registry. Thirteen scoped groups are retired; DEF-151 retains its exact remaining recognition/preview signatures after its Core validation/crosscheck deviations are resolved. The current ledger has thirteen groups overall, including peer-owned and unrelated work; this does not claim all fourteen scoped groups closed. Normative payloads and expectations remain independent of current output. Existing unrelated signatures must remain exact across the real `loadCorpus()` result; a group record hiding a separate browser deviation must preserve that deviation under its actual owner.

## Version and delivery

Core 0.45.0 and CLI's Core range `^0.45.0` are aligned with workspace lock metadata. The permanent brief amended the original reservation after the independently delivered Core 0.44.0 recognition work; the current baseline includes peer 024/025 at `f1758bc`. Existing app and CLI version lines remain independent. Read actual values after any reconciliation because equal version edits can merge silently. The user authorized two branch pushes, one per settled wave, with local and hosted gates. Main integration is owned by the maintainer; no npm publication or production deployment is part of this contract.

## Expectation identity binding and peer-owned observations

Existing fixture IDs prefixed `expected.` are unbound semantic symbols, not shipped finding IDs. Bind only the selected affected symbols to implemented public IDs, retaining every payload, severity, path and parameter assertion. The corpus harness/oracle stays unchanged; the real 256-case loader comparison proves the bounded impact. DEF-151 additionally has recognition/preview expectations owned by another agent; those observations must pass before its record is retired. The assigned semantic implementation is complete in this branch; that remaining ownership and observable-verification boundary is explicit and prevents a false full-completion claim.
