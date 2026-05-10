/* ============================================================
   modules/save-sample/i18n.js — per-module translations.

   10 keys × 3 locales. Loaded LAZY by index.js — pushed into
   window.kt_i18n_modules queue, drained by central /i18n.js (or
   registered directly via window.registerI18nModule when the queue
   has already been drained, which is always the case here since
   /i18n.js loads eagerly at boot).

   Keys are namespaced by tool:
     - modal.save_sample.{title,update_title}
     - toast.{updated,save_failed,nothing_to_save,partner_gone,partner_created}
     - hint.partner.{suggestion,use_existing,create_new}

   Generic shared keys stay in /i18n.js — they're consumed by other
   flows too: toast.saved (editSample 4101), toast.signin_to_save
   (corpus save 1057), toast.crypto_session_lost (load/edit/etc.),
   toast.send_failed (multiple network paths), sample.label.* +
   sample.partner_none (edit-sample modal), toast.save_changes_failed
   (editSample-specific, NOT this flow).
   ============================================================ */
(function () {
  'use strict';

  const SAVE_SAMPLE_I18N = {
    id: 'save-sample',
    keys: {
      'modal.save_sample.title': {
        uk: 'зберегти запит',
        en: 'save sample',
        ru: 'сохранить запрос',
      },
      'modal.save_sample.update_title': {
        uk: 'оновити запис · #{id}',
        en: 'update sample · #{id}',
        ru: 'обновить запись · #{id}',
      },
      'toast.updated': {
        uk: 'Оновлено · {title}',
        en: 'Updated · {title}',
        ru: 'Обновлено · {title}',
      },
      'toast.save_failed': {
        uk: 'Не вдалося зберегти: {error}',
        en: 'Save failed: {error}',
        ru: 'Не удалось сохранить: {error}',
      },
      'toast.nothing_to_save': {
        uk: 'Нічого зберігати — обидва поля порожні',
        en: 'Nothing to save — both fields are empty',
        ru: 'Нечего сохранять — оба поля пусты',
      },
      'toast.partner_gone': {
        uk: 'Партнера, якого ти обрав(ла), видалили у іншій вкладці. Список оновлено — обери ще раз.',
        en: 'The partner you picked was deleted in another tab. Picker refreshed — pick again.',
        ru: 'Партнёра, которого ты выбрал(а), удалили в другой вкладке. Список обновлён — выбери заново.',
      },
      'toast.partner_created': {
        uk: 'Партнер «{name}» створений',
        en: 'Partner "{name}" created',
        ru: 'Партнёр «{name}» создан',
      },
      'hint.partner.suggestion': {
        uk: 'Виглядає як <b>{name}</b> ({conf} впевненість)',
        en: 'Looks like <b>{name}</b> ({conf} confidence)',
        ru: 'Похоже на <b>{name}</b> ({conf} уверенность)',
      },
      'hint.partner.use_existing': {
        uk: 'Обрати',
        en: 'Use this',
        ru: 'Выбрать',
      },
      'hint.partner.create_new': {
        uk: 'Створити',
        en: 'Create',
        ru: 'Создать',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(SAVE_SAMPLE_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(SAVE_SAMPLE_I18N);
  }
})();
