# Public-Boundary Contract: Inspector UI Repair

This feature changes only `public/`. Core, the HTTP API and the CLI are untouched: no finding id,
level, message, `spec-refs.json` entry or package version changes. Shipped in v1.20.0 (`76570e4`) on 2026-09-09.

## What changes for an operator

| Situation                                                                            | Before                                                         | After                                                                          |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| An analysis fails with a structured server error                                     | previous verdict, stored analysis and preview stayed on screen | all three are invalidated and the failure is explained                         |
| Saved history entries after such a failure                                           | untouched                                                      | untouched                                                                      |
| Re-pasting text equal to the last pretty-print                                       | analysis used the pre-pretty bytes                             | analysis uses the newly pasted bytes                                           |
| Pretty-printing                                                                      | pre-pretty bytes remain the provenance                         | unchanged                                                                      |
| A response with more than one creative                                               | only the first was reachable                                   | a labelled, keyboard-operable selector reaches every seat/bid pair or material |
| A response with exactly one creative                                                 | no selector                                                    | unchanged — no selector                                                        |
| Documented vendor wrapper (EXADS, Adon3, Kadam clickunder, feed redirect, link-feed) | empty preview                                                  | visible card or inert destination                                              |
| PPCmate pop material (no visual asset)                                               | dressed as a push notification card                            | inert destination                                                              |
| Icon-only or image-only push material                                                | rendered                                                       | unchanged — still rendered                                                     |
| Vendor banner bid with price + click + picture                                       | —                                                              | not dressed as a notification card                                             |
| Rendered creative frame                                                              | no accessible name                                             | localized name stating kind and dimensions                                     |
| Redirect-script pop                                                                  | blank box, no identity                                         | **unchanged** — still blank; DEF-245 stays open                                |

## What does not change

The sealed preview frame keeps its policy exactly: `default-src 'none'`, `script-src
'unsafe-inline'`, `img-src data: blob:`, `media-src 'none'`, `frame-src 'none'`, `sandbox
allow-scripts`. Nothing new executes, fetches or navigates. Remote images remain refused, with the
existing explanation and the existing "Load N image(s)" action.

## Compatibility decision

1. **No id, level or message changes**, so nothing keyed on the Core contract is affected.
2. **The selector is additive**: it appears only when a second creative exists, and resolves from
   the already-stored analysis rather than issuing a new request.
3. **Push qualification narrows and widens at once**: it now requires a visual asset plus
   notification identity. A PPCmate pop and a vendor banner bid stop being claimed as cards; an
   icon-only or image-only material keeps rendering as one. Pinned by test in both directions.
4. **Corpus expectations were not weakened.** Two per-creative expectations were _added_ for
   materials the selector newly exposed, declaring the partial render their remote images produce
   under the frame policy. DEF-245 keeps its record; two PPCmate pairs are re-pinned to the still
   open DEF-107.

## Consumers checked

- Core, CLI, the HTTP handler and the smoke scripts are untouched by this change.
- `tests/push-preview-browser.test.js` (014 FR-005) and the two vendor-banner assertions in
  `tests/creative-resolution.test.js` pin the push-qualification rule from both sides.
- The 020 corpus browser, UX and accessibility layers are the regression net.
