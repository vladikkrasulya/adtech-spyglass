/* ============================================================
   modules/diff/i18n.js — per-module translations for the Diff tab.

   Same queue-push pattern as the other module i18n files: loaded
   BEFORE /i18n.js in the HTML shells, drained on i18n boot.

   Keys are namespaced under "diff.*".
   ============================================================ */
(function () {
  'use strict';

  const DIFF_I18N = {
    id: 'diff',
    keys: {
      'diff.target': {
        uk: 'Порівнювати',
        en: 'Compare',
        ru: 'Сравнивать',
      },
      'diff.target.request': { uk: 'BidRequest', en: 'BidRequest', ru: 'BidRequest' },
      'diff.target.response': { uk: 'BidResponse', en: 'BidResponse', ru: 'BidResponse' },
      'diff.mode': { uk: 'Режим', en: 'Mode', ru: 'Режим' },
      'diff.mode.semantic': { uk: 'Семантичний', en: 'Semantic', ru: 'Семантический' },
      'diff.mode.raw': { uk: 'Сирий JSON', en: 'Raw JSON', ru: 'Сырой JSON' },
      'diff.mode.semantic_hint': {
        uk: 'imp[] за id, seatbid[] за seat, bid[] за id; порядок ключів і set-полів не враховується. schain.nodes[] лишається чутливим до порядку.',
        en: 'imp[] by id, seatbid[] by seat, bid[] by id; key order and set-like fields ignored. schain.nodes[] stays order-sensitive.',
        ru: 'imp[] по id, seatbid[] по seat, bid[] по id; порядок ключей и set-полей не учитывается. schain.nodes[] остаётся чувствительным к порядку.',
      },
      'diff.mode.raw_hint': {
        uk: 'Кожен масив порівнюється за позицією. Перестановка = зміна.',
        en: 'Every array is compared by index. A reorder counts as a change.',
        ru: 'Каждый массив сравнивается по позиции. Перестановка = изменение.',
      },
      'diff.side_a': {
        uk: 'A — з інспектора',
        en: 'A — from the Inspector',
        ru: 'A — из инспектора',
      },
      'diff.side_b': { uk: 'B — встав сюди', en: 'B — paste here', ru: 'B — вставь сюда' },
      'diff.side_b_placeholder': {
        uk: 'Встав другий payload для порівняння…',
        en: 'Paste the second payload to compare against…',
        ru: 'Вставь второй payload для сравнения…',
      },
      'diff.refresh_a': {
        uk: 'Оновити з інспектора',
        en: 'Reload from Inspector',
        ru: 'Обновить из инспектора',
      },
      'diff.swap': { uk: 'Поміняти A та B', en: 'Swap A and B', ru: 'Поменять A и B' },
      'diff.run': { uk: 'Порівняти', en: 'Compare', ru: 'Сравнить' },
      'diff.empty': {
        uk: 'Встав payload у поле B і натисни «Порівняти». Нічого не змінюється — вкладка лише читає.',
        en: 'Paste a payload into B and press Compare. Nothing is modified — this tab only reads.',
        ru: 'Вставь payload в поле B и нажми «Сравнить». Ничего не меняется — вкладка только читает.',
      },
      'diff.a_empty': {
        uk: 'Сторона A порожня — встав payload в інспектор або натисни «Оновити з інспектора».',
        en: 'Side A is empty — paste a payload into the Inspector, or press "Reload from Inspector".',
        ru: 'Сторона A пуста — вставь payload в инспектор или нажми «Обновить из инспектора».',
      },
      'diff.b_empty': {
        uk: 'Сторона B порожня — вставити нічого.',
        en: 'Side B is empty — there is nothing to compare against.',
        ru: 'Сторона B пуста — сравнивать не с чем.',
      },
      'diff.invalid': {
        uk: 'Сторона {side} — некоректний JSON: {error}',
        en: 'Side {side} is not valid JSON: {error}',
        ru: 'Сторона {side} — некорректный JSON: {error}',
      },
      'diff.failed': {
        uk: 'Не вдалося порівняти: {error}',
        en: "Couldn't compare: {error}",
        ru: 'Не удалось сравнить: {error}',
      },
      'diff.identical': {
        uk: 'Різниць немає — сторони еквівалентні в обраному режимі.',
        en: 'No differences — the two sides are equivalent in this mode.',
        ru: 'Различий нет — стороны эквивалентны в выбранном режиме.',
      },
      'diff.summary': {
        uk: '{added} додано · {removed} видалено · {changed} змінено',
        en: '{added} added · {removed} removed · {changed} changed',
        ru: '{added} добавлено · {removed} удалено · {changed} изменено',
      },
      'diff.group.added': { uk: 'Додано', en: 'Added', ru: 'Добавлено' },
      'diff.group.removed': { uk: 'Видалено', en: 'Removed', ru: 'Удалено' },
      'diff.group.changed': { uk: 'Змінено', en: 'Changed', ru: 'Изменено' },
      'diff.jump': {
        uk: 'Показати це місце в редакторі',
        en: 'Show this position in the editor',
        ru: 'Показать это место в редакторе',
      },
      'diff.jump_unavailable': {
        uk: 'Це місце є лише на стороні B — у редакторі його немає.',
        en: 'This position exists only on side B — it is not in the editor.',
        ru: 'Это место есть только на стороне B — в редакторе его нет.',
      },
      // The warning banner matters more than it looks: the engine can report
      // "equal" while having silently fallen back to positional comparison, and
      // a UI that just said "no differences" would be lying by omission.
      'diff.warning.title': {
        uk: 'Порівняння було послаблене',
        en: 'The comparison was weakened',
        ru: 'Сравнение было ослаблено',
      },
      'diff.warning.fallback': {
        uk: '{path} — не вдалося зіставити за «{key}», тому масив порівняно за позицією. Причина: {reason}. Перестановка елементів тут виглядатиме як зміна.',
        en: '{path} — could not match on "{key}", so the array was compared by index instead. Reason: {reason}. A reorder here will look like a change.',
        ru: '{path} — не удалось сопоставить по «{key}», поэтому массив сравнён по позиции. Причина: {reason}. Перестановка элементов здесь будет выглядеть как изменение.',
      },
      'diff.warning.reason.duplicate': {
        uk: 'повторювані значення',
        en: 'duplicate values',
        ru: 'повторяющиеся значения',
      },
      'diff.warning.reason.missing': {
        uk: 'поле відсутнє в деяких елементах',
        en: 'the field is missing from some elements',
        ru: 'поле отсутствует в некоторых элементах',
      },
      'diff.warning.reason.invalid': {
        uk: 'непридатні значення',
        en: 'unusable values',
        ru: 'непригодные значения',
      },
      'diff.equal_with_warnings': {
        uk: 'Різниць не знайдено, але порівняння було послаблене — див. попередження нижче.',
        en: 'No differences found, but the comparison was weakened — see the warning below.',
        ru: 'Различий не найдено, но сравнение было ослаблено — см. предупреждение ниже.',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(DIFF_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(DIFF_I18N);
  }
})();
