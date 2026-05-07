/* ============================================================
   public/modules/intel/index.js — Spyglass Intelligence entry.

   Phase 7a: loads storage + observer + banner, wires init.
   spyglass.app.js calls window.SpyglassIntel.observe(payload, validation)
   after every analyze; the observer gates and persists.

   Why a thin entry: the three submodules are loaded as classic
   <script>s in the shell (so they run before this file). This file
   exposes the consolidated public API + kicks off init().
   ============================================================ */
(function () {
  'use strict';

  if (window.SpyglassIntel) return;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    if (window.SpyglassIntelObserver && typeof window.SpyglassIntelObserver.init === 'function') {
      window.SpyglassIntelObserver.init();
    }
  });

  window.SpyglassIntel = {
    /**
     * Observe a (payload, validation) pair. No-ops when discovery is
     * disabled or the gate rejects. Errors are swallowed.
     */
    observe: function (payload, validation) {
      if (!window.SpyglassIntelObserver) return;
      // Fire and forget — observe() returns a Promise but callers
      // don't need to await; analyze flow proceeds regardless.
      window.SpyglassIntelObserver.observe(payload, validation);
    },
    /**
     * Pull the current banner summary on demand (settings UI, debug).
     */
    summary: function () {
      if (!window.SpyglassIntelObserver) return Promise.resolve({ total: 0, byBucket: {} });
      return window.SpyglassIntelObserver.summariseForBanner();
    },
    /**
     * Wipe the field-observation index. Settings UI / privacy reset.
     */
    clear: async function () {
      if (window.SpyglassIntelStorage) {
        await window.SpyglassIntelStorage.clearAll();
      }
      if (window.SpyglassIntelBanner) {
        window.SpyglassIntelBanner.refresh({ total: 0, byBucket: {} });
      }
    },
  };
})();
