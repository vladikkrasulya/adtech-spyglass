# Data Model: Vendor inspection

## Original input

The original JSON object or URL remains authoritative and is never rewritten into an OpenRTB envelope. Opaque IDs, keys, notice URLs and decimal-string prices retain their original values. This feature creates no persisted entity.

## Canonical URL request

Use the existing object containing `variant`, `method: GET`, `endpoint`, `url`, `device`, `site`, `user`, `_raw`, `warnings` and `meta.detectedVariant`. `format` is present only when the decoder has defensible subtype evidence. `_raw` contains the first original encoded query value; shared repair metadata describes any transport repair. Device address families and supplied context are retained without constructing missing schemes or identifiers.

Adon3-shaped requests add `meta.contractStatus: provisional-unsupported`. That status always produces a visible public WARNING; it is independent of successful parsing and does not replace invalid-field findings.

## Vendor carrier evidence

EXADS JSON uses its documented request field family or an anchored outer `bid`. Adon3 uses the provisional path/query or `rid`/`cur`/`ads` family. Presence establishes an attempted carrier; independent validation determines validity. IAB structural markers retain precedence, even when their values are malformed. A notice URL alone does not establish a creative.

## Findings and classification

Existing finding objects retain `id`, `level`, `path`, parameters and source-reference behavior. New IDs are additive public keys with literal severity and synchronized en/uk/ru messages. Original JSON/query paths identify errors. Added type/contract metadata describes recognized inspection; no finding says a provisional vendor contract is certified.

## Format evidence

Request subtype declarations, source-supported query roles, inpage widget/card roles and nested AdCOM Native structures contribute to the existing formats/contexts/protocols/tags output. Confidence reports observable detection, not inferred external provisioning. Existing real media alternatives are retained; an enclosing display object alone is insufficient banner evidence when it carries only Native.

## Layer evidence

A materialized case contains unchanged request/response values and normative expectations, plus exact admitted deviations per Core/HTTP/browser layer. Removing a layer signature does not imply removing the case's record. A whole-case transition to normative requires all applicable layers to pass. The two Kadam format assertions have a separate explicit decision gate; DEF-180 preview expectations remain peer-owned.
