# Research: Audio Repair Boundaries

**Date**: 2026-09-08

## R1 — Preserve reviewed intent and prove new repairs

**Decision**: Adopt the exact 35-file `completion.patch` from the Gemini review, based on `82c04260f8e18f226cf8dea782ae8863f95a47ca`, then repair only its remaining scanner/JSDoc blockers and uncovered boundaries.
**Rationale**: Independent review passed the original audio corpus and all 12 R1–R4 controls, but reproduced R5 termination failure and R6 typecheck failure. Original passing cases cannot disprove either regression. The external archive is `ortbtools-research/2026-09-08-gemini-audio-watch/`; its snapshot and logs preserve exact provenance.
**Alternatives considered**: Accepting only original corpus success would miss the reproduced hang. Reimplementing the complete patch would add unnecessary scope and discard verified work.

## R2 — Numeric protocol and MIME contracts

**Decision**: Use the pinned IAB baseline already held by 020/021. [OpenRTB 2.6](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/403cbba542de3a5d9cfcccd0a34e74b01b79a9f1/2.6.md) Object Audio requires `mimes` as a string array. Its audio/video protocol enumeration distinguishes DAAST 1.0 codes 9/10 from VAST 4.x codes 7/8/11–14; code 4 is VAST 1 wrapper and must not claim DAAST. [AdCOM 1.0](https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/df8ba06de0ba77c82efee7a2dc832bd4968474d6/AdCOM%20v1.0%20FINAL.md) Audio and Video response objects use scalar integer `ctype`; placement requests use integer arrays.
**Rationale**: The former detector mixed protocol codes and a response-array fallback confused distinct object contracts. New missing/invalid MIME errors complement required-field validation without adding media capability discovery.
**Alternatives considered**: Treating response arrays as compatibility metadata has no accepted contract and would invent evidence from malformed fields. Expanding this into full protocol enum/type validation is outside this repair.

## R3 — XML evidence and termination

**Decision**: Keep the existing bounded scanner, consume actual attributes, ignore comments/CDATA/DOCTYPE bodies, and require input progress or termination on every malformed token.
**Rationale**: The review proved apparent type attributes inside another quoted value and declarations can create false audio evidence. The latest repair then exposed a nonprogressing attribute token and unbounded allocation. Isolated worker/process watchdogs make this regression safe to execute.
**Alternatives considered**: Regex over raw tag content loses quoted-value boundaries. A new general XML parser or entity resolver would expand architecture and security scope. Whole-document XML conformance is not promised by format detection.

## R4 — DAAST preview and evidence accounting

**Decision**: Use shared root recognition and the existing inert `vast` text preview; do not execute or fetch DAAST. Preserve all 17 payloads and normative expectations; 16 are fully normative, one remains browser DEF-201. Retire only DEF-101/112/102, leaving 37 groups in this audio-only ledger snapshot.
**Rationale**: Document inspection satisfies the existing preview contract; audio playback and arbitrary wrappers are separate capabilities. Coverage completion and defect closure remain distinct.
**Alternatives considered**: Rendering DAAST as generic markup misrepresents it; closing the independent multi-bid selection defect would hide an observed failure.

## R5 — Versions and concurrent work

**Decision**: Core0.42.0 records two additive error IDs and corrected audio detection; CLI0.1.3 consumes ^0.42.0 and app1.19.4 remains. Work and tests stay in an isolated checkout/process namespace; delivery is an isolated verified local commit/patch.
**Rationale**: Finding additions can change verdicts and justify the Core minor bump. Existing CLI exit policy, app API and preview interaction shape remain. Isolation prevents automatic test cleanup or Git operations from affecting Claude Code/Cursor.
**Alternatives considered**: Reusing 021's current feature pointer hides audio intent. Shared-main mutation or parallel cleanup would risk unrelated active work. Neither is necessary for local completion.
