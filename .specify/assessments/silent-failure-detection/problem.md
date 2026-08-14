# Problem Definition: Silent Failure Detection

- **Slug**: silent-failure-detection
- **Created**: 2026-08-13
- **Inputs used**: intake.md, `docs/silent-failures-research-2026-08-13.md`,
  `docs/hypothesis-catalogue-2026-08-13.md`, `docs/hypothesis-triage-2026-08-13.md`,
  `docs/url-input-spec-2026-08-13.md`, direct measurement

## Problem Statement

An inspector exists to tell an engineer what is wrong with a payload. ortbtools could not report
an entire class of defect, because the defects are destroyed before any rule runs — by
`JSON.parse`, by `URLSearchParams`, by the tool's own input handling — and because several
answers it did compute were discarded one frame later without reaching a human.

## Affected Users & Stakeholders

- **Users**: integration engineers pasting a feed URL or a bid request. They receive either a
  green result over a damaged value, or a refusal with no reason, and cannot tell which of their
  own assumptions is wrong.
- **Users**: AdOps debugging a live integration. A duplicate `bidfloor` or an identifier past
  2^53-1 changes money and identity between two participants who both believe they agree.
- **Stakeholders**: platform operator. A tool that reports a green status over a silently mutated
  input teaches operators to distrust it, which is worse than reporting nothing.

## Evidence

Measured on Node 22.23.2 (ada), Chrome 151 (GURL), Firefox 140esr (rust-url), Python 3.13.5.
No divergence between the URL engines on any case.

| Defect                     | Behaviour                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate JSON key         | Node and Python both keep the last value silently. RFC 8259 §4 leaves it undefined, so receivers may disagree. After `JSON.parse` the ambiguity is unrecoverable. |
| Integer past 2^53-1        | `9007199254740993` reads back as `…992` in Node, intact in Python. Same bytes, different identifier by receiver language.                                         |
| Misspelled field           | Forward compatibility requires ignoring unknown fields, so `protcols` has no effect and nothing reports it.                                                       |
| Unexpanded feed macro      | `searchParams` destroys `%%CACHEBUSTER%%` (`CA` is valid hex) and leaves `%%CLICK_URL%%` intact. Damage depends on the macro's name; `href` still looks whole.    |
| Damaged TCF consent string | Decodes without exception into different consent, switching on purposes and special features nobody granted.                                                      |

Three further defects were confirmed inside this codebase during the work: `_raw` violated its
own documented "verbatim" contract in two decoders; `decodeRequest` returned `null` for two
different events; and the computed refusal reasons never reached `validate`, so a mistyped feed
host was answered with "expected a JSON object or array".

## Goals

- Report defects that exist only in the bytes, on the payloads already flowing through `validate`.
- Never mutate an operator's input without saying what changed.
- Distinguish "not a URL" from "not a feed we recognise" from "a scheme we cannot fetch".
- Preserve the operator's input exactly, whatever the tool does to recognise it.

## Non-Goals

- Breadth across supply-chain, consent and creative surfaces as standalone products.
- Any network call, fetch, or live probe.
- Repairing structure that is genuinely ambiguous rather than reporting it.

## Success Signals

- A clean payload produces zero findings from every new rule. Silence on correct input is the
  gating property; a rule that cries wolf gets disabled and then reports nothing at all.
- Repeated analysis of the same paste yields the same findings.
- Every repair the tool performs is recoverable and reported.
