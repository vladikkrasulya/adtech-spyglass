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
        uk: 'Це <b>єдиний</b> спосіб відновити доступ до bid request/response, зашифрованих вебінтерфейсом, якщо забудеш пароль. Оператор не має ключа й не може розшифрувати ці тіла; назви, нотатки та інші метадані читає сервер. Запиши ключ у password-manager або на папері.',
        en: 'This is the <b>only</b> way to recover bid request/response bodies encrypted by the web UI if you forget your password. The operator does not hold the key and cannot decrypt those bodies; titles, notes, and other metadata remain server-readable. Save the key in a password manager or on paper.',
        ru: 'Это <b>единственный</b> способ восстановить bid request/response, зашифрованные веб-интерфейсом, если забудешь пароль. Оператор не имеет ключа и не может расшифровать эти тела; названия, заметки и другие метаданные читает сервер. Запиши ключ в password-manager или на бумаге.',
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
        uk: 'Ти точно зберіг recovery key? Без нього не відновити зашифровані bid-тіла, якщо забудеш пароль.',
        en: 'Did you really save your recovery key? Without it, encrypted bid bodies cannot be recovered if you forget your password.',
        ru: 'Ты точно сохранил recovery key? Без него не восстановить зашифрованные bid-тела, если забудешь пароль.',
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
