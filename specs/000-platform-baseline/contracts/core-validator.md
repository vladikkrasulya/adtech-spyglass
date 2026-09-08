# Contract: Core Validator and CLI

**Owner**: `packages/core/` and `packages/cli/`
**Current versions**: Core `0.46.0`; CLI `0.1.3`

## Public Core Surface

The root CommonJS module exports:

- `validate`, `crosscheck`, and `mirror`;
- `detectType`, `detectVersion`, and `detectFormat`;
- `listDialects` and `listLocales`;
- `decodeCategory`, `decodeCategories`, and `extractAllCategories`;
- `rollupStatus` and `nativeAssetCrosscheck`; and
- the public type, version, format, context, protocol, and finding-level constants.

Specialized CommonJS subpaths provide behavior analysis, Intel/discovery helpers, and the Node-only
knowledge-base loader. There is no package `exports` map; shipped file paths remain part of the
current subpath resolution behavior.

The main validation, detection, crosscheck, mirror, behavior, and Intel algorithms are deterministic
data-to-data functions without external network calls or telemetry. Interactive Intel callers use
the deterministic `lib/intel-rules.js` adapter. The optional knowledge-base loader reads packaged
files from disk.

## Validation Result

`validate(payload, options)` returns:

```text
{
  type,
  version: { version, confidence, signals },
  status,
  findings,
  urlRequest?            // recognized URL-style request only
}
```

Each decorated finding contains a stable `id`, `level`, JSON-ish `path`, structured `params`, a
nullable `specRef`, and localized `msg`. Callers key automation on the structured fields, never on
translated `msg`.

Validator levels are `error`, `warning`, `info`, and non-blocking `question`. Top-level status is
`errors` when an error exists, `warnings` when warnings are the highest real severity, and `clean`
for empty, info-only, or question-only results. `invalid` is an explicit parse/root failure status.

Crosscheck uses the same structured/decorated shape plus `ok` and optional `detail`; its scale is
`crit`, `warn`, and `ok`.

## Determinism and Compatibility

For `validate()` and `crosscheck()`:

1. `disabledRules` removes exact ids or trailing-`*` prefixes.
2. Duplicate `(id, path)` pairs collapse to the first finding; merged rows add
   `params.dedupCount` only when two or more were present.
3. Findings sort by severity, then path ascending, then id ascending. Shared severity order is
   error/crit, warning/warn, info, question, ok.
4. Strictness filters the already ordered set: `lax` keeps error/crit, `normal` keeps
   error/crit/warning/warn/question, and `pedantic` keeps all. Missing or unknown strictness is
   `pedantic`.
5. Localization and spec-link decoration occur after filtering/dedup/sort.

Stable finding IDs, stable deterministic finding order, and `(id, path)` dedup semantics are public
compatibility guarantees. Finding-id removal or rename, output-shape removal/change, reordered
semantics, CLI exit-code change, or changed dedup identity is a breaking Core/CLI contract change.
New findings and additive fields require tests because they can change consumer verdicts even when
structurally additive.

## Type and Version Routing

- Non-object roots return an invalid-root finding.
- Recognized URL strings are decoded and validated as URL requests and can include a canonical
  `urlRequest` result.
- OpenRTB request/response shapes route to the 2.x or 3.0 validator after type/version detection.
- A hybrid request/response or 2.x/3.0 envelope is resolved deterministically and surfaces an
  ambiguity finding.
- Supported vendor-feed shapes use dedicated rules.
- JSON Feed 1.1 is detected but not structurally validated; it emits the informational
  `jsonfeed.not_validated` finding.

Version detection returns `2.5`, `2.6`, `3.0`, or `unknown` with confidence and signals. An OpenRTB
object with no recognized marker uses the low-confidence 2.5 default. `expectedVersion` accepts the
three supported buckets and adds `version.mismatch` when the detected bucket differs. Dated 2.6
revisions are not distinguished.

Coverage is rules-based rather than official JSON Schema conformance. OpenRTB 2.x has broad shared
request/response rules but incomplete minor-version gating. OpenRTB 3.0 has deep envelope and core
AdCOM coverage but is not exhaustive.

## Formats, Dialects, and Rules

Format detection returns independent sets of formats, runtime contexts, protocols, combined tags,
and confidence. It covers IAB media and non-IAB extension/shape hints, including user-dialect
mappings where supplied.

Built-in dialects are `iab`, `ext-rtb`, and `inpage-push`; an unknown slug falls back to `iab`.
Baseline request/response rules remain in the versioned flat validators. New modular groups are
explicitly registered in `packages/core/rules/index.js`; directories are not auto-discovered. Plugin
findings join baseline findings before finalization. A plugin exception is logged and isolated so it
does not crash the whole validation call.

A user-dialect object may suppress questions for already mapped extension signals and can contribute
format hints. It does not replace the IAB baseline.

## Crosscheck and Mirror

`crosscheck(request, response, options)` compares the paired auction semantics, including impression
resolution, price/floor and currency context, exclusions, media shape, Native references, and VAST
shape. Response-side plugins receive the paired request only when the caller supplies it.

`mirror(input, options)` accepts a request or response, generates the opposite side in `minimal` or
`best-practice` mode, then validates and crosschecks the result. A successful response includes the
generated output, localized notes, direction/input type, mode, and self-test severity counts. A
generation failure returns no output and no self-test rather than claiming success.

## Locales

Core finding locales are `en`, `uk`, and `ru`. A message missing from the requested locale resolves
requested → `en` → `uk`, then renders a bracketed finding id when it exists in no locale, making the
missing key visible. English sits ahead of Ukrainian because `en` is this codebase's canonical
locale ([ADR-014](../../decisions/ADR-014-default-locale-english.md)); before 2026-08-27 the chain
fell straight to Ukrainian, which silently returned Ukrainian text to English and Russian readers.
Message files, spec-reference coverage, and localized behavior are part of rule delivery.

## Key-Role Layer (016, ADR-015; Core 0.38.0)

The dialect vocabulary and the labelling resolution are a layered contract:

- `packages/core/dialects/key-role-vocabulary.js` is the ONE normative enumeration: ten canonical
  roles, twenty storable labels (the eleven pre-existing plus nine role labels), and the explicit
  `FORMAT_LABELS` allowlist. Every surface that lists labels imports it (the save route, the model
  schema, the generated browser mirror `public/core/key-role-vocabulary.js` gated by a
  byte-equality test); no consumer declares its own array. Format recognition tests `FORMAT_LABELS`
  membership, never "is an accepted stored label" — the nine role labels are inert to it by test.
- `classifySignal()` in `signal-lexicon.js` returns the legacy resolver's verdict CLASSIFIED
  (`terminal-flag` / `specific-format` / `guarded-contradiction` / `broad-heuristic` / `abstain`);
  `resolveSignal()` is a byte-compatible thin projection and keeps its public shape.
- `key-role-alphabet.js` resolves a key's ROLE over four committed manifests in
  `packages/core/dialects/data/` (corpus 322 exact-case names, adjudication — staged until the US2
  increment per the `STAGING:` marker, named rules, routing matrix with frozen `D0`). Identity is
  exact code-point spelling; an unlisted casing abstains. Lookup never returns null: the states are
  `resolved` (one role, one of the exact scores 0.90/0.80/0.70/0.60/0.40), `ambiguous` (candidates,
  no singular score), `abstain`.
- `resolve-precedence.js` combines the two per the 016 FR-001 matrix. Guarantees: an exact saved
  mapping outranks everything; terminal flags stay terminal; a role-layer abstain never demotes a
  deterministic answer to a model call. Routes partition into exact-format / role-resolved /
  role-ambiguous / preserved-legacy / model (SC-002).
- The suggest-label response gained three variants (role-resolved with `role`/`roleConfidence`/
  `valueStatus`/projected `label`, ambiguous with `roleCandidates` and nothing preselected,
  saved-mapping without a numeric confidence); preserved legacy and model answers are
  field-identical to before, model answers carry routing evidence. `valueStatus: 'resolved'` is a
  RESERVED state no v1 path produces. The model prompt payload is frozen to the ADR-012 §6
  allowlist, asserted by test; `docs/PRIVACY.md` is unchanged.

## Recommended Fields and Supplied Types (021, ADR-016; Core 0.40.0)

For omitted fields, specification qualifiers map to levels: `required` → error, `recommended` →
warning, `optional` → info, with the named exceptions in ADR-016. Device `ua`/`ip` omissions and
their 3.0 mirrors are warnings on site/app requests and info on DOOH-only requests; an empty
`seatbid` array without `nbr` is an info-level no-bid. An absent property or explicit JavaScript
`undefined` counts as omitted; `null` does not.

Concretely, `request.no_site_or_app`, `request.device_required`,
`request.30.context.no_site_or_app` and `request.30.context.device_required` are warnings;
`request.device.ip_required`/`ua_required` and `request.30.context.device.ip_required`/`ua_required`
are warnings (info on DOOH-only); `response.seatbid_empty_no_nbr` and
`response.30.seatbid_empty_no_nbr` are info. An absent 2.x `device` yields only
`request.device_required`, without child-field cascades.

Supplied `site`, `app`, `dooh` and `device` in 2.x requests or 3.0 request contexts must be
non-null, non-array objects. Supplied Device `ua`, `ip` and `ipv6` must be strings; empty strings
may retain existing omission guidance. Supplied response `nbr` must be an integer, regardless of
whether `seatbid` is populated, empty or absent. Supplied wrong types, including falsy values and
`null`, produce errors. Invalid Device objects do not trigger child-field cascades. These checks
add no IP-address parsing, network-range checks, or `nbr` enum membership or numeric-range policy.

Crosscheck reports only the id check for an empty `seatbid` array with absent or integer `nbr`;
`crosscheck.no_response` remains for responses with neither a `seatbid` array nor `nbr`. No-bid
handling must not suppress a validator error for malformed supplied `nbr`. The no-signal errors
`response.seatbid_or_nbr_required` and `response.30.seatbid_or_nbr_required` remain errors.

All existing finding ids remain. Core 0.40.0 adds exactly 13 invalid-type error ids enumerated with
paths in the [021 finding contract](../../021-recommended-fields-guidance/contracts/finding-levels.md).
Existing 3.0 Site/App/Device invalid ids remain errors, including for supplied falsy wrong types.
The additive ids and restored blocking verdicts for malformed inputs justify the minor bump from
0.39.0; that release used CLI Core dependency `^0.40.0` (superseded by 023 below). Public-boundary tests must distinguish valid
omissions from supplied wrong types in both protocol families, and every new id must have en/uk/ru
messages. Core tests cover explicit `undefined`; HTTP tests cover JSON omission and invalid values.

## Price and Floor Resolution (022; Core 0.41.0)

A bid price is usable only when `bid.price` is a JSON number that is finite and not negative; zero is
a real bid. No coercion is performed, so `[]`, `[1]`, `true`, `''` and a quoted number are not prices.
Both engines apply that one predicate: the crosscheck emits `crosscheck.bid.price_invalid` (crit) and
no floor verdict, and the auction summary counts only usable prices.

The effective floor is resolved by one shared function, `resolveDealFloor(bid, imp)`, exported from
`packages/core/rules/price-floor/index.js` and imported by `packages/core/crosscheck.js`, so the
validation and crosscheck engines can never name different floors for the same pair. When `bid.dealid`
matches an `imp.pmp.deals[].id` whose `bidfloor` is a finite number, that floor governs at any value
including `0`, denominated in the deal's own `bidfloorcur`, which never inherits `imp.bidfloorcur`
(oRTB 2.6 §3.2.12). Otherwise the impression floor applies with its existing absent, explicit and
unusable branches unchanged. A negative floor is not flagged by any rule today and prints as stated.

On the OpenRTB 3.0 path the item projection reads the floor currency from `flrcur`, and a paired 3.0
request reaches the response rule pass projected to `{cur}` from `openrtb.request.cur` so a permitted
currency is not reported as a mismatch. The projection deliberately carries nothing else.

## Audio Detection and Required MIME Values (023; Core 0.42.0)

The [023 audio contract](../../023-audio-repair/contracts/audio-behavior.md) corrects audio/VAST/DAAST detection and adds two OpenRTB 2.x audio errors. `imp.audio.mimes_required` reports absent, non-array or empty `imp[i].audio.mimes`; `imp.audio.mimes_invalid` reports a non-string or blank element at `imp[i].audio.mimes[m]`. Both are errors with en/uk/ru messages and specification references. Valid nonempty string arrays produce neither error; MIME presence/type validation does not enumerate all supported media capabilities.

Format detection preserves independent actual audio/video evidence, ignores apparent attributes inside another quoted value or XML comments/CDATA/DOCTYPE, and terminates on malformed attribute tokens without manufacturing valid media evidence. Actual video remains visible alongside audio metadata. The VAST media whitelist accepts its documented audio MIME variants. OpenRTB audio/video codes 9/10 mean DAAST; 7/8/11–14 mean VAST4; code4 does not mean DAAST. AdCOM Audio/Video response `ctype` contributes scalar integer protocol evidence; malformed response arrays do not.

DAAST shape recognition accepts an actual DAAST local root, including supported namespace/prolog forms; a DAAST prefix on another root is not sufficient. Browser preview uses the existing inert `vast` document-text kind. No playback, wrapper fetch, entity expansion, new network path or sandbox privilege is added.

Existing public result shapes, finding IDs, ordering/deduplication and CLI exit-code policy remain. The two additive errors can change consumer verdicts and justify Core0.42.0 with CLI dependency `^0.42.0`; app1.19.4 and CLI0.1.3 retain their version lines. Release/verification state is recorded in [023](../../023-audio-repair/spec.md), separately from repository contract state.

## Malformed-Shape Category Decode (024; Core 0.43.0)

`extractAllCategories(payload, locale)` guards `imp`, `seatbid` and each seat's `bid` with an
array-type check before walking them. A syntactically valid payload whose `bid` or `seatbid` is a
non-array value now decodes to no categories for that branch rather than throwing a `TypeError`; the
validator's own structural finding (for example `response.seatbid.empty` or
`response.seatbid_or_nbr_required`) remains the answer. This is the only behaviour change on the
public Core surface and is why Core takes the minor bump; no finding id, level or message changes.
The consuming HTTP boundary (`POST /api/analyze`) therefore keeps its `200` structured envelope for
such shapes instead of returning `400 bad_request`, and a present scalar `bidRes` is validated to
`payload.invalid_root` with `crosscheck.no_response` — both recorded in
[the HTTP API contract](./http-api.md) and the
[024 public-boundary contract](../../024-analyze-input-robustness/contracts/analyze-input-boundary.md).

## Format Detection and Feed Dispatch Alignment (025; Core 0.44.0)

The feed key-role tables are aligned. `detectFeedFormat` treats `image_url`/`icon_url` as creative-slot
aliases alongside `image`/`icon`, so a material validated under those aliases earns the same format
tag (DEF-160). The `clickurl` click alias, already honoured by `format-detect.js`, is now also
recognized by `detect.js`'s single-object classifier and `rules-feed.js`'s push-material click check
(DEF-181). A materials array dispatches each element by shape through the shared
`validateBidPriceMaterial(o, fp, findings)` contract, so a `bid_price`/`notification_url` element is
validated as a bid-price shape with array-indexed paths instead of drawing push-material errors
(DEF-161). A standalone Native 1.x `adm` body (a `native` wrapper or bare native root with an `assets`
array or `assetsurl`) tags the format `native` when the bid declares no `mtype`; a bid that declares
its media type is unchanged (DEF-460). No finding id, level or message changes. The same alias
alignment incidentally corrects the response-format detection of the still-open DEF-107 Kadam cases,
which stay recorded against their residual request-decoder gap. Recorded in the
[025 public-boundary contract](../../025-format-detect-vendor-dialects/contracts/format-detection-boundary.md).

## Selected Media and Buyer Seats (026 Wave A; Core 0.45.0)

Feature [026](../../026-validation-crosscheck/spec.md) changes the applicability and evidence behind
paired-media verdicts. On OpenRTB 2.x impressions, an offered `bid.mtype` selects its declared
family; otherwise supported actual creative evidence selects an offered family, with a sole offered
family as the fallback. Banner sizes, Native assets and video document checks apply only to that
selected family. Merely offering several families no longer imposes all their constraints on one bid.
Wave B adds declaration validation and structured Native handling as specified below.

The exported `inspectVastMedia()` helper is owned by `packages/core/rules-vast.js` and imported by
crosscheck. Its bounded scan records the actual VAST/DAAST root and version, InLine/Wrapper form,
per-Linear rendition MIME alternatives and parsed duration. Comments, processing instructions,
CDATA that only resembles markup, quoted attribute text and vendor/creative extension subtrees do
not manufacture media facts. A malformed lexical token advances or ends inspection; no entities are
expanded and no wrapper or creative URL is fetched.

For selected video, each observed InLine Linear must have a rendition allowed by a supplied MIME
list when both sides provide usable MIME facts. Observed durations are compared with explicit
finite minimum/maximum bounds without discarding fractions. Known actual root-version/form protocol
codes and a supplied integer `bid.protocol` are compared with the offered protocol list; metadata
cannot hide an incompatible observed document. An unresolved Wrapper contributes its known protocol,
without invented rendition or duration values. The existing `crosscheck.bid.video_vast` remains a
shape verdict; it does not certify facts that were not supplied.

For selected banner, supplied VAST/DAAST or structured Native content receives a media warning.
For selected audio, unrecognized inline document shape receives a warning; observed video-only media
or an InLine containing only NonLinear display content receives a critical media mismatch. An
unresolved Wrapper is not presumed to contain video. Identified 2.x response seats are compared
case-sensitively with explicit `wseat`/`bseat` lists at the SeatBid path, once per group after normal
deduplication; absent identities do not become invented matches.

Wave A adds these public finding IDs, with en/uk/ru messages and specification references:

| ID                                       | Level  | Path               |
| ---------------------------------------- | ------ | ------------------ |
| `crosscheck.bid.video_mime_mismatch`     | `crit` | Affected bid `adm` |
| `crosscheck.bid.video_duration_mismatch` | `crit` | Affected bid `adm` |
| `crosscheck.bid.video_protocol_mismatch` | `crit` | Affected bid `adm` |
| `crosscheck.bid.banner_not_banner`       | `warn` | Affected bid `adm` |
| `crosscheck.bid.audio_not_vast`          | `warn` | Affected bid `adm` |
| `crosscheck.bid.audio_media_mismatch`    | `crit` | Affected bid `adm` |
| `crosscheck.seat.not_allowed`            | `crit` | `seatbid[i].seat`  |

The existing `vast.mediafile_missing` error is retained and scoped to actual InLine Linear content,
or InLine content with neither Linear media nor a NonLinear alternative. Valid NonLinearAds-only
content no longer requires a Linear MediaFile, while a broken sibling Linear remains diagnosable.
This bounded applicability correction is not a claim of exhaustive XML schema validation.

Existing finding IDs, finalization order, deduplication, API shapes and CLI exit policy remain. The
[022 economic contract](#price-and-floor-resolution-022-core-0410), including its currency-only
3.0 response-plugin projection, remains unchanged. The seven additive findings justify the reserved
Core 0.45.0 release with CLI dependency `^0.45.0`; app 1.19.4 and CLI 0.1.3 retain their independent
versions. The [026 tasks](../../026-validation-crosscheck/tasks.md) record verification and delivery
state rather than implying main integration or deployment.

## Response Semantics and Structured Native (026 Wave B; Core 0.45.0)

OpenRTB 2.x `bid.mtype` is optional; a supplied value must be an integer from 1 through 4. A valid
declaration whose family is absent from the matched impression produces a crosscheck contradiction.
Invalid declarations are diagnosed by validation and do not acquire a made-up family in crosscheck.
Repeated explicit string seat identities across separate SeatBid groups are errors in 2.x and 3.0;
several bids in one group remain valid, and missing identities are not fabricated.

The same owning helpers in `rules-response.js` serve both response versions' duplicate-seat and
no-bid reason checks. Supplied integer `nbr` values outside 0–17 and the exchange-specific range
500 and above receive an unassigned-code warning. Existing errors for supplied noninteger/wrong-type
values remain separate, including null, booleans and numeric strings. Optional omission remains
valid. Supplied 2.x `regs.coppa` must be exactly integer 0 or 1; other values are errors.

A nonempty whitespace-only 2.x `adm` produces `response.bid.adm_blank`, including when a notice URL
is also present. This warning distinguishes blank supplied content from usable markup without
renaming the existing `response.bid.payload_missing` omission finding or changing its callers'
compatibility contract. Existing supplied-type diagnostics elsewhere are not downgraded.

### Supported Native Carriers and Paired Asset Checks

The supported SSP convention `bid.native` satisfies the 2.x creative-presence check when it is an
object. For crosscheck, an explicitly supplied `bid.native` takes precedence over `adm`, even if
malformed; a notice URL does not hide that content. Native 1.x parsing accepts the bare asset object
or one explicit object-valued `native` wrapper. Shared `nativePayloadInner()` rejects null, booleans,
numbers, arrays and malformed/nested wrappers rather than normalizing them to an empty object. Those
values cannot receive `crosscheck.bid.native_complete` even when every requested asset is optional.

AdCOM `placement.display.nativefmt` and `media.ad.display.native` are projected into the existing
paired asset checks: request `asset` becomes `assets` and `req` becomes `required`; response `asset`
becomes `assets` and `image` becomes `img`. A Native-only display placement no longer manufactures a
banner alternative. Explicit display dimensions or formats preserve the separate offered banner
alternative. This in-memory crosscheck projection does not alter the caller payload or the
currency-only 3.0 response-plugin projection established in 022.

A structured AdCOM `display.native` object satisfies display creative presence without requiring a
second `adm` or `curl`. A supplied non-object `display.native` reuses the existing
`response.30.bid.native_invalid` error at that field, even if alternate markup is also present.
Paired Native checks separately reject malformed request/response containers using the existing
`native_invalid_request`/`native_invalid_adm` finding IDs. Absent response assets retain the existing
required-ID missing-assets behavior. Request assets must be a nonempty array of objects with IDs;
required asset identity, kind, nonblank title/data/image-URL content and applicable length/dimension
checks govern the existing complete verdict. These are bounded existing fitness checks, not a claim
of exhaustive Native schema conformance. Existing finding paths are preserved, including the 2.x
bid `adm` path and the 3.0 Ad object path for the structured carrier.

Native image URLs additionally accept the constrained embedded raster form
`data:image/{png,jpeg,gif,webp};base64,` with a nonempty syntactically valid base64 body. The allowance
is specific to the image field; navigation URL scheme checks are unchanged. It does not admit SVG,
HTML, malformed/empty data bodies or data navigation URLs, fetch external assets, execute markup,
change the browser sandbox or assert that image bytes have been decoded and verified.

### Bounded Pop Exceptions

Under the explicitly selected `ext-rtb` dialect, an EXADS `instl: 1` impression can omit all four
standard media fields. The exception requires each field to be absent/undefined; a supplied malformed
field is not reinterpreted as omitted, and the ordinary IAB dialect retains `imp.format_required`.
A pop-tagged bid with absent/undefined `adm` and a valid notice URL passes the pop redirect check.
The URL predicate is exported from its response-rule owner and imported by the pop plugin. Supplied
bad inline content still receives the existing `bid.pop.adm_not_redirect` error even alongside a
valid notice URL.

Wave B adds eight finding IDs, each with en/uk/ru messages and specification references:

| ID                                      | Level     | Path                           |
| --------------------------------------- | --------- | ------------------------------ |
| `response.bid.mtype_invalid_enum`       | `error`   | `seatbid[i].bid[j].mtype`      |
| `crosscheck.bid.mtype_offered_mismatch` | `crit`    | `seatbid[i].bid[j].mtype`      |
| `response.seatbid_seat_duplicated`      | `error`   | `seatbid[i].seat`              |
| `response.30.seatbid_seat_duplicated`   | `error`   | 3.0 response `seatbid[i].seat` |
| `response.bid.adm_blank`                | `warning` | `seatbid[i].bid[j].adm`        |
| `response.nbr_code_unassigned`          | `warning` | `nbr`                          |
| `response.30.nbr_code_unassigned`       | `warning` | 3.0 response `nbr`             |
| `regs.coppa_invalid`                    | `error`   | `regs.coppa`                   |

Together the two 026 waves add fifteen public IDs under Core 0.45.0. Existing malformed supplied
`nbr` and AdCOM Native errors remain errors. The semantic fixes do not by themselves close DEF-151:
its separately owned recognition and preview deviations remain in the exact corpus ledger until
those observations pass. Current branch verification and delivery state belong in the
[026 feature records](../../026-validation-crosscheck/tasks.md), not in a claim of full feature
completion, main integration, package publication or deployment.

## Vendor Carriers and Format Recognition (028; Core 0.46.0)

Feature [028](../../028-vendor-request-dialects/spec.md) adds deterministic vendor inspection at the
existing Core boundary. `TYPES.VENDOR_REQUEST` adds the `Vendor Feed Request` classification; EXADS
validation resolves to `EXADS RTB Request` or `EXADS RTB Response`. Existing type constants and
finding IDs are not renamed. Vendor classification does not establish an OpenRTB version or invent
an impression, seat, bid floor or account currency.

### Documented request and response carriers

`vendor-exads.js` owns shared request/response recognition, validation and format roles. Required
request strings are checked independently from supplied-invalid values; banner additionally requires
size. The documented inpage type is supported. JSON `sub` is a finite nonnegative integer; GET
represents it as a digit string. Invalid representation is an error, while the contradictory source
length/leading-zero guidance remains a warning. Unsupported request type is guidance; supplied
unsupported export serialization is an error. Missing pasted headers are not fabricated payload
requirements.

EXADS outer bids retain original `bid.*` paths. Supplied `value` must be a finite nonnegative number
without JSON-string coercion; supplied `btype` is exactly 1 or 2. Omitted response fields not marked
required by the source produce bounded guidance, while supplied invalid types remain errors.
`nUrl` is notification evidence only; pop landing `url`, click `clickUrl`, icon and image roles stay
separate. Account currency is not inferred and CPC is not converted into CPM. Empty/malformed JSON
does not manufacture the documented HTTP 204 no-bid state.

Recognition guards preserve any own `imp`, `seatbid` or `openrtb` marker, even if malformed. Core
crosscheck returns an empty finding list only when both request and response are recognized EXADS
carriers. Other unknown or malformed IAB pairs keep their existing findings. The HTTP analyzer uses
this same Core behavior; there is no broad unknown-request exemption.

The explicit decoder registry adds four families after existing decoder precedence:

| Family            | Source-bound carrier and format evidence                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PPCmate           | Root-path GET with publisher, address, user-agent and domain keys; feed ID is optional. Subscription timestamp and impression number provide push/pop evidence. JSON/XML format selects serialization, not inventory.    |
| Kadam             | `/feed` with sid/ua/uid/pid and an IP-family key; skey is not universally required. Explicit Native/teaser and cu/pops formats are recognized. Missing subscription age or format does not identify inpage provisioning. |
| EXADS             | `/rtb.php` plus the EXADS request field family; the same owning validator handles decoded GET values with transport-specific representation checks.                                                                      |
| Provisional Adon3 | `/v1/feed/` plus one nonempty opaque segment and documented lowercase ip/ua keys; recognition does not establish origin or a finalized vendor protocol.                                                                  |

These host-independent GET decoders reject userinfo/fragments and rely on the existing HTTP(S)
registry boundary. They preserve the full URL, first raw encoded query values, duplicate-key
precedence and repair/decode-damage warnings. `urlRequest.meta.vendorRequest` holds actual supplied
first decoded values for the owning validator, without manufacturing absent keys. Supplied IPv4
and IPv6 and page/domain context are retained without inventing a scheme. Ambiguous subtype evidence
sets `meta.formatAmbiguous` and produces guidance; it does not inspect opaque keys or creative text.

### Native/inpage meaning and provisional status

Kadam Native material uses its documented `url`/`image`/`cpc` carrier. It does not require the unrelated
push `click_url` field or become an IAB Native assets envelope. Supplied CPC remains finite,
nonnegative and numeric. Missing title/image guidance remains distinct from supplied invalid values.
Explicit Native URL-request intent supplies the paired Native tag; an isolated card need not prove a
unique Native placement.

The project inpage dialect exports its owning placement/card role helpers for format detection.
Widget/zone hints and extension-card aliases add inpage evidence while retaining actual media tags,
`imp.format_required` and the IAB control's payload warning. Nested AdCOM `display.nativefmt` and
`media.ad.display.native` supply the supplemental DEF-151 Native recognition. A Native display
container alone is not a banner; a separately offered display format or actual display markup/URL
retains the genuine banner alternative. The 026 Native validation and asset crosscheck remain.

Adon3 response inspection requires own `rid`, `cur` and `ads` carrier keys while preserving IAB
precedence. It always returns the `Provisional Adon3 Response` label and the
`feed.adon3.provisional_contract` warning. Request metadata independently retains
`contractStatus: provisional-unsupported` with `request.url.provisional_contract`. Neither path
certifies vendor conformance, supply provisioning or commercial crosscheck coverage. Existing
finding filters do not turn the retained type/metadata into certification.

Empty/malformed ad arrays, invalid rows, required URL/notice/price fields and supplied invalid typed
values produce original-path errors. Adon3 prices remain decimal strings, including trailing zeros
and values beyond binary-float precision; no numeric or currency conversion occurs. An explicit
under/over pop role or title plus image/icon supports format evidence; a landing URL or opaque key
alone does not. Unknown future string response pop types retain provisional status without a hard
final-enum claim. The three source cases remain documented-reference examples, not vendor-valid
coverage.

### Additive findings and preserved delivery boundary

New source-backed finding families are `request.exads.*`, `feed.exads.*`, `feed.adon3.*` and
`feed.native.*`, plus `request.url.required_parameter_missing`, `request.url.parameter_invalid`,
`request.url.format_ambiguous` and `request.url.provisional_contract`. Their literal severities,
matching en/uk/ru messages and specification references form one contract; existing finding order,
deduplication, public result envelopes and CLI exit policy remain. Core 0.46.0 and CLI dependency
`^0.46.0` advance together; app 1.19.4 and CLI 0.1.3 keep their independent versions.

No runtime network, payload persistence, model forwarding, asset fetching or preview sandbox change
is introduced. Core/backend verification does not close the separately owned public preview work.
The whole 256-case corpus remains the preservation boundary: only proven Core/HTTP deviations are
narrowed, and browser records remain until an individual case has current complete browser proof.
The two Kadam hidden-placement assertions and four peer-owned inpage preview contradictions retain
explicit decision ownership. [028 verification](../../028-vendor-request-dialects/verification.md)
records current gates; this contract does not claim hosted delivery, npm publication or deployment.

## CLI Contract

The CLI supports `validate`, `crosscheck`, `detect`, `dialects`, `locales`, `help`, and `version`; it
reads a file or stdin where applicable. Human output is the default and `--json` returns machine
output. Locale defaults to English, dialect defaults to IAB, and `--fail-on` accepts `error`, `warn`,
or `never`.

Exit codes are stable:

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | Command succeeded and the selected failure threshold was not reached |
| `1`  | Analysis completed and findings reached the selected threshold       |
| `2`  | Usage, input, file, or parse error prevented the requested analysis  |

Core and CLI are repository workspaces and currently have no verified npm registry publication.
Executable registry-install claims remain absent until the first-publish procedure in
[docs/NPM_PUBLISH.md](../../../docs/NPM_PUBLISH.md) succeeds and is verified.

## Required Verification

Changes run focused API stability, validator, detector, rule/dialect, localization, mirror/behavior,
and CLI tests first. Every new finding id must have all applicable locale messages and an IAB spec
reference where the rule is source-mapped. Before merge, run the complete repository gate from
[the baseline quickstart](../quickstart.md).
