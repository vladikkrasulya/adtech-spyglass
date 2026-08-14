# Implementation Plan: Silent Failure Detection

**Status**: Complete · **Created**: 2026-08-13 · **Spec**: [spec.md](./spec.md)

> Written after the implementation, alongside the retroactive assessment. See
> `.specify/assessments/silent-failure-detection/decision.md` for why that is recorded rather than
> smoothed over.

## Approach

One constraint drives the whole design: **any parse is a lossy projection**. Duplicate keys,
integer spellings, unexpanded macros and damaged consent bits are destroyed by the act of reading,
so a rule that receives a parsed object cannot see them. Raw bytes are therefore the source of
truth and every derived view is secondary.

Four layers, each a separate file so they can be reasoned about apart:

| Layer           | File                                | Responsibility                                                     |
| --------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Input repair    | `decoders/request/_input-repair.js` | Undo transport damage on a pasted string; report every change      |
| Verbatim query  | `decoders/request/_raw-query.js`    | Read the query without decoding; detect what decoding destroyed    |
| Signature match | `decoders/request/_signature.js`    | Recognise case-insensitively without rewriting the input           |
| Byte scan       | `raw-json.js`                       | Find duplicate keys, unsafe numbers and control characters in text |

Findings are emitted by thin rule modules (`rules-raw-json`, `rules-unknown-fields`,
`rules-consent`) that contain no analysis of their own — only the decision of how loudly to speak.

## Key decisions

- **Repair always, not on failure.** Measured: `?a=1&amp;b=2` and `?q=shoes)` parse successfully,
  so a repair-on-exception strategy never sees the cases that damage values.
- **Idempotence is an invariant, not a preference.** A tool that changes its own output on the
  second run is the silent mutation this work removes. Achieved by construction: the `&amp;` guard
  excludes `;` from the parameter-name class, so a double-escaped input never matches.
- **Match loosely, preserve exactly.** RFC 3986 §6.2.2.1 makes only scheme and host
  case-insensitive, so `endpoint`, `_raw` and `url` keep the operator's case.
- **Raw text is optional at the API.** `validate` gains `opts.rawText`; callers holding only the
  parsed object behave exactly as before.
- **Merge once, not per return.** `validate` has seven exits; the raw findings are merged at the
  top, because merging at each is how one gets forgotten.

## Plumbing

The browser parsed the pane before posting, so the server had never seen the operator's bytes.
`bidReqRaw` now carries them. The client also pretty-printed the pane after each analysis, which
re-serialises and erases exactly the defects being scanned for — the first analysis reported them
and every later one did not. The bytes are kept across that rewrite and dropped when the operator
edits the pane.

## Risks accepted

- **False positives are the live risk.** Every suite asserts silence on a clean payload first.
- **Hand-typed field registry.** 38 objects, 252 names, typed from the specs rather than generated.
  Each missing field is a false positive waiting for a payload that uses it.
- **Plausibility, not proof, in consent checks.** Capped at warning: IAB can publish a new policy
  version and turn a confident error into a false alarm.
