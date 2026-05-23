/* modules/sample-preview/i18n.js — labels for the hero "Try with sample"
   CTA. 6 keys × 3 locales. Registered via the same lazy queue as the rest
   of the per-module i18n files (live/, shortcuts/, share/, …). */
(function () {
  'use strict';

  const SAMPLE_PREVIEW_I18N = {
    id: 'sample-preview',
    keys: {
      'sample_preview.banner26': {
        uk: 'Спробувати: OpenRTB 2.6 banner →',
        en: 'Try OpenRTB 2.6 banner →',
        ru: 'Попробовать: OpenRTB 2.6 banner →',
      },
      'sample_preview.video26': {
        uk: 'Спробувати: OpenRTB 2.6 video →',
        en: 'Try OpenRTB 2.6 video →',
        ru: 'Попробовать: OpenRTB 2.6 video →',
      },
      'sample_preview.env30': {
        uk: 'Спробувати: OpenRTB 3.0 envelope →',
        en: 'Try OpenRTB 3.0 envelope →',
        ru: 'Попробовать: OpenRTB 3.0 envelope →',
      },
      'sample_preview.aria_label': {
        uk: 'Завантажити приклад BidRequest',
        en: 'Load sample BidRequest',
        ru: 'Загрузить пример BidRequest',
      },
      'sample_preview.err_fetch_failed': {
        uk: 'Не вдалося завантажити',
        en: 'Fetch failed',
        ru: 'Не удалось загрузить',
      },
      'sample_preview.err_inspector_missing': {
        uk: 'Інспектор недоступний',
        en: 'Inspector missing',
        ru: 'Инспектор недоступен',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(SAMPLE_PREVIEW_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(SAMPLE_PREVIEW_I18N);
  }
})();
