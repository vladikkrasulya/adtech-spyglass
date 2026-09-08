# Research: Verdict Semantics

**Date**: 2026-09-08. This plan uses the accepted brief, existing source-attributed corpus and owning baseline contracts. Execution evidence will be recorded separately; this document does not claim the defects repaired.

## R1. Normative evidence and preserved economic contract

**Decision**: Use the existing source-backed expectations and pinned protocol editions. OpenRTB 2.6 is pinned at `403cbba542de3a5d9cfcccd0a34e74b01b79a9f1`; OpenRTB 3.0 at `9af34fc79580f67f6abaf89b1e48d18398c9a697`; AdCOM at `df8ba06de0ba77c82efee7a2dc832bd4968474d6`. The 022 research archive retains readable copies. Relevant owners are OpenRTB BidRequest/Bid/SeatBid/Video/Regs and Markup Types/No-Bid Reason lists, AdCOM NativeFormat/Native assets, VAST NonLinearAds, and the exact EXADS request reference stored in the corpus.

**Rationale**: Expected behavior predates this repair and is not inferred from current output. The Core baseline's Price and Floor Resolution section remains authoritative: finite nonnegative number-only prices, the imported `resolveDealFloor` owner, `item.flrcur`, and the currency-only paired 3.0 projection.

**Alternatives rejected**: Updating expected findings to match implementation, coercing price, copying deal-floor resolution or projecting 3.0 items to activate an unrelated price rule.

## R2. Selected media and evidence

**Decision**: Resolve the matched impression, determine the selected response media from supported declarations and actual supplied content, and apply only that media family's constraints. Diagnose declared/actual and offered/selected contradictions explicitly. Reuse the existing bounded VAST evidence and extract `inspectVastMedia` from its semantic owner `rules-vast.js` for crosscheck; real rendition facts govern MIME/duration/protocol checks, not tokens embedded in comments or vendor metadata.

**Rationale**: Offered alternatives are choices, not simultaneous obligations. Existing VAST inspection already provides bounded evidence, and a local supplied document cannot prove facts hidden behind a wrapper URL. Multiple MediaFiles can supply compatible alternatives.

**Alternatives rejected**: Running every impression's media branch, relying solely on `mtype`, treating any XML token as media, remote wrapper resolution or a second general XML parser.

## R3. Native and completeness

**Decision**: Supported 2.x `bid.native` and AdCOM `media.ad.display.native` participate in creative presence and asset checks. Preserve the distinction between the supported SSP object convention and IAB's documented serialized markup field. Empty/invalid supplied values do not become complete creatives. For pop bids, absent inline markup with a supported notice-only response is not an inline redirect failure; supplied non-redirect inline markup retains its diagnostic.

**Rationale**: Equivalent supported representations must receive equivalent verdicts, without treating a truthy malformed object or whitespace as usable content.

**Alternatives rejected**: Requiring duplicate serialized markup, suppressing all Native findings, or globally accepting missing pop content.

## R4. Value domains and seats

**Decision**: Optional `mtype` is integer 1–4 when supplied; no-bid reason values outside 0–17 and integer 500+ receive an unassigned-value warning while malformed supplied types retain errors; supplied COPPA is an integer 0/1. Identified response seats are checked against explicit allowed/blocked lists; duplicate explicit seats across SeatBid groups receive a diagnostic.

**Rationale**: Omission guidance and invalid supplied values are different contracts. Several bids within one group do not imply a duplicate seat, and missing identity is not proof of a restriction violation.

**Alternatives rejected**: Coercing numeric strings, silently treating unknown enum values as known, or applying a seat contradiction to an invented identity.

## R5. Vendor and VAST exceptions are narrow

**Decision**: The EXADS popunder media-absence exception requires the documented recognized popunder evidence; it does not exempt generic `instl` inventory. NonLinearAds-only InLine content does not require a Linear MediaFile; actual Linear content still does.

**Rationale**: Both defects come from applying the wrong content contract. Correct the applicability condition rather than demoting errors globally.

**Alternatives rejected**: Disabling the IAB media requirement for all interstitial requests or disabling MediaFile validation for every VAST document containing a NonLinearAds token.

## R6. Delivery and evidence ownership

**Decision**: Work from the isolated 026 checkout at main `340ffd3`; reserve Core 0.45.0 with CLI dependency and lock aligned. The maintainer owns main integration. Preserve historical evidence when retiring obsolete clean Codex worktrees. Push the reviewed branch once per wave and wait for hosted gates. Use the prior private-profile/PID-namespace Chrome recipe for full tests.

**Rationale**: Other agents own active UI/recognition work and Core 0.43.0. Identical version edits can merge without a textual conflict, and shared Chrome cleanup can kill peer browsers. Version readback and isolated processes address actual observed failures.

**Alternatives rejected**: Editing shared main, broad staging, per-defect full-gate pushes, silently relying on merge conflict detection, or changing the corpus harness to pass a failing product.

## Scoped registry inventory

| Wave | Group   | Cases                                                                                                                                                               | Source                                                                                                                                                                   |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A    | DEF-113 | `video-duration-incompatible`, `video-mime-incompatible`, `video-protocol-incompatible`                                                                             | [Registry source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectvideo)                           |
| A    | DEF-194 | `mut-format-mismatch-banner-vast-adm`, `mut-format-mismatch-audio-video-mediafile`, `cover-preview-audio-unidentified-inert`                                        | [Registry source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbanner)                          |
| A    | DEF-111 | `format-mixed-impression-video-wins`, `mut-format-mismatch-mixed-video-mtype-banner`                                                                                | [Registry source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectimp)                             |
| A    | DEF-192 | `multiplicity-wseat-allows-other-seat`, `multiplicity-bseat-blocks-responding-seat`                                                                                 | [Registry source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#321-object-bidrequest)                 |
| A    | DEF-130 | `video-x-web-42-nonlinear-overlay`                                                                                                                                  | [Registry source](https://github.com/InteractiveAdvertisingBureau/VAST/blob/master/VAST-4.4.md#312-nonlinearads)                                                         |
| B    | DEF-195 | `mut-format-mismatch-mtype-invalid-enum`, `mut-format-mismatch-mtype-video-banner-only`                                                                             | [Registry source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#list_markuptypes)                      |
| B    | DEF-151 | `native-x-ortb30-adcom-stub`, `cover-context-native-30-ctv`, `cover-context-native-30-inapp`, `cover-context-native-30-dooh`, `cover-context-native-30-unspecified` | [Registry source](https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/df8ba06de0ba77c82efee7a2dc832bd4968474d6/AdCOM%20v1.0%20FINAL.md#object_nativeformat)       |
| B    | DEF-150 | `native-x-structured-bid-object`                                                                                                                                    | [Registry source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbid)                             |
| B    | DEF-190 | `mut-identity-duplicate-seat-ids`                                                                                                                                   | [Registry source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectseatbid)                         |
| B    | DEF-198 | `encoding-adm-whitespace-only`                                                                                                                                      | [Registry source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbid)                             |
| B    | DEF-109 | `pop-exads-openrtb-url-adm`                                                                                                                                         | [Registry source](https://docs.exads.com/docs/rtb-publishers/open-rtb/bid-request/open-rtb-publishers-request-2p5/)                                                      |
| B    | DEF-170 | `pop-x-nurl-only-response`                                                                                                                                          | [Registry source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#333-object-bid)                                                            |
| B    | DEF-301 | `mut-input-shape-nbr-unassigned-code`                                                                                                                               | [Registry source](https://github.com/InteractiveAdvertisingBureau/openrtb/blob/9af34fc79580f67f6abaf89b1e48d18398c9a697/OpenRTB%20v3.0%20FINAL.md#list_nobidreasoncodes) |
| B    | DEF-197 | `field-shape-regs-coppa-invalid`                                                                                                                                    | [Registry source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectregs)                            |
