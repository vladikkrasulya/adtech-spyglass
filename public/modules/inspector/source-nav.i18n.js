/* ============================================================
   modules/inspector/source-nav.i18n.js — translations for the
   exact finding→source navigator (source-nav.js).

   Follows the per-module i18n pattern: EITHER register directly via
   window.registerI18nModule when /i18n.js has already booted, OR push
   the {id, keys} spec onto window.kt_i18n_modules for it to drain at
   boot — exactly one path (this file is deferred and may run before or
   after /i18n.js). Keys namespaced under "inspector.nav.*"; {var}
   placeholders interpolate via t().
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
      'inspector.nav.toolbar': {
        uk: 'Навігація по знайдених місцях у коді',
        en: 'Finding source navigation',
        ru: 'Навигация по найденным местам в коде',
      },
      'inspector.nav.jump': {
        uk: 'Перейти до цього місця в коді',
        en: 'Jump to this location in the source',
        ru: 'Перейти к этому месту в коде',
      },
    },
  };

  // Standard per-module i18n registration: register DIRECTLY if /i18n.js has
  // already booted, otherwise queue for it to drain — exactly one path, never
  // both (a simultaneous push + register double-registers the spec).
  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(SPEC);
  } else {
    (window.kt_i18n_modules = window.kt_i18n_modules || []).push(SPEC);
  }
})();
