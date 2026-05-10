# embed — iframe-snippet generator + embed-mode renderer

Two roles:

1. **Producing the embed.** Opens a modal where the user copies an
   `<iframe>` snippet pointing at the current bid via the share-link
   URL primitive (`?embed=1#req=…&res=…`). Reuses the share module's
   `buildShareUrl` and slots `?embed=1` into the existing query so
   the loaded view strips chrome.
2. **Rendering the embed.** When the URL has `?embed=1`, the inline
   head-IIFE in each HTML shell sets `data-embed="1"` on
   `documentElement`. CSS gated on that attribute hides the
   header / input panels / left sidebar / footer / theme-toggle and
   tightens the layout for in-iframe display.

## Files

- `index.js` — modal builder + embed URL composition
- `i18n.js` — 6 namespaced strings × 3 locales
- `README.md` — this file

## Loading

EAGER — both `i18n.js` and `index.js` are loaded at boot from the
HTML shells (after `modules/share/`, before `spyglass.app.js`).
Unlike `mirror`, `live`, or `simulate` (lazy on tab activation), the
embed modal is reachable from the topnav/share menu, so it has to be
ready as soon as the workbench mounts.

## Window APIs (provides)

- `window.openEmbedModal()` — opens the snippet-builder modal
- `window._copyEmbedSnippet()` — copy handler wired into the modal
  markup (top-level so inline `onclick` can find it)

## Window APIs (consumes)

- `window.buildShareUrl(reqText, resText) → Promise<string>` — from
  `modules/share/index.js`
- `window.spyglassShareSupported() → boolean` — feature-detect from
  `modules/share/index.js`
- `window.t(key, params)` — i18n lookup
- `window.toast(msg, type)` — toast surface
- `window.closeModal()` — modal-host close handler

## Events

- Listens: none (no DOM-ready gating; just sits idle until the
  topnav button calls `openEmbedModal`)
- Dispatches: none

## URL shape produced

```
https://spyglass.kyivtech.com.ua/?embed=1#req=<b64url(deflate(json))>&res=<...>
```

`?embed=1` is the chrome-stripper flag; the hash fragment carries
the same compressed payload as a normal share link, so the URL_BUDGET
ceiling (7000 chars) applies the same way.
