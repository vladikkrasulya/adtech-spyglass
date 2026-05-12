# dialects-questions plugin

Walks oRTB `imp[].ext.*` and `req.ext.*` keys. For any key outside the
IAB-blessed allowlist that the user hasn't already labelled, emits a
`level:'question'` finding carrying a shape-based recommendation.

## What it does NOT do

- It does not validate against the IAB spec — that's the legacy
  `rules-request.js` job.
- It does not block. `rollupStatus` filters `question` findings out of
  the top-level severity rollup.
- It does not know about specific vendors. The shape heuristic and
  allowlist are vendor-agnostic; per-user mappings live in the cabinet,
  not in this repo.

## Why `question` level?

Spec violations are `error`/`warning`/`info`. An unrecognized vendor
extension isn't a violation — it's an _open question_: "you put
something here, what does it mean?". The user answers once per
(signal_path, signal_value) pair; subsequent payloads with the same
signal are silently skipped on lookup.

## ctx.userDialect

The plugin reads `ctx.userDialect` (optional). If present, it must
expose:

```
userDialect.lookupMapping(signalPath, signalValue) -> mapping|null
```

Anonymous validation (`ctx.userDialect == null`) emits all unknown-ext
questions — useful for the public demo but noisier.

## Severity reasoning per finding

There's only one finding id emitted by this plugin
(`dialects.question.unknown_ext_signal`), so the matrix is small:

| level    | when                                                                 |
| -------- | -------------------------------------------------------------------- |
| question | imp.ext or req.ext key outside IAB allowlist AND not in user dialect |

The shape heuristic decides `params.recommended` — if it's `null`, the
UI shows "label manually". If it's `{format, confidence:'high'}`, the
UI shows that format as the pre-selected option.

## Cap

20 question findings per payload max. Payloads with many vendor fields
would otherwise flood the UI; 20 is enough to surface the most common
pop-family / video-ext / native-asset patterns.

## Allowlist maintenance

`KNOWN_IAB_IMP_EXT_KEYS` and `KNOWN_IAB_REQ_EXT_KEYS` sourced from IAB
oRTB 2.6 + 3.0 specs + widely-adopted public extensions (SKAdNetwork,
GPID, DSA, etc.). Extend ONLY for public, spec-documented keys. Vendor-
specific keys belong in user dialects, never here.
