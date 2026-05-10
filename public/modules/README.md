# Spyglass modules

Each tool (mirror, live, simulate, replay, corpus, share, …) is its own
module. A module is a folder. Add the folder, register it, the tool
exists. Delete the folder, unregister, the tool is gone — without
touching anything else. Same idea as design-system tokens, but for code.

## Layout

```
modules/<tool>/
  index.js        ← entry point. IIFE that wires up the tool
                    (event listeners, exposed window.* APIs, lifecycle).
                    Must be self-contained: no imports from other modules.
  i18n.js         ← per-module translation registration. Pushes its keys
                    to window.kt_i18n_modules; the central /i18n.js merges
                    them into the global I18N table. Keys are NAMESPACED
                    by tool ("toast.share_*", "modal.mirror.*", …).
  template.{lang}.html  ← (only if the tool injects DOM). One file per
                          locale. Loaded lazy by index.js on first use.
  styles.css      ← (only if the tool needs styles beyond design-system
                    tokens). Loaded lazy by index.js the same way.
  README.md       ← one-paragraph description: what the tool does,
                    what window.* APIs it exposes, what events it
                    listens to / dispatches.
```

## Lifecycle

Modules are loaded in the HTML shell as `<script>` tags in this order:

1. `/i18n.js` (central) — defines `window.t()` and `window.registerI18nModule()`.
2. `/modules/<tool>/i18n.js` — pushes keys (or registers if i18n.js already loaded).
3. `/modules/<tool>/index.js` — wires the tool. Listens for `kt:inspector-ready`
    if it depends on workbench DOM (#bidReq, #bidRes, …).

Module index.js MUST be wrapped in an IIFE — `'use strict'` mode, no
globals leaked except via explicit `window.<name>` assignments at the
bottom of the file.

## Communication between modules

Modules don't import each other. They communicate via:

- **window.* APIs** — `window.buildShareUrl`, `window.runAnalysis`,
  `window.toast`, `window.t`. Documented in each module's README.
- **DOM events** — `kt:inspector-ready`, `kt:locale-changed`,
  `kt:analysis-complete`. Names are `kt:` prefixed.
- **Shared DOM contracts** — `#bidReq`, `#bidRes`, `#findingDetail`,
  `#modalRoot`. Owned by `modules/inspector/` (the workbench template).

If you need a new cross-module API, it gets a `kt:` event or a
`window.*` function with a one-line comment in both modules' READMEs.
No "magic" — every cross-module touchpoint is explicit and grepable.

## Versioning

Each module's `i18n.js` and `index.js` are content-hashed by the server's
`rewriteAssetVersions()` (server.js:245) — no manual `?v=N` bumps needed.
Touch the file → hash changes → cache invalidates.

## Tests

Module-local tests live in `tests/modules/<tool>.test.js` (top-level
tests/ dir, mirroring the modules/ structure). Reason: Node's test
runner discovers via glob; keeping all tests under tests/ avoids per-
module test-config repetition.
