/* ============================================================
   modules/save-sample/i18n.js — per-module translations.

   2 keys × 3 locales. Loaded LAZY by index.js — pushed into
   window.kt_i18n_modules queue, drained by central /i18n.js (or
   registered directly via window.registerI18nModule when the queue
   has already been drained, which is always the case here since
   /i18n.js loads eagerly at boot).

   ONLY the modal-title strings live here (`modal.save_sample.title`,
   `modal.save_sample.update_title`) — every other string the modal
   uses is shared with non-lazy surfaces and DELIBERATELY stays in
   the central /i18n.js:
     - sample.label.title / .partner / .notes — also used by the
       library list / cabinet meta-cards.
     - hint.partner.* / toast.partner_created / toast.partner_gone
       — also used by the partner-suggest banner outside this modal.
     - toast.signin_to_save — also used by 'open-corpus-save' guard
       in spyglass.app.js dispatcher.
     - toast.saved / toast.updated / toast.save_failed
       / toast.crypto_session_lost / toast.send_failed
       / toast.nothing_to_save — also used by confirmEdit / loadSample
       / other save-adjacent flows in spyglass.app.js.
     - btn.save / btn.update / btn.save_as_new / btn.cancel
       — generic UI vocabulary, reused everywhere.
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
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(SAVE_SAMPLE_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(SAVE_SAMPLE_I18N);
  }
})();
