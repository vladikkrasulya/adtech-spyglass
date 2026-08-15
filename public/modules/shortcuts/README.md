# shortcuts — keyboard shortcuts + cheat-sheet modal

Captures global hotkeys (`?`, `Ctrl/Cmd+1…5`, `Ctrl/Cmd+Enter`,
`Ctrl/Cmd+S`, bare `M`) and renders a cheat-sheet modal listing the
bindings. Self-contained: injects its own `<style>` on first use; reuses
the shared `modalRoot` / `closeModal()` / `t()` primitives from
`ortbtools.app.js` and `i18n.js`.

## Files

- `index.js` — keydown listener + cheat-sheet modal renderer
- `i18n.js` — 8 namespaced strings × 3 locales
- `README.md` — this file

## Loading

EAGER — script-tag IIFE in the HTML shell, after `ortbtools.app.js` and
`i18n.js`. No `kt:inspector-ready` wait: hotkeys bind on
`document` and the modal target (`#modalRoot`) is in the shell, not the
inspector template.

## Window APIs (provides)

- `window.openShortcutsModal()` — open the cheat-sheet programmatically
  (e.g. from a future "?" pill in the format bar)

## Window APIs (consumes)

- `window.t(key)` — i18n lookup
- `window.openSaveModal()` — Ctrl/Cmd+S delegate (auth-gated upstream)
- `window.openMirrorModal()` — bare `M` delegate
- `window.runAnalysis()` — Ctrl/Cmd+Enter delegate (Inspector mounted only)
- `window.OrtbtoolsShell.navigateTo()` — Ctrl/Cmd+1…5 section jumps
- `/modules/nav/index.js` (dynamic import) — `SECTIONS` / `QUICK_JUMPS` /
  `prefixLocale` / `canonicalize`, so the jump targets stay single-sourced

## Hotkeys

| Combo              | Action                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `?` (Shift+/)      | Open cheat-sheet (skipped while typing, or modal open)                                                  |
| `Ctrl/Cmd + 1…5`   | Jump to Inspector / Streams / Samples / Dialects / Insights                                             |
| `Ctrl/Cmd + Enter` | `runAnalysis()` from anywhere on the Inspector (textareas keep their own binding in `ortbtools.app.js`) |
| `Ctrl/Cmd + S`     | `openSaveModal()` — overrides browser "save page"                                                       |
| `M` / `m`          | `openMirrorModal()` (skipped while typing, or modal open)                                               |

`Ctrl/Cmd+K` (command palette) lives in `modules/search/index.js`; `Esc`
(close menus/modals) lives in `ortbtools.app.js` — both are displayed in
the cheat-sheet but not owned by this module.

## Events

- Listens: `keydown` on `document`
- Dispatches: none

## Modal contract

Renders into `#modalRoot` using the shared `.modal-backdrop` /
`.modal-card` classes. The `.shortcuts-table` styles are scoped to this
module and injected once via `<style data-shortcuts="1">`.
