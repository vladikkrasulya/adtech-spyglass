# Contract: Frontend Shell and Modules

**Owner**: `public/shell-boot.js`, `public/core/`, `public/modules/`, and the Inspector adapter in
`public/ortbtools.app.js`

## Runtime Model

The frontend is native browser JavaScript and CSS. There is no application bundler or framework.
Locale shells load persistent chrome and use dynamic `import()` for route sections and action
modules. The Node server injects transitive content hashes into served HTML/JavaScript references;
normal source changes do not use manual cache-bust numbers.

Classic scripts and explicit `window.*` compatibility APIs still coexist with ES modules. A new
module follows the loading contract of its caller rather than assuming every folder is a route or
every script is an IIFE.

## Shell Ownership

`public/shell-boot.js` owns:

- installation of the shell-level session facade and one modal host;
- one-time navigation and topbar mounting;
- lazy registration of route sections;
- same-origin History API navigation and back/forward activation;
- locale-prefix canonicalization before client route matching;
- specimen and blog deep-route handoff;
- language-change remount and section title updates; and
- a contained in-app failure view when a module cannot activate.

Session/auth/DEK state is not owned by Inspector. `public/core/session.js` persists for the shell
lifetime and optionally accepts an Inspector UI adapter while that route is mounted. Modal state is a
sibling of `#app-root`, so auth, unlock, recovery, and password-reset flows survive section changes.

## Route-Level Sections

The lazy registry currently maps:

| Registry id  | Canonical route                        | Owner                                              |
| ------------ | -------------------------------------- | -------------------------------------------------- |
| `inspector`  | `/inspector`                           | `public/modules/inspector/` plus Inspector adapter |
| `library`    | `/library`                             | `public/modules/library/`                          |
| `docs`       | `/docs`, `/docs/findings`              | `public/modules/docs/`                             |
| `dialects`   | `/dialects`                            | `public/modules/dialects/`                         |
| `stream`     | `/live`                                | `public/modules/stream/`                           |
| `blog`       | `/blog` and post deep routes           | `public/modules/blog/`                             |
| `admin-blog` | `/admin/blog`                          | `public/modules/admin-blog/`                       |
| `behavior`   | `/behavior`                            | `public/modules/behavior/`                         |
| `insights`   | `/insights`                            | `public/modules/insights/`                         |
| `landing`    | registered programmatic landing routes | `public/modules/landing/`                          |

English uses these paths directly; Ukrainian and Russian prefixes are removed only for client
matching. The server remains authoritative for which localized/deep routes receive a shell and which
return 404.

## Section Module Interface

A route module default-exports an object with a unique `id`, optional route/style/manifest metadata,
required `mount(root, ctx)`, and optional `unmount(root)`.

Each activation receives a fresh context:

- shared `t`, `toast`, and `escapeHtml` helpers;
- `emit`, `on`, and `off` event-bus helpers;
- live locale and theme getters;
- a mount-scoped `AbortSignal`; and
- `addCleanup(function)` for resources that do not support a signal.

Listeners and fetches use `ctx.signal` where supported. A subscription made with `ctx.on()` registers
its returned unsubscribe function with `ctx.addCleanup()`. EventSource, timers, observers, dynamic
styles, global adapters, and other non-signal resources each register an explicit cleanup.

Deactivation order is fixed:

1. abort the mount signal;
2. execute registered cleanups in last-in-first-out order;
3. call optional `unmount()` for final non-resource teardown; and
4. clear the route root.

One failing cleanup is logged and does not prevent the remaining cleanup stack. A failed mount aborts
and cleans everything registered before the failure. A module stylesheet declared in `css` loads
before mount and remains cached for later activations; a module that appends a temporary stylesheet
itself owns its removal.

## Persistent Chrome and Action Modules

Navigation, topbar, search integration, shell session, and the modal host are outside the active
section lifecycle. Feature/action modules such as auth, save/edit sample, partners, mirror, simulate,
corpus save, share/embed, unlock, recovery, password reset, and shortcuts are loaded by an
owning action or shell service.

Cross-feature communication prefers direct ES imports for static dependencies and the `kt:*`
CustomEvent bus for lifecycle-aware notifications. Existing explicit globals remain compatibility
contracts only where a producer and consumer use them. A new global requires a named owner, cleanup
when mount-scoped, and coverage in the window-contract tests; implicit global state is prohibited.

## Inspector Boundary

The Inspector route:

1. attaches its workbench class and component stylesheet;
2. fetches the matching locale template with English fallback;
3. injects the route DOM;
4. invokes `mountInspector(root, ctx)` from the compatibility module;
5. announces `kt:inspector-ready`; and
6. performs optional curated-sample or specimen-permalink handoff with the mount signal.

`mountInspector` is re-entrant. Its DOM listeners, in-flight analyze request, timers, EventSources,
watchdog, window facades, session adapter, and preview state are scoped to the current mount or swept
on cleanup. Mutations intentionally allowed to finish after navigation must still avoid painting or
toasting into a later mount.

## Creative Preview and Behavior Probe

Banner, Native, and VAST-derived creative content is rendered in an iframe with
`sandbox="allow-scripts"`; `allow-same-origin` is never added. The parent inlines the probe before
creative markup, keeps the expected iframe window identity, validates `postMessage` source, and
stores at most the bounded rolling event window for the active preview.

The probe reports instrumentation events to the parent. The parent watchdog covers failure modes
where a frozen iframe cannot report for itself. Behavior findings are computed through the server
endpoint; an explicit authenticated Corpus save is a separate persistence action. Preview markup
must never be promoted into the parent origin or logged as request context.

A creative body is classified before any display decision, and only a body classified as markup may
reach a frame. Every other kind — VAST, native, JSON, a bare URL, base64 that does not decode to a
creative, and anything unidentified — is presented as inert text assigned to the parent DOM as text,
never parsed. VAST recognition is delegated to the single canonical detector rather than restated in
the preview.

The frame-to-parent channel carries two message types. Instrumentation events keep their existing
type and enter the bounded behavior event window. Content-policy refusals travel as a separate type,
are deduplicated by refused directive and refused resource, are bounded per render, and are counted
into a per-render ledger that is discarded on the next mount. Refusals MUST NOT enter the behavior
event window, appear in the behavior analysis request, or change the number or content of behavior
findings for a payload — that window is capped and drops its oldest entries, so a creative emitting
many refusals could otherwise evict the evidence it is being measured for. Both types are subject to
the same iframe-window identity check.

## Browser State Ownership

- Raw Inspector history is a bounded same-origin `localStorage` ring and synchronizes across tabs.
- Locale, theme, dialect, version pin, and layout preferences use browser storage/cookie/account
  preference according to their feature contract.
- The session service holds DEK state in memory and `sessionStorage` only for per-tab refresh
  continuity; logout clears it.
- Discovery writes normalized extension paths and shapes to IndexedDB after privacy filtering; it
  never stores raw extension values or weakens the validator result.

Exact entities and lifetimes are in [data-model.md](../data-model.md) and
[data retention](./data-retention.md).

## Localization

Global web strings live in `public/i18n.js`; feature dictionaries register through their module
`i18n.js`; locale-specific shells/templates own structural copy; Core messages live separately under
`packages/core/messages/`. A module key is namespaced, registers before first use, and has equivalent
English, Ukrainian, and Russian meaning. See [locales and versioning](./locales-versioning.md).

## Verification Rule

A new or changed route section needs a focused mount/deactivate/remount test, signal/cleanup coverage
for every resource, locale behavior, and any explicit global contract. Inspector changes run the
re-entrancy and window-contract suites. Crypto/session changes run browser crypto, auth, and privacy
guards. Finish with the frontend steps and complete gate in [quickstart.md](../quickstart.md).
