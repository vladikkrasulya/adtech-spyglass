# Verification of the 021 review follow-up

The follow-up to 977e6b1 repairs the two reproduced regression classes: supplied malformed request values could be reduced to omission guidance, and an invalid supplied nbr could make an empty-seatbid response appear clean. The original omission corrections remain intact. Core is 0.40.0; the CLI uses ^0.40.0. The app/CLI version lines and production deployment are outside this follow-up.

## Behavior and compatibility

Supplied site/app/dooh/device values must be non-null, non-array objects, and supplied ua/ip/ipv6 must be strings. The absence test includes explicit undefined; false/0/null/arrays cannot masquerade as omission. Existing empty-string client guidance and DOOH info levels remain. Supplied nbr must be an integer, regardless of seatbid presence or cardinality. No address parsing, network ranges or reason-code enum/range policy was added.

The 13 new error ids, field paths and compatibility decision are listed in [contracts/finding-levels.md](contracts/finding-levels.md). Old ids remain. All new ids have English/Ukrainian/Russian messages and primary-source references, and literal severity call sites remain visible to the public finding catalog.

## Evidence

Evidence directory: `/home/vk/.local/share/ortbtools-research/2026-09-08-021-review-followup/`. Review reproductions against the original implementation remain separately archived under `2026-09-08-fable-021-review/`.

- `types-before.log`: new regression suite against 977e6b1 — eight failing groups and two passing omission controls.
- `types-after.log`: all ten groups pass after the repair. Loops cover malformed object/client values and malformed nbr in both protocol families, omission and explicit undefined, valid IPv6 fallback, empty-string guidance and valid integer no-bids. The default CLI and real HTTP analyze endpoint are exercised, including localized error messages.
- The initial wider focused run caught an old sample assertion that expected an omission id for numeric ua. The fixture itself is unchanged; its test now requires the correct invalid-type error and forbids the omission finding. `focused.log` retains that diagnostic failure.
- `focused-final.log`: 990 tests/subtests, 821 passes, 166 expected-failure markers, three explicit Core transport skips; zero failures or cancellations. Commands cover the new suite, validator, OpenRTB 3.0, CLI, crosscheck, locales, finding metadata, governance/version contracts and the full Core/HTTP corpus.
- Format, lint and typecheck pass. An independent read-only review of the four runtime rule files and new tests found no blocker; no browser driver or assertion was weakened.

Full local `npm run ci` exited 0: 4,035 tests/subtests, 3,866 passes, 166 expected-failure markers and 3 explicit transport skips, zero failures/cancellations and no runner retries; 162 nonbrowser and 25 browser files. `ci.log` and `ci-summary.json` retain the measured results. Convergence found zero gaps across 11 requirements, five success criteria, 12 acceptance scenarios, eight plan decisions and eight constitution principles. It left tasks.md byte-for-byte unchanged during assessment; `convergence.json` records the matching hashes. All 19 implementation tasks are now complete. Operational delivery still requires the mandatory pre-push gate and exact-commit hosted CI. The final commit/remote agreement and hosted results will be recorded in `delivery.json` beside the logs before completion is reported.

The integration base also includes Fable’s f8168ca correction to the packed-CLI smoke fixture after the first hosted run of 977e6b1 failed that step. Its genuine sizeless-banner error preserves the intended exit-1 check. The follow-up retains that correction and its recorded failure history. The packed install/help/CLI exit-1 smoke now passes locally on Core 0.40.0 (`npm-pack-smoke.log`), and the final completion-document contract check passes all ten tests (`completion-contract-final.log`).

## Corpus results and boundaries

Of the 21 originally targeted cases, 20 are fully normative; the CTV dynamic pod still carries browser DEF-201 because the second bid cannot be selected. Eight other cases retain their existing unrelated deviations. The original 256 payloads and normative expectations are unchanged, and the current ledger contains 40 groups after the four omission/no-bid groups were retired. The original 020 coverage reports retain their dated evidence; the corrected current disposition is recorded here and in the resolution section of its defect report.

This work fixes the two review regression classes and the inaccurate completion counts. It does not claim all remaining product defects or the separate cleanup backlog are resolved.
