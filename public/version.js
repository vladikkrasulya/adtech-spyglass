/* ============================================================
   public/version.js — single source of truth for the public
   version string shown in chrome (topnav, footer, about pages,
   export bundle metadata).

   Why a separate file: the version was previously hardcoded in 4+
   places (3 inspector templates × 2 spots, 3 about-page footers,
   export.js JSON). Bumping required N synchronized edits and we
   forgot some on every release. Now: bump VERSION here, rebuild
   the bundle (or the bind-mounted /public/), every consumer reads
   `window.OrtbtoolsVersion` or paints from `[data-ortbtools-version]`.

   Consumers:
     - Inspector template (topnav brand label + footer #engineVer)
     - About-page footers (3 locales)
     - export.js (reads #engineVer.textContent which we paint here)

   As of v1.4.0 the about-page docs eyebrow is also tagged with
   [data-ortbtools-version] (the old "docs content version" distinction
   let it drift ~50 releases behind — it showed v0.52.0 next to a
   v1.3.7 footer), so every version surface now paints from here.
   ============================================================ */
(function () {
  'use strict';

  // ⚠ Single source of truth — bump this on a release.
  const VERSION = 'v1.5.1';

  window.OrtbtoolsVersion = VERSION;
  // legacy-spyglass-ok: console/back-compat alias for the pre-rename global (~v1.6)
  window.SpyglassVersion = VERSION; // legacy-spyglass-ok

  // One-time browser-storage migration for the 2026-07-13 rename (legacy-spyglass-ok)
  // rename. Copies each pre-rename key to its new name (if the new one is not
  // already set) and deletes the old key. Cheap and idempotent — runs on every
  // shell because version.js is the one script all three page types load.
  // legacy-spyglass-ok: drop the whole block ~v1.6.
  try {
    const LS_PAIRS = [
      ['spyglass_dialect_v1', 'ortbtools_dialect_v1'], // legacy-spyglass-ok
      ['spyglass_history_v1', 'ortbtools_history_v1'], // legacy-spyglass-ok
      ['spyglass_version_pin', 'ortbtools_version_pin'], // legacy-spyglass-ok
      ['spyglass_intel_banner_dismissed_until', 'ortbtools_intel_banner_dismissed_until'], // legacy-spyglass-ok
      ['spyglass_admin_token', 'ortbtools_admin_token'], // legacy-spyglass-ok
    ];
    for (const [oldKey, newKey] of LS_PAIRS) {
      const v = localStorage.getItem(oldKey);
      if (v !== null) {
        if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, v);
        localStorage.removeItem(oldKey);
      }
    }
    const SS_PAIRS = [['spyglass_recovery_pending_v1', 'ortbtools_recovery_pending_v1']]; // legacy-spyglass-ok
    for (const [oldKey, newKey] of SS_PAIRS) {
      const v = sessionStorage.getItem(oldKey);
      if (v !== null) {
        if (sessionStorage.getItem(newKey) === null) sessionStorage.setItem(newKey, v);
        sessionStorage.removeItem(oldKey);
      }
    }
  } catch (_e) {
    /* storage blocked — nothing to migrate */
  }

  function paint() {
    try {
      const els = document.querySelectorAll('[data-ortbtools-version]');
      for (let i = 0; i < els.length; i++) els[i].textContent = VERSION;
    } catch (_e) {
      /* DOM not ready — paint() is idempotent, the late call below picks up */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paint, { once: true });
  } else {
    paint();
  }

  // Inspector mounts its template asynchronously (modules/inspector/index.js
  // fetches template.${lang}.html). The brand-label + #engineVer markers
  // live INSIDE that template, so they don't exist at DOMContentLoaded
  // time. Re-paint when the inspector emits its ready event.
  window.addEventListener('kt:inspector-ready', paint);
})();
