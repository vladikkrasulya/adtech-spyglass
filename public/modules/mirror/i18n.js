/* ============================================================
   modules/mirror/i18n.js — per-module translations.

   26 keys × 3 locales. Loaded LAZY by index.js — pushed into
   window.kt_i18n_modules queue, drained by central /i18n.js (or
   registered directly via window.registerI18nModule when the queue
   has already been drained, which is always the case here since
   /i18n.js loads eagerly at boot).
   ============================================================ */
(function () {
  'use strict';

  const MIRROR_I18N = {
    id: 'mirror',
    keys: {
      'toast.nothing_to_mirror': {
        uk: 'Нічого віддзеркалювати — встав BidRequest або BidResponse',
        en: 'Nothing to mirror — paste a BidRequest or BidResponse first',
        ru: 'Нечего зеркалировать — вставь BidRequest или BidResponse',
      },
      'toast.mirror_invalid_json': {
        uk: 'Не вдалось розпарсити JSON у вхідному полі',
        en: 'Could not parse JSON in the source field',
        ru: 'Не удалось распарсить JSON в исходном поле',
      },
      'toast.mirror_copied': {
        uk: 'Згенерований JSON скопійовано в буфер',
        en: 'Generated JSON copied to clipboard',
        ru: 'Сгенерированный JSON скопирован в буфер',
      },
      'toast.mirror_copy_failed': {
        uk: 'Не вдалось скопіювати в буфер',
        en: 'Could not copy to clipboard',
        ru: 'Не удалось скопировать в буфер',
      },
      'toast.mirror_loaded': {
        uk: 'Згенерований JSON завантажено у відповідне поле',
        en: 'Generated JSON loaded into the other editor',
        ru: 'Сгенерированный JSON загружен в соседнее поле',
      },
      'toast.mirror_share_copied': {
        uk: 'Permalink з канонічною парою скопійовано в буфер',
        en: 'Permalink with the canonical pair copied to clipboard',
        ru: 'Permalink с канонической парой скопирован в буфер',
      },
      'toast.mirror_share_failed': {
        uk: 'Не вдалось зробити share-лінк: {error}',
        en: 'Could not build share link: {error}',
        ru: 'Не удалось собрать share-ссылку: {error}',
      },
      'modal.mirror.title': {
        uk: 'дзеркало запит ↔ відповідь',
        en: 'mirror request ↔ response',
        ru: 'зеркало запрос ↔ ответ',
      },
      'modal.mirror.unsupported_title': {
        uk: 'дзеркало · не підтримується',
        en: 'mirror · not supported',
        ru: 'зеркало · не поддерживается',
      },
      'modal.mirror.loading': {
        uk: 'генеруємо канонічну пару…',
        en: 'building canonical pair…',
        ru: 'строим каноническую пару…',
      },
      'modal.mirror.failed': {
        uk: 'не вдалось згенерувати',
        en: 'could not generate',
        ru: 'не удалось сгенерировать',
      },
      'modal.mirror.dir.response_from_request': {
        uk: 'BidRequest → BidResponse',
        en: 'BidRequest → BidResponse',
        ru: 'BidRequest → BidResponse',
      },
      'modal.mirror.dir.request_from_response': {
        uk: 'BidResponse → BidRequest',
        en: 'BidResponse → BidRequest',
        ru: 'BidResponse → BidRequest',
      },
      'modal.mirror.output_label': {
        uk: 'згенерований JSON',
        en: 'generated JSON',
        ru: 'сгенерированный JSON',
      },
      'modal.mirror.notes_label': {
        uk: 'що вирішено й чому',
        en: 'choices and reasons',
        ru: 'что и почему решено',
      },
      'modal.mirror.btn_copy': {
        uk: 'копіювати',
        en: 'copy',
        ru: 'копировать',
      },
      'modal.mirror.btn_load': {
        uk: 'завантажити в інше поле',
        en: 'load into the other editor',
        ru: 'загрузить в соседнее поле',
      },
      'modal.mirror.btn_share': {
        uk: '🔗 share-лінк з парою',
        en: '🔗 share link with the pair',
        ru: '🔗 share-ссылка с парой',
      },
      'modal.mirror.selftest.clean': {
        uk: 'self-test ✓ valid + crosscheck чистий',
        en: 'self-test ✓ valid + clean crosscheck',
        ru: 'self-test ✓ valid + чистый crosscheck',
      },
      'modal.mirror.selftest.dirty': {
        uk: 'self-test: {errors} помилок, {crits} CRIT',
        en: 'self-test: {errors} errors, {crits} CRIT',
        ru: 'self-test: {errors} ошибок, {crits} CRIT',
      },
      'modal.mirror.mode_label': {
        uk: 'режим',
        en: 'mode',
        ru: 'режим',
      },
      'modal.mirror.mode.minimal': {
        uk: 'мінімум · тільки обовʼязкові поля',
        en: 'minimal · required fields only',
        ru: 'минимум · только обязательные поля',
      },
      'modal.mirror.mode.best_practice': {
        uk: 'best-practice · з recommended (schain, dchain, DSA, GDPR)',
        en: 'best-practice · with recommended (schain, dchain, DSA, GDPR)',
        ru: 'best-practice · с recommended (schain, dchain, DSA, GDPR)',
      },
      'modal.mirror.diff_label': {
        uk: 'diff: твоя версія vs канонічна',
        en: 'diff: your version vs canonical',
        ru: 'diff: твоя версия vs каноническая',
      },
      'modal.mirror.diff_legend': {
        uk: '≠ розбіжність   + у канонічній є, у тебе немає   − у тебе є, в канонічній немає',
        en: '≠ different   + canonical has, you don’t   − you have, canonical doesn’t',
        ru: '≠ различие   + в канонической есть, у тебя нет   − у тебя есть, в канонической нет',
      },
      'modal.mirror.diff_no_changes': {
        uk: 'Все співпадає на верхньому рівні — твоя версія структурно еквівалентна канонічній.',
        en: 'Everything matches at the top level — your version is structurally equivalent to the canonical one.',
        ru: 'Всё совпадает на верхнем уровне — твоя версия структурно эквивалентна канонической.',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(MIRROR_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(MIRROR_I18N);
  }
})();
