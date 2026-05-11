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
        uk: 'Локальна qwen2.5:3b симулює як три типи DSP відповіли б на твій запит. Тільки метадані запиту (формат, розмір, гео, floor) — bid VALUES не передаємо в LLM.',
        en: 'Local qwen2.5:3b simulates how three DSP types would respond to your request. Metadata only (format, size, geo, floor) — bid VALUES never reach the LLM.',
        ru: 'Локальная qwen2.5:3b симулирует как три типа DSP ответили бы на твой запрос. Только метаданные (формат, размер, гео, floor) — bid VALUES не передаются в LLM.',
      },
      'modal.simbids.loading': {
        uk: 'LLM думає… (3 паралельні prompts, ~15s)',
        en: 'LLM is thinking… (3 parallel prompts, ~15s)',
        ru: 'LLM думает… (3 параллельных prompts, ~15s)',
      },
      'modal.simbids.ollama_down': {
        uk: 'Ollama недоступна. AI-bridge падає тихо — попроси адміна перевірити контейнер.',
        en: 'Ollama unavailable. AI bridge fails quietly — ask the admin to check the container.',
        ru: 'Ollama недоступна. AI-bridge падает тихо — попроси админа проверить контейнер.',
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
