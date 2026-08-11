/* ============================================================
   modules/embed/i18n.js — per-module translations.

   Pushes embed-modal keys into window.kt_i18n_modules. The central
   /i18n.js merges this queue into the global I18N table at boot
   (or on-the-fly via registerI18nModule for late-loaded modules).

   Loaded BEFORE /i18n.js in HTML shells, so this file uses the
   queue-push pattern. After /i18n.js loads, the queue is drained.

   Keys are namespaced under "embed.*" — call sites stay stable:
   t('embed.title'), t('embed.btn.copy'), etc.
   ============================================================ */
(function () {
  'use strict';

  const EMBED_I18N = {
    id: 'embed',
    keys: {
      'embed.title': {
        uk: 'Вбудувати в інший сайт',
        en: 'Embed in another site',
        ru: 'Встроить в другой сайт',
      },
      'embed.body': {
        uk: 'Вставиш цей сніпет у блог, Notion або документ — і він покаже інтерактивний ortbtools з поточним bid. Hash-фрагмент не надсилається з першим HTTP-запитом; після завантаження сторінка передає payload у /api/analyze.',
        en: 'Paste this snippet into a blog, Notion or doc to render an interactive ortbtools view with the current bid. The hash fragment is absent from the initial HTTP request; after loading, the page submits the payload to /api/analyze.',
        ru: 'Вставь этот сниппет в блог, Notion или документ — он покажет интерактивный ortbtools с текущим bid. Hash-фрагмент отсутствует в первом HTTP-запросе; после загрузки страница отправляет payload в /api/analyze.',
      },
      'embed.label.height': {
        uk: 'Висота (px)',
        en: 'Height (px)',
        ru: 'Высота (px)',
      },
      'embed.label.snippet': {
        uk: 'iframe-сніпет',
        en: 'iframe snippet',
        ru: 'iframe-сниппет',
      },
      'embed.btn.copy': {
        uk: 'скопіювати',
        en: 'copy',
        ru: 'скопировать',
      },
      'embed.toast.copied': {
        uk: 'iframe-сніпет скопійовано',
        en: 'iframe snippet copied',
        ru: 'iframe-сниппет скопирован',
      },
    },
  };

  // Two-mode registration: if /i18n.js already loaded, register directly.
  // Otherwise queue, and i18n.js drains the queue on its own boot.
  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(EMBED_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(EMBED_I18N);
  }
})();
