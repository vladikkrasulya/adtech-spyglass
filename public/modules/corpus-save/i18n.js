/* ============================================================
   modules/corpus-save/i18n.js — per-module translations.

   11 keys × 3 locales. Loaded LAZY by index.js — pushed into
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
      'modal.corpus_save.summary': {
        uk: 'Поточний probe має {count} події. Збережемо їх з міткою для подальшого аналізу.',
        en: 'Current probe captured {count} events. Save them with a label for later analysis.',
        ru: 'Текущий probe имеет {count} событий. Сохраним их с меткой для дальнейшего анализа.',
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
      'toast.corpus_saved': {
        uk: 'Збережено в corpus · {count} events як «{label}»',
        en: 'Saved to corpus · {count} events as "{label}"',
        ru: 'Сохранено в corpus · {count} events как «{label}»',
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
