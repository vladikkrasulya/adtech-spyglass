/* ============================================================
   modules/macros/i18n.js — Macro Evaluator translations.
   ============================================================ */
(function () {
  'use strict';

  const MACROS_I18N = {
    id: 'macros',
    keys: {
      'macros.tab_title': {
        uk: 'макроси',
        en: 'macros',
        ru: 'макросы',
      },
      'macros.card_title': {
        uk: 'Симулятор макросів · OpenRTB §4.4',
        en: 'Macro Evaluator · OpenRTB §4.4',
        ru: 'Симулятор макросов · OpenRTB §4.4',
      },
      'macros.empty': {
        uk: 'У цій відповіді не виявлено трекінг-URL або макросів для симуляції',
        en: 'No notice URLs or macro substitutions detected in this response',
        ru: 'В этом ответе не обнаружено трекинг-URL или макросов для симуляции',
      },
      'macros.col_bid': {
        uk: 'Ставка / Imp ID',
        en: 'Bid / Imp ID',
        ru: 'Ставка / Imp ID',
      },
      'macros.col_type': {
        uk: 'Тип сповіщення',
        en: 'Notice Type',
        ru: 'Тип уведомления',
      },
      'macros.col_original': {
        uk: 'Початковий шаблон',
        en: 'Original Pattern',
        ru: 'Исходный шаблон',
      },
      'macros.col_evaluated': {
        uk: 'Сформований URL (після підстановки)',
        en: 'Evaluated URL (post-substitution)',
        ru: 'Сформированный URL (после подстановки)',
      },
      'macros.type_nurl': {
        uk: 'Сповіщення про виграш (nurl)',
        en: 'Win Notice (nurl)',
        ru: 'Уведомление о выигрыше (nurl)',
      },
      'macros.type_burl': {
        uk: 'Біллінг-сповіщення (burl)',
        en: 'Billing Notice (burl)',
        ru: 'Биллинг-уведомление (burl)',
      },
      'macros.type_lurl': {
        uk: 'Сповіщення про втрату (lurl)',
        en: 'Loss Notice (lurl)',
        ru: 'Уведомление о проигрыше (lurl)',
      },
      'macros.type_adm': {
        uk: 'Трекер креативу (adm)',
        en: 'Creative Tracker (adm)',
        ru: 'Трекер креатива (adm)',
      },
      'macros.copy': {
        uk: 'Копіювати',
        en: 'Copy',
        ru: 'Копировать',
      },
      'macros.copied': {
        uk: 'URL скопійовано в буфер',
        en: 'URL copied to clipboard',
        ru: 'URL скопирован в буфер',
      },
      'macros.sim_header': {
        uk: 'Параметри симуляції',
        en: 'Simulation Parameters',
        ru: 'Параметры симуляции',
      },
      'macros.price_label': {
        uk: 'Ціна клірингу (${AUCTION_PRICE})',
        en: 'Clearing Price (${AUCTION_PRICE})',
        ru: 'Цена клиринга (${AUCTION_PRICE})',
      },
      'macros.auction_id_label': {
        uk: 'ID аукціону (${AUCTION_ID})',
        en: 'Auction ID (${AUCTION_ID})',
        ru: 'ID аукциона (${AUCTION_ID})',
      },
      'macros.loss_code_label': {
        uk: 'Код втрати (${AUCTION_LOSS})',
        en: 'Loss Code (${AUCTION_LOSS})',
        ru: 'Код проигрыша (${AUCTION_LOSS})',
      },
      'macros.min_to_win_label': {
        uk: 'Мінімум для перемоги (${AUCTION_MIN_TO_WIN})',
        en: 'Min to Win (${AUCTION_MIN_TO_WIN})',
        ru: 'Минимум для победы (${AUCTION_MIN_TO_WIN})',
      },
      'macros.mbr_label': {
        uk: 'Ринкова ставка MBR (${AUCTION_MBR})',
        en: 'Market Bid Rate (${AUCTION_MBR})',
        ru: 'Рыночная ставка MBR (${AUCTION_MBR})',
      },
      'macros.multiplier_label': {
        uk: 'Множник показів (${AUCTION_MULTIPLIER})',
        en: 'Multiplier (${AUCTION_MULTIPLIER})',
        ru: 'Множитель показов (${AUCTION_MULTIPLIER})',
      },
      'macros.imp_ts_label': {
        uk: 'Часова мітка (${AUCTION_IMP_TS})',
        en: 'Impression Timestamp (${AUCTION_IMP_TS})',
        ru: 'Временная метка (${AUCTION_IMP_TS})',
      },
      'macros.discount_pct_label': {
        uk: 'Знижка % (${AUCTION_DISCOUNT_PCT})',
        en: 'Discount % (${AUCTION_DISCOUNT_PCT})',
        ru: 'Скидка % (${AUCTION_DISCOUNT_PCT})',
      },
      'macros.discount_cpm_label': {
        uk: 'Знижка CPM (${AUCTION_DISCOUNT_CPM})',
        en: 'Discount CPM (${AUCTION_DISCOUNT_CPM})',
        ru: 'Скидка CPM (${AUCTION_DISCOUNT_CPM})',
      },
      'macros.unresolved_price_hint': {
        uk: 'Потрібне значення симуляції ціни клірингу',
        en: 'Requires simulated clearing price value',
        ru: 'Требуется значение симуляции цены клиринга',
      },
      'macros.unresolved_encoder_hint': {
        uk: 'Нестандартизований формат: потрібен партнерський енкодер',
        en: 'Non-standard format: partner encoder required',
        ru: 'Нестандартизированный формат: требуется партнерский энкодер',
      },
      'preview.inert_notice': {
        uk: 'Зовнішні ресурси заблоковані. Візуальний попередній перегляд і знахідки Behavior можуть бути неповними.',
        en: 'External resources are blocked. Visual preview and Behavior findings may be incomplete.',
        ru: 'Внешние ресурсы заблокированы. Визуальный предпросмотр и результаты Behavior могут быть неполными.',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(MACROS_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(MACROS_I18N);
  }
})();
