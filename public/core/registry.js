/* ============================================================
   public/core/registry.js — module registry + lifecycle (ES module).

   Phase B of the modular-architecture migration. Defines the contract
   every feature module follows:

     export default {
       id:    'stream',                                  // unique id
       route: '/stream.html',                            // optional
       css:   '/modules/stream/stream.css',              // optional — registry
                                                         //   awaits it BEFORE
                                                         //   mount() so the
                                                         //   section never
                                                         //   flashes unstyled
       manifest: { title:{en,uk,ru}, icon, ... },        // optional
       async prepare(ctx) { ... },                       // optional resources
       async mount(root, ctx, prepared) { ... },          // required
       async unmount(root) { ... },                      // optional
     };

   register(mod)         — adds the module + its route.
    activate(id, root)    — imports/prepares required resources, then tears
                             down the old module and mounts the new context.
   deactivate()           — explicit teardown (called by activate too).
   current() / get(id)    — introspection.

   The ctx passed to mount() is the module's everything-it-needs:

     ctx = {
       // shared utilities (re-exported from /core/utils.js so modules
       // see one place; direct import works too).
       t, toast, escapeHtml,
       // event bus (from /core/events.js).
       emit, on, off,
       // current state via getters (always fresh).
       lang, theme,
       // lifecycle helpers — UNIQUE TO THIS MOUNT, do not import:
       signal,         AbortSignal that fires when the module unmounts.
                       Pass to addEventListener({signal}), fetch({signal}),
                       etc. — they auto-detach.
       addCleanup(fn)  Register a cleanup callback for things that don't
                       accept AbortSignal (EventSource.close, clearInterval,
                       removing dynamically-added <link> nodes). Runs
                       LIFO order during deactivate().
     };

   Cleanup order on deactivate:
     1. controller.abort() — signal-aware listeners detach.
     2. addCleanup queue runs in LIFO (last registered, first cleaned).
     3. mod.unmount(root) called for any final teardown.
     4. root.innerHTML = ''  — registry sweeps the DOM.

   This split is deliberate: most resource cleanup belongs in steps 1-2
   and modules don't need to define unmount() at all. unmount() is for
   non-resource teardown (state flushing, persistence, custom logic).
   ============================================================ */
'use strict';

import * as router from './router.js';
import { t, toast, escapeHtml } from './utils.js';
import { emit, on, off } from './events.js';

// Re-export router primitives so consumers (shell-boot.js) reach the same
// router instance the registry uses internally. Asset-version injection
// otherwise gives consumers a *different* `/core/router.js?v=H` URL → two
// singletons, register() goes to one, match() reads the other (empty).
export { match, list as listRoutes, register as registerRoute } from './router.js';

const modules = new Map(); // id → module (loaded)
const loaders = new Map(); // id → () => import() — registered lazily, loaded on first activate
let active = null; // { id, mod, root, controller, cleanups }
let pending = null;
let activation = 0;

export function register(mod) {
  if (!mod || !mod.id) {
    throw new Error('registry.register: module needs an id');
  }
  if (modules.has(mod.id)) {
    throw new Error('registry.register: duplicate module id "' + mod.id + '"');
  }
  if (typeof mod.mount !== 'function') {
    throw new Error('registry.register: "' + mod.id + '" is missing mount()');
  }
  modules.set(mod.id, mod);
  if (mod.route) router.register(mod.route, mod.id);
}

// Lazy registration: record the route → id mapping and an import() loader, but
// DON'T fetch the module yet. The module code (and its static imports — e.g.
// the inspector's ~65 KB gz ortbtools.app.js) loads only when the section is
// first activated, keeping the boot payload to chrome + the active section.
export function registerLazy(id, route, load) {
  if (!id || typeof load !== 'function') {
    throw new Error('registry.registerLazy: id and load() function required');
  }
  loaders.set(id, load);
  if (route) router.register(route, id);
}

export function get(id) {
  return modules.get(id);
}

export function list() {
  return Array.from(modules.values());
}

export function current() {
  return active ? { id: active.id, root: active.root } : null;
}

export async function activate(id, root) {
  if (!root) throw new Error('registry.activate: root element required');
  const attempt = ++activation;
  if (pending) {
    pending.controller.abort();
    runCleanups(pending.cleanups);
  }
  const controller = new AbortController();
  const cleanups = [];
  const ctx = buildCtx(controller, cleanups);
  const next = { id, mod: null, root, controller, cleanups };
  pending = next;
  try {
    let mod = modules.get(id);
    if (!mod) {
      const load = loaders.get(id);
      if (!load) throw new Error('registry.activate: unknown module "' + id + '"');
      const imported = await load();
      controller.signal.throwIfAborted();
      mod = imported && imported.default;
      if (!mod || typeof mod.mount !== 'function') {
        throw new Error(
          'registry.activate: lazy module "' + id + '" lacks a default export with mount()',
        );
      }
      modules.set(id, mod);
    }
    next.mod = mod;
    // Required resources load before teardown. A stale deferred import, failed
    // stylesheet or rejected template leaves the current editor and handlers live.
    const sheet = mod.css ? await ensureStylesheet(mod.css, controller.signal) : null;
    const prepared = typeof mod.prepare === 'function' ? await mod.prepare(ctx) : undefined;
    controller.signal.throwIfAborted();
    if (attempt !== activation) throw new DOMException('Navigation replaced', 'AbortError');
    await deactivateCurrent();
    controller.signal.throwIfAborted();
    active = next;
    // Once committed, this context belongs to the visible section even while
    // mount() awaits its background boot work. Only an actual replacement or
    // explicit deactivation may abort it; a newer preparation is independent.
    if (pending === next) pending = null;
    if (sheet) sheet.media = 'all';
    await mod.mount(root, ctx, prepared);
    controller.signal.throwIfAborted();
    emit('kt:registry-mount', { id: mod.id });
    return active;
  } catch (err) {
    if (active === next) active = null;
    if (pending === next) pending = null;
    controller.abort();
    runCleanups(cleanups);
    throw err;
  }
}

export async function deactivate() {
  activation++;
  if (pending) {
    pending.controller.abort();
    runCleanups(pending.cleanups);
    pending = null;
  }
  await deactivateCurrent();
}

async function deactivateCurrent() {
  if (!active) return;
  const { mod, root, controller, cleanups, id } = active;
  active = null;

  // 1) Abort signal — addEventListener({signal}) and fetch({signal})
  //    detach themselves at this point.
  controller.abort();

  // 2) Module-registered cleanups, LIFO order. Anything that fails is
  //    logged and skipped so one bad cleanup can't block the rest.
  runCleanups(cleanups);

  // 3) Module's optional unmount hook for non-resource teardown.
  if (typeof mod.unmount === 'function') {
    try {
      await mod.unmount(root);
    } catch (e) {
      console.warn('[registry] unmount() threw:', e);
    }
  }

  // 4) Sweep DOM. Modules shouldn't leak nodes into root.
  root.innerHTML = '';
  emit('kt:registry-unmount', { id });
}

function runCleanups(list) {
  while (list.length) {
    try {
      list.pop()();
    } catch (e) {
      console.warn('[registry] cleanup threw:', e);
    }
  }
}

// Required section styles are prepared before the old section is removed.
// Successful links persist; failed and aborted new links never become ready.
const cssReady = new Map();
function ensureStylesheet(href, signal) {
  signal.throwIfAborted();
  const abs = new URL(href, window.location.href).href;
  if (cssReady.has(abs)) return Promise.resolve(cssReady.get(abs));
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(
      (link) => link.href === abs,
    );
    const link = existing || document.createElement('link');
    if (existing && existing.sheet) {
      cssReady.set(abs, existing);
      resolve(existing);
      return;
    }
    const finish = (error) => {
      link.removeEventListener('load', loaded);
      link.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      if (error) {
        if (!existing) link.remove();
        reject(error);
      } else {
        cssReady.set(abs, link);
        resolve(link);
      }
    };
    const loaded = () => finish(null);
    const failed = () => finish(new Error('Section stylesheet unavailable'));
    const aborted = () => finish(signal.reason);
    link.addEventListener('load', loaded, { once: true });
    link.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
    if (!existing) {
      link.rel = 'stylesheet';
      link.href = abs;
      link.media = 'not all';
      document.head.appendChild(link);
    }
  });
}

function buildCtx(controller, cleanups) {
  return {
    // shared utilities
    t,
    toast,
    escapeHtml,
    // event bus
    emit,
    on,
    off,
    // current state — getters so each read sees the live value
    get lang() {
      return document.documentElement.lang || 'en';
    },
    get theme() {
      return document.documentElement.getAttribute('data-theme') || 'light';
    },
    // lifecycle helpers
    signal: controller.signal,
    addCleanup(fn) {
      if (typeof fn !== 'function') {
        throw new TypeError('ctx.addCleanup: function required');
      }
      cleanups.push(fn);
    },
  };
}
