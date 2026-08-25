# Data Model: Creative Preview Repair — Wave 1

Nothing here is persisted. Classification, the refusal ledger, probe capability, and static-analysis
source live for one active preview. The static source crosses the existing same-origin
`/api/analyze-behavior` boundary transiently and is not logged or saved.

## Creative Body Classification

The determination of what a macro-resolved creative body is, made once before any display decision.

| Field     | Type           | Notes                                                                                              |
| --------- | -------------- | -------------------------------------------------------------------------------------------------- |
| `kind`    | enum           | `vast` \| `native` \| `markup` \| `json` \| `url` \| `unidentified`                                |
| `body`    | string         | once-decoded body when `decoded` is true; otherwise the macro-resolved input unchanged             |
| `decoded` | boolean        | true when one bounded base64 decode round was applied                                              |
| `native`  | object \| null | normalized Native object when `kind === 'native'`, whether the source was wrapped or envelope-less |
| `reason`  | string         | the test or fail-closed dependency state that decided the result                                   |

**Rules**

- Classification is pure: same dependencies and input, same output; no clock, network, or DOM write.
- Padded and standards-valid unpadded base64 are accepted. A remainder of one is invalid; valid
  remainders of two or three are padded only for `atob`. There is exactly one decode round.
- The decode attempt is bounded by input length; an oversized body is not decoded.
- Raw body bytes reach `srcdoc` only for `kind === 'markup'`. Native is rendered by first generating
  escaped synthetic card HTML; the raw Native JSON never reaches a frame.
- VAST, generic JSON, URL, prose, and failed/unknown classifications are inert text.
- VAST delegates to the single Core detector. A missing Core detector or missing classifier fails
  closed to `unidentified`.

**Lifetime**: recomputed on every `setAdPreview` call; not persisted.

## Executing Creative Source

The static behavior scanner's transient view of the body selected to execute.

| Field                    | Type    | Notes                                                                          |
| ------------------------ | ------- | ------------------------------------------------------------------------------ |
| `creative_adm_b64`       | string  | canonical padded base64 of the deterministic UTF-8 source window               |
| `creative_adm_truncated` | boolean | true when the executing body exceeded the 1 MiB decoded-byte bound             |
| `creative_revision`      | number  | increments when a new executing body or asset-inlined rerender becomes current |

**Source selection**

- Markup uses the macro-resolved, classified, once-decoded `body` before probe/CSP instrumentation.
- Native uses escaped synthetic card HTML, not raw JSON.
- A successful banner asset-inlining rerender replaces the source with the rewritten HTML before
  the frame is repointed.
- Inert-text branches do not claim an executing creative source.

The UTF-8 prefix is at most 1 MiB and never ends inside a multibyte character. For a body within the
bound it is the complete executing body. `behavior-tab.js` snapshots source plus revision and can
request static analysis with an empty runtime-visible event list. Generation and revision checks
discard stale responses.

**Wire form**: `{ events, adm_b64, adm_truncated }` to `/api/analyze-behavior`. The server validates
canonical base64, the decoded-byte bound, and fatal UTF-8 before invoking Core. Legacy callers may
still send `{ events, adm }`; `adm_b64` takes precedence when supplied.

**Lifetime**: current Inspector render only; transiently processed, never persisted.

## Probe Capability

A fresh cryptographically random, opaque value authenticating the trusted probe for one iframe
render.

| Field     | Type   | Notes                                                                               |
| --------- | ------ | ----------------------------------------------------------------------------------- |
| `channel` | string | embedded into the trusted probe closure and required on both reserved message types |

The parent also pins `event.source` to the current iframe. The probe removes its own channel-bearing
script element before creative markup parses, so code in that same frame cannot recover the value
from the DOM. Repointing an asset-inlined banner creates a new capability. A failed probe fetch or
random-value generation leaves telemetry unauthenticated and therefore unaccepted.

**Lifetime**: one mounted iframe document; reset before every preview branch.

## Refusal Ledger

The per-render tally of sub-resources the sealed frame refused to load.

| Field       | Type    | Notes                                                          |
| ----------- | ------- | -------------------------------------------------------------- |
| `entries`   | Set     | key is normalized directive text plus blocked URI              |
| `count`     | number  | accepted distinct entries, at most 200                         |
| `hosts`     | Set     | distinct hosts parsed from bounded blocked URIs                |
| `kinds`     | Map     | localized stable resource group → count                        |
| `truncated` | boolean | probe or parent discarded an entry because a bound was reached |

**Rules**

- The current iframe source and per-render capability must both match before reduction.
- The parent validates `v`, finite `ts`, boolean `truncated`, array `items`, and string item fields.
- Probe and parent independently cap a render at 200 entries. Parent batches accept at most 200;
  directives are at most 64 characters and blocked URIs at most 2048.
- Deduplication uses `(directive, blockedUri)`; duplicates do not consume final capacity.
- Chromium aliases such as `script-src-elem` and `style-src-elem` normalize to stable localized
  script/style groups before display.
- The store never calls `pushBehaviorEvent`, enters `/api/analyze-behavior`, or changes behavior
  findings. Host and kind output is assigned as text, never parsed as markup.

**Lifetime**: one preview render. Cleared with behavior/watchdog/frame state; not persisted or sent to
an endpoint.
