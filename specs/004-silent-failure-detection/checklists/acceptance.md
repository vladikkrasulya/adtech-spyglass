# Acceptance Checklist: Silent Failure Detection

Verified against the implemented branch with full CI green.

- [x] All fifteen paste variants are recognised; the previously accepted-and-damaged cases report the repair (US1, SC-001)
- [x] `?q=(shoes)` keeps its balanced parentheses while `?q=shoes)` loses the unbalanced one (US1)
- [x] `repairInput(repairInput(x).text).repairs` is empty for every input in the suite, including double-escaped `&amp;amp;` (FR-002)
- [x] Every repair records step, before and after; the original text is recoverable (FR-003, US1)
- [x] `endpoint`, `_raw` and `url` keep the operator's case after a case-insensitive match (FR-004)
- [x] `_raw` is read without percent-decoding; unexpanded macros survive verbatim in both decoders (FR-005)
- [x] Refusals are distinguishable: unparseable, unsupported scheme, no decoder (FR-006, US2)
- [x] Prose, SQL, markup and bare numbers keep the JSON answer rather than being claimed as URLs (US2)
- [x] Duplicate keys are errors on money and identity fields, warnings elsewhere (US3, FR-008)
- [x] An integer past 2^53-1 is reported with the value it reads back as (US3)
- [x] Findings do not disappear on a second analysis of the same paste (SC-003, US3)
- [x] Raw findings are absent when the caller supplies no text; behaviour is otherwise unchanged (FR-007)
- [x] Unknown keys under `ext` produce nothing at any depth (US4)
- [x] A real field in the wrong object names where it belongs and invents no correction (US4)
- [x] A sound TCF consent string produces nothing; a damaged one warns (US5, FR-009)
- [x] A GPP string is not read by the TCF reader (US5)
- [x] Zero findings from the new rules across the repository's OpenRTB fixture corpus (SC-002)
- [x] No rule performs network access (FR-010)
- [x] Full CI green including the raw-control-character source gate (SC-004)
