/* ============================================================
   public/modules/stub/index.js — stub section factory.

   Stage 0 (ROADMAP.md): six sections are scaffolded but not yet
   built — /live, /behavior, /library, /dialects, /blog, /docs.
   Each is a registry-compatible module that renders a single
   "coming soon — here's what will be here" card with the target
   stage number.

   Usage (in shell-boot.js):
     import { createStubModule } from '/modules/stub/index.js';
     registry.register(createStubModule({
       id: 'live',
       route: '/live',
       icon: '📡',
       stage: 2,
       title: { en: 'Live RTB feed', uk: 'Стрім', ru: 'Стрим' },
       copy: { en: '...', uk: '...', ru: '...' },
     }));

   The module follows the same lifecycle contract as other registry
   modules (mount(root, ctx) / unmount). Uses ctx.signal for any
   event listeners and ctx.addCleanup for resources.
   ============================================================ */
'use strict';

const FALLBACK_LANG = 'en';

function pick(map, lang) {
  if (!map) return '';
  return map[lang] || map[FALLBACK_LANG] || Object.values(map)[0] || '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function createStubModule(config) {
  if (!config || !config.id || !config.route) {
    throw new Error('createStubModule: id + route required');
  }
  const { id, route, icon, stage, title, copy } = config;

  return {
    id,
    route,
    manifest: { title, description: copy, stage },

    async mount(root, ctx) {
      const lang = ctx.lang || FALLBACK_LANG;
      const stageLabel = pick(
        {
          en: `Stage ${stage}`,
          uk: `Етап ${stage}`,
          ru: `Этап ${stage}`,
        },
        lang,
      );
      const comingSoon = pick(
        {
          en: 'Coming soon',
          uk: 'Скоро тут',
          ru: 'Скоро здесь',
        },
        lang,
      );

      root.innerHTML = `
        <section class="stub-section" data-section-id="${escapeHtml(id)}">
          <div class="stub-card">
            <div class="stub-card__head">
              <span class="stub-card__icon" aria-hidden="true">${escapeHtml(icon || '🚧')}</span>
              <div>
                <h1 class="stub-card__title">${escapeHtml(pick(title, lang))}</h1>
                <p class="stub-card__meta">
                  <span class="stub-card__badge">${escapeHtml(stageLabel)}</span>
                  <span class="stub-card__status">${escapeHtml(comingSoon)}</span>
                </p>
              </div>
            </div>
            <p class="stub-card__copy">${escapeHtml(pick(copy, lang))}</p>
          </div>
        </section>
      `;

      ctx.emit('kt:stub-mounted', { id });
    },

    async unmount(_root) {
      // Registry sweeps innerHTML.
    },
  };
}
