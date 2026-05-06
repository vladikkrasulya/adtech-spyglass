/* ============================================================
   public/core/registry.js — module registry + lifecycle (ES module).

   Phase B of the modular-architecture migration. Defines the contract
   every feature module follows:

     export default {
       id:    'stream',                                  // unique id
       route: '/stream.html',                            // optional
       manifest: { title:{en,uk,ru}, icon, ... },        // optional
       async mount(root, ctx) { ... },                   // required
       async unmount(root) { ... },                      // optional
     };

   register(mod)         — adds the module + its route.
   activate(id, root)    — tears down current module, mounts the new
                            one with a fresh context.
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

const modules = new Map(); // id → module
let active = null; // { id, mod, root, controller, cleanups }

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
  const mod = modules.get(id);
  if (!mod) throw new Error('registry.activate: unknown module "' + id + '"');
  if (!root) throw new Error('registry.activate: root element required');

  // Tear down whatever's currently mounted before bringing up the new one.
  if (active) await deactivate();

  // Per-mount AbortController + cleanup queue. These are the lifecycle
  // helpers the module gets in ctx — unique to this activation, never
  // shared across modules.
  const controller = new AbortController();
  const cleanups = [];
  const ctx = buildCtx(controller, cleanups);

  active = { id: mod.id, mod, root, controller, cleanups };
  try {
    await mod.mount(root, ctx);
  } catch (err) {
    // Mount failed mid-way — tear down whatever did register.
    active = null;
    controller.abort();
    runCleanups(cleanups);
    throw err;
  }
  emit('kt:registry-mount', { id: mod.id });
  return active;
}

export async function deactivate() {
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
  for (let i = list.length - 1; i >= 0; i--) {
    try {
      list[i]();
    } catch (e) {
      console.warn('[registry] cleanup threw:', e);
    }
  }
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
