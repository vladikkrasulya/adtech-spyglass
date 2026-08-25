# Contract: Creative Preview Classification and Refusal Reporting

**Scope**: the Inspector's preview column and the frame-to-parent message channel. Extends
[frontend-modules](../../000-platform-baseline/contracts/frontend-modules.md) §"Creative Preview and
Behavior Probe"; nothing in that section is relaxed.

## 1. Classification order

A creative body is classified exactly once per render, before any display decision. The order is
normative — a body can satisfy more than one test, and the first match wins.

| #   | Kind           | Test                                                                                                               | Displayed as                                        |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 1   | `vast`         | `isVastShape` from `packages/core/vast-shape.js`                                                                   | scrollable inert text, no reveal overlay            |
| 2   | `native`       | parses as JSON and exposes an assets array at `native.assets` or at top level                                      | rendered native card, in a probed frame             |
| 3   | `json`         | parses as JSON, no native assets                                                                                   | inert text, named as an unidentified payload        |
| 4   | `base64`       | matches base64 within the length bound and decodes to a body that classifies as anything other than `unidentified` | as the decoded classification, with decoding stated |
| 5   | `url`          | the whole trimmed body is one absolute `http(s)` URL                                                               | inert text; never fetched, never linked             |
| 6   | `markup`       | contains at least one element-like construct                                                                       | frame `srcdoc`                                      |
| 7   | `unidentified` | everything else                                                                                                    | inert text, named as unidentified                   |

**Invariants**

- Only `markup` reaches `srcdoc`. Every other kind is inert text.
- Exactly one base64 decode round; a decoded body that is again base64 is `unidentified`.
- Classification never rewrites the body it classifies. The bytes handed to the frame are the bytes
  the behaviour engine and the static scanner measure.
- VAST recognition has exactly one implementation in the product. The preview does not carry its own.

## 2. Inert-text rule

Any body not classified `markup`, and the VAST text view, are written to the parent DOM with
`textContent`.

- `innerHTML` is prohibited on this path, with or without an escaping helper. The baseline contract
  forbids promoting preview markup into the parent origin, and writing text performs no parse, so
  there is nothing for an escaping function to get wrong.
- No anchor, image, or other fetching element is generated from payload content. A URL body is text.
- This applies to blocked-resource identifiers in the refusal display, which are equally
  payload-derived.

## 3. Frame-to-parent messages

Two types now travel this channel. Both are subject to the existing source-pinning check: the parent
accepts a message only when `event.source` is the `contentWindow` of the frame it just mounted.

| Type                        | Sender                        | Parent handling                                                                                  |
| --------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `ortbtools-probe`           | probe instrumentation hooks   | unchanged — resets the watchdog clock; non-heartbeat messages enter the bounded behaviour buffer |
| `ortbtools-preview-refusal` | probe content-policy listener | resets the watchdog clock; updates the refusal ledger only                                       |

**`ortbtools-preview-refusal` payload**

| Field       | Type    | Notes                                                              |
| ----------- | ------- | ------------------------------------------------------------------ |
| `type`      | string  | literal `ortbtools-preview-refusal`                                |
| `v`         | number  | probe version, as on `ortbtools-probe`                             |
| `ts`        | number  | frame-local timestamp                                              |
| `items`     | array   | batch of `{ directive, blockedUri }`; both strings, both untrusted |
| `truncated` | boolean | the frame stopped reporting at its per-render cap                  |

**Invariants**

- A refusal message MUST NOT enter the behaviour event buffer. That buffer is bounded at 500 and drops
  the oldest; routing refusals through it would let a creative emitting hundreds of violations evict
  the navigation and frame-bust evidence it is being measured for.
- Refusals MUST NOT appear in the behaviour analysis request body, and MUST NOT change the number or
  content of behaviour findings for a given payload.
- The frame's listener is registered on `window` in the capture phase, because `document.open()`
  detaches document-level listeners on precisely the creatives that most need reporting.
- Reporting is batched on a short timer and capped per render.
- An unknown message type is ignored, as today.

## 4. Reveal overlay

The overlay is offered only over a preview containing a revealable creative. Sizing and revealability
are independent signals: a text-mode preview may size its own box while declaring nothing to reveal.

The blur selector continues to match only `iframe, img`, so screenshot-safety for actual creatives is
unchanged.

## 5. Unchanged by this contract

Stated explicitly, because the value of this wave depends on it:

- the content policy injected into the frame, byte for byte;
- `sandbox="allow-scripts"`, with `allow-same-origin` never added;
- the request behaviour, route, limits, and response types of `/api/creative/asset`;
- the existing assertion that a rendered creative reaches no network.

Any change to the first three is a privacy/security contract change under Principle III and requires
its own package, its own decision, and updated regression tests in the same change.
