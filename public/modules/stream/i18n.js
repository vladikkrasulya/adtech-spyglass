/* ============================================================
   modules/stream/i18n.js — per-module translations for /live.

   Same queue-push contract as modules/share/i18n.js: push a
   { id, keys } spec into
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
      // The queue is bounded (MAX_ROWS): past that point the count keeps
      // rising but only the newest {kept} will come back on Resume. Said in
      // the pill rather than only in a tooltip — a reader who paused for
      // three minutes and got a hundred rows back would otherwise have no
      // way to know the rest was ever there. No counted noun follows either
      // number on purpose, so no locale needs plural agreement here.
      'stream.state.paused.capped': {
        uk: 'пауза · {held} · покажу {kept}',
        en: 'paused · {held} · will show {kept}',
        ru: 'пауза · {held} · покажу {kept}',
      },
      'stream.state.paused.hint': {
        uk: 'Черга на паузі обмежена: збережено лише останні {kept}, старіше вже витіснено.',
        en: 'The paused queue is capped: only the newest {kept} survive, older ones are already dropped.',
        ru: 'Очередь на паузе ограничена: сохранены только последние {kept}, более старые уже вытеснены.',
      },
      'stream.state.offline': {
        uk: 'звʼязок втрачено',
        en: 'connection lost',
        ru: 'связь потеряна',
      },
      // The server's 429. Named separately because it is the one outage the
      // reader can clear without waiting for anybody: close the other tabs.
      'stream.state.capped': {
        uk: 'ліміт зʼєднань з цієї адреси',
        en: 'connection limit for this address',
        ru: 'лимит соединений с этого адреса',
      },
      'stream.reconnect': {
        uk: 'Підключитись знову',
        en: 'Reconnect',
        ru: 'Подключиться снова',
      },
      'stream.reconnect.hint': {
        uk: 'Спробувати відкрити стрім ще раз, не перезавантажуючи сторінку',
        en: 'Try opening the stream again without reloading the page',
        ru: 'Попробовать открыть стрим ещё раз, не перезагружая страницу',
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

      // ── kind cell ────────────────────────────────────────
      // The cell itself keeps the Latin REQ / RES: they are the trade's own
      // shorthand in all three locales (like `vast` among the chips), the
      // track is 60px wide at the narrow breakpoint, and «ВІДПОВІДЬ» there
      // would ellipsise to «ВІД…». The translated word goes on the cell's
      // title and into the row's accessible name instead, so a screen reader
      // and a hover both get the language they asked for.
      'stream.kind.req': {
        uk: 'запит',
        en: 'request',
        ru: 'запрос',
      },
      'stream.kind.res': {
        uk: 'відповідь',
        en: 'response',
        ru: 'ответ',
      },
      'stream.kind.unknown': {
        uk: 'невідомий тип',
        en: 'unknown kind',
        ru: 'неизвестный тип',
      },

      // ── format cell ──────────────────────────────────────
      // A payload can be well-formed enough to place on the feed and still
      // declare no media anywhere (an oRTB 3.0 item with no spec, say). The
      // cell then used to print a bare qualifier — "3.0" — which reads as if
      // the version were the format. This word says what is actually missing.
      'stream.format.unknown': {
        uk: 'невідомо',
        en: 'unknown',
        ru: 'неизвестно',
      },

      // ── size cell ────────────────────────────────────────
      // Unit only; the number is formatted by Intl in the active locale.
      'stream.size.kb': {
        uk: 'КБ',
        en: 'KB',
        ru: 'КБ',
      },

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
      // An empty table under a dead socket is not "waiting" — nothing is on
      // its way. These two say which of the two silences it is.
      'stream.empty.offline': {
        uk: 'звʼязку зі стрімом немає — payload не надійде, доки він не відновиться',
        en: 'the stream is disconnected — no payload will arrive until it is back',
        ru: 'связи со стримом нет — payload не придёт, пока она не восстановится',
      },
      'stream.empty.capped': {
        uk: 'сервер відхилив підключення: з цієї адреси вже відкрито забагато стрімів (ліміт 8). Закрий зайві вкладки — або натисни «Підключитись знову».',
        en: 'the server refused the connection: this address already holds too many streams (limit 8). Close the other tabs — or press “Reconnect”.',
        ru: 'сервер отклонил подключение: с этого адреса уже открыто слишком много стримов (лимит 8). Закрой лишние вкладки — или нажми «Подключиться снова».',
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
      // Shown on the TIME cell of a row that came out of the server's replay
      // buffer rather than off the live generator.
      'stream.row.replay': {
        uk: 'з буфера повтору — подія сталася раніше, це не щойно',
        en: 'from the replay buffer — this happened earlier, not just now',
        ru: 'из буфера повтора — событие произошло раньше, это не только что',
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
