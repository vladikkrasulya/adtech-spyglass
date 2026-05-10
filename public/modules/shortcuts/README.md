# shortcuts — keyboard shortcuts + cheat-sheet modal

Captures global hotkeys (`?`, `Ctrl/Cmd+S`, bare `M`) and renders a
cheat-sheet modal listing the bindings. Self-contained: injects its own
`<style>` on first use; reuses the shared `modalRoot` / `closeModal()` /
`t()` primitives from `spyglass.app.js` and `i18n.js`.

## Files

- `index.js` — keydown listener + cheat-sheet modal renderer
- `i18n.js` — 6 namespaced strings × 3 locales
- `README.md` — this file

## Loading

EAGER — script-tag IIFE in the HTML shell, after `spyglass.app.js` and
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

## Hotkeys

| Combo          | Action                                                    |
| -------------- | --------------------------------------------------------- |
| `?` (Shift+/)  | Open cheat-sheet (skipped while typing, or modal open)    |
| `Ctrl/Cmd + S` | `openSaveModal()` — overrides browser "save page"         |
| `M` / `m`      | `openMirrorModal()` (skipped while typing, or modal open) |

`Ctrl/Cmd+Enter` (run analysis) and `Esc` (close modal) live in
`spyglass.app.js` and aren't owned by this module — only displayed.

## Events

- Listens: `keydown` on `document`
- Dispatches: none

## Modal contract

Renders into `#modalRoot` using the shared `.modal-backdrop` /
`.modal-card` classes. The `.shortcuts-table` styles are scoped to this
module and injected once via `<style data-shortcuts="1">`.
