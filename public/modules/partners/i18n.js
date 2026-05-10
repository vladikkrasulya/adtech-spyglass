/* ============================================================
   modules/partners/i18n.js — per-module translations.

   11 keys × 3 locales. Loaded LAZY by index.js — pushed into
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
        uk: 'Видалити цього партнера? Запити що були з ним повʼязані стануть "без партнера" (не видаляються).',
        en: 'Delete this partner? Linked samples become "no partner" (they’re not deleted).',
        ru: 'Удалить этого партнёра? Запросы, которые с ним были связаны, станут "без партнёра" (не удаляются).',
      },
      'confirm.delete_partner_with_count': {
        uk: 'Видалити цього партнера? {count} запит(ів) що зараз йому привʼязані стануть "без партнера" (записи НЕ видаляються).',
        en: 'Delete this partner? {count} sample(s) currently assigned to it will become "no partner" (they are NOT deleted).',
        ru: 'Удалить этого партнёра? {count} запрос(ов), которые сейчас к нему привязаны, станут "без партнёра" (записи НЕ удаляются).',
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
