/* ============================================================
   public/version.js — single source of truth for the public
   version string shown in chrome (topnav, footer, about pages,
   export bundle metadata).

   Why a separate file: the version was previously hardcoded in 4+
   places (3 inspector templates × 2 spots, 3 about-page footers,
   export.js JSON). Bumping required N synchronized edits and we
   forgot some on every release. Now: bump VERSION here, rebuild
   the bundle (or the bind-mounted /public/), every consumer reads
   `window.SpyglassVersion` or paints from `[data-spyglass-version]`.

   Consumers:
     - Inspector template (topnav brand label + footer #engineVer)
     - About-page footers (3 locales)
     - export.js (reads #engineVer.textContent which we paint here)

   Not auto-updated by this script — must be bumped manually:
     - docs eyebrow `v9.0.0` text in about-page intro (it's the docs
       *content* version, not the app version, and they're allowed
       to drift)
   ============================================================ */
(function () {
  'use strict';

  // ⚠ Single source of truth — bump this on a release.
  const VERSION = 'v0.36.5';

  window.SpyglassVersion = VERSION;

  function paint() {
    try {
      const els = document.querySelectorAll('[data-spyglass-version]');
      for (let i = 0; i < els.length; i++) els[i].textContent = VERSION;
    } catch (e) {
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
