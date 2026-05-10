/* ============================================================
   public/modules/inspector/index.js — Inspector module (ES module).

   Phase C-2 + C-3 of the modular-architecture migration.
   The inspector is now a self-contained "vanilla LEGO" module:

     /modules/inspector/
       index.js              ← this file (lifecycle + asset wiring)
       template.en.html      ← inspector body markup, EN locale
       template.uk.html      ← UK locale
       template.ru.html      ← RU locale
       inspector.css         ← component styles (extracted from inline <style>)

   Lifecycle on mount:
     1. Append <link rel="stylesheet" href="./inspector.css"> to <head>,
        await its load event so injected markup paints with full chrome
        (no FOUC). Removed from head on unmount via ctx.addCleanup.
     2. fetch the locale-matched template (ctx.lang → template.${lang}.html),
        fall back to template.en.html if the locale file is missing.
     3. Inject template HTML into root.innerHTML.
     4. Hand off to legacy mountInspector() in /spyglass.app.js — it
        binds handlers / dispatcher / DEK state to the now-existing DOM.
     5. emit('kt:inspector-ready', { lang }) so classic <script> files
        (share.js etc.) that need #bidReq / #bidRes can boot without
        racing the async mount.
   ============================================================ */
'use strict';

import { mountInspector } from '/spyglass.app.js?v=9';

const ASSET_VERSION = '9';

async function loadStylesheet(href) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
  // Wait for parse so injected markup paints with full chrome. The error
  // listener also resolves so a 404 doesn't hang the module forever — we
  // log instead.
  await new Promise((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener(
      'error',
      () => {
        console.error('[inspector] stylesheet load failed:', href);
        resolve();
      },
      { once: true },
    );
  });
  return link;
}

async function fetchTemplate(lang) {
  const url = `/modules/inspector/template.${lang}.html?v=${ASSET_VERSION}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`template ${lang} HTTP ${resp.status}`);
  }
  return resp.text();
}

export default {
  id: 'inspector',
  // Single route entry won't catch /uk/, /ru/, /en/ because they're
  // separate files served via locale-aware routing in server.js.
  // Each shell explicitly calls activate('inspector', ...) in its
  // boot script, so the route field is informational only here.
  route: '/',
  manifest: {
    title: { en: 'Inspector', uk: 'Інспектор', ru: 'Инспектор' },
    description: {
      en: 'OpenRTB BidRequest / BidResponse inspector + validator',
      uk: 'OpenRTB-інспектор з валідацією BidRequest / BidResponse',
      ru: 'OpenRTB-инспектор с валидацией BidRequest / BidResponse',
    },
  },

  async mount(root, ctx) {
    // 1. Component CSS — append + await + register cleanup so the
    //    next mount starts from a clean head.
    const cssLink = await loadStylesheet(`/modules/inspector/inspector.css?v=${ASSET_VERSION}`);
    ctx.addCleanup(() => cssLink.remove());

    // 2. Fetch the locale-matched template, with EN fallback so an
    //    unknown lang never leaves the user with a blank shell.
    const lang = ctx.lang || 'en';
    let html;
    try {
      html = await fetchTemplate(lang);
    } catch (e) {
      console.warn(`[inspector] template.${lang}.html missing — falling back to EN:`, e.message);
      html = await fetchTemplate('en');
    }

    // 3. Inject markup. From this point on, #bidReq / #bidRes / #modalRoot
    //    et al. exist and can be queried by legacy code.
    root.innerHTML = html;

    // 4. Hand off to legacy mountInspector — it wires the central
    //    dispatcher, auth widget, history list, etc. against the
    //    DOM we just injected.
    await mountInspector(root, ctx);

    // 5. Notify classic <script> files (share.js etc.) that the
    //    inspector DOM is ready. Listeners use { once: true } so a
    //    later remount that fires the event again won't double-bind
    //    on the same script instance — but a fresh re-bind would
    //    require those scripts to handle re-entry, which is out of
    //    scope here (they boot once per page).
    ctx.emit('kt:inspector-ready', { lang });
  },

  async unmount(_root) {
    // No-op. Cleanup runs through:
    //   1. ctx.signal — listeners with {signal} detach automatically
    //   2. ctx.addCleanup queue — sweeps window globals, the dynamic
    //      <link> appended in mount(), EventSources, anything else
    //      mountInspector registered.
    //   3. Registry's root.innerHTML = '' clears injected template DOM.
  },
};
