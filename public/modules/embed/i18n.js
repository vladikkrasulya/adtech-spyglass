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
        uk: 'Вставиш цей сніпет у блог, Notion або документ — і він покаже інтерактивний ortbtools з поточним bid. Payload зашитий у hash-фрагмент URL — на сервер не йде.',
        en: 'Paste this snippet into a blog, Notion or doc — it will render an interactive ortbtools view with the current bid. The payload is in the URL hash fragment — never reaches the server.',
        ru: 'Вставь этот сниппет в блог, Notion или документ — и он покажет интерактивный ortbtools с текущим bid. Payload зашит в hash-фрагменте URL — на сервер не идёт.',
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
