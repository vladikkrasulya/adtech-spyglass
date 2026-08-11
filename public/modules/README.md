# ortbtools frontend modules

`public/modules/` contains frontend features, but not every folder has the
same loading contract. The authoritative inventory is the directory itself;
the authoritative loading paths are `public/shell-boot.js`,
`public/core/registry.js`, and each feature's callers.

The backend has a parallel one-folder-per-feature layout under `modules/`
(without the `public/` prefix). See `docs/ARCHMAP.md` for the broader project
map.

## Categories and loading

- **SPA section modules** own route-level content mounted into `#app-root`.
  `public/shell-boot.js` registers them with `registry.registerLazy()`, so the
  section and its static imports are fetched on first activation. These modules
  default-export the registry contract described below.
- **Shell/chrome modules** provide persistent navigation and topbar behavior.
  The shell imports and mounts them once, outside the active-section lifecycle.
- **Feature and action modules** provide modals, inspector actions, search, or
  supporting behavior. Their callers load them as needed from the shell,
  modal host, topbar, or inspector dispatcher. Some compatibility helpers are
  still classic scripts loaded by the locale shells. Follow the local README
  and the caller instead of assuming a registry lifecycle.

Do not maintain a dated module list here. Add or remove the feature directory
and update the relevant registration or call site in the same change.

## SPA section contract

Section modules use the contract implemented by `public/core/registry.js`:

```js
export default {
  id: 'example',
  route: '/example', // optional metadata; routes are registered by the shell
  css: '/modules/example/styles.css', // optional
  manifest: { title: { en: 'Example', uk: 'Приклад', ru: 'Пример' } }, // optional
  async mount(root, ctx) {},
  async unmount(root) {}, // optional final teardown
};
```

`mount()` receives a fresh context for every activation:

- shared helpers: `t`, `toast`, and `escapeHtml`;
- event-bus helpers: `emit`, `on`, and `off`;
- live `lang` and `theme` getters;
- a mount-scoped `AbortSignal` in `ctx.signal`;
- `ctx.addCleanup(fn)` for resources that do not accept an abort signal.

Pass `ctx.signal` to listeners and requests where supported. Register cleanup
for resources such as `EventSource`, intervals, observers, and dynamically
created nodes. On deactivation, the registry aborts the signal, runs registered
cleanups in LIFO order, calls optional `unmount()`, and finally clears the
section root. A stylesheet declared through the module's `css` field is loaded
before `mount()` and retained for later activations.

## Typical directory shape

Feature directories use only the files they need:

```text
public/modules/<feature>/
  index.js                 entry point
  i18n.js                  optional feature translations
  template.<lang>.html     optional localized templates
  styles.css               optional feature styles
  README.md                optional feature-specific contracts
```

`index.js` may be an ES module or a classic-script compatibility entry point,
depending on its caller. Do not require an IIFE or ban imports globally: SPA
sections use ES imports, while older shell-loaded helpers may expose explicit
`window.*` APIs.

## Communication and i18n

Prefer direct ES imports for shared code and the event bus for lifecycle-aware
cross-feature notifications. Existing compatibility surfaces also use
documented `window.*` functions and `kt:` DOM events. Keep those touchpoints
explicit in the producer, consumer, and feature README when one exists.

The central `/i18n.js` owns the global translation table. A feature-local
`i18n.js` can call `window.registerI18nModule()` after central i18n has loaded,
or queue its dictionary in `window.kt_i18n_modules` when loaded earlier. Keep
feature keys namespaced.

## Asset versioning

The server rewrites served HTML and JavaScript asset references with content
hashes, including static and dynamic imports. Modules with several templates or
styles can use a `__<MODULE>_BUNDLE_HASH__` token so any file in that module
invalidates the bundle URL. Normal module changes do not need manual version
bumps.

## Tests

Frontend module tests live directly under `tests/`, for example
`tests/<tool>.test.js`. Package scripts invoke Node's test runner with the
shallow `tests/*.test.js` glob, so nested files such as
`tests/modules/<tool>.test.js` are not discovered by the standard test and CI
commands.
