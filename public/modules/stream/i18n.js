/* ============================================================
   modules/stream/i18n.js — per-module translations for /live.

   Same queue-push contract as modules/live/i18n.js and
   modules/share/i18n.js: push a { id, keys } spec into
   window.kt_i18n_modules, or call window.registerI18nModule
   directly when /i18n.js has already drained the queue (which is
   the case here — the stream module is imported by the section
   registry long after boot).

   Imported for side effects from ./index.js, so the keys are
   registered before mount() paints its first label.

   Plural note: the only count that needs grammatical agreement in
   uk/ru is "N blocking" (блокує / блокують). It gets two forms and
   index.js picks between them; every other counted string is
   phrased so one form covers every number.
   ============================================================ */
(function () {
  'use strict';

  const STREAM_I18N = {
    id: 'stream',
    keys: {
      // ── page header ──────────────────────────────────────
      'stream.title': {
        uk: 'Стріми',
        en: 'Streams',
        ru: 'Стримы',
      },
      'stream.lede': {
        uk: 'Синтетичний RTB-трафік у реальному часі. Обери payload — він відкриється в Inspector. Тут немає продакшн-даних.',
        en: 'Synthetic RTB traffic, live. Pick a payload and it opens in the Inspector — nothing here is production data.',
        ru: 'Синтетический RTB-трафик в реальном времени. Выбери payload — он откроется в Inspector. Здесь нет продакшн-данных.',
      },

      // ── status pill ──────────────────────────────────────
      'stream.state.connecting': {
        uk: 'підключаюсь…',
        en: 'connecting…',
        ru: 'подключаюсь…',
      },
      'stream.state.streaming': {
        uk: 'стрім · {rate}/хв',
        en: 'streaming · {rate}/min',
        ru: 'стрим · {rate}/мин',
      },
      'stream.state.paused': {
        uk: 'пауза · {held} в черзі',
        en: 'paused · {held} held',
        ru: 'пауза · {held} в очереди',
      },
      'stream.state.offline': {
        uk: 'звʼязок втрачено',
        en: 'connection lost',
        ru: 'связь потеряна',
      },
      'stream.pause': {
        uk: 'Пауза',
        en: 'Pause',
        ru: 'Пауза',
      },
      'stream.resume': {
        uk: 'Продовжити',
        en: 'Resume',
        ru: 'Продолжить',
      },
      'stream.pause.hint': {
        uk: 'Заморозити стрічку — нові рядки чекатимуть у черзі',
        en: 'Freeze the feed — new rows wait in a queue',
        ru: 'Заморозить ленту — новые строки будут ждать в очереди',
      },
      'stream.resume.hint': {
        uk: 'Розморозити стрічку і показати те, що накопичилось',
        en: 'Unfreeze the feed and show what piled up',
        ru: 'Разморозить ленту и показать накопившееся',
      },

      // ── filter band ──────────────────────────────────────
      'stream.filter.label': {
        uk: 'показати',
        en: 'show',
        ru: 'показать',
      },
      'stream.filter.all': {
        uk: 'усе',
        en: 'all',
        ru: 'всё',
      },
      'stream.filter.requests': {
        uk: 'запити',
        en: 'requests',
        ru: 'запросы',
      },
      'stream.filter.responses': {
        uk: 'відповіді',
        en: 'responses',
        ru: 'ответы',
      },
      'stream.filter.findings': {
        uk: 'зі знахідками',
        en: 'with findings',
        ru: 'с находками',
      },
      'stream.filter.pops': {
        uk: 'попи',
        en: 'pops',
        ru: 'попы',
      },
      'stream.filter.vast': {
        uk: 'vast',
        en: 'vast',
        ru: 'vast',
      },
      'stream.window': {
        uk: 'за годину: {count}',
        en: '{count} in the last hour',
        ru: 'за час: {count}',
      },

      // ── column headers ───────────────────────────────────
      'stream.col.time': { uk: 'час', en: 'time', ru: 'время' },
      'stream.col.kind': { uk: 'тип', en: 'kind', ru: 'тип' },
      'stream.col.source': { uk: 'джерело', en: 'source', ru: 'источник' },
      'stream.col.format': { uk: 'формат', en: 'format', ru: 'формат' },
      'stream.col.size': { uk: 'розмір', en: 'size', ru: 'размер' },
      'stream.col.findings': { uk: 'знахідки', en: 'findings', ru: 'находки' },

      // ── findings cell ────────────────────────────────────
      'stream.findings.clean': {
        uk: 'чисто',
        en: 'clean',
        ru: 'чисто',
      },
      // uk/ru need agreement here: 1 блокує, 2–4/5+ блокують.
      'stream.findings.blocking.one': {
        uk: '{count} блокує',
        en: '{count} blocking',
        ru: '{count} блокирует',
      },
      'stream.findings.blocking.other': {
        uk: '{count} блокують',
        en: '{count} blocking',
        ru: '{count} блокируют',
      },
      // Invariant across counts in all three locales.
      'stream.findings.tofix': {
        uk: '{count} до правки',
        en: '{count} to fix',
        ru: '{count} к правке',
      },
      'stream.findings.pending': {
        uk: 'перевіряю…',
        en: 'checking…',
        ru: 'проверяю…',
      },
      'stream.findings.unknown': {
        uk: 'без перевірки',
        en: 'not checked',
        ru: 'без проверки',
      },

      // ── empty states ─────────────────────────────────────
      'stream.empty': {
        uk: 'чекаю на перший payload…',
        en: 'waiting for the first payload…',
        ru: 'жду первый payload…',
      },
      'stream.empty.filtered': {
        uk: 'під цей фільтр поки нічого не підходить',
        en: 'nothing matches this filter yet',
        ru: 'под этот фильтр пока ничего не подходит',
      },

      // ── row affordance ───────────────────────────────────
      'stream.row.open': {
        uk: 'Відкрити в Inspector',
        en: 'Open in the Inspector',
        ru: 'Открыть в Inspector',
      },
      'stream.row.no_permalink': {
        uk: 'Цей payload ще не має постійного посилання',
        en: 'This payload has no permalink yet',
        ru: 'У этого payload ещё нет постоянной ссылки',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(STREAM_I18N);
  } else {
    if (!window.kt_i18n_modules) window.kt_i18n_modules = [];
    window.kt_i18n_modules.push(STREAM_I18N);
  }
})();
