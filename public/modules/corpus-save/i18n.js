/* ============================================================
   modules/corpus-save/i18n.js — per-module translations.

   11 messages × 3 locales — 15 keys, because two of the messages are
   counted nouns and carry all three Slavic plural forms
   (*_one / *_few / *_many). Loaded LAZY by index.js — pushed into
   window.kt_i18n_modules queue, drained by central /i18n.js (or
   registered directly via window.registerI18nModule when the queue
   has already been drained, which is always the case here since
   /i18n.js loads eagerly at boot).

   Note: corpus.bar.*, corpus.cabinet.*, corpus.label.*,
   toast.corpus_deleted, toast.corpus_delete_failed,
   confirm.corpus_delete stay in the central /i18n.js — they are
   consumed by injectCorpusBar (eager, on the behavior tab) and the
   cabinet rendering / 'corpus-delete' dispatcher case, neither of
   which migrate with this modal.
   ============================================================ */
(function () {
  'use strict';

  const CORPUS_SAVE_I18N = {
    id: 'corpus-save',
    keys: {
      'modal.corpus_save.title': {
        uk: 'зберегти behavior як corpus',
        en: 'save behavior as corpus',
        ru: 'сохранить behavior как corpus',
      },
      /* Counted noun, so three forms per Slavic locale — 1 / 2-4 / 5+.
         The single stored string read "має {count} події", which is the
         2-4 form: it was wrong for one event ("1 події"), wrong from five
         up ("7 події"), and wrong in Russian for everything but 5+
         ("1 событий"). English needs two of the three and was wrong at
         one ("1 events"). Selected by pluralKeySuffix() in index.js,
         which mirrors pluralKey() in public/ortbtools.app.js — the rule
         pinned by tests/plural-forms.test.js. */
      'modal.corpus_save.summary_one': {
        uk: 'Поточний probe захопив {count} подію. Збережемо її з міткою для подальшого аналізу.',
        en: 'Current probe captured {count} event. Save it with a label for later analysis.',
        ru: 'Текущий probe захватил {count} событие. Сохраним его с меткой для дальнейшего анализа.',
      },
      'modal.corpus_save.summary_few': {
        uk: 'Поточний probe захопив {count} події. Збережемо їх з міткою для подальшого аналізу.',
        en: 'Current probe captured {count} events. Save them with a label for later analysis.',
        ru: 'Текущий probe захватил {count} события. Сохраним их с меткой для дальнейшего анализа.',
      },
      'modal.corpus_save.summary_many': {
        uk: 'Поточний probe захопив {count} подій. Збережемо їх з міткою для подальшого аналізу.',
        en: 'Current probe captured {count} events. Save them with a label for later analysis.',
        ru: 'Текущий probe захватил {count} событий. Сохраним их с меткой для дальнейшего анализа.',
      },
      'modal.corpus_save.label': {
        uk: 'Як класифікувати',
        en: 'Classify as',
        ru: 'Как классифицировать',
      },
      'modal.corpus_save.label.legitimate': {
        uk: 'легітимно — реальний користувач',
        en: 'legitimate — real user',
        ru: 'легитимно — реальный пользователь',
      },
      'modal.corpus_save.label.fraud': {
        uk: 'шахрайство — бот / фейкова активність',
        en: 'fraud — bot / fake activity',
        ru: 'мошенничество — бот / фейковая активность',
      },
      'modal.corpus_save.label.ambiguous': {
        uk: 'неоднозначно — потребує review',
        en: 'ambiguous — needs review',
        ru: 'неоднозначно — требует review',
      },
      'modal.corpus_save.notes': {
        uk: 'Нотатки (опційно)',
        en: 'Notes (optional)',
        ru: 'Заметки (опционально)',
      },
      'modal.corpus_save.notes_placeholder': {
        uk: 'Що тригернуло цю мітку, що варто запамʼятати на майбутнє…',
        en: 'What triggered this label, anything worth remembering…',
        ru: 'Что триггернуло эту метку, что стоит запомнить на будущее…',
      },
      /* Same three forms. {label} used to interpolate the raw machine value
         — the Ukrainian toast said «fraud» — so it now receives the short
         localized name from corpus.label.* in the central catalog, which is
         what the cabinet already prints next to each stored row. */
      'toast.corpus_saved_one': {
        uk: 'Збережено в corpus · {count} подію як «{label}»',
        en: 'Saved to corpus · {count} event as "{label}"',
        ru: 'Сохранено в corpus · {count} событие как «{label}»',
      },
      'toast.corpus_saved_few': {
        uk: 'Збережено в corpus · {count} події як «{label}»',
        en: 'Saved to corpus · {count} events as "{label}"',
        ru: 'Сохранено в corpus · {count} события как «{label}»',
      },
      'toast.corpus_saved_many': {
        uk: 'Збережено в corpus · {count} подій як «{label}»',
        en: 'Saved to corpus · {count} events as "{label}"',
        ru: 'Сохранено в corpus · {count} событий как «{label}»',
      },
      'toast.corpus_save_failed': {
        uk: 'Не вдалось зберегти: {error}',
        en: 'Save failed: {error}',
        ru: 'Не удалось сохранить: {error}',
      },
      'toast.corpus_no_events': {
        uk: 'Запусти probe — без подій нема що зберігати',
        en: 'Run a probe first — nothing to save without events',
        ru: 'Запусти probe — без событий нечего сохранять',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(CORPUS_SAVE_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(CORPUS_SAVE_I18N);
  }
})();
