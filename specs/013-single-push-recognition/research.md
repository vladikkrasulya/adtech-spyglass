# Phase 0 Research: Single-Object Push Response Recognition

**Date**: 2026-08-26. No NEEDS CLARIFICATION markers existed in the Technical Context; this
file records the technical decisions and the code evidence they rest on. All line references
are to the working tree at the time of writing.

## R1. Where the defect lives (evidence)

- `packages/core/detect.js` — `detectType()`: arrays are claimed as feeds
  (`Array.isArray(obj) → VENDOR_FEED`), but a single object reaches
  `looksLikeJsonFeedSingle()`, which recognizes only four unique keys (`clickUrl`,
  `notification_url`, `bid_price`, `redirecturl`). A push material's keys (`title`, `icon`,
  `image`, `link`, `cpc`, …) match none of them → `UNKNOWN`.
- `packages/core/index.js:414-435` — `VENDOR_FEED` dispatches to `validateFeedResponse()`;
  `UNKNOWN` produces the blocking `payload.unknown_type` ERROR the owner saw.
- Reproduced 2026-08-26 with the live module: reported object → `unknown`; `[object]` →
  `Vendor Feed Response`.
- Even in array form the material draws false findings today:
  `rules-feed.js` `validatePushMaterialsFeed()` requires `id` (`tId` not accepted → ERROR),
  `image_url` (`image` not accepted → WARNING), `icon_url|nurl` (`icon` not accepted →
  WARNING). `click_url|link` and `cpc|price` are already alias-tolerant.

## R2. Detection signature (Decision)

**Decision**: extend `looksLikeJsonFeedSingle()` with one additional predicate, evaluated
after the four existing unique-key checks:

> price key (`cpc` | `price`) AND click key (`click_url` | `link`) AND at least one creative
> key (`title` | `description` | `image` | `image_url` | `icon` | `icon_url`).

Presence-based (`'key' in o`), like every existing predicate in that function.

**Rationale**:

- Any single key here is too generic to claim (`link` alone is the documented reason the
  function refused this shape); the three-way co-occurrence is the smallest combination that
  is unmistakably "a priced, clickable creative" — i.e. a bid.
- Placing it inside `looksLikeJsonFeedSingle()` keeps the one existing seam in `detectType()`
  (called after 3.0-envelope, `imp[]`, `seatbid[]`, `result`-wrapper, and JSON Feed 1.1
  branches), so every structural precedence stays exactly as it is.
- Presence-based checks keep detection and validation separated: detection answers "which
  rule set runs", the rule set then reports wrong types with the format's own messages
  (`feed.push.bid_not_numeric` etc.).

**Alternatives considered**:

- _Require `tId` or `linkTtl` as a marker_: rejected — the owner's ruling is that this shape
  is the mainstream response, not a vendor fingerprint; keying on one vendor's id spelling
  would re-create the dialect framing the owner rejected.
- _Type-checked values in the signature_ (e.g. `cpc` must be a number): rejected — a push
  response with `cpc: "0.03"` must be _recognized_ and then told its cpc is a string by the
  existing `feed.push.bid_string_type` rule, not bounced back to `unknown`.
- _Claiming in `detectType()` before the `result`-wrapper / JSON Feed 1.1 branches_:
  rejected — FR-002 requires existing classifications to keep precedence.

## R3. Validator reuse, not duplication (Decision)

**Decision**: extract the per-material body of `validatePushMaterialsFeed()` into a shared
helper parameterized by path prefix and material number; the array path calls it per element
(`[i]` prefix, `num = i+1`), the new single-object path calls it once (root-relative paths,
`num = 1`). Route to it from `detectSingleBidShape()` via a new `'push'` result, checked
**after** the value-feed / bid-price / bid-redirect unique keys.

**Rationale**:

- FR-004 requires finding parity between the two shapes; one shared body makes parity true
  by construction rather than by test discipline.
- Ordering after the unique-key vendors preserves their classification (a bid-price response
  carries `link` and often `title`; its `bid_price`/`notification_url` must keep winning) —
  this is the Edge-Case precedence rule in the spec.
- Root-relative paths for the single form follow the existing convention
  (`validateLinkFeed` emits `Link-Feed Response (single)` with the same pattern), and
  `finding-location.js` already resolves both prefix styles.

**Result type string**: `Push-Materials Feed Response (single)` — additive, mirroring the
existing `(single)` convention. Recorded as a compatibility decision in the contract.

## R4. Alias acceptance set (Decision)

**Decision**: exactly the pairs the spec fixes, applied identically in both shapes:

| Logical field       | Canonical          | Alias   | Current behavior              | New behavior               |
| ------------------- | ------------------ | ------- | ----------------------------- | -------------------------- |
| Material identifier | `id`               | `tId`   | ERROR when `id` absent        | either satisfies           |
| Click destination   | `click_url`        | `link`  | already alias-tolerant        | unchanged                  |
| Price               | `cpc`              | `price` | already alias-tolerant        | unchanged                  |
| Large image         | `image_url`        | `image` | WARNING when canonical absent | either satisfies           |
| Icon / win-notify   | `icon_url`, `nurl` | `icon`  | WARNING when both absent      | any of the three satisfies |

`linkTtl` needs no code: feeds do not run the unknown-fields registry (that pass is
oRTB-only), so it draws no noise today — FR-008 is enforced by a test asserting no finding
references it, not by new code.

**Rationale**: the alias set is exactly what the mainstream shape demonstrably uses; the spec
forbids speculative aliases until observed. String-type checks (`isStr`) stay as they are —
an alias present with a non-string value keeps producing the existing finding, same as the
canonical key does today.

**Alternatives considered**: a general alias-mapping table for all feed formats — rejected as
a parallel abstraction (Constitution V) serving one consumer.

## R5. Format tagging (Decision)

**Decision**: two minimal edits in `format-detect.js`:

1. `detectFeedFormat()`: `link` joins the click-key set (`hasClick`).
2. `detectFormat()`: a plain object that reaches the end of the object branch having matched
   none of the oRTB/URL-request paths (no `imp[]`, no `seatbid[]`, no 3.0 envelope, not a
   canonical URL request) is passed through `detectFeedFormat()` — the same call array items
   already get.

**Rationale**: the tagging bar stays `hasClick && hasImage && hasTitle` — strictly narrower
than the new detection signature, so tagging can only fire on payloads detection already
claims or on array items already claimed structurally. The reported shape (title + image +
icon + link) clears it. Bid-price single objects (no title/image) stay untagged, unchanged.
Existing inpage discrimination (`ext.widget_id` etc.) is untouched.

**Alternatives considered**: unifying `detectFeedFormat`'s signature with the new
`detect.js` predicate — rejected: the two answer different questions (claim vs. tag), and
the audit-hardened comments in each file document deliberately different bars.

## R6. Messages and locales (Decision)

**Decision**: zero message changes. The single-object path reuses `feed.push.*` with
`num = 1`; `payload.unknown_type` keeps its text (its enumeration "vendor push array,
clickunder wrapper, or single-bid object" already names the single-bid object it now
actually accepts); result-type strings are not localized.

**Rationale**: Constitution VI makes any wording change a three-locale contract change;
nothing here requires one. `tests/i18n-audit.test.js` keeps enforcing parity.

## R7. Severity/catalog registration (Evidence, no decision needed)

`severity-registry.js` scans `makeFinding(id, LEVEL, …)` call sites at first use — no manual
registration exists to update. Reusing existing IDs means the catalog is already correct.

## R8. Test placement (Decision)

**Decision**: extend the two suites that already own these behaviors —
`tests/detection-mechanism.test.js` for the `detectType()` matrix (new claim, precedence
non-claims, generic-JSON non-claims) and `tests/validator.test.js` for rule behavior through
the public `validate()` boundary (alias matrix per pair, single-vs-array finding parity,
synthetic replica end-to-end, format tags). No new test file.

**Rationale**: Constitution VII wants boundary tests where the contract lives; both files
already carry the neighboring cases (`feed.push.bid_*` matrix at `validator.test.js:1099+`).

**Synthetic replica**: same ten keys and value shapes as the report, synthetic values
(example.com hosts, zeroed ids); the production record itself is never committed (III/VII).
