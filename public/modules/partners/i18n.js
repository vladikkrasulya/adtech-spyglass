/* ============================================================
   modules/partners/i18n.js — per-module translations.

   12 keys × 3 locales (the delete confirm is three of them — one per
   plural form; see the note above them). Loaded LAZY by index.js — pushed into
   window.kt_i18n_modules queue, drained by central /i18n.js (or
   registered directly via window.registerI18nModule when the queue
   has already been drained, which is always the case here since
   /i18n.js loads eagerly at boot).

   NOTE: keys that look "partnery" but live OUTSIDE the modal — used
   by the partner-suggest banner (`hint.partner.*`,
   `toast.partner_created`) or the save-modal flow
   (`toast.partner_gone`) — DELIBERATELY stay in the central /i18n.js,
   not here. Same logic as /core/utils.js: a key moves into a module's
   i18n.js only when no other module reads it.
   ============================================================ */
(function () {
  'use strict';

  const PARTNERS_I18N = {
    id: 'partners',
    keys: {
      'modal.partners.title': {
        uk: 'партнери',
        en: 'partners',
        ru: 'партнёры',
      },
      'partner.label.add_new': {
        uk: 'додати нового',
        en: 'add new',
        ru: 'добавить нового',
      },
      'partner.placeholder': {
        uk: 'наприклад MyVendor, BidMachine',
        en: 'e.g. MyVendor, BidMachine',
        ru: 'например MyVendor, BidMachine',
      },
      'empty.partners': {
        uk: 'Партнерів ще немає',
        en: 'No partners yet',
        ru: 'Партнёров пока нет',
      },
      'toast.partner_name_required': {
        uk: 'Введи назву партнера',
        en: 'Enter a partner name',
        ru: 'Введи название партнёра',
      },
      'toast.partner_add_failed': {
        uk: 'Не вдалося додати партнера: {error}',
        en: 'Couldn’t add partner: {error}',
        ru: 'Не удалось добавить партнёра: {error}',
      },
      'toast.partner_deleted': {
        uk: 'Партнера видалено',
        en: 'Partner deleted',
        ru: 'Партнёр удалён',
      },
      'toast.partner_delete_failed': {
        uk: 'Не вдалося видалити партнера: {error}',
        en: 'Couldn’t delete partner: {error}',
        ru: 'Не удалось удалить партнёра: {error}',
      },
      'confirm.delete_partner': {
        uk: 'Видалити цього партнера? Зразки, що були з ним повʼязані, стануть "без партнера" (не видаляються).',
        en: 'Delete this partner? Linked samples become "no partner" (they’re not deleted).',
        ru: 'Удалить этого партнёра? Образцы, которые с ним были связаны, станут "без партнёра" (не удаляются).',
      },
      /* Three keys, not one: this is the last thing a user reads before a
         destructive action, and "1 запит(ів)" is a machine talking. The
         counted noun is now the same word the Samples screen uses for the
         same rows (зразок / образец), not "запит"/"запрос" — the count is
         of saved samples, and a confirm that renames them mid-sentence
         makes the reader wonder what else is about to be deleted.
         index.js picks the form; see pluralKeySuffix() there. */
      'confirm.delete_partner_with_count_one': {
        uk: 'Видалити цього партнера? {count} зразок, що зараз йому привʼязаний, стане "без партнера" (записи НЕ видаляються).',
        en: 'Delete this partner? {count} sample currently assigned to it will become "no partner" (it is NOT deleted).',
        ru: 'Удалить этого партнёра? {count} образец, который сейчас к нему привязан, станет "без партнёра" (записи НЕ удаляются).',
      },
      'confirm.delete_partner_with_count_few': {
        uk: 'Видалити цього партнера? {count} зразки, що зараз йому привʼязані, стануть "без партнера" (записи НЕ видаляються).',
        en: 'Delete this partner? {count} samples currently assigned to it will become "no partner" (they are NOT deleted).',
        ru: 'Удалить этого партнёра? {count} образца, которые сейчас к нему привязаны, станут "без партнёра" (записи НЕ удаляются).',
      },
      'confirm.delete_partner_with_count_many': {
        uk: 'Видалити цього партнера? {count} зразків, що зараз йому привʼязані, стануть "без партнера" (записи НЕ видаляються).',
        en: 'Delete this partner? {count} samples currently assigned to it will become "no partner" (they are NOT deleted).',
        ru: 'Удалить этого партнёра? {count} образцов, которые сейчас к нему привязаны, станут "без партнёра" (записи НЕ удаляются).',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(PARTNERS_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(PARTNERS_I18N);
  }
})();
