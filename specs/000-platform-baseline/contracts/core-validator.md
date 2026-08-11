# Contract: Core Validator and CLI

**Owner**: `packages/core/` and `packages/cli/`
**Current versions**: Core `0.31.0`; CLI `0.1.1`

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

Core finding locales are `en`, `uk`, and `ru`. The Core fallback is Ukrainian. A message lookup that
exists in no locale renders a bracketed finding id, making the missing key visible. Message files,
spec-reference coverage, and localized behavior are part of rule delivery.

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
