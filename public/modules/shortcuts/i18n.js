/* ============================================================
   modules/shortcuts/i18n.js — per-module translations.

   Pushes shortcut cheat-sheet keys into window.kt_i18n_modules. The
   central /i18n.js merges this queue into the global I18N table at
   boot (or on-the-fly via registerI18nModule for late-loaded modules).

   Loaded BEFORE /i18n.js in HTML shells, so this file uses the
   queue-push pattern. After /i18n.js loads, the queue is drained.

   Keys are namespaced under "shortcuts.*" — call sites stay stable:
   t('shortcuts.title') still works.
   ============================================================ */
(function () {
  'use strict';

  const SHORTCUTS_I18N = {
    id: 'shortcuts',
    keys: {
      'shortcuts.title': {
        uk: 'Гарячі клавіші',
        en: 'Keyboard shortcuts',
        ru: 'Горячие клавиши',
      },
      'shortcuts.row.help': {
        uk: 'Показати цю довідку',
        en: 'Show this help',
        ru: 'Показать эту справку',
      },
      'shortcuts.row.run': {
        uk: 'Запустити аналіз',
        en: 'Run analysis',
        ru: 'Запустить анализ',
      },
      'shortcuts.row.save': {
        uk: 'Зберегти в бібліотеку',
        en: 'Save to library',
        ru: 'Сохранить в библиотеку',
      },
      'shortcuts.row.mirror': {
        uk: 'Дзеркало запит ↔ відповідь',
        en: 'Mirror request ↔ response',
        ru: 'Зеркало запрос ↔ ответ',
      },
      'shortcuts.row.close': {
        uk: 'Закрити модалку',
        en: 'Close modal',
        ru: 'Закрыть модалку',
      },
    },
  };

  // Two-mode registration: if /i18n.js already loaded, register directly.
  // Otherwise queue, and i18n.js drains the queue on its own boot.
  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(SHORTCUTS_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(SHORTCUTS_I18N);
  }
})();
