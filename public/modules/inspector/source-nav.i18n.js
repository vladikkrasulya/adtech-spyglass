/* ============================================================
   modules/inspector/source-nav.i18n.js — translations for the
   exact finding→source navigator (source-nav.js).

   Follows the per-module i18n pattern: push a {id, keys} spec onto
   window.kt_i18n_modules (drained by /i18n.js at boot) AND call
   window.registerI18nModule directly when /i18n.js already loaded
   (this file is deferred and may run after it). Keys namespaced
   under "inspector.nav.*"; {var} placeholders interpolate via t().
   ============================================================ */
(function () {
  'use strict';

  const SPEC = {
    id: 'inspector-nav',
    keys: {
      'inspector.nav.prev': { uk: '‹ назад', en: '‹ prev', ru: '‹ назад' },
      'inspector.nav.next': { uk: 'далі ›', en: 'next ›', ru: 'далее ›' },
      'inspector.nav.locatable': {
        uk: '{n} зі знайденим місцем',
        en: '{n} locatable',
        ru: '{n} с найденным местом',
      },
      'inspector.nav.none_locatable': {
        uk: 'місце не знайдено',
        en: 'none locatable',
        ru: 'место не найдено',
      },
      'inspector.nav.edited': {
        uk: 'змінено — запусти аналіз знову',
        en: 'edited — re-run analyze',
        ru: 'изменено — запусти анализ снова',
      },
      'inspector.nav.no_location': {
        uk: 'немає точного місця',
        en: 'no precise location',
        ru: 'нет точного места',
      },
      'inspector.nav.idle': { uk: '—', en: '—', ru: '—' },
      'inspector.nav.jumped': {
        uk: 'Перехід до {display} у {side}, рядок {line} колонка {col}',
        en: 'Jumped to {display} in {side}, line {line} column {col}',
        ru: 'Переход к {display} в {side}, строка {line} колонка {col}',
      },
      'inspector.nav.related': {
        uk: ' (повʼязаних: {n})',
        en: ' ({n} related)',
        ru: ' (связанных: {n})',
      },
      'inspector.nav.no_precise': {
        uk: 'Немає точного місця в коді ({reason}).',
        en: 'No precise source location ({reason}).',
        ru: 'Нет точного места в коде ({reason}).',
      },
      'inspector.nav.no_source': {
        uk: 'Для цього finding немає місця в коді.',
        en: 'No source location for this finding.',
        ru: 'Для этого finding нет места в коде.',
      },
      'inspector.nav.side.request': { uk: 'запиті', en: 'request', ru: 'запросе' },
      'inspector.nav.side.response': { uk: 'відповіді', en: 'response', ru: 'ответе' },
    },
  };

  (window.kt_i18n_modules = window.kt_i18n_modules || []).push(SPEC);
  if (typeof window.registerI18nModule === 'function') window.registerI18nModule(SPEC);
})();
