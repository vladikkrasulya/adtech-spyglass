# Implementation Plan: Theme Cycle Visible Feedback

**Branch**: `fix/theme-cycle-visible-feedback` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

## Summary

Reorder the shell theme cycle so the press that cannot repaint is the press into auto rather than the
press out of it. The state set, the storage key, its values, and every consumer of that key stay
exactly as they are; only the successor function and the control's own title/glyph change.

## Technical Context

**Language/Version**: Browser JavaScript in the localized shell head IIFE; Node.js `>=22.13.0` test
baseline

**Primary Dependencies**: None added. The IIFE runs before any module and must keep doing so.

**Storage**: `kt-theme` in `localStorage`. Key, values (`light`, `dark`, absent = auto), and meanings
are unchanged, so an existing saved preference keeps working across the upgrade.

**Testing**: `node:test` with jsdom for the successor function's contract; serial Puppeteer with the
media feature pinned to both `light` and `dark` for the cycle itself

**Target Platform**: Public web application, evergreen browsers

**Project Type**: Server-rendered localized shells plus a vanilla-JavaScript SPA

**Constraints**: EN/UK/RU parity across six files; no new dependency; the IIFE stays inline and
synchronous because it exists to set `data-theme` before first paint

## The arithmetic this feature does not fight

Three states map onto two appearances, so at least one adjacent pair in any three-cycle shares an
appearance. No ordering removes the silent press; ordering only decides which press it is. Today it
is the first press from auto — the one a new visitor makes, and the worst possible place for it. This
feature moves it to the return into auto, where an unchanged appearance is the correct answer rather
than a confusing one.

The spec states this openly rather than promising that every press repaints, because that promise
cannot be kept without dropping to two states and losing "follow the system" as a reachable choice.

## Successor function

Let `sys` be the theme the system currently resolves to and `opp` its opposite.

| Stored | Next  | Repaints?                                                    |
| ------ | ----- | ------------------------------------------------------------ |
| auto   | `opp` | yes                                                          |
| `opp`  | `sys` | yes                                                          |
| `sys`  | auto  | no — and correctly so, the value already equals the system's |

## Constitution Check

_GATE: Passed before design._

- **I — Spec Kit memory**: This package exists before the change, which is the order 006 could not
  claim; it was opened from the follow-up recorded in the 1.14.3 release.
- **II — Evidence-backed truth**: The defect was reproduced deterministically under pinned media
  features before any edit, and the same harness proves the fix.
- **III — Privacy/security**: No collection, retention, auth, network, or payload change.
- **IV — Compatible contracts**: `kt-theme` keeps its key, values, and meanings; Account radios and
  the rail label keep their behavior. No Core, CLI, API, route, or storage change.
- **V — Bounded architecture**: Edits one existing IIFE in place; no new owner, module, or store.
- **VI — Locale parity**: All six localized shells move in the same change.
- **VII — Proportional verification**: A DOM test for the successor contract, plus browser coverage
  pinned to both system preferences — the omission that let the original defect ship.
- **VIII — Traceable release**: App patch `1.14.4`; Core and CLI unchanged. Deployment is a separate
  authorization and is not implied by this plan.

## Project Structure

```text
specs/007-theme-cycle-visible-feedback/
├── spec.md
├── plan.md
├── checklists/requirements.md
└── tasks.md

public/
├── index.{en,uk,ru}.html    # head IIFE: successor, title, glyph
└── about.{en,uk,ru}.html    # same IIFE

tests/
├── theme-cycle.test.js                      # successor contract, both system preferences
└── single-chrome-control-browser.test.js    # cycle expectation updated to the new order
```

**Structure Decision**: Keep the IIFE as the single owner. The six copies are duplicated by the
existing shell-templating approach; unifying them is a separate, larger change and is not smuggled
into a behavior fix.

## Complexity Tracking

No constitution violation and no new architectural mechanism.
