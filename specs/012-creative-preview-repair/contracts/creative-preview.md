# Contract: Creative Preview Classification and Refusal Reporting

**Scope**: the Inspector's preview column, its static-analysis source transport, the frame-to-parent
message channel, and the separately bounded mapped-address guard on the existing creative-asset
route. Extends
[frontend-modules](../../000-platform-baseline/contracts/frontend-modules.md) §"Creative Preview and
Behavior Probe"; nothing in that section is relaxed.

## 1. Classification order

A creative body is macro-resolved and classified exactly once per render, before any display
decision. The order is normative — a body can satisfy more than one test, and the first match wins.

| #   | Kind           | Test                                                                                         | Displayed as                                               |
| --- | -------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | `vast`         | `isVastShape` from the generated browser copy of `packages/core/vast-shape.js`               | scrollable inert text, no reveal overlay                   |
| 2   | `native`       | parses as JSON and exposes an assets array at `native.assets` or at top level                | escaped synthetic Native HTML in a probed frame            |
| 3   | `json`         | parses as JSON, no native assets                                                             | inert text, named as JSON without renderable Native assets |
| 4   | `base64`       | padded or valid unpadded base64 within the bound, decoding to anything except `unidentified` | the once-decoded classification, with decoding stated      |
| 5   | `url`          | the whole trimmed body is one absolute `http(s)` URL                                         | inert text; never fetched and never linked                 |
| 6   | `markup`       | contains at least one element-like construct                                                 | the classified markup body in frame `srcdoc`               |
| 7   | `unidentified` | everything else                                                                              | inert text, named as unidentified                          |

`base64` is a transport row, not a terminal `kind`: a successful decode returns the decoded body's
kind with `decoded: true`. Padding is optional when the final RFC 4648 quantum is otherwise valid;
a one-character remainder is invalid. Decoding occurs at most once.

**Invariants**

- Raw payload bytes reach `srcdoc` only when classified as `markup`. A Native payload is the sole
  non-markup rendering exception: its untrusted JSON never reaches `srcdoc`; the renderer first
  constructs a standalone escaped synthetic card, and only that generated HTML is framed.
- VAST, raw Native JSON, generic JSON, bare URLs, prose, and failed/unknown classifications remain
  inert in the parent.
- Classification never rewrites a body except for the single base64 decode. Macro resolution occurs
  before classification, so the classified body is the body selected for execution or inert display.
- VAST recognition has exactly one implementation in the product. If the Core detector is absent,
  classification fails closed to `unidentified`; the preview has no private fallback detector.
- If the classifier itself is absent, the parent also fails closed to `unidentified` rather than
  restoring the former catch-all markup branch.

## 2. Inert-text and Native rules

VAST and every body not selected for a frame are written to the parent DOM with `textContent`.

- `innerHTML` is prohibited on this path, with or without an escaping helper. The baseline contract
  forbids promoting preview markup into the parent origin, and writing text performs no parse.
- No anchor, image, or other fetching element is generated from an inert payload. A URL body is text.
- Blocked-resource identifiers use the same text-only rule.
- Wrapped and unwrapped Native payloads normalize to the same object and produce the same escaped
  synthetic card under `sandbox="allow-scripts"` without `allow-same-origin`.
- Wave 1 does not expose the asset-inlining/network button on the Native branch. Remote Native art is
  refused by the sealed frame and described by the ledger; the existing explicit asset action for
  classified banner markup is not widened to Native.

## 3. Probe loading and authenticated frame messages

Inspector activation awaits the one-time `/creative-probe.js` fetch before Analyze handlers are
exposed. The server rewrites that runtime fetch to a content-hash query, so a fresh parent cannot be
paired with a stale cached probe. If the probe cannot load or a cryptographically random per-render
capability cannot be created, telemetry fails closed; unauthenticated substitute messages are not
accepted.

Two reserved types travel from a probed frame. Both are accepted only when:

1. `event.source` is the `contentWindow` of the currently mounted iframe; and
2. `channel` equals the fresh per-render capability closed over by the trusted inlined probe.

The probe removes the script element containing the capability before creative markup parses. A
creative running in the same source-pinned frame can call `parent.postMessage`, but cannot read the
removed capability and therefore cannot forge either reserved type.

| Type                        | Sender                        | Parent handling                                                                    |
| --------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| `ortbtools-probe`           | authenticated probe hooks     | resets liveness; non-heartbeat messages enter the bounded behavior buffer          |
| `ortbtools-preview-refusal` | probe content-policy listener | validates the schema, resets liveness, and updates only the bounded refusal ledger |

**`ortbtools-preview-refusal` payload**

| Field       | Type    | Notes                                                             |
| ----------- | ------- | ----------------------------------------------------------------- |
| `type`      | string  | literal `ortbtools-preview-refusal`                               |
| `v`         | number  | exactly the supported probe version                               |
| `ts`        | number  | finite frame-local timestamp                                      |
| `channel`   | string  | opaque per-render capability                                      |
| `items`     | array   | batch of `{ directive, blockedUri }`; both fields must be strings |
| `truncated` | boolean | the sender or parent discarded entries at a bound                 |

The probe and parent independently enforce the refusal boundary. A render retains at most 200
distinct entries, and the parent examines at most 200 items from one batch; directive strings are at
most 64 characters and blocked URIs at most 2048 characters. Malformed entries are ignored. Overflow or an overlong value marks the
ledger truncated, and the UI reports the retained count as "at least". The parent deduplicates again
by `(directive, blockedUri)`, so probe restarts and overlapping policies do not inflate the total.

Refusal messages never enter the behavior event buffer or the behavior-analysis request. The frame
listener is registered on `window` in the capture phase so it survives creative `document.open()`.
Reporting is batched through a private `MessageChannel` task, with a captured microtask fallback, so
creative code cannot cancel the pending flush by replacing timer functions or guessing a numeric
timer handle. Unknown, stale-source, wrong-capability, malformed, and unsupported-version messages
are ignored.

Chromium directive aliases are normalized before localization: `script-src-elem`/`script-src-attr`
become scripts, `style-src-elem`/`style-src-attr` become styles, and equivalent image, child-frame,
worker/connection aliases map to the stable resource groups. Missing dictionary keys fall back to a
safe raw directive, never a `[creative…]` placeholder.

## 4. Static behavior-analysis source

Static rules analyze the creative body selected to execute, before probe/CSP instrumentation:

- classified markup uses the macro-resolved, once-decoded `result.body`;
- Native uses the escaped synthetic card HTML, never the raw Native JSON; and
- an asset-inlined banner rerender replaces the stored source with the rewritten HTML before the new
  frame is mounted.

The browser stores a deterministic UTF-8 prefix of at most 1 MiB, without cutting a multibyte
character, and sends canonical padded base64 as `adm_b64` plus `adm_truncated`. For bodies at or under
the bound, decoding `adm_b64` yields exactly the full body mounted in `srcdoc`; for larger bodies it
yields the exact bounded prefix and declares truncation. The server rejects non-canonical base64,
invalid UTF-8, and decoded data over the bound.

Static analysis runs even when the probe has produced zero runtime-visible events. A creative
revision and render generation prevent a same-count or previous-creative response from repainting a
newer Behavior tab. The public endpoint continues to accept legacy `{ events, adm }`; `adm_b64` takes
precedence when present.

## 5. Reveal, localization, and unchanged boundaries

The reveal overlay is offered only over a preview containing a revealable frame. Sizing and
revealability are independent: VAST and other text previews can size and scroll while declaring
nothing to reveal. VAST truncation text and refusal kinds are localized in English, Ukrainian, and
Russian with placeholder parity.

Unchanged by this contract:

- the content policy injected into the frame, byte for byte;
- `sandbox="allow-scripts"`, with `allow-same-origin` never added;
- the route, limits, accepted response types, and explicit-click semantics of
  `/api/creative/asset`;
- no automatic or Native-specific advertiser/third-party fetch; and
- the zero-creative-network assertion before an analyst explicitly invokes the pre-existing banner
  asset action.

The one narrowing host change is explicit: every syntactically valid IPv4-mapped IPv6 literal is
canonicalized to its embedded IPv4 address before the existing private/public classification and
before any socket opens. Compressed, partially compressed, expanded, dotted, and WHATWG-hex forms
therefore cannot spell a private IPv4 target around the guard; a mapped public control continues into
the existing pinned-address path.

Any future change to the frame policy, sandbox, route surface, response types, or accepted outbound
target classes is a privacy/security contract change under Principle III and requires its own package
and updated regression tests.

## 6. Verification

The contract is guarded at three levels:

- classifier unit tests cover every row, padded and valid unpadded base64, one decode round, Core
  delegation, and fail-closed missing dependencies;
- handler tests cover canonical 1 MiB UTF-8 base64 transport, truncation metadata, invalid input,
  zero-event static scanning, and legacy `{ events, adm }`; and
- a real-browser test covers authenticated probe messages, the parent 200-entry cap, behavior-buffer
  isolation, real CSP alias localization, inert URL/VAST states, wrapped/unwrapped Native parity,
  missing-classifier failure, exact decoded static-analysis bytes, hashed probe loading, and localized
  VAST trimming; and
- host-classification and asset-fetch tests cover mapped private forms with zero request calls and a
  mapped public control reaching the unchanged request path.
