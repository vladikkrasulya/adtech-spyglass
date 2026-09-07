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
     4. Hand off to legacy mountInspector() in /ortbtools.app.js — it
        binds handlers / dispatcher / DEK state to the now-existing DOM.
     5. emit('kt:inspector-ready', { lang }) so classic <script> files
        (share.js etc.) that need #bidReq / #bidRes can boot without
        racing the async mount.
   ============================================================ */
'use strict';

// Note: ?v=… is auto-injected by server.js rewriteAssetVersions() — no manual bump needed.
import { mountInspector } from '/ortbtools.app.js';
import { loadSpecimenIntoEditor } from '/modules/inspector/specimen-handoff.js';

// Bundle hash for the inspector module. The literal `__INSPECTOR_BUNDLE_HASH__`
// is replaced at serve time by server.js → injectModuleBundleHashes() with the
// SHA-256 identity of module filenames, byte boundaries and dependencies.
// CSS and templates share this validated revision; obsolete revisions fail
// before the registry tears down the current editor. No manual knob.
const ASSET_VERSION = '__INSPECTOR_BUNDLE_HASH__';

async function loadStylesheet(href, ctx) {
  ctx.signal.throwIfAborted();
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  // Prepare without changing the currently visible section. The registry only
  // removes its existing mount once both this sheet and the template are ready.
  link.media = 'not all';
  ctx.addCleanup(() => link.remove());
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      link.removeEventListener('load', loaded);
      link.removeEventListener('error', failed);
      ctx.signal.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve();
    };
    const loaded = () => finish(null);
    const failed = () => finish(new Error('Inspector stylesheet unavailable'));
    const aborted = () => finish(ctx.signal.reason);
    link.addEventListener('load', loaded, { once: true });
    link.addEventListener('error', failed, { once: true });
    ctx.signal.addEventListener('abort', aborted, { once: true });
    document.head.appendChild(link);
  });
  ctx.signal.throwIfAborted();
  return link;
}

async function fetchTemplate(lang, signal) {
  const url = `/modules/inspector/template.${lang}.html?v=${ASSET_VERSION}`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) {
    const error = new Error(`template ${lang} HTTP ${resp.status}`);
    error.status = resp.status;
    throw error;
  }
  const html = await resp.text();
  signal.throwIfAborted();
  return html;
}

export default {
  id: 'inspector',
  // Stage 0 multi-section site: client router maps /inspector to this
  // module via core/router.js. Locale-prefixed variants (/uk/inspector,
  // /ru/inspector) are handled by the boot script — it strips /uk or /ru
  // before calling router.match().
  route: '/inspector',
  manifest: {
    title: { en: 'Inspector', uk: 'Інспектор', ru: 'Инспектор' },
    description: {
      en: 'OpenRTB BidRequest / BidResponse inspector + validator',
      uk: 'OpenRTB-інспектор з валідацією BidRequest / BidResponse',
      ru: 'OpenRTB-инспектор с валидацией BidRequest / BidResponse',
    },
  },

  async prepare(ctx) {
    const cssLink = await loadStylesheet(
      `/modules/inspector/inspector.css?v=${ASSET_VERSION}`,
      ctx,
    );
    const lang = ['en', 'uk', 'ru'].includes(ctx.lang) ? ctx.lang : 'en';
    let html;
    try {
      html = await fetchTemplate(lang, ctx.signal);
    } catch (error) {
      if (error.status !== 404 || lang === 'en') throw error;
      html = await fetchTemplate('en', ctx.signal);
    }
    return { cssLink, html, lang };
  },

  async mount(root, ctx, prepared) {
    const { cssLink, html, lang } = prepared || (await this.prepare(ctx));
    ctx.signal.throwIfAborted();
    // 0. Stage 0 multi-section shell: the shell HTML provides a bare
    //    <main id="app-root"> root. Inspector layout (the .workbench
    //    grid in inspector.css) requires the workbench class on root.
    //    Add it on mount; clean it up on unmount.
    root.classList.add('workbench');
    ctx.addCleanup(() => root.classList.remove('workbench'));

    cssLink.media = 'all';

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

    // 6. ?sample=SLUG handoff (Stage 1 — Library section sends users
    //    here pre-loaded with a curated sample). Fetch via the public
    //    catalog endpoint, fill request + response editors, strip the
    //    query so reloads don't re-trigger the fetch.
    try {
      const params = new URLSearchParams(location.search);
      const sample = params.get('sample');
      if (sample && /^[a-z0-9-]+$/.test(sample)) {
        const resp = await fetch(`/api/v1/sample?type=${encodeURIComponent(sample)}`, {
          signal: ctx.signal,
        });
        if (resp.ok) {
          const data = await resp.json();
          const reqEl = document.getElementById('bidReq');
          const resEl = document.getElementById('bidRes');
          if (reqEl && data.bid_request && Object.keys(data.bid_request).length) {
            reqEl.value = JSON.stringify(data.bid_request, null, 2);
            reqEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (resEl && data.bid_response && Object.keys(data.bid_response).length) {
            resEl.value = JSON.stringify(data.bid_response, null, 2);
            resEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
          // Strip ?sample so reload doesn't loop. keepalive: future Stage
          // 2 specimen permalinks (/r/{hash}) use the same pattern.
          params.delete('sample');
          const newUrl =
            location.pathname + (params.toString() ? '?' + params : '') + location.hash;
          history.replaceState(history.state, '', newUrl);
        } else {
          console.warn('[inspector] sample handoff fetch failed:', resp.status);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.warn('[inspector] sample handoff:', e.message);
      }
    }

    // 7. /r/:hash specimen permalink handoff (Stage 2).
    //    shell-boot.js sets window.__pendingSpecimenHash when routing /r/<hash>.
    //    We fetch the envelope, fill the appropriate editor, then clean up.
    try {
      const pendingHash = window.__pendingSpecimenHash;
      if (pendingHash) {
        delete window.__pendingSpecimenHash;
        const resp = await fetch('/api/v1/specimen/' + pendingHash, { signal: ctx.signal });
        if (resp.ok) {
          const data = await resp.json();
          const specimen = data.specimen;
          if (specimen) loadSpecimenIntoEditor(specimen);
          // Replace /r/<hash> with /<lang>/inspector for a clean URL state.
          const cleanUrl = location.pathname.replace(/\/r\/[0-9a-f]+/i, '/inspector');
          history.replaceState(history.state, '', cleanUrl);
        } else {
          console.warn('[inspector] specimen handoff fetch failed:', resp.status);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.warn('[inspector] specimen hash handoff:', e.message);
      }
    }
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
