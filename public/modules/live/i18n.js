/* ============================================================
   modules/live/i18n.js — per-module translations.

   11 keys × 3 locales. Loaded LAZY by index.js — pushed into
   window.kt_i18n_modules queue, drained by central /i18n.js (or
   registered directly via window.registerI18nModule when the queue
   has already been drained, which is always the case here since
   /i18n.js loads eagerly at boot).

   Note: toast.live_loaded / toast.live_load_failed are bundled
   here (not in /i18n.js) because the dispatcher's 'live-load'
   case can only fire AFTER the user clicks the live button, by
   which point this module has already been imported and its keys
   registered. So the lazy boundary is safe.
   ============================================================ */
(function () {
  'use strict';

  const LIVE_I18N = {
    id: 'live',
    keys: {
      'modal.live.title': {
        uk: 'live · потік RTB-зразків',
        en: 'live · RTB sample stream',
        ru: 'live · поток RTB-образцов',
      },
      'modal.live.connecting': {
        uk: '· підключаюсь…',
        en: '· connecting…',
        ru: '· подключаюсь…',
      },
      'modal.live.connected': {
        uk: '· live',
        en: '· live',
        ru: '· live',
      },
      'modal.live.paused': {
        uk: '· пауза',
        en: '· paused',
        ru: '· пауза',
      },
      'modal.live.connection_lost': {
        uk: '· звʼязок втрачено',
        en: '· connection lost',
        ru: '· связь потеряна',
      },
      'modal.live.pause': {
        uk: '⏸ пауза',
        en: '⏸ pause',
        ru: '⏸ пауза',
      },
      'modal.live.resume': {
        uk: '▶ продовжити',
        en: '▶ resume',
        ru: '▶ продолжить',
      },
      'modal.live.empty': {
        uk: 'чекаємо першого зразка…',
        en: 'waiting for the first sample…',
        ru: 'ждём первый образец…',
      },
      'modal.live.hint': {
        uk: 'Клік по рядку — завантажити зразок у відповідне поле та закрити вікно.',
        en: 'Click a row to load that sample into the matching editor and close the modal.',
        ru: 'Клик по строке — загрузить образец в соответствующее поле и закрыть окно.',
      },
      'toast.live_loaded': {
        uk: 'Зразок завантажено · можна аналізувати',
        en: 'Sample loaded · ready to analyze',
        ru: 'Образец загружен · можно анализировать',
      },
      'toast.live_load_failed': {
        uk: 'Не вдалось розпарсити зразок',
        en: 'Could not parse the sample',
        ru: 'Не удалось распарсить образец',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(LIVE_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(LIVE_I18N);
  }
})();
