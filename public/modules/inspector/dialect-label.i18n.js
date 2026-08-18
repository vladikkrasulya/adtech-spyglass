/* ============================================================
   modules/inspector/dialect-label.i18n.js — translations for the
   dialect labelling flow (dialect-label.js).

   Same per-module i18n pattern as source-nav.i18n.js: EITHER register
   directly via window.registerI18nModule when /i18n.js has already
   booted, OR push the {id, keys} spec onto window.kt_i18n_modules for
   it to drain at boot. Keys namespaced under "dialect.label.*".
   ============================================================ */
(function () {
  'use strict';

  const SPEC = {
    id: 'inspector-dialect-label',
    keys: {
      // ── buttons on the finding card ──
      'dialect.label.ask': { uk: 'Спитати агента', en: 'Ask the agent', ru: 'Спросить агента' },
      'dialect.label.asking': { uk: 'Думаю…', en: 'Thinking…', ru: 'Думаю…' },
      'dialect.label.manual': {
        uk: 'Розмітити вручну',
        en: 'Label manually',
        ru: 'Разметить вручную',
      },

      // ── the proposal ──
      'dialect.label.proposal_title': {
        uk: 'Пропозиція',
        en: 'Suggestion',
        ru: 'Предложение',
      },
      // The badge that separates a table lookup from a model guess. These
      // two must never read alike — that difference is the whole point.
      'dialect.label.source.lexicon': {
        uk: 'з таблиці',
        en: 'from table',
        ru: 'из таблицы',
      },
      'dialect.label.source.model': {
        uk: 'здогад моделі',
        en: 'model guess',
        ru: 'догадка модели',
      },
      'dialect.label.source.lexicon_hint': {
        uk: 'Детерміноване правило: той самий сигнал завжди дає ту саму відповідь.',
        en: 'Deterministic rule: the same signal always gives the same answer.',
        ru: 'Детерминированное правило: тот же сигнал всегда даёт тот же ответ.',
      },
      'dialect.label.source.model_hint': {
        uk: 'Локальна модель. Це припущення — перевір, перш ніж зберігати.',
        en: 'Local model. This is a guess — check it before saving.',
        ru: 'Локальная модель. Это предположение — проверь, прежде чем сохранять.',
      },
      'dialect.label.confidence': { uk: 'впевненість', en: 'confidence', ru: 'уверенность' },
      'dialect.label.low_confidence_warn': {
        uk: 'Низька впевненість. Найімовірніше потрібен словник вендора — збережеш здогад, і він мовчки застосується до всього подальшого трафіку.',
        en: 'Low confidence. This likely needs the vendor’s dictionary — saving a guess applies it silently to all your future traffic.',
        ru: 'Низкая уверенность. Скорее всего нужен словарь вендора — сохранишь догадку, и она молча применится ко всему дальнейшему трафику.',
      },

      // ── the label picker ──
      'dialect.label.pick': {
        uk: 'Семантичний лейбл',
        en: 'Semantic label',
        ru: 'Семантическая метка',
      },
      'dialect.label.notes': {
        uk: 'Нотатка (необовʼязково)',
        en: 'Note (optional)',
        ru: 'Заметка (необязательно)',
      },
      'dialect.label.signal': { uk: 'Сигнал', en: 'Signal', ru: 'Сигнал' },
      'dialect.label.target': {
        uk: 'Зберегти в діалект',
        en: 'Save to dialect',
        ru: 'Сохранить в диалект',
      },
      'dialect.label.new_dialect': {
        uk: '+ новий діалект',
        en: '+ new dialect',
        ru: '+ новый диалект',
      },
      'dialect.label.new_dialect_name': {
        uk: 'Назва нового діалекту',
        en: 'New dialect name',
        ru: 'Название нового диалекта',
      },

      // ── actions ──
      'dialect.label.save': { uk: 'Зберегти', en: 'Save', ru: 'Сохранить' },
      'dialect.label.saving': { uk: 'Зберігаю…', en: 'Saving…', ru: 'Сохраняю…' },
      'dialect.label.cancel': { uk: 'Скасувати', en: 'Cancel', ru: 'Отменить' },
      'dialect.label.reject': { uk: 'Не згоден', en: 'Disagree', ru: 'Не согласен' },

      // ── outcomes ──
      'dialect.label.saved': {
        uk: 'Розмічено: {label}. Запусти аналіз знову, щоб побачити результат.',
        en: 'Labelled as {label}. Re-run analyse to see the effect.',
        ru: 'Размечено: {label}. Запусти анализ снова, чтобы увидеть результат.',
      },
      'dialect.label.rejected': {
        uk: 'Пропозицію відхилено. Обери лейбл сам.',
        en: 'Suggestion dismissed. Pick a label yourself.',
        ru: 'Предложение отклонено. Выбери метку сам.',
      },

      // ── failures, each said plainly ──
      'dialect.label.err.unauthorized': {
        uk: 'Увійди в акаунт — діалекти зберігаються для твого користувача.',
        en: 'Sign in — dialects are saved per user.',
        ru: 'Войди в аккаунт — диалекты сохраняются для твоего пользователя.',
      },
      'dialect.label.err.unavailable': {
        uk: 'Локальна модель недоступна. Розмітити вручну можна й далі.',
        en: 'The local model is unavailable. Manual labelling still works.',
        ru: 'Локальная модель недоступна. Разметить вручную по-прежнему можно.',
      },
      'dialect.label.err.timeout': {
        uk: 'Модель не встигла відповісти. Спробуй ще раз або познач вручну.',
        en: 'The model timed out. Try again or label manually.',
        ru: 'Модель не успела ответить. Попробуй ещё раз или пометь вручную.',
      },
      'dialect.label.err.rate_limited': {
        uk: 'Забагато запитів поспіль. Зачекай хвилину.',
        en: 'Too many requests in a row. Wait a minute.',
        ru: 'Слишком много запросов подряд. Подожди минуту.',
      },
      'dialect.label.err.generic': {
        uk: 'Не вдалося отримати пропозицію.',
        en: 'Could not get a suggestion.',
        ru: 'Не удалось получить предложение.',
      },
      'dialect.label.err.save': {
        uk: 'Не вдалося зберегти розмітку.',
        en: 'Could not save the mapping.',
        ru: 'Не удалось сохранить разметку.',
      },
      'dialect.label.err.no_payload': {
        uk: 'Не бачу payload у редакторі — онови аналіз.',
        en: 'No payload in the editor — re-run the analysis.',
        ru: 'Не вижу payload в редакторе — обнови анализ.',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(SPEC);
  } else {
    (window.kt_i18n_modules = window.kt_i18n_modules || []).push(SPEC);
  }
})();
