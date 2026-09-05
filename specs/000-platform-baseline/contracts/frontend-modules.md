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

## Inspector Display Density

Desktop type does not scale with viewport width. Editor/finding body text uses 13px, metadata 11–12px, and the verdict 17px at normal browser zoom. The shell bounds the workbench to 2200px; the desktop split bounds results to 800px and optional context to 200–240px, leaving the remaining space for the payload. Context takes a real grid column above 1100px and retains its existing drawer behavior below that breakpoint. Native browser zoom remains available. Shared styles serve all three locales and both themes.

`tests/inspector-density-browser.test.js` verifies rendered type, gutter alignment, panel geometry and expanded findings across desktop widths. Existing mobile tests guard stacking and whole controls.

## Creative Preview and Behavior Probe

The creative body is macro-resolved and classified once before display. Raw payload bytes reach
`srcdoc` only when classified as markup. Native is the rendering exception: wrapped and envelope-less
Native normalize to the same object, are escaped into standalone synthetic HTML, and only that
generated card reaches a probed frame. Raw Native JSON, VAST, generic JSON, bare URLs, prose, failed
base64, and dependency-failure fallbacks remain inert text assigned with `textContent` in the parent.

Padded and valid unpadded base64 decode at most once. VAST delegates to the generated browser copy of
the single Core detector. Missing Core or classifier is a failed safety dependency and classification
fails closed to `unidentified`; the preview has no second VAST regex or catch-all markup fallback.

Framed banner markup and synthetic Native HTML use `sandbox="allow-scripts"`;
`allow-same-origin` is never added. The frame content policy stays sealed. Wave 1 exposes no
asset-inlining/network action for Native. The pre-existing explicit banner asset action retains its
route and limits; when it repoints a banner frame, it also replaces the static-analysis source with
the rewritten HTML and creates a new probe generation.

Inspector activation awaits the one-time probe source fetch before Analyze is exposed. The runtime
`/creative-probe.js` URL receives the file's content hash from the static rewriter, preventing a stale
cached probe from being paired with a fresh parent receiver. The parent inlines the probe before the
creative and keeps the expected iframe window identity.

Source identity alone is not authentication because creative code runs inside that current frame and
can call `parent.postMessage`. Each render therefore creates a cryptographically random capability
closed over by the trusted probe. The probe captures the parent send function, removes its own
capability-bearing script element before payload markup parses, and only then enables telemetry. Both
reserved message types require current-frame `event.source` and the current capability; failed probe
load/random generation fails telemetry closed.

Instrumentation messages enter the bounded rolling behavior window; the parent watchdog covers a
frozen iframe that cannot report. Refusal messages take a separate reducer and never enter that
window or its request. The probe and parent independently cap a refusal render at 200. The parent
also validates version, finite timestamp, boolean truncation, array/string schema, a 200-item batch,
64-character directive, and 2048-character blocked-URI bounds before deduplicating
`(directive, blockedUri)`. Overflow is visibly truncated. Chromium directive aliases normalize to
stable localized image/script/style/frame/font/connection/media/other groups.

Static behavior rules analyze the selected executing body before probe/CSP instrumentation:
macro-resolved/classified/once-decoded markup or escaped synthetic Native HTML. The browser sends
canonical base64 of a valid UTF-8 prefix up to 1 MiB plus explicit truncation state over the existing
same-origin `/api/analyze-behavior` endpoint. Static analysis runs with zero runtime-visible events;
render generation and creative revision reject stale results. Source is transient, not persisted or
logged as request context. An explicit authenticated Corpus save remains the only Behavior
persistence action.

The reveal overlay is independent of sizing and appears only for revealable frames. VAST and other
text views are scrollable and unrevealable; VAST trimming and normalized refusal kinds resolve through
the three-locale module dictionary. Preview markup must never be promoted into the parent origin.

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
