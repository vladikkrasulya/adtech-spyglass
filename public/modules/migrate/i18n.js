/* ============================================================
   modules/migrate/i18n.js — per-module translations for the Migration tab.

   Same queue-push pattern as the other module i18n files: loaded
   BEFORE /i18n.js in the HTML shells, drained on i18n boot.

   Keys are namespaced under "migrate.*".
   ============================================================ */
(function () {
  'use strict';

  const MIGRATE_I18N = {
    id: 'migrate',
    keys: {
      'migrate.empty': {
        uk: 'Встав BidRequest у редактор — тут з’являться пропозиції переходу з OpenRTB 2.5 на 2.6.',
        en: 'Paste a BidRequest into the editor — proposed OpenRTB 2.5 → 2.6 changes appear here.',
        ru: 'Вставь BidRequest в редактор — здесь появятся предложения перехода с OpenRTB 2.5 на 2.6.',
      },
      'migrate.invalid': {
        uk: 'У редакторі некоректний JSON: {error}',
        en: 'The editor does not contain valid JSON: {error}',
        ru: 'В редакторе некорректный JSON: {error}',
      },
      // A BidResponse would otherwise silently produce an empty list, which
      // reads as "nothing to migrate" for a payload that was never examined.
      'migrate.not_request': {
        uk: 'Порадник працює лише з BidRequest — потрібен масив imp[]. Цей payload не перевірявся.',
        en: 'The advisor only handles a BidRequest — an imp[] array is required. This payload was not examined.',
        ru: 'Советник работает только с BidRequest — нужен массив imp[]. Этот payload не проверялся.',
      },
      'migrate.failed': {
        uk: 'Не вдалося порадити: {error}',
        en: "Couldn't produce advice: {error}",
        ru: 'Не удалось дать совет: {error}',
      },
      'migrate.none': {
        uk: 'Пропозицій немає — у межах цього набору правил payload уже відповідає 2.6.',
        en: 'Nothing proposed — within this rule set the payload already matches 2.6.',
        ru: 'Предложений нет — в рамках этого набора правил payload уже соответствует 2.6.',
      },
      // Honesty about coverage: the rule set is bounded on purpose, and a user
      // must not read "no proposals" as "fully migrated".
      'migrate.scope': {
        uk: 'Набір правил обмежений: поля без однозначного відповідника в 2.6 — гнучкі межі banner, device.sua, метадані подів — сюди не входять.',
        en: 'The rule set is bounded: fields without an unambiguous 2.6 counterpart — flexible banner bounds, device.sua, pod metadata — are out of scope.',
        ru: 'Набор правил ограничен: поля без однозначного соответствия в 2.6 — гибкие границы banner, device.sua, метаданные подов — сюда не входят.',
      },
      'migrate.confidence.certain': { uk: 'певно', en: 'certain', ru: 'точно' },
      'migrate.confidence.likely': { uk: 'ймовірно', en: 'likely', ru: 'вероятно' },
      'migrate.confidence.review': { uk: 'перевір', en: 'review', ru: 'проверь' },
      'migrate.kind.move': { uk: 'Перенести', en: 'Move', ru: 'Перенести' },
      'migrate.kind.add': { uk: 'Додати', en: 'Add', ru: 'Добавить' },
      'migrate.kind.drop': {
        uk: 'Прибрати застаріле',
        en: 'Drop legacy copy',
        ru: 'Убрать устаревшее',
      },
      'migrate.kind.drop_note': {
        uk: 'поле 2.6 вже містить те саме значення',
        en: 'the 2.6 field already holds the same value',
        ru: 'поле 2.6 уже содержит то же значение',
      },
      'migrate.spec': { uk: 'специфікація', en: 'spec', ru: 'спецификация' },
      'migrate.apply': {
        uk: 'Застосувати вибране ({count})',
        en: 'Apply selected ({count})',
        ru: 'Применить выбранное ({count})',
      },
      'migrate.select_all': { uk: 'Вибрати все', en: 'Select all', ru: 'Выбрать всё' },
      'migrate.select_none': { uk: 'Зняти все', en: 'Clear', ru: 'Снять всё' },
      'migrate.refresh': { uk: 'Перечитати', en: 'Refresh', ru: 'Перечитать' },
      // Stated BEFORE the click, not after: applying reformats the JSON, and
      // the user has to know that when deciding, not when discovering it.
      'migrate.apply_hint': {
        uk: 'Застосування перезаписує редактор і переформатовує JSON (відступ 2 пробіли). «Скасувати» повертає твій текст точно таким, яким він був.',
        en: 'Applying rewrites the editor and reformats the JSON (2-space indent). Undo restores your text exactly as it was.',
        ru: 'Применение перезаписывает редактор и переформатирует JSON (отступ 2 пробела). «Отменить» вернёт твой текст ровно таким, каким он был.',
      },
      // Counted in proposals — the unit shown next to each checkbox.
      'migrate.applied': {
        uk: 'Застосовано пропозицій: {count}',
        en: 'Applied {count} proposal(s)',
        ru: 'Применено предложений: {count}',
      },
      'migrate.partial': {
        uk: 'застосовано частково: {count}',
        en: '{count} applied only partly',
        ru: 'применено частично: {count}',
      },
      'migrate.unapplied': {
        uk: 'не вдалося застосувати: {count}',
        en: '{count} could not be applied',
        ru: 'не удалось применить: {count}',
      },
      'migrate.stale': {
        uk: 'застаріло після зміни payload: {count}',
        en: '{count} no longer applied — the payload had changed',
        ru: 'устарело после изменения payload: {count}',
      },
      'migrate.undo': { uk: 'Скасувати', en: 'Undo', ru: 'Отменить' },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(MIGRATE_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(MIGRATE_I18N);
  }
})();
