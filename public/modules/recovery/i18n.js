/* ============================================================
   modules/recovery/i18n.js — per-module translations.

   5 keys × 3 locales. Loaded LAZY by the dispatcher's
   `case 'show-recovery'` stub — pushed into
   window.kt_i18n_modules queue, drained by central /i18n.js
   (or registered directly via window.registerI18nModule when
   the queue has already been drained, which is always the case
   here since /i18n.js loads eagerly at boot).

   Owned keys (recovery-specific, moved out of the central
   /i18n.js dictionary in this migration):
     - modal.recovery.title
     - recovery.body
     - btn.recovery_saved
     - toast.recovery_key_copied
     - confirm.recovery_save

   Consumed (still owned by central /i18n.js — shared with
   other surfaces, not duplicated here):
     - btn.copy / btn.copied      (every copy button uses these)
     - toast.copy_failed_select   (every clipboard fallback uses)
   ============================================================ */
(function () {
  'use strict';

  const RECOVERY_I18N = {
    id: 'recovery',
    keys: {
      'modal.recovery.title': {
        uk: '⚠ recovery key — збережи зараз',
        en: '⚠ recovery key — save now',
        ru: '⚠ recovery key — сохрани сейчас',
      },
      'recovery.body': {
        uk: 'Це <b>єдиний</b> спосіб відновити доступ до твоєї бібліотеки якщо забудеш пароль. Я (оператор сервера) не маю його і не зможу відновити твої дані без нього. Запиши його у password-manager або на папері.',
        en: 'This is the <b>only</b> way to recover access to your library if you forget your password. I (the operator) don’t hold it and can’t recover your data without it. Save it in a password manager or on paper.',
        ru: 'Это <b>единственный</b> способ восстановить доступ к твоей библиотеке если забудешь пароль. Я (оператор сервера) не имею его и не смогу восстановить твои данные без него. Запиши его в password-manager или на бумаге.',
      },
      'btn.recovery_saved': {
        uk: 'я зберіг',
        en: 'I saved it',
        ru: 'я сохранил',
      },
      'toast.recovery_key_copied': {
        uk: 'Recovery key скопійовано',
        en: 'Recovery key copied',
        ru: 'Recovery key скопирован',
      },
      'confirm.recovery_save': {
        uk: 'Ти точно зберіг recovery key? Без нього неможливо відновити дані якщо забудеш пароль.',
        en: 'Did you really save your recovery key? You can’t recover data without it if you forget your password.',
        ru: 'Ты точно сохранил recovery key? Без него невозможно восстановить данные если забудешь пароль.',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(RECOVERY_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(RECOVERY_I18N);
  }
})();
