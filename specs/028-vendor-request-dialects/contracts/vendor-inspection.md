# Contract: Vendor request dialects and Core recognition

**Release target**: Core 0.46.0; CLI 0.1.3 with Core range `^0.46.0`; app version unchanged.

This describes the implemented 028 behavior. Delivery outcomes and remaining preview work are recorded in verification.md.

## Public compatibility

Core remains deterministic data-to-data with no network calls. Existing result shapes, types, finding IDs, order/deduplication and CLI exit-code policy remain compatible. Vendor type additions and optional canonical contract metadata are additive. New IDs must be literal public strings with inline severity, en/uk/ru and `spec-refs.json` provenance; the implementation inventory must record their exact keys before delivery. Unknown and malformed generic inputs do not gain a blanket exception.

## Documented URL families

| Family            | Bounded signature                                                                          | Projection and format contract                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EXADS             | HTTP(S), `/rtb.php`, documented EXADS field family; host independent                       | `ip`, `language`, `ua`, `url`, `user_id`; explicit type supplies banner/push/inpage/pops; JSON required fields retain their documented meaning           |
| PPCmate           | HTTP(S), root path, `pubid`, `ip`, `useragent`, `domain`; optional feedid                  | `useragent` to UA, `lang` to language, `user_id` to user; subscription timestamp and impression number supply subtype evidence; JSON/XML format does not |
| Kadam             | HTTP(S), `/feed`, `sid`, `ua`, `uid`, `pid`, and ip or ipv6; skey not universally required | Both supplied address families preserved, language and page retained; native/teaser to Native, cu/pops to pops; hidden inpage provisioning not inferred  |
| Provisional Adon3 | HTTP(S), `/v1/feed/` plus one segment, documented lowercase ip/ua query names              | Provisional-unsupported metadata and unconditional warning; preserve opaque key and decimal strings; no subtype inference from key contents              |

New decoders reuse existing `_canonical`, `_raw-query`, `_signature` and repair contracts. Keep first-match registry precedence, first duplicate query value, literal macros, original encoded values and decode-damage warnings. Unsupported schemes, userinfo, fragments, irrelevant path/key combinations and malformed inputs remain bounded negative controls. Family recognition and invalid supplied values are separate judgments.

## EXADS JSON and proprietary crosscheck

Request recognition uses field presence across documented identity/type/export fields, not validity tests that make a malformed attempted request disappear. Any own `imp`, `seatbid` or `openrtb` carrier marker preserves IAB routing precedence. Required request strings and banner size are checked separately from optional supplied values.

Outer bid recognition requires vendor-specific anchors plus identity/value evidence. A generic `bid` key, `{bid:null}` or empty body is insufficient to establish the vendor or an HTTP 204 no-bid. Direct vendor validators handle malformed bid objects finitely. Response value is a strict finite non-negative numeric value without JSON string coercion. btype is the documented CPM/CPC enum; its default is semantic, not a mutation. Currency is absent account context, not an invented USD field. Missing undocumented response requirements do not create invented hard errors.

Banner/inpage image and click, icon-only push and pop landing roles remain distinct. `nUrl` is a notice only. Source-ambiguous response shapes do not gain a guessed unique subtype. Recognized proprietary pairs bypass only inapplicable IAB commercial pairing; unknown or malformed IAB inputs retain existing diagnostics. Core and HTTP use the same owning classification rather than copied heuristics.

## Kadam Native and project inpage

Kadam material with documented `url`/`image`/`cpc` roles does not require the push carrier's `click_url`. An isolated ambiguous card need not acquire a unique Native tag; explicit Native request intent supplies the paired format. This does not convert the material into an IAB Native assets envelope.

Project inpage tags reuse the existing dialect's title/text, description, image, icon and click aliases. Widget or explicit inpage extension evidence and bid-card evidence are recognition only: `imp.format_required`, the IAB payload warning and actual media tags remain. No public selection or rendering precedence changes are implemented here. The supplemental 026 Native work recognizes nested AdCOM display Native objects while retaining actual banner alternatives and existing semantic/crosscheck findings.

## Provisional inspection

Recognized Adon3-shaped request and response always produce an explicit WARNING that support is provisional/unconfirmed. Finding text never certifies origin, vendor validity, final standard compliance or commercial coverage. Supplied malformed carrier/field values may additionally produce ERRORs. Response `price` remains its original decimal string; no float or currency conversion occurs. All three references remain documented-reference provenance and excluded from vendor-valid example counts. Generic unknown inputs retain their existing errors.

## Preservation and closure

- Preserve the complete 256-case materialized corpus inputs and every unrelated expectation/signature. Keep the shared oracle unchanged.
- Only explicit owner approval may permit the two named Kadam inpage format assertion corrections; preserve their other assertions and record the source rationale and exact diff.
- Do not change the four DEF-180 preview kind/rendered assertions, exact title identity, assets or IAB checks; Opus owns that correction.
- Remove only proven Core/HTTP signature lines. Retain each unresolved browser signature. Remove a repaired Core-derived browser signature only when a current browser observation proves it disappeared; retire the individual case only when every browser expectation passes.
- Preserve 022 price/floor/currency ownership and strictness, 023 bounded XML behavior and 026 malformed/optional Native/media behavior.
- Retain transient processing, authentication, sealed sandbox, inert navigation and existing asset-fetch controls. No runtime endpoint requests or payload persistence are introduced.

## Required evidence

Public Core/HTTP positive and negative probes; full 256-case before/after comparison; applicable browser observations with isolated Chrome before push; additive finding locale/reference tests; version/lock and package checks; managed SpecKit/governance checks; green `npm run ci`; exact pushed revision and green hosted CI. These are delivery gates, not assertions of work already run.

## Additive finding inventory

All keys below have en/uk/ru messages and an owning source reference. Levels are literal at the call site.

| ID                                       | Level   | Parameters      |
| ---------------------------------------- | ------- | --------------- |
| `feed.adon3.ads_invalid`                 | ERROR   | none            |
| `feed.adon3.field_invalid`               | ERROR   | field           |
| `feed.adon3.price_invalid`               | ERROR   | none            |
| `feed.adon3.provisional_contract`        | WARNING | vendor          |
| `feed.exads.bid_invalid`                 | ERROR   | none            |
| `feed.exads.btype_invalid`               | ERROR   | none            |
| `feed.exads.field_invalid`               | ERROR   | field           |
| `feed.exads.field_missing`               | WARNING | field           |
| `feed.exads.landing_missing`             | WARNING | none            |
| `feed.exads.value_invalid`               | ERROR   | none            |
| `feed.native.field_invalid`              | ERROR   | field           |
| `feed.native.field_missing`              | WARNING | field           |
| `feed.native.price_invalid`              | ERROR   | none            |
| `request.exads.export_invalid`           | ERROR   | none            |
| `request.exads.field_invalid`            | ERROR   | field           |
| `request.exads.field_required`           | ERROR   | field           |
| `request.exads.sub_nonstandard`          | WARNING | none            |
| `request.exads.type_unsupported`         | WARNING | none            |
| `request.url.format_ambiguous`           | WARNING | none            |
| `request.url.parameter_invalid`          | ERROR   | param           |
| `request.url.provisional_contract`       | WARNING | vendor, version |
| `request.url.required_parameter_missing` | ERROR   | param           |

Native material recognition excludes all own IAB carrier markers and existing single-feed discriminators. A generic zone_id alone is not evidence of inpage inventory.
