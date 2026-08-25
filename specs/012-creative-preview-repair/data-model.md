# Data Model: Creative Preview Repair — Wave 1

Nothing here is persisted. Both entities live in the parent tab for the duration of one render and are
discarded when the next creative mounts. No schema, no storage, no wire format leaves the browser.

## Creative Body Classification

The determination of what a creative body _is_, made once before any display decision.

| Field     | Type           | Notes                                                                                                |
| --------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `kind`    | enum           | `vast` \| `native` \| `markup` \| `json` \| `url` \| `unidentified`                                  |
| `body`    | string         | the body to act on — the decoded form when `decoded` is true, otherwise the input unchanged          |
| `decoded` | boolean        | true when one base64 decode round was applied before classifying                                     |
| `native`  | object \| null | normalised native object when `kind === 'native'`, in the wrapped shape the renderer already accepts |
| `reason`  | string         | the test that decided it; carried for display and for test assertions                                |

**Rules**

- Classification is pure: same input, same output, no clock, no network, no DOM mutation.
- Exactly one base64 decode round. A decoded body that is itself base64 classifies as `unidentified`,
  never as a second decode.
- The decode attempt is bounded by input length; an oversized body is `unidentified` without decoding.
- `kind === 'markup'` is the **only** classification permitted to reach a frame's `srcdoc`.
- `native` normalisation accepts assets at `native.assets` or at top-level `assets`, and emits the
  wrapped shape, so the existing renderer needs no change.
- `body` is never rewritten for display purposes. Macro literals stay exactly as the frame will
  receive them, because the behaviour engine and the static scanner measure those same bytes.

**State**: none. Recomputed on every `setAdPreview` call.

## Refusal Ledger

The per-render tally of sub-resources the sealed frame refused to load.

| Field       | Type    | Notes                                                                                     |
| ----------- | ------- | ----------------------------------------------------------------------------------------- |
| `entries`   | Map     | key is the directive and the blocked URI joined, so one refused resource counts once      |
| `count`     | number  | distinct entries                                                                          |
| `hosts`     | Set     | distinct hosts parsed from blocked URIs; unparseable identifiers are grouped, not dropped |
| `kinds`     | Map     | refused directive → count, so "8 images and 2 scripts" is answerable, not just "10"       |
| `truncated` | boolean | true when the frame stopped reporting because the per-render cap was reached              |

**Rules**

- Deduplicated by `(directive, blockedUri)`. The `srcdoc` document is governed by two overlapping
  policies, so one refused resource can raise two violations; counting raw events would inflate the
  number the analyst is asked to trust.
- Bounded per render. On reaching the cap the frame stops reporting and sets `truncated`, so a
  pathological creative cannot grow parent memory. The displayed count then reads as "at least".
- Kept entirely separate from the behaviour event buffer. It has its own message type and its own
  store, and never calls `pushBehaviorEvent` — see [contracts/creative-preview.md](./contracts/creative-preview.md).
- Cleared in `setAdPreview` alongside `resetBehavior()` and `stopWatchdog()`, on every branch,
  including branches that mount no frame.
- Blocked URIs originate in hostile payload. They are displayed as text, never parsed into markup.

**Lifetime**: one render. Not persisted, not sent to any endpoint, not included in the behaviour
analysis request body.
