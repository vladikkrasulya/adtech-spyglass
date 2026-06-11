'use strict';

/**
 * public/modules/landing/index.js — programmatic-SEO landing module.
 *
 * The page body is server-rendered into #app-root by lib/landings.js, so this
 * module deliberately LEAVES that content in place on mount. It only ever runs
 * on first load: shell-boot.js hard-loads (full navigation) when you move onto
 * a landing route via the SPA, so we never reach mount() with a swept #app-root.
 *
 * Its only job is to give the registry a module to activate for landing routes
 * — without it, registry.match() returns nothing and shell-boot clobbers the
 * SSR content with the unknown-route 404. Styling comes from the server-injected
 * <link rel="stylesheet" href="/modules/landing/landing.css">, so no `css` field
 * here (avoids a redundant second load).
 */

const landing = {
  id: 'landing',
  route: '/openrtb/2-6',
  manifest: {
    title: {
      en: 'OpenRTB Validator',
      uk: 'Валідатор OpenRTB',
      ru: 'Валидатор OpenRTB',
    },
  },

  async mount(root, ctx) {
    // Leave the server-rendered landing body untouched. Wire optional
    // interactivity only when the SSR markup advertises it (e.g. the future
    // IAB-taxonomy table filter via [data-landing-filter]).
    const filterInput = root.querySelector('[data-landing-filter]');
    if (filterInput) {
      const onInput = () => {
        const q = filterInput.value.trim().toLowerCase();
        root.querySelectorAll('[data-landing-row]').forEach((row) => {
          row.hidden = q && !row.textContent.toLowerCase().includes(q);
        });
      };
      filterInput.addEventListener('input', onInput, { signal: ctx && ctx.signal });
    }
    if (ctx && typeof ctx.emit === 'function') {
      ctx.emit('kt:landing-ready', { route: location.pathname });
    }
  },

  async unmount() {
    // Nothing to tear down — the registry sweeps #app-root on deactivate.
  },
};

export default landing;
