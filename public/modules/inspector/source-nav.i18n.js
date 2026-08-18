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
      // The rail that replaced the ‹prev / next› stepper: an ARIA toolbar of
      // one tick per finding down the right edge of the editor.
      'inspector.nav.rail': {
        uk: 'Знахідки в цьому payload',
        en: 'Findings in this payload',
        ru: 'Находки в этом payload',
      },
      'inspector.nav.tick': {
        uk: 'рядок {line}: {what}',
        en: 'line {line}: {what}',
        ru: 'строка {line}: {what}',
      },
      'inspector.nav.at_line': {
        uk: 'рядок {line}',
        en: 'line {line}',
        ru: 'строка {line}',
      },
      // Popover action: from the place in the code to the card that explains it.
      'inspector.nav.to_card': {
        uk: 'відкрити знахідку',
        en: 'open the finding',
        ru: 'открыть находку',
      },
      // Said out loud when the payload is past the highlighter's ceiling, so a
      // monochrome editor reads as a size decision and not as a broken one.
      'inspector.nav.syntax_off': {
        uk: 'підсвітку вимкнено — payload завеликий',
        en: 'highlighting off — payload too large',
        ru: 'подсветка выключена — payload слишком большой',
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
