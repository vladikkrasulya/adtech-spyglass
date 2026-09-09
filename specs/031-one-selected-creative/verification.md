# Verification: 031 One selected creative

**Date**: 2026-09-09 | **Feature**: [031](./spec.md) | **Status**: Complete

## Reproduced first, on payloads written here

Both reported defects were reproduced in real Chrome before any code changed, using an OpenRTB 3.0
EUR pair and a two-material feed authored for this feature rather than the reporter's fixtures. The
probe reads the live DOM: the price chip, the frame's `srcdoc`, the inert text and every selector
control's `aria-pressed`.

| Measurement                                     | Before  | After   |
| ----------------------------------------------- | ------- | ------- |
| 3.0 response declaring EUR, bid 1.25            | `$1.25` | `€1.25` |
| Mixed feed, before any click — material shown   | second  | first   |
| Mixed feed, before any click — price shown      | `$0.01` | `$0.42` |
| Mixed feed, after clicking the selected control | `BID`   | `$0.42` |

The third row was found while reproducing the second and is a defect of the same family: the price
chip followed a different material from the creative. The fourth was found in the same run: a vendor
Native material's own `cpc` never reached the chip at all.

## Two more the reproduction found

- **A creative attributed to a bid that does not exist.** For a response whose first seat carries an
  empty `bid` array, the analysis path rendered `findAdm(res)` — a whole-response walk that crosses
  the seat boundary — and labelled it with `seatbid[0].bid[0]`, which is `{}`. Verified directly:
  the markup shown belonged to seat B while the chip read `BID` from seat A's absent bid. Both
  affected cases had no `expect.preview` at all, so nothing observed it.
- **An analysis that stopped in silence.** `runAnalysis`'s guard read `j.success === false`, so a
  2xx whose body is not the documented envelope satisfied neither branch: no toast, no cleared
  result, the previous verdict left standing. Feature 027 fixed the structured-error half of this;
  this is the other half.

## The measured consequence of unifying the two copies

Before changing anything, the analysis path's algorithm and `resolveCreativeAt` were run against
every one of the 243 materialized responses and compared. They agreed on 229 and differed on 14 —
and twelve of those fourteen were shapes the resolver could not reach at all (`res.bid` wrappers and
bare single-object feeds: 0 of 6 and 0 of 6). Delegating without completing the resolver would have
regressed all twelve. That is why the resolver was completed first.

The displayed price was then measured for every corpus case before and after. Fourteen changed, and
each was read individually:

| Change                                 | Cases | Judgement                                                  |
| -------------------------------------- | ----- | ---------------------------------------------------------- |
| `$1.25` → `€1.25`                      | 1     | The reported currency defect                               |
| `$0.01` → `$0.42`                      | 1     | The reported selection defect                              |
| `BID` → the material's own price       | 8     | A price the response carried and the panel withheld        |
| `BID` → `$1.25` on an empty first seat | 2     | The cross-seat attribution defect                          |
| `$0.00` → the bid's own price          | 2     | A fabricated zero replaced by the number the response gave |

The last row is a behaviour change beyond the reported defects, so it is stated as a requirement and
pinned: `pop-x-nurl-only-response` and `encoding-adm-null` both carry a real bid price with nothing
renderable, and `$0.00` asserted something the response never said. Genuine no-bid responses still
show a formatted zero, and are unchanged.

## Results

| Check                                                    | Result                                 |
| -------------------------------------------------------- | -------------------------------------- |
| `tests/creative-resolution.test.js`                      | 51 pass / 0 fail                       |
| `tests/inspector-reentrant.test.js`                      | 24 pass / 0 fail                       |
| `tests/corpus-{core,http,lib,axes}.test.js`              | 554 pass / 0 fail                      |
| Browser layer, the fifteen affected cases                | 15 pass / 0 fail                       |
| `tests/corpus-ux-browser.test.js`                        | 12/12 scenarios, including the new one |
| i18n parity across en/uk/ru                              | 65 pass / 0 fail                       |
| Independent browser reproduction, re-run after the fix   | all four symptoms gone                 |
| `npx eslint`, `npx tsc --noEmit`, `npx prettier --check` | clean                                  |
| Full repository gate through the pre-push hook           | recorded in the delivery evidence      |

## The coverage the corpus was missing

`priceChip` had been measured by the harness since it was written and asserted nowhere. That is why
`bn-banner-30-adcom` — a conformant, green, un-gapped case carrying `cur: "EUR"` and `price: 1.25` —
never revealed the currency defect. The regression for it is that same case with one line added.

Two guards named "across the whole corpus" walked the corpus directory reading raw JSON, which skips
every mutation: they reached 135 of the 243 materialized responses, and examined only the first
material of any feed. Both now enumerate through the corpus loader and over every material, carrying
the same click-alias scope the resolver applies. Closing the gap changed no assertion outcome — the
same case ids come back — so it was a defect of the evidence, not of the product. A third guard now
asserts that the traversal itself is exhaustive, so this cannot quietly narrow again.

## Deployment

Shipped in **v1.21.0**, deployed 2026-09-09 through the standing path.
