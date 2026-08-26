# Public-Boundary Contract: Push Single-Object Recognition

The Core public API (`validate()`, `detectType()`, `detectFormat()`) is a deterministic
data-to-data contract (Constitution IV). This file records exactly what this feature changes
at that boundary and the compatibility decision for each change.

## What changes

1. **`detectType()` / `validate().type`** — a single object matching the push-material
   signature (price key + click key + creative key; see [data-model.md](../data-model.md))
   is classified `Vendor Feed Response` instead of `unknown`, and `validate()` resolves the
   feed type to the **new additive result-type string** `Push-Materials Feed Response
(single)` (mirrors the existing `Link-Feed Response (single)` convention).
   _Compatibility decision_: additive. Payloads previously classified as anything other than
   `unknown` are untouched (the new branch is evaluated last); only a subset of previously
   `unknown` payloads moves. Consumers switching on result-type strings see a new value only
   for payloads that previously produced the unknown-type error path.

2. **`payload.unknown_type`** — fires on strictly fewer payloads (the moved subset). ID,
   severity (ERROR), message text, and behavior for genuinely unknown payloads: unchanged.

3. **`feed.push.id_required`** — no longer fires when the material carries a string `tId`
   (either shape). ID, severity, text: unchanged.
   **`feed.push.image_url_recommended`** — no longer fires when the material carries a
   string `image`. **`feed.push.nurl_recommended`** — no longer fires when the material
   carries a string `icon`.
   _Compatibility decision_: these are corrections of false positives on the mainstream
   shape (owner ruling 2026-08-26); a finding that stops firing on valid input is the
   intended fix, not a silent contract change — this file is the explicit decision, and
   boundary tests pin the new behavior in both shapes.

4. **`detectFormat()`** — the `push` tag additionally fires (a) for array items whose click
   key is `link`, and (b) for a plain non-oRTB object matching the same
   click+image+title bar that array items use today.
   _Compatibility decision_: additive tags only; no existing tag is removed or reordered.

## What must NOT change (regression-pinned)

- Classification of: oRTB 2.x/3.0 requests and responses, URL requests, clickunder and
  link-feed wrappers, JSON Feed 1.1, value-feed / bid-price / bid-redirect single objects
  (their unique keys keep precedence over the push signature — a bid-price object carrying
  `link` + `title` stays a bid-price feed), and array-form feeds.
- Generic JSON objects below the three-group signature bar stay `unknown` (e.g. an object
  with only `link`, or `title` + `link` without a price key).
- The `feed.push.*` finding set: no IDs added or removed; `cpc`/`price` type-tier behavior
  (`bid_string_type` / `bid_not_numeric` / `bid_required`) identical in both shapes.
- Single-vs-array parity: one material analyzed alone produces the same findings (modulo
  path prefix and the `(single)` type suffix) as the same material as a one-element array.
- Message catalogs (en/ru/uk): byte-identical — no keys added, removed, or reworded.
- Finding order and deduplication semantics.

## Versioning

Core public behavior changes additively → Core SemVer **minor** bump in the same change,
per the independent-versioning rule (Constitution VIII, ADR-008).
