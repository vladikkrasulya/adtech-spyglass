/* ============================================================
   modules/edit-sample/i18n.js — per-module translations.

   1 key × 3 locales. Loaded LAZY by index.js — pushed into
   window.kt_i18n_modules queue, drained by central /i18n.js (or
   registered directly via window.registerI18nModule when the queue
   has already been drained, which is always the case here since
   /i18n.js loads eagerly at boot).

   Note on what STAYS in the central /i18n.js (NOT moved here):

     - sample.label.title, sample.label.partner,
       sample.label.notes_short — shared with the save-sample modal
       (still inline in spyglass.app.js, lines ~3765-3770) which uses
       identical labels for the same metadata fields.
     - toast.saved, toast.save_changes_failed — shared with the
       save-sample modal's confirmSave handler (line ~3946).
     - btn.save, btn.cancel — global button labels used across
       half a dozen modules (mirror, simulate, corpus-save, …).

   Only modal.edit_sample.title is exclusive to this modal.
   ============================================================ */
(function () {
  'use strict';

  const EDIT_SAMPLE_I18N = {
    id: 'edit-sample',
    keys: {
      'modal.edit_sample.title': {
        uk: 'редагувати запит',
        en: 'edit sample',
        ru: 'редактировать запрос',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(EDIT_SAMPLE_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(EDIT_SAMPLE_I18N);
  }
})();
