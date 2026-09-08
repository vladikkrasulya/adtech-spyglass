# Verified deviations and capability gaps

The completed 020 audit recorded 44 groups: the earlier 42 plus coverage-closure findings DEF-441 and DEF-460. Feature 021 subsequently retired DEF-100, DEF-103, DEF-114 and DEF-302; feature 022 retired DEF-110, DEF-104 and DEF-105; feature 023 retired DEF-101, DEF-102 and DEF-112; and feature 024's transport/shape-robustness fix then resolved DEF-115, DEF-204, DEF-300 and DEF-303, leaving 30 current ledger groups; the original findings below are retained with their resolutions at the end. Additional context and vendor cases extend existing groups rather than duplicating them. These include protocol-validation errors, documented vendor-support gaps, preview limitations and product API defects; the record count is not a count of IAB conformance defects. Retired or merged IDs are explained at the end. Case presence and a reproduced known gap do not establish conformance; complete applicable-layer outcomes belong in [verification.md](verification.md).

Baseline: `a61fc258c3ec8cc8bda5e2512df125a358bc08a4` (App 1.19.4 / Core 0.38.0). This audit adds assertions and evidence; it does not fix the product behaviors below. Exact per-case, per-layer signatures live in `tests/corpus/` and their ledger is merged from `tests/corpus/known-gaps.json` and `tests/corpus/known-gaps/*.json`. Known-gap test guards ensure new failures and repaired defects cannot silently pass.

## Core and HTTP defects

| ID      | Severity | Observed behavior                                                                              | Representative case                  |
| ------- | -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------ |
| DEF-100 | medium   | Recommended Device object and optional IP/UA are treated as mandatory                          | `video-ctv-26-dynamic-pod`           |
| DEF-101 | high     | Valid audio fixtures receive optional-device errors, video MIME warnings and video format tags | `audio-inapp-26-podcast-companion`   |
| DEF-102 | medium   | DAAST request protocol enumeration is not detected                                             | `audio-daast-26-request-only`        |
| DEF-103 | medium   | DOOH-only request without optional Device object is rejected                                   | `banner-dooh-26-screen`              |
| DEF-104 | high     | Crosscheck ignores the matched PMP deal floor                                                  | `bn-banner-26-pmp-multisize`         |
| DEF-105 | high     | OpenRTB 3.0 response currency and Item.flrcur are read from wrong fields                       | `bn-banner-30-adcom`                 |
| DEF-110 | high     | Crosscheck coerces invalid bid price values and emits a floor verdict                          | `price-invalid-array-empty`          |
| DEF-111 | high     | Mixed-format crosscheck applies constraints from unchosen media                                | `format-mixed-impression-video-wins` |
| DEF-112 | high     | Missing required Audio.mimes has no validation issue                                           | `audio-mimes-missing`                |
| DEF-113 | high     | Returned VAST MIME, duration and protocol constraints are not crosschecked                     | `video-duration-incompatible`        |
| DEF-114 | medium   | Valid no-bid empty seatbid without optional nbr is rejected                                    | `nobid-empty-seatbid`                |
| DEF-115 | high     | HTTP analysis crashes in category traversal on non-array seatbid or bid                        | `shape-bid-object`                   |

## Vendor support and provisional references

DEF-106 (EXADS wrapper), DEF-107 (PPCmate/Kadam request decoding) and DEF-109 (EXADS popunder extension) are documented vendor-support gaps. They do not imply these proprietary inputs are invalid IAB payloads or that support for every vendor is an existing product guarantee. DEF-108 preserves provisional Adon3 references for investigation; it is not a confirmed protocol defect and those examples do not count toward the minimum.

## Findings from coverage closure

- **DEF-441 — Kadam Native feed carrier** (medium, vendor capability). The documented Native response uses `url`, `image`, `title` and `cpc`. It is routed through Push validation and receives `feed.push.click_url_required`; the paired Native GET request has no decoder and loses its explicit format intent. The browser displays no Native card. Reproduce with `CORPUS_CASE='cover-vendor-native-kadam-*' node --test tests/corpus-core.test.js tests/corpus-http.test.js tests/corpus-browser.test.js`. A fix must recognize or explicitly explain the vendor carrier, accept its documented click field, retain the literal source payload and show the correct creative identity. See [Kadam Feed Integration](https://wiki.kadam.net/en/index.php?title=OpenRTB/Feed_Integration_SSP) and the case provenance. This is missing vendor support, not an invalid IAB-wire claim.
- **DEF-460 — standalone Native format detection** (medium, detection capability). A Native 1.2 `adm` body without the optional 2.6 `mtype` hint is successfully previewed, but Core, HTTP and browser format tags are empty. Reproduce with `CORPUS_CASE=cover-input-push-response-only node --test tests/corpus-core.test.js tests/corpus-http.test.js tests/corpus-browser.test.js`. A fix must identify the detectable Native carrier while keeping the source's push placement intent separate; generic JSON must remain unclassified. The fixture uses the [Native 1.2 response contract](https://github.com/InteractiveAdvertisingBureau/Native-Ads/blob/dd45d0733d96710981541ea213f4452952f41c40/OpenRTB-Native-Ads-Specification-Final-1.2.md#6-1). A particular application tag is a desired capability, not an IAB wire requirement.

The new cases also reproduce DEF-100/101/106/151/180/194/302. In particular, optional Device enforcement now has explicit AdCOM 3.0 DOOH evidence; Native 3.0 remains empty across four additional contexts; plain prose incorrectly escapes the negotiated-audio crosscheck. Per-case signatures preserve those failures and reject unrelated regressions. Integration-only aliases DEF-400–403, DEF-440 and DEF-442 were consolidated before delivery and do not increase the group count.

Source review also corrected inherited fixture mistakes: AdCOM OS/MIME field types, six VAST 4.1 Inline serving IDs and three older VAST element-order/attribute errors. These were test-data corrections, not product-defect fixes. Independent positive-fixture guards and pinned XSD validation prevent them from being mistaken for valid source evidence again.

## Reproductions and expected behavior

Run a listed case with `CORPUS_CASE=<id> node --test tests/corpus-core.test.js tests/corpus-http.test.js`. A known-gap expected-failure marker preserves the unmet normative assertion; its companion ordinary test must pass only while the exact recorded deviation remains.

### DEF-100 — Recommended Device object and optional IP/UA are treated as mandatory

The Device object is recommended; IP and UA are optional attributes. Omitting them may produce guidance but must not invalidate an otherwise valid request.

Reproduce: `video-ctv-26-dynamic-pod`, `field-shape-device-missing`. Affected code: `packages/core/rules-request.js:259`.

Observed assertion difference: `request: findings above warning: request.device.ip_required[error]@device.ip, request.device.ua_required[error]@device.ua`

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectdevice).

### DEF-101 — Valid audio fixtures receive optional-device errors, video MIME warnings and video format tags

Audio VAST and audio MediaFiles must remain valid and be identified as audio; optional request Device attributes do not invalidate the pair.

Reproduce: `audio-inapp-26-podcast-companion`. Affected code: `packages/core/rules-request.js:259`, `packages/core/rules-vast.js:322`, `packages/core/format-detect.js`.

Observed assertion difference: `request: findings above warning: request.device.ip_required[error]@device.ip, request.device.ua_required[error]@device.ua`

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectaudio).

### DEF-102 — DAAST request protocol enumeration is not detected

Audio protocols 9 and 10 negotiate DAAST 1.0 inline/Wrapper and must yield the DAAST protocol family.

Reproduce: `audio-daast-26-request-only`. Affected code: `packages/core/format-detect.js:85`.

Observed assertion difference: `format.protocols: expected [daast], got []`

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/main/AdCOM%20v1.0%20FINAL.md#list_creativesubtypesaudiovideo).

### DEF-103 — DOOH-only request without optional Device object is rejected

A valid DOOH-only BidRequest does not require the optional Device object.

Reproduce: `banner-dooh-26-screen`. Affected code: `packages/core/rules-request.js:259`.

Observed assertion difference: `request: findings above warning: request.device_required[error]@device`

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbidrequest).

### DEF-104 — Crosscheck ignores the matched PMP deal floor

The matching Deal.bidfloor governs its bid; validation and crosscheck must agree on both effective floor and below-floor outcome.

Reproduce: `bn-banner-26-pmp-multisize`. Affected code: `packages/core/crosscheck.js:193`, `packages/core/rules/price-floor/index.js`.

Observed assertion difference: `crosscheck: missing crosscheck.bid.above_floor @ seatbid[0].bid[0].price [ok] params={"floor":"0.7500"} — got crosscheck.auction.summary[ok]@auction, crosscheck.cur_allowed[ok]@cur, crosscheck.id_match[ok]@id, crosscheck.bid.impid_resolved[ok]@seatbid[0].bid[0].impid, crosscheck.bid.above_floor[ok]@seatbid[0].bid[0].price, crosscheck.bid.size_match[ok]@seatbid[0].bid[0].size`

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectdeal).

### DEF-105 — OpenRTB 3.0 response currency and Item.flrcur are read from wrong fields

The 3.0 request envelope permits EUR and item.flrcur is EUR, so an EUR bid above its EUR floor cannot produce a currency mismatch.

Reproduce: `bn-banner-30-adcom`. Affected code: `packages/core/crosscheck.js:660`, `packages/core/rules/currency/index.js:269`.

Observed assertion difference: `response: findings above warning: err-bid-currency-mismatch[error]@openrtb.response.cur`

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb/blob/9af34fc79580f67f6abaf89b1e48d18398c9a697/OpenRTB%20v3.0%20FINAL.md).

### DEF-106 — Documented EXADS proprietary request and bid wrapper are unsupported

Documented proprietary EXADS contracts remain intact; the validator should identify them or explicitly explain the unsupported dialect. They are not OpenRTB bid pairs.

Reproduce: `inpage-exads-wrapper`. Affected code: `packages/core/detect.js`, `packages/core/rules-feed.js`, `modules/analyze/handler.js`.

Observed assertion difference: `request: findings above warning: payload.unknown_type[error]@`

Normative or vendor reference: [source](https://docs.exads.com/docs/rtb-publishers/exads-rtb/bid-response/exads-rtb-publishers-response/).

### DEF-107 — Documented PPCmate and Kadam URL request dialects have no decoder

Publicly documented vendor URL request contracts should be decoded consistently with their feed responses; fixture host and token values are synthetic.

Reproduce: `inpage-kadam-icon-notice`. Affected code: `packages/core/decoders/request`, `packages/core/rules-request-url.js`.

Observed assertion difference: `request: findings above warning: request.url.no_decoder[error]@`

Vendor references: [PPCmate push endpoint](https://kb.ppcmate.com/kb/references-and-guidelines/how-to-create-a-push-endpoint-xml-feed), [Kadam feed integration](https://wiki.kadam.net/en/index.php?title=OpenRTB/Feed_Integration_SSP&oldid=7231).

### DEF-108 — Provisional Adon3 feed references are not recognized

Preserve provisional Adon3 references visibly as unsupported; this is not a confirmed protocol defect and does not count toward five qualified cases per format.

Reproduce: `pop-adon3-over-multi`. Affected code: `packages/core/detect.js`, `packages/core/decoders/request`.

Observed assertion difference: `request: findings above warning: request.url.no_decoder[error]@`

Normative or vendor reference: [source](https://adon3.com/docs/xml/response).

### DEF-109 — EXADS OpenRTB popunder impression without standard media object is rejected

The EXADS documented popunder extension permits instl-only impression shape and URL adm; generic IAB media rules need dialect awareness.

Reproduce: `pop-exads-openrtb-url-adm`. Affected code: `packages/core/rules-request.js`.

Observed assertion difference: `request: findings above warning: imp.format_required[error]@imp[0]`

Normative or vendor reference: [source](https://docs.exads.com/docs/rtb-publishers/open-rtb/bid-request/open-rtb-publishers-request-2p5/).

### DEF-110 — Crosscheck coerces invalid bid price values and emits a floor verdict

Bid.price is a non-negative JSON number. Values rejected by validation must also receive price_invalid in crosscheck and never above_floor or below_floor.

Reproduce: `price-invalid-array-empty`. Affected code: `packages/core/crosscheck.js:218`, `packages/core/rules/price-floor/index.js`.

Observed assertion difference: `crosscheck: missing crosscheck.bid.price_invalid @ seatbid[0].bid[0].price [crit] — got crosscheck.bid.below_floor[warn]@seatbid[0].bid[0].price, crosscheck.auction.summary[ok]@auction, crosscheck.cur_allowed[ok]@cur, crosscheck.id_match[ok]@id, crosscheck.bid.impid_resolved[ok]@seatbid[0].bid[0].impid, crosscheck.bid.size_match[ok]@seatbid[0].bid[0].size`

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbid).

### DEF-111 — Mixed-format crosscheck applies constraints from unchosen media

A valid mtype=2 video bid answering mixed offered inventory is checked against its selected video format. Conversely, a selected banner bid must not inherit the unchosen video VAST requirement. The corpus covers both directions.

Reproduce: `format-mixed-impression-video-wins`, `mut-format-mismatch-mixed-video-mtype-banner`. Affected code: `packages/core/crosscheck.js:420`, `packages/core/crosscheck.js:523`.

Observed assertion difference: `crosscheck: forbidden crosscheck.bid.size_mismatch @ seatbid[0].bid[0].size → crosscheck.bid.size_mismatch[warn]@seatbid[0].bid[0].size`

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectimp).

### DEF-112 — Missing required Audio.mimes has no validation issue

Audio.mimes is required. Its absence must produce a field-local warning or error; the oracle does not invent a future finding identifier.

Reproduce: `audio-mimes-missing`. Affected code: `packages/core/rules-request.js`.

Observed assertion difference: `request: missing issue at imp[0].audio.mimes`

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectaudio).

### DEF-113 — Returned VAST MIME, duration and protocol constraints are not crosschecked

A response creative incompatible with the requested MIME, duration or protocol must produce an issue on the affected bid adm. Detecting VAST shape alone is insufficient.

Reproduce: `video-duration-incompatible`. Affected code: `packages/core/crosscheck.js:523`.

Observed assertion difference: `crosscheck: missing issue at seatbid[0].bid[0].adm`

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectvideo).

### DEF-114 — Valid no-bid empty seatbid without optional nbr is rejected

No-bid BidResponse can have empty seatbid and optional nbr; its auction id is still meaningful and it must not be treated as a missing response.

Reproduce: `nobid-empty-seatbid`. Affected code: `packages/core/rules-response.js:90`, `packages/core/crosscheck.js`.

Observed assertion difference: `response: findings above warning: response.seatbid_empty_no_nbr[error]@seatbid`

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbidresponse).

### DEF-115 — HTTP analysis crashes in category traversal on non-array seatbid or bid

Syntactically valid JSON containing malformed nested field types should retain structured validation findings and HTTP success envelope; internal forEach failures must not replace them with bad_request.

Reproduce: `shape-bid-object`. Affected code: `packages/core/categories.js:131`.

Observed assertion difference: `http: expected 200, got 400 {"success":false,"error":"(intermediate value)(intermediate value)(intermediate value).forEach is not a function","code":"bad_request"}`

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbidresponse).

## Browser and UI/UX

| ID      | Classification                            | Behavior and follow-up acceptance                                                                                                                                                                                                                                  | Evidence cases                                                       |
| ------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| DEF-200 | Verified stale-result defect              | Structured HTTP error leaves the previous successful analysis visible. After an earlier successful analysis, a structured 429 failure for the same input must invalidate the old successful verdict and stored analysis.                                           | `ux-en-light-desktop`, `ux-en-light-mobile` (12 cases)               |
| DEF-201 | Missing bid/material selection capability | Inspector cannot select every returned bid or feed material. The audit must account for every returned creative. The current first-bid/material preview cannot expose subsequent creatives; report this capability gap explicitly.                                 | `audio-web-26-multi-imp-reversed`, `bn-banner-26-multiimp-multiseat` |
| DEF-202 | Vendor preview support gap                | Documented vendor response wrappers and clickunder creative have no preview. Documented response creatives retain their wire wrappers; a visible card or inert destination should be available, or absence reported as an unsupported preview capability.          | `inpage-exads-wrapper`, `pop-adon3-over-multi`                       |
| DEF-203 | Vendor creative classification mismatch   | PPCmate pop material is presented as a notification instead of an inert destination. A documented pop placement should expose its inert destination. Generic push-material heuristics must not silently claim notification rendering as pop creative coverage.     | `pop-ppcmate-json-material`, `pop-ppcmate-json-multi`                |
| DEF-204 | Verified malformed-input failure          | Malformed first bid crashes client analysis before the API call. Parseable malformed bid objects must reach structured validation, without a client-side null/undefined cur TypeError.                                                                             | `shape-bid-null`, `shape-bid-object`, `multiplicity-empty-bid-array` |
| DEF-205 | Verified raw-input cache defect           | Repasting clean JSON equal to the last pretty-print retains old duplicate-key bytes. Explicitly pasting clean request text starts new lexical provenance even when the parsed object equals the previous pretty-print. Validation must use the newly pasted bytes. | `ux-en-light-desktop`, `ux-en-light-mobile` (12 cases)               |

The 12 UX combinations reproduce both DEF-200 and DEF-205. DEF-200 leaves the prior successful analysis/verdict after a controlled structured HTTP 429. DEF-205 preserves duplicate-key findings after the user replaces the original input with clean JSON equal to the previous pretty-printed text: the outgoing raw sidecar still contains the earlier bytes. The explicit two-analysis sequence belongs in UX; independent corpus examples start on fresh pages so these signatures do not depend on test ordering.

DEF-201 records inaccessible later bids/materials using original indices. It does not simulate a selector by rearranging the payload. DEF-202/203 describe vendor-preview limitations separately from IAB conformance. DEF-204 preserves the client TypeError and missing successful analysis for malformed first bids; harness errors are not admitted as product gaps.

The browser checks the actual Analyze request, visible finding/crosscheck rows, successful reveal, ancestor blur/overlay state, original creative markers and image visibility. VAST is inert by the existing preview contract; media readiness is never called playback. External Native images remain subject to existing CSP, with limitations recorded explicitly. Final per-layer outcomes and persistent screenshots are linked from verification.md.

### DEF-260 — Rendered creative frame has no accessible name

Classification: accessibility defect; severity: medium. The `names-desktop` scenario renders and reveals the banner frame, then measures Chromium's accessibility tree. The frame is present and exposed (`found: true`, `ignored: false`) but its accessible name is empty. A missing frame is a separate failure, so removing the creative cannot satisfy this check.

Affected paths: `public/ortbtools.app.js:1598`, `public/ortbtools.app.js:1645`. Reproduce with `CORPUS_REQUIRE_BROWSER=1 node --test tests/corpus-ux-a11y-browser.test.js`; the pinned assertion is `a11y: creative frame or its accessible title is missing`. [W3C H64](https://www.w3.org/WAI/WCAG22/Techniques/html/H64) describes a meaningful iframe title as a naming technique; the test also accepts a meaningful accessible name supplied another way. This finding does not claim a complete WCAG assessment.

Follow-up: provide a localized accessible name and verify it in the accessibility tree for banner and Native previews. Retire DEF-260 only when the naming assertion passes while the creative still renders. The measured JSON, 19 scenario results and screenshots are linked from [verification.md](verification.md).

## Format extension — additional deviations and support gaps

The extended corpus (additional pairs per format and mutation categories) recorded the following further deviations. Each entry mirrors the ledger record in `tests/corpus/known-gaps/<owner>.json`; signatures are pinned per case.

### Core and HTTP — summary

| ID      | Severity | Title                                                                                                                                                     | Reproduce                           |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| DEF-130 | medium   | InLine VAST document containing only NonLinearAds (no Linear creative) is flagged vast.mediafile_missing                                                  | `video-x-web-42-nonlinear-overlay`  |
| DEF-150 | medium   | Structured bid.native object is invisible to schema markup-presence and crosscheck native completeness                                                    | `native-x-structured-bid-object`    |
| DEF-151 | medium   | OpenRTB 3.0 structured AdCOM native is rejected as missing display markup, detected as banner and omitted from native completeness                        | `native-x-ortb30-adcom-stub`        |
| DEF-160 | medium   | detectFeedFormat ignores the image_url/icon_url push-material aliases validatePushMaterial accepts                                                        | `push-x-kadam-material-single`      |
| DEF-161 | medium   | Array dispatch forces push-material field names onto a different vendor's documented single-bid shape                                                     | `push-x-richads-bare-array`         |
| DEF-170 | medium   | Pop-response plugin rejects a spec-complete nurl-only bid that Core's own baseline rule already accepts                                                   | `pop-x-nurl-only-response`          |
| DEF-180 | medium   | Widget/zone carrier lacks in-page vendor-format identification and preview identity                                                                       | `inpage-x-widget-openrtb-canonical` |
| DEF-181 | medium   | The clickurl feed alias, recognized by format-detect.js, is missing from detect.js's single-object classifier and rules-feed.js's push-material validator | `inpage-x-card-feed-single`         |

### DEF-130 — InLine VAST document containing only NonLinearAds (no Linear creative) is flagged vast.mediafile_missing

Classification: false-positive. Severity: medium.

This VAST 4.2 fixture contains a NonLinear creative delivered through StaticResource. The IAB schema permits NonLinearAds without a Linear child; MediaFiles belongs to the Linear branch, so the absence of a linear MediaFile does not invalidate this creative.

Reproduce: `video-x-web-42-nonlinear-overlay`. Affected code: `packages/core/rules-vast.js:133-136`.

Observed: The exact reviewed deviations are pinned separately for each case and layer; successful or unrelated findings are not admitted as gaps.

References: [IAB VAST schema, Creative alternatives](https://github.com/InteractiveAdvertisingBureau/VAST/blob/e0858cd714474bf17ef61065097456d7643ff838/vast_4.1.xsd#L921), [IAB VAST 4.2 NonLinear sample](https://github.com/InteractiveAdvertisingBureau/VAST_Samples/blob/6a60797f3b17f6d371ebe8ee3f511e9944078073/VAST%204.2%20Samples/Inline_Non-Linear_Tag-test.xml).

### DEF-150 — Structured bid.native object is invisible to schema markup-presence and crosscheck native completeness

Classification: missing-capability. Severity: medium.

This fixture uses the nonstandard structured `bid.native` carrier already recognized by the Inspector (`public/ortbtools.app.js:4026-4034`). The requested compatibility behavior is consistent markup-presence and Native-completeness checking across product layers. OpenRTB does not define a standard `Bid.native` field; the Native specification supports the asset structure, while carrier support is a product capability boundary.

Reproduce: `native-x-structured-bid-object`. Affected code: `packages/core/rules-response.js:140`, `packages/core/crosscheck.js:443`.

Observed: The exact reviewed deviations are pinned separately for each case and layer; successful or unrelated findings are not admitted as gaps.

References: [Native 1.2 response structure](https://github.com/InteractiveAdvertisingBureau/Native-Ads/blob/dd45d0733d96710981541ea213f4452952f41c40/OpenRTB-Native-Ads-Specification-Final-1.2.md#5-1), `public/ortbtools.app.js:4026-4034`, `specs/014-push-creative-preview/`.

### DEF-151 — OpenRTB 3.0 structured AdCOM native is rejected as missing display markup, detected as banner and omitted from native completeness

Classification: missing-capability. Severity: medium.

AdCOM places NativeFormat under `item.spec.placement.display.nativefmt` and the returned Native creative under `media.ad.display.native`. Display permits structured Native content as an alternative to markup or a markup URL. The pair should therefore validate as Native without requiring `display.adm` or `display.curl`. Native asset-completeness checking and preview are the requested product capabilities; the specification does not prescribe a particular validator finding ID.

Reproduce: `native-x-ortb30-adcom-stub`. Affected code: `packages/core/rules-response-30.js:226`, `packages/core/format-detect.js`, `packages/core/crosscheck.js:576`, `public/ortbtools.app.js`.

Observed on the corrected fixture: Core and HTTP emit the false error `response.30.bid.display.markup_required`, identify the Native display subtype as banner, and omit `crosscheck.bid.native_complete`. The corrected fixture was independently remeasured in Chrome: the browser still shows an empty preview, omits the expected Native identity and reproduces the validation/completeness deviations. The exact signatures and final integrated measurement are recorded in [verification.md](verification.md).

References: [DisplayPlacement](https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/df8ba06de0ba77c82efee7a2dc832bd4968474d6/AdCOM%20v1.0%20FINAL.md#object_displayplacement), [Display](https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/df8ba06de0ba77c82efee7a2dc832bd4968474d6/AdCOM%20v1.0%20FINAL.md#object_display), [NativeFormat](https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/df8ba06de0ba77c82efee7a2dc832bd4968474d6/AdCOM%20v1.0%20FINAL.md#object_nativeformat).

### DEF-160 — detectFeedFormat ignores the image_url/icon_url push-material aliases validatePushMaterial accepts

Classification: format-detection. Severity: medium.

A push material recognized and cleanly validated under its documented image_url/icon_url alias names (Kadam contract, formats-feeds map §1.1/§1.2) also receives the push format tag from detectFormat, the same way it would under the bare image/icon keys.

Reproduce: `push-x-kadam-material-single`, `push-x-numeric-string-cpc`. Affected code: `packages/core/format-detect.js:212`.

Observed: The exact reviewed deviations are pinned separately for each case and layer; successful or unrelated findings are not admitted as gaps.

Normative or vendor reference: packages/core/format-detect.js (detectFeedFormat, hasImage/hasClick predicate, line 212) vs packages/core/rules-feed.js (validatePushMaterial alias table, line 164-214).

### DEF-161 — Array dispatch forces push-material field names onto a different vendor's documented single-bid shape

Classification: false-positive. Severity: medium.

An array element whose keys match a documented single-bid vendor shape (RichAds: title/description/image/notification_url/link/bid_price, sources-vendor map §2a) is validated against that shape's own field contract, not force-fit through the push-material alias table; RichAds documents no id field at all and spells its price and win-notify fields bid_price/notification_url, neither of which validatePushMaterial's alias table recognizes.

Reproduce: `push-x-richads-bare-array`. Affected code: `packages/core/rules-feed.js:49`.

Observed: The exact reviewed deviations are pinned separately for each case and layer; successful or unrelated findings are not admitted as gaps.

Normative or vendor reference: packages/core/rules-feed.js (validateFeedResponse, unconditional Array.isArray branch, line 49-51) vs [RichAds Telegram SSP bare-array response](https://docs.richads.com/ssp/telegram-native.html).

### DEF-170 — Pop-response plugin rejects a spec-complete nurl-only bid that Core's own baseline rule already accepts

Classification: false-positive. Severity: medium.

IAB OpenRTB 2.6 §4.2.3 marks Bid.adm optional and §4.3.1 describes markup served on the win notice; a bid carrying only nurl (win notice URL) already satisfies Core's own baseline completeness rule (response.bid.payload_missing, which only warns when BOTH adm and nurl are absent). A pop-tagged bid in that exact shape should not be treated as an incomplete/broken creative just because it also carries a pop-family ext hint.

Reproduce: `pop-x-nurl-only-response`. Affected code: `packages/core/rules/pop-response/index.js:76-80`, `packages/core/rules-response.js:140`.

Observed: packages/core/rules/pop-response/index.js's admLooksLikePop check runs on bid.adm alone; an absent adm is treated as "not a redirect", producing bid.pop.adm_not_redirect (ERROR) regardless of a present, well-formed nurl. This is a stricter, internally inconsistent contract than Core's own baseline rule applied to the identical bid.

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbid).

### DEF-180 — Widget/zone carrier lacks in-page vendor-format identification and preview identity

Classification: vendor-support. Severity: medium.

OpenRTB 2.6 §3.1 requires at least one Banner, Video, Audio or Native object for each impression. These widget/zone carrier fixtures omit those objects, so `imp.format_required` at error level is an expected baseline finding, including when the response dialect selector is `iab`. The recorded support gap is the missing in-page vendor-format tag and preview identity; it does not establish that this nonstandard carrier is a valid IAB impression.

Reproduce: `inpage-x-widget-openrtb-canonical`, `inpage-x-widget-openrtb-aliases`, `inpage-x-widget-iab-contract`, `inpage-x-widget-adm-and-ext`, `inpage-x-widget-inapp`. Affected code: `packages/core/format-detect.js:220`, `public/ortbtools.app.js`.

Observed: `detectFeedFormat` recognizes widget/zone signals in JSON feeds, but the OpenRTB carrier lacks the equivalent in-page format tag; the per-case browser signatures separately record missing creative identity. The valid `imp.format_required` diagnostic is not admitted as a deviation.

Reference: [OpenRTB object model](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectmodel), `packages/core/format-detect.js` (`detectFeedFormat` widget/zone predicate).

### DEF-181 — The clickurl feed alias, recognized by format-detect.js, is missing from detect.js's single-object classifier and rules-feed.js's push-material validator

Classification: false-positive. Severity: medium.

The product's own committed in-page card feed sample (manifest id kb-jsonfeed-inpage-001) uses `clickurl`, which packages/core/format-detect.js's hasClick set already recognizes as a click-key alias (alongside clickUrl/click_url/redirectUrl/link) for FORMATS.INPAGE tagging. The same alias should be recognized consistently everywhere else a click key is checked for this shape: detect.js's single-object payload-type classifier, rules-feed.js's push-materials click role (canonical click_url, alias link), and the front-end's findPushMaterial()/isMat() card-recognition heuristic.

Reproduce: `inpage-x-card-feed-single`, `inpage-x-card-feed-array`. Affected code: `packages/core/detect.js:184`, `packages/core/rules-feed.js:164`, `public/ortbtools.app.js:3234`.

Observed: The exact reviewed deviations are pinned separately for each case and layer; successful or unrelated findings are not admitted as gaps.

Normative or vendor reference: packages/core/knowledge_base/jsonfeed/inpage/inpage-card.json.

### Browser and UI/UX — summary

| ID      | Severity | Title                                                                                                | Reproduce                                   |
| ------- | -------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| DEF-245 | low      | Script-shaped pop creatives (window.open / location redirect) render with no on-screen identity text | `pop-x-openrtb-adtype-popunder-window-open` |

### DEF-245 — Script-shaped pop creatives (window.open / location redirect) render with no on-screen identity text

Classification: preview-capability. Severity: low.

A pop adm shaped as a redirect script (window.open(...) / location.href|replace|assign(...) / top.location...) is product-recognized pop markup (packages/core/rules/pop-response/index.js's own header comment). The rendered preview correctly shows kind=markup and rendered=empty (there is no visible DOM), but the analyst has no way to see WHICH destination the script would have navigated to without reading raw JSON elsewhere.

Reproduce: `pop-x-openrtb-adtype-popunder-window-open`, `pop-x-openrtb-adtype-clickunder-location`, `pop-x-openrtb-flag-popunder-bool`, `pop-x-openrtb-shape-flag-allowshock`. Affected code: `public/modules/inspector/creative-classify.js:190-197`, `public/ortbtools.app.js:1639-1671`.

Observed: creative-classify.js routes any `<script>...</script>` body into the markup/iframe branch rather than the inert-text branch used for VAST/JSON/URL/unidentified kinds — unlike those kinds, a script-only pop creative never surfaces its destination text anywhere the browser measurement can see (setAdPreview never extracts or displays the script's target URL). The per-bid identity/marker check in the corpus browser harness therefore cannot confirm which creative was returned for any script-shaped pop adm.

Normative or vendor reference: specs/012-creative-preview-repair/contracts/creative-preview.md; public/modules/inspector/creative-classify.js.

## Mutation extension — additional deviations and support gaps

The extended corpus (additional pairs per format and mutation categories) recorded the following further deviations. Each entry mirrors the ledger record in `tests/corpus/known-gaps/<owner>.json`; signatures are pinned per case.

### Core and HTTP — summary

| ID      | Severity | Title                                                                                                                | Reproduce                                |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| DEF-190 | medium   | Duplicate SeatBid.seat entries receive no uniqueness diagnostic                                                      | `mut-identity-duplicate-seat-ids`        |
| DEF-192 | medium   | wseat/bseat buyer-seat allow/block lists are never enforced or even read                                             | `multiplicity-wseat-allows-other-seat`   |
| DEF-194 | high     | Crosscheck has no content-type check for a banner or audio impression; only video has an adm-shape check             | `mut-format-mismatch-banner-vast-adm`    |
| DEF-195 | high     | Response bid.mtype is never validated for enum range or for consistency against the offered impression's media types | `mut-format-mismatch-mtype-invalid-enum` |
| DEF-197 | low      | regs.coppa outside {0,1} produces no finding at all                                                                  | `field-shape-regs-coppa-invalid`         |
| DEF-198 | medium   | Whitespace-only Bid.adm passes the isStr() presence check and is never flagged as a blank creative                   | `encoding-adm-whitespace-only`           |

### DEF-190 — Duplicate SeatBid.seat entries receive no uniqueness diagnostic

Classification: missing-capability. Severity: medium.

OpenRTB 2.6 §4.2.2 describes the response's SeatBid objects as collections of bids on behalf of different seats. Two SeatBid entries identifying the same seat contradict that structure and should receive a diagnostic. The response validator and crosscheck do not compare the SeatBid.seat identifiers.

Reproduce: `mut-identity-duplicate-seat-ids`. Affected code: `packages/core/rules-response.js`, `packages/core/crosscheck.js`.

Observed: duplicate seat identifiers receive no finding. The exact reviewed missing-diagnostic signature is recorded per layer in the fixture.

Scope correction: `mut-identity-duplicate-bid-ids` is a positive robustness control. The Bid.id description states a logging/tracking purpose without an explicit uniqueness scope, so a duplicate-bid-ID diagnostic would be an optional policy proposal, not an active DEF-190 assertion.

References: [SeatBid](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectseatbid), [Bid](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbid).

### DEF-192 — wseat/bseat buyer-seat allow/block lists are never enforced or even read

Classification: commercial-contradiction. Severity: medium.

BidRequest.wseat ("Array of names for allowed buyer seats") and BidRequest.bseat ("Block list of buyer seats… restricted from bidding") are request-side auction-integrity fields. A responding seatbid.seat outside an explicit wseat allow-list, or present in bseat, is a request/response consistency violation an auditor should surface.

Reproduce: `multiplicity-wseat-allows-other-seat`, `multiplicity-bseat-blocks-responding-seat`. Affected code: `packages/core/crosscheck.js`, `packages/core/unknown-fields.js`.

Observed: grep across packages/core/ confirms crosscheck.js never reads seatbid.seat, wseat or bseat under any name; wseat/bseat are recognized only as allowlisted field names (so no unknown-field note fires either) with zero semantic enforcement. A seat entirely outside wseat, or explicitly blocked by bseat, produces byte-identical crosscheck output to a fully authorized seat. Reviewed directly against current HEAD (commit a61fc25) via packages/core, not inferred from prior audits.

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbidrequest).

### DEF-194 — Crosscheck has no content-type check for a banner or audio impression; only video has an adm-shape check

Classification: format-negotiation. Severity: high.

A bid answering a banner-only or audio-only impression is expected to deliver content that actually renders as that media type. crosscheck.js already performs this check for video (isVastShape gates crosscheck.bid.video_vast/video_not_vast); the equivalent check does not exist for banner or audio.

Reproduce: `mut-format-mismatch-banner-vast-adm`, `mut-format-mismatch-audio-video-mediafile`. Affected code: `packages/core/crosscheck.js:412-440`, `packages/core/rules-vast.js:311-345`.

Observed: The exact reviewed deviations are pinned separately for each case and layer; successful or unrelated findings are not admitted as gaps.

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbanner).

### DEF-195 — Response bid.mtype is never validated for enum range or for consistency against the offered impression's media types

Classification: false-negative. Severity: high.

OpenRTB 2.6 §4.2.3 defines Bid.mtype values as 1=Banner, 2=Video, 3=Audio, 4=Native. A value outside that range should be flagged, and a value inside the range that contradicts the offered impression's declared media objects (e.g. mtype=2 on an impression with no imp.video) should be flagged by crosscheck.

Reproduce: `mut-format-mismatch-mtype-invalid-enum`, `mut-format-mismatch-mtype-video-banner-only`. Affected code: `packages/core/rules-response.js`, `packages/core/format-detect.js:69-75,314`, `packages/core/crosscheck.js`.

Observed: The exact reviewed deviations are pinned separately for each case and layer; successful or unrelated findings are not admitted as gaps.

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbid).

### DEF-197 — regs.coppa outside {0,1} produces no finding at all

Classification: missing-capability. Severity: low.

OpenRTB 2.6 §3.2.3 types Regs.coppa as an integer flag limited to 0 or 1 ("Flag indicating if this request is subject to the COPPA regulations"). A value outside that pair (e.g. 2) is not a value the field can hold and should be reported.

Reproduce: `field-shape-regs-coppa-invalid`. Affected code: `packages/core/rules-request.js:242`.

Observed: rules-request.js only inspects regs.coppa inside `if (req.regs && req.regs.coppa === 1)`, to cross-check PII fields when the flag is set. Any other value, valid or not, takes neither branch and produces no finding.

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectregs).

### DEF-198 — Whitespace-only Bid.adm passes the isStr() presence check and is never flagged as a blank creative

Classification: false-negative. Severity: medium.

Bid.adm is documented as carrying the actual ad markup for the impression; a string containing only whitespace carries none of it and should be distinguishable from a real creative.

Reproduce: `encoding-adm-whitespace-only`. Affected code: `packages/core/helpers.js:9`, `packages/core/rules-response.js:140`.

Observed: The exact reviewed deviations are pinned separately for each case and layer; successful or unrelated findings are not admitted as gaps.

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbid).

### Other — summary

| ID      | Severity | Title                                                                                                                               | Reproduce                              |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| DEF-300 | high     | POST /api/analyze silently drops a non-object, non-array response body instead of reporting it as invalid                           | `mut-input-shape-number-root-response` |
| DEF-301 | low      | A no-bid reason code outside both the canonical 0-17 list and the reserved 500+ exchange range is not distinguished from a real one | `mut-input-shape-nbr-unassigned-code`  |
| DEF-302 | medium   | Request without site or app is rejected although OpenRTB marks both as recommended                                                  | `field-shape-no-site-or-app`           |
| DEF-303 | medium   | Oversized analyze body resets the connection instead of returning the documented 400 payload_too_large                              | `encoding-request-body-oversized`      |

### DEF-300 — POST /api/analyze silently drops a non-object, non-array response body instead of reporting it as invalid

Classification: http-shape. Severity: high.

Core's own validate() correctly rejects a bare JSON scalar (e.g. a number) as a BidResponse root with payload.invalid_root, status:invalid. The HTTP contract exposed by POST /api/analyze should surface the same rejection when a caller submits such a value as bidRes.

Reproduce: `mut-input-shape-number-root-response`. Affected code: `modules/analyze/handler.js:172`, `packages/core/index.js`.

Observed: Submitting a numeric `bidRes` alongside a valid request returns HTTP 200 with a clean request-only analysis and no crosscheck. The supplied response is treated as absent instead of validated and rejected. Root cause: modules/analyze/handler.js:172 computes `hasRes = bidRes && typeof bidRes === 'object' && Object.keys(bidRes).length > 0`, which is false for a numeric bidRes, so validate(bidRes) is never even called for that side.

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbidresponse).

### DEF-301 — A no-bid reason code outside both the canonical 0-17 list and the reserved 500+ exchange range is not distinguished from a real one

Classification: media-constraint. Severity: low.

The cited No-Bid Reason Codes table defines codes 0–17 and reserves 500+ for exchange-specific values. A code outside both groups should receive a diagnostic distinguishing it from a recognized code; the exchange-specific positive control must remain accepted.

Reproduce: `mut-input-shape-nbr-unassigned-code`. Affected code: `packages/core/rules-response.js`.

Observed: The exact reviewed deviations are pinned separately for each case and layer in knownGap.matches; response.no_bid fires identically for every numeric nbr value regardless of whether it falls in the canonical range, the reserved exchange range, or neither.

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb/blob/9af34fc79580f67f6abaf89b1e48d18398c9a697/OpenRTB%20v3.0%20FINAL.md#list_nobidreasoncodes).

### DEF-302 — Request without site or app is rejected although OpenRTB marks both as recommended

Classification: false-positive. Severity: medium.

OpenRTB 2.5/2.6 §3.2.1 lists site and app as recommended; a request carrying neither remains valid and may receive guidance, not an error.

Reproduce: `field-shape-no-site-or-app`. Affected code: `packages/core/rules-request.js`.

Observed: Core emits request.no_site_or_app at ERROR and the request status becomes errors.

Normative or vendor reference: [source](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectbidrequest).

### DEF-303 — Oversized analyze body resets the connection instead of returning the documented 400 payload_too_large

Classification: http-shape. Severity: medium.

A body over the 2 MiB cap receives HTTP 400 with code payload_too_large in the documented error envelope.

Reproduce: `encoding-request-body-oversized`. Affected code: `lib/http.js:40-52`.

Observed: The connection is reset before a final HTTP status or error envelope is received. The reviewed curl run received an interim 100 Continue before exiting 56; node/undici reported ECONNRESET / fetch failed. `readJson()` rejects the body and immediately destroys the request (`lib/http.js:48-51`), preventing the handler from delivering its structured error response.

Product contract: [HTTP API errors](../../docs/api-v1.md) (`POST /api/analyze`: HTTP 400 `payload_too_large` above the 2 MiB parser limit).

## Retired review claims

- **DEF-193 (retired)**: `SeatBid.group=1` applies to the bids in that seat's group; it does not require bidding on every impression offered by the request. The partial-group case is a positive control. See [SeatBid](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md#objectseatbid).
- **DEF-196 (retired)**: Native 1.2 §4.1 explicitly describes exchange compatibility with a direct JSON object. `field-shape-native-request-object` is a positive compatibility case; the product has no separate strict wire-type profile. An optional diagnostic for a future strict profile would be a proposal, not this audit's product defect. The former Native 1.2 “§3.2.9” reference was incorrect. See [Native request structure](https://github.com/InteractiveAdvertisingBureau/Native-Ads/blob/dd45d0733d96710981541ea213f4452952f41c40/OpenRTB-Native-Ads-Specification-Final-1.2.md#4-1).
- **DEF-199 (merged into DEF-303)**: both IDs described the same oversized-body transport failure and the same `encoding-request-body-oversized` case. Only DEF-303 is active.

## Resolutions

Product fixes are recorded here by pointer only; the audit text above is left as written.

- **DEF-100, DEF-103, DEF-302 (resolved 2026-09-08 by [021](../021-recommended-fields-guidance/spec.md), ADR-016, Core 0.39.0)**: the 2.x and 3.0 request rules now treat the distribution channel and the Device object as recommended (warning) and `ip`/`ua` as optional guidance (warning on site/app, info on DOOH-only). Their omission errors are resolved; the ledger records are removed. The CTV dynamic-pod case retains its independent browser selection gap DEF-201. The device lines were also removed from the recorded signatures of seven DEF-101 cases and one DEF-151 case, whose remaining deviations are unchanged.
- **DEF-114 (resolved 2026-09-08 by 021)**: an empty `seatbid` array without `nbr` is an info-level no-bid on both protocol lines, and crosscheck keeps only the id check for it. Its case passes normatively; the record is removed.
- **DEF-110, DEF-104, DEF-105 (resolved 2026-09-08 by [022](../022-crosscheck-price-floor/spec.md), Core 0.41.0)**: crosscheck no longer coerces `bid.price`, so a non-number or negative price receives `price_invalid` and no floor verdict; a matched PMP deal's own `bidfloor` governs its bid through the resolver both engines now share; and the OpenRTB 3.0 path reads `item.flrcur` and receives the paired request's accepted-currency list, so a permitted currency is no longer a mismatch. Their nine cases pass normatively and the three ledger records are removed. No finding id, level or message changed.
- **DEF-115 (resolved 2026-09-08)**: `packages/core/categories.js` now guards every category-walk level with `Array.isArray` (`imp`, `seatbid`, and each seat's `bid`), so a syntactically valid payload carrying a non-array `bid`/`seatbid` no longer throws a `forEach` `TypeError` inside the HTTP handler's category decode. `POST /api/analyze` keeps its 200 success envelope and structured findings for `shape-bid-object` and `shape-seatbid-object`; both cases pass at HTTP (and, transitively, in the browser). The ledger records are removed.
- **DEF-204 (resolved 2026-09-08)**: the Inspector's winning-bid selection in `public/ortbtools.app.js` now resolves `seatbid`/`bid` with `Array.isArray` guards and defaults a null/undefined/non-object first bid to `{}`, so a malformed first bid (`shape-bid-null`, `shape-bid-object`, an empty first `bid[]` in `multiplicity-empty-bid-array`) reaches structured validation instead of throwing `Cannot read properties of … (reading 'cur')` before the Analyze POST. All three cases pass at the browser layer. The ledger records are removed.
- **DEF-300 (resolved 2026-09-08)**: `modules/analyze/handler.js` now treats a present scalar `bidRes` (e.g. a bare `42`) as a submitted response, so `validate()` rejects it with `payload.invalid_root` and `crosscheck` reports `crosscheck.no_response`, matching Core's own direct behaviour. `mut-input-shape-number-root-response` passes at HTTP. The HTTP corpus harness was extended to represent a scalar response side (a merged envelope cannot express a per-side `invalid` root status, which stays asserted at the Core layer). The ledger record is removed.
- **DEF-303 (resolved 2026-09-08)**: `lib/http.js#readJson` no longer destroys the socket when the 2 MiB cap is exceeded; it rejects with `payload_too_large` and drains without buffering, so the handler delivers the documented `400 payload_too_large` error envelope instead of an `ECONNRESET`. `encoding-request-body-oversized` passes at HTTP. The ledger record is removed.

- **DEF-101, DEF-102, DEF-112 (resolved in the audio corpus 2026-09-08 by [023](../023-audio-repair/spec.md), Core 0.42.0; final repair verification tracked there)**: audio MediaFiles are permitted in VAST rules (`audio/*` in `VALID_MF_TYPES`); audio VAST creatives are identified as audio instead of video in `format-detect.js` (DEF-101 on 14 cases); missing `imp.audio.mimes` produces required error `imp.audio.mimes_required` (DEF-112 on 1 case); DAAST protocols 9 and 10 are detected from audio requests and `isDaastShape` classifies DAAST XML as an inert document in preview (DEF-102 on 2 cases). 16 of the 17 cases now pass fully normatively across Core, HTTP and Browser, while audio multi-imp (audio-web-26-multi-imp-reversed) retains only its independent browser selection gap DEF-201; the three ledger records are removed.

The 021 review follow-up preserves the original 256-case expectations. Across the 29 affected cases, 20 are fully normative, one retains only browser DEF-201, and eight retain their other recorded deviations. Core 0.40.0 adds malformed supplied-value errors separately from omission guidance; the original measured 020 reports remain historical evidence for their recorded revision.
