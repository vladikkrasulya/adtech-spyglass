# Research: Vendor request dialects and Core recognition

**Date**: 2026-09-08. Research preceded runtime implementation and used the materialized 256-case corpus at the eventual PR #83 landing revision. Source snapshots, hashes and raw observations remain in the operator's research store; this tracked summary contains no private paths or payload bodies.

## EXADS: proprietary traffic, not an OpenRTB projection

The [request contract](https://docs.exads.com/docs/rtb-publishers/exads-rtb/bid-request/exads-rtb-publishers-request/) documents JSON POST and GET with required string fields `id`, `ip`, `language`, `type`, `ua`, `url`, `user_id`, `export`; banner requires `size`. Dedicated examples establish `in_page_push_notification` despite its omission from the general enum table. Configurable-host GET examples use `/rtb.php`. Missing pasted headers cannot be treated as missing required payload fields.

The [response contract](https://docs.exads.com/docs/rtb-publishers/exads-rtb/bid-response/exads-rtb-publishers-response/) uses one outer `bid`. Banner/inpage use `imgUrl` with `clickUrl`, push may use only `iconUrl` with `clickUrl`, and popunder uses `url`. `nUrl` is a notice, not a destination. `btype` is CPM/CPC with a documented default; the raw wire remains unchanged. No-bid is HTTP 204, which cannot be inferred from an arbitrary empty JSON body.

The [integration contract](https://docs.exads.com/docs/rtb-publishers/exads-rtb/exads-rtb-publishers/) places currency in account configuration. Do not invent USD or compare proprietary CPC with OpenRTB floors. The response table has no per-field required markers; therefore omitted fields are not automatically hard errors. Conflicting `sub` length examples justify conservative guidance instead of a hard length constraint.

Decision: one Core owner for recognition/validation/roles, thin GET projection, original paths, conservative standalone format evidence and narrowly scoped crosscheck exclusion. Reject generic JSON or malformed IAB carrier capture. The banner case retains a separate empty-preview failure.

## PPCmate and Kadam: source-bound URL families

PPCmate's [push endpoint](https://kb.ppcmate.com/kb/references-and-guidelines/how-to-create-a-push-endpoint-xml-feed) and [pop endpoint](https://kb.ppcmate.com/kb/references-and-guidelines/how-to-create-a-pop-endpoint-xml-feed) share root-path requests with `pubid`, `ip`, `useragent`, `domain`; `feedid` is optional. Subscription timestamp identifies push evidence, impression number pop evidence. JSON/XML `format` selects serialization, not inventory. Ambiguous/conflicting subtype signals remain explicit. Pop materials retain title/description; the preview's missing material titles are an independent UI obligation.

Kadam's [pinned revision 7076](https://wiki.kadam.net/en/index.php?title=RTB_setting&oldid=7076) and [current integration contract](https://wiki.kadam.net/en/index.php?title=OpenRTB/Feed_Integration_SSP) support `/feed`, `sid`, `ua`, `uid`, `pid` and `ip` or `ipv6`. `skey` is not universally required. Native/teaser and cu/pops are explicit format declarations; omitted format is supported by published examples. Preserve both address families where supplied, and keep page/domain values without inventing a URL scheme. Kadam Native's `url`/`image`/`cpc` response is not an IAB Native assets document.

Decision: add narrowly registered decoders after existing decoder precedence, reuse raw-query/signature/repair helpers and preserve first-value semantics. Case sensitivity follows the source and the existing helper contract, never a case-normalized reconstruction of the wire.

## Explicit pending decision: two hidden Kadam placements

`inpage-kadam-icon-notice` and `inpage-kadam-separate-notice-alias` expect exactly inpage despite lacking a subtype signal in their request or response. Their metadata explicitly places selection outside the wire. Optional subscription-age absence, notice aliases and opaque feed keys cannot distinguish the inventory. Existing dialect options do not carry such context into format detection.

The owner is considering a source-based correction of only those two format assertions. Until explicit approval is recorded, preserve their expected values and exact residual signatures. No input rewrite, fixture-name rule, placement-context API, shared-harness edit or implied approval is part of this plan.

## Adon3: inspect a provisional carrier with an explicit warning

The live [bid endpoint](https://adon3.com/docs/xml/bid-endpoint) still labels parameters provisional; the [response formats](https://adon3.com/docs/xml/response) include decimal-string prices. No finalized primary protocol proof was found. The three cases correctly remain `documented-reference`, excluded from vendor-valid counts.

Decision: recognize a bounded provisional feed-shaped carrier for inspection and always emit a localized unsupported/provisional WARNING. Request path is exactly `/v1/feed/` plus one nonempty segment, with lowercase documented `ip`/`ua`; account/host/key strings are not origin proof. Strong response evidence is the `rid`/`cur`/`ads` envelope and documented ad roles; optional `cid` is not a signature requirement. Retain original price strings and tracking values. Recognition and format tags never certify provisioned supply or a final vendor standard. Supplied malformed fields receive errors separately from the warning.

This resolves the conflict between useful at-most-warning inspection and visible unsupported status without altering the three fixtures' normative assertions. Generic unknown inputs retain existing errors.

## Project inpage and supplemental Native recognition

DEF-180 belongs to the local `inpage-push` dialect. Reuse its owning alias resolver for card recognition; widget or explicit inpage evidence may add a format tag but cannot replace mandatory IAB media. Preserve all existing `imp.format_required` checks and the IAB control's payload warning. Actual `adm` and media alternatives keep their meaning.

Four cases—`inpage-x-widget-openrtb-canonical`, `inpage-x-widget-openrtb-aliases`, `inpage-x-widget-iab-contract`, `inpage-x-widget-inapp`—require empty preview plus a nonempty visible title. Opus owns resolving that contradiction, with payload and title identity preserved. Core work leaves those preview expectations intact.

DEF-151's five nested AdCOM Native cases inherit their semantic fix from 026. This feature supplies Core detection of `display.nativefmt` and `media.ad.display.native`, following [AdCOM](https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/df8ba06de0ba77c82efee7a2dc832bd4968474d6/AdCOM%20v1.0%20FINAL.md#object_nativeformat). The peer separately adapts selected creative extraction and preview. Recognition must preserve a genuine banner alternative and must not reimplement Native asset validation.

## Evidence standard for closure

Whole records are not the unit of Core-only delivery. Remove exact proven Core/HTTP lines; retain browser evidence until the peer implementation or a current all-layer run satisfies every assertion. Independent tails include the EXADS banner, PPCmate pop title identity, both Kadam Native cards, the inpage contradictions and AdCOM preview. All 256 inputs, unrelated assertions and unrelated signatures remain the impact boundary.

Independent review narrowed two carrier heuristics before delivery: Native material recognition reuses the existing single-feed discriminator and rejects own IAB markers; generic zone_id metadata alone never establishes inpage. Public negative probes preserve the previous malformed-input verdicts.
