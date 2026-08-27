/* ============================================================
   modules/simulate/i18n.js — per-module translations.

   12 keys × 3 locales. Loaded LAZY by index.js — pushed into
   window.kt_i18n_modules queue, drained by central /i18n.js (or
   registered directly via window.registerI18nModule when the queue
   has already been drained, which is always the case here since
   /i18n.js loads eagerly at boot).
   ============================================================ */
(function () {
  'use strict';

  const SIMULATE_I18N = {
    id: 'simulate',
    keys: {
      'modal.simbids.title': {
        uk: '🤖 симуляція 3 DSP-стратегій',
        en: '🤖 simulate 3 DSP strategies',
        ru: '🤖 симуляция 3 DSP-стратегий',
      },
      'modal.simbids.hint': {
        uk: 'Детермінований rules-рушій рахує, як три типи DSP відповіли б на твій запит: прозорі формули від floor, якості інвентарю і стратегії. BidRequest тимчасово обробляється сервером ortbtools, не зберігається цим endpoint і не передається зовнішній моделі.',
        en: 'A deterministic rules engine computes how three DSP types would respond: transparent formulas over floor, inventory quality and strategy. The BidRequest is processed transiently by the ortbtools server, is not persisted by this endpoint, and is not sent to an external model.',
        ru: 'Детерминированный rules-движок считает, как три типа DSP ответили бы на твой запрос: прозрачные формулы от floor, качества инвентаря и стратегии. BidRequest временно обрабатывается сервером ortbtools, не сохраняется этим endpoint и не передаётся внешней модели.',
      },
      'modal.simbids.loading': {
        uk: 'Рахуємо стратегії…',
        en: 'Computing strategies…',
        ru: 'Считаем стратегии…',
      },
      'modal.simbids.ollama_down': {
        uk: 'Сервіс тимчасово недоступний — спробуй ще раз за хвилину.',
        en: 'Service temporarily unavailable — try again in a minute.',
        ru: 'Сервис временно недоступен — попробуй ещё раз через минуту.',
      },
      'modal.simbids.failed_generic': {
        uk: 'Не вдалося виконати симуляцію. Спробуй ще раз.',
        en: 'Simulation failed. Try again.',
        ru: 'Не удалось выполнить симуляцию. Попробуй ещё раз.',
      },
      'modal.simbids.bid': {
        uk: '✓ ставить',
        en: '✓ bids',
        ru: '✓ ставит',
      },
      'modal.simbids.pass': {
        uk: '✗ пропускає',
        en: '✗ passes',
        ru: '✗ пропускает',
      },
      'modal.simbids.strat.aggressive': {
        uk: 'aggressive · max scale',
        en: 'aggressive · max scale',
        ru: 'aggressive · max scale',
      },
      'modal.simbids.strat.conservative': {
        uk: 'conservative · ROAS guard',
        en: 'conservative · ROAS guard',
        ru: 'conservative · ROAS guard',
      },
      'modal.simbids.strat.quality': {
        uk: 'quality · premium only',
        en: 'quality · premium only',
        ru: 'quality · premium only',
      },
      'toast.simbids_no_request': {
        uk: 'Встав BidRequest у ліве поле',
        en: 'Paste a BidRequest in the left pane',
        ru: 'Вставь BidRequest в левое поле',
      },
      'toast.simbids_invalid_json': {
        uk: 'Не вдалось розпарсити BidRequest JSON',
        en: 'Could not parse BidRequest JSON',
        ru: 'Не удалось распарсить BidRequest JSON',
      },
      'toast.simbids_failed': {
        uk: 'Симуляція впала: {error}',
        en: 'Simulation failed: {error}',
        ru: 'Симуляция упала: {error}',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(SIMULATE_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(SIMULATE_I18N);
  }
})();
