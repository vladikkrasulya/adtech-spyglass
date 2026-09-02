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
        uk: 'Низька впевненість. Перевір здогад, перш ніж зберігати: мапінг застосується там, де цей шлях має саме це значення, у вибраному діалекті.',
        en: 'Low confidence. Check the guess before saving: the mapping applies where this path has exactly this value, in the chosen dialect.',
        ru: 'Низкая уверенность. Проверь догадку, прежде чем сохранять: маппинг применится там, где этот путь имеет именно это значение, в выбранном диалекте.',
      },
      // FR-015: the saved mapping's REAL scope — this dialect, this
      // normalized path, this exact serialized value. Never "all traffic".
      'dialect.label.scope_note': {
        uk: 'Мапінг діє лише у вибраному діалекті, для цього шляху з саме цим значенням. Інших значень, шляхів чи діалектів він не торкається.',
        en: 'The mapping applies only within the chosen dialect, to this path with exactly this value. Other values, paths or dialects are untouched.',
        ru: 'Маппинг действует только в выбранном диалекте, для этого пути с именно этим значением. Других значений, путей и диалектов он не касается.',
      },

      // ── 016: the role/value split, variants, provenance ──
      'dialect.label.role': { uk: 'Роль поля', en: 'Field role', ru: 'Роль поля' },
      'dialect.label.value_yours': {
        uk: 'Значення — код вендора. Що воно означає, вирішуєш ти.',
        en: 'The value is the vendor’s code. What it means is your call.',
        ru: 'Значение — код вендора. Что оно значит, решаешь ты.',
      },
      'dialect.label.source.saved-mapping': {
        uk: 'твій мапінг',
        en: 'your mapping',
        ru: 'твой маппинг',
      },
      'dialect.label.source.saved-mapping_hint': {
        uk: 'Цей сигнал ти вже розмітив; збережений лейбл показано без оцінки — ти його підтвердив.',
        en: 'You already labelled this signal; the stored label is shown without a score — you confirmed it.',
        ru: 'Этот сигнал ты уже разметил; сохранённый лейбл показан без оценки — ты его подтвердил.',
      },
      'dialect.label.ambiguous_title': {
        uk: 'Кілька можливих ролей',
        en: 'Several possible roles',
        ru: 'Несколько возможных ролей',
      },
      'dialect.label.candidates': { uk: 'кандидати', en: 'candidates', ru: 'кандидаты' },
      'dialect.label.evidence': { uk: 'докази', en: 'evidence', ru: 'доказательства' },
      'dialect.label.unverified': {
        uk: 'доказ не підтверджено другим читачем',
        en: 'evidence not independently confirmed',
        ru: 'доказательство не подтверждено вторым читателем',
      },
      'dialect.label.conflict_note': {
        uk: 'Значення і форма impression суперечать одне одному — роль стоїть на назві ключа, конфлікт показано.',
        en: 'The value and the impression shape contradict each other — the role rests on the key name; the conflict is shown.',
        ru: 'Значение и форма impression противоречат друг другу — роль стоит на имени ключа, конфликт показан.',
      },

      // ── localized names + one-line descriptions for all twenty labels
      //    (016 R-06/FR-023): stored IDs never change; display only. ──
      'dialect.label.name.pop': {
        uk: 'поп (нове вікно)',
        en: 'pop (new window)',
        ru: 'поп (новое окно)',
      },
      'dialect.label.desc.pop': {
        uk: 'Popunder/clickunder: відкривається нове вікно чи вкладка.',
        en: 'Popunder/clickunder: a new window or tab opens.',
        ru: 'Popunder/clickunder: открывается новое окно или вкладка.',
      },
      'dialect.label.name.native': { uk: 'нативний', en: 'native', ru: 'нативный' },
      'dialect.label.desc.native': {
        uk: 'Канонічний IAB native-формат.',
        en: 'Canonical IAB native format.',
        ru: 'Канонический IAB native-формат.',
      },
      'dialect.label.name.banner': { uk: 'банер', en: 'banner', ru: 'баннер' },
      'dialect.label.desc.banner': {
        uk: 'Канонічний IAB банер.',
        en: 'Canonical IAB banner.',
        ru: 'Канонический IAB баннер.',
      },
      'dialect.label.name.video': { uk: 'відео', en: 'video', ru: 'видео' },
      'dialect.label.desc.video': {
        uk: 'Канонічний IAB відеоформат.',
        en: 'Canonical IAB video format.',
        ru: 'Канонический IAB видеоформат.',
      },
      'dialect.label.name.audio': { uk: 'аудіо', en: 'audio', ru: 'аудио' },
      'dialect.label.desc.audio': {
        uk: 'Канонічний IAB аудіоформат.',
        en: 'Canonical IAB audio format.',
        ru: 'Канонический IAB аудиоформат.',
      },
      'dialect.label.name.in-page-push': {
        uk: 'in-page push',
        en: 'in-page push',
        ru: 'in-page push',
      },
      'dialect.label.desc.in-page-push': {
        uk: 'Віджет у сторінці, що імітує сповіщення.',
        en: 'An in-page widget imitating a notification.',
        ru: 'Виджет на странице, имитирующий уведомление.',
      },
      'dialect.label.name.push': { uk: 'push', en: 'push', ru: 'push' },
      'dialect.label.desc.push': {
        uk: 'Системне сповіщення пристрою.',
        en: 'A system device notification.',
        ru: 'Системное уведомление устройства.',
      },
      'dialect.label.name.interstitial-banner': {
        uk: 'міжсторінковий банер',
        en: 'interstitial banner',
        ru: 'межстраничный баннер',
      },
      'dialect.label.desc.interstitial-banner': {
        uk: 'Повноекранний банер усередині сторінки.',
        en: 'A full-screen banner inside the page.',
        ru: 'Полноэкранный баннер внутри страницы.',
      },
      'dialect.label.name.ignore': { uk: 'ігнорувати', en: 'ignore', ru: 'игнорировать' },
      'dialect.label.desc.ignore': {
        uk: 'Технічний шум: службові id, трасування.',
        en: 'Technical noise: bookkeeping ids, traces.',
        ru: 'Технический шум: служебные id, трассировка.',
      },
      'dialect.label.name.informational': {
        uk: 'інформаційне',
        en: 'informational',
        ru: 'информационное',
      },
      'dialect.label.desc.informational': {
        uk: 'Метадані, які варто бачити, але це не формат.',
        en: 'Metadata worth seeing, but not a format.',
        ru: 'Метаданные, которые стоит видеть, но это не формат.',
      },
      'dialect.label.name.custom': {
        uk: 'формат не визначено',
        en: 'format undetermined',
        ru: 'формат не определён',
      },
      'dialect.label.desc.custom': {
        uk: 'Поле оголошує формат, але який саме — не встановлено.',
        en: 'The field declares a format; which one is not established.',
        ru: 'Поле объявляет формат, но какой именно — не установлено.',
      },
      'dialect.label.name.identifier': {
        uk: 'ідентифікатор',
        en: 'identifier',
        ru: 'идентификатор',
      },
      'dialect.label.desc.identifier': {
        uk: 'Посилання на акаунт, плейсмент, запит чи іншу сутність.',
        en: 'A reference to an account, placement, request or other entity.',
        ru: 'Ссылка на аккаунт, плейсмент, запрос или другую сущность.',
      },
      'dialect.label.name.credential': {
        uk: 'облікові дані',
        en: 'credential',
        ru: 'учётные данные',
      },
      'dialect.label.desc.credential': {
        uk: 'Токен, ключ або підпис інтеграції.',
        en: 'An integration token, key or signature.',
        ru: 'Токен, ключ или подпись интеграции.',
      },
      'dialect.label.name.metadata': { uk: 'метадані', en: 'metadata', ru: 'метаданные' },
      'dialect.label.desc.metadata': {
        uk: 'Версія, партнер, середовище, локаль — контекст інтеграції.',
        en: 'Version, partner, environment, locale — integration context.',
        ru: 'Версия, партнёр, среда, локаль — контекст интеграции.',
      },
      'dialect.label.name.media-property': {
        uk: 'властивість медіа',
        en: 'media property',
        ru: 'свойство медиа',
      },
      'dialect.label.desc.media-property': {
        uk: 'Розміри, mimes, тривалість — параметри креативу.',
        en: 'Sizes, mimes, duration — creative parameters.',
        ru: 'Размеры, mimes, длительность — параметры креатива.',
      },
      'dialect.label.name.pricing': { uk: 'ціна', en: 'pricing', ru: 'цена' },
      'dialect.label.desc.pricing': {
        uk: 'Флор, валюта, множник — грошове правило.',
        en: 'Floor, currency, multiplier — a monetary rule.',
        ru: 'Флор, валюта, множитель — денежное правило.',
      },
      'dialect.label.name.targeting': { uk: 'таргетинг', en: 'targeting', ru: 'таргетинг' },
      'dialect.label.desc.targeting': {
        uk: 'Аудиторія, ключові слова, категорія, гео.',
        en: 'Audience, keywords, category, geography.',
        ru: 'Аудитория, ключевые слова, категория, гео.',
      },
      'dialect.label.name.privacy-consent': {
        uk: 'згода/приватність',
        en: 'privacy/consent',
        ru: 'согласие/приватность',
      },
      'dialect.label.desc.privacy-consent': {
        uk: 'Сигнал згоди чи регульованої обробки.',
        en: 'A consent or regulated-processing signal.',
        ru: 'Сигнал согласия или регулируемой обработки.',
      },
      'dialect.label.name.delivery-control': {
        uk: 'керування доставкою',
        en: 'delivery control',
        ru: 'управление доставкой',
      },
      'dialect.label.desc.delivery-control': {
        uk: 'Перемикач, ліміт, таймаут, режим, ендпойнт.',
        en: 'A switch, limit, timeout, mode or endpoint.',
        ru: 'Переключатель, лимит, таймаут, режим, эндпойнт.',
      },
      'dialect.label.name.measurement': { uk: 'вимірювання', en: 'measurement', ru: 'измерение' },
      'dialect.label.desc.measurement': {
        uk: 'Лічильник, метрика, трекінг — звітує, а не керує.',
        en: 'A counter, metric or tracking value — reports, not controls.',
        ru: 'Счётчик, метрика, трекинг — сообщает, а не управляет.',
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
      // ── creative assets, fetched server-side so the preview CSP stays shut ──
      'creative.assets.load': {
        uk: 'Показати зображення ({n}) через сервер',
        en: 'Load {n} image(s) via the server',
        ru: 'Показать изображения ({n}) через сервер',
      },
      'creative.assets.loading': { uk: 'Завантажую…', en: 'Loading…', ru: 'Загружаю…' },
      'creative.assets.loaded': {
        uk: 'Завантажено зображень: {n}. Твій браузер до рекламодавця не звертався.',
        en: 'Loaded {n} image(s). Your browser never contacted the advertiser.',
        ru: 'Загружено изображений: {n}. Твой браузер к рекламодателю не обращался.',
      },
      'creative.assets.partial': {
        uk: 'Завантажено {ok}, не вдалося {bad}.',
        en: 'Loaded {ok}, {bad} failed.',
        ru: 'Загружено {ok}, не удалось {bad}.',
      },
      'creative.assets.all_failed': {
        uk: 'Жодне з {n} зображень не вдалося завантажити.',
        en: 'None of the {n} images could be loaded.',
        ru: 'Ни одно из {n} изображений загрузить не удалось.',
      },
      'dialect.label.err.no_payload': {
        uk: 'Не бачу payload у редакторі — онови аналіз.',
        en: 'No payload in the editor — re-run the analysis.',
        ru: 'Не вижу payload в редакторе — обнови анализ.',
      },
      // ── the refusal ledger ──────────────────────────────────────────────
      // The wording carries the whole point of this feature: the frame
      // REFUSED to fetch these, which is not the same thing as the creative
      // being empty, and the difference is what stops the panel reading as a
      // crash. "at least" appears when the frame stopped counting at its cap.
      'creative.blocked.summary': {
        uk: 'Кадр не пропустив {n} ресурс(ів) до {hosts} хост(ів)',
        en: 'The frame refused {n} resource(s) across {hosts} host(s)',
        ru: 'Кадр не пропустил {n} ресурс(ов) к {hosts} хост(ам)',
      },
      'creative.blocked.summary_truncated': {
        uk: 'Кадр не пропустив щонайменше {n} ресурс(ів) до {hosts} хост(ів)',
        en: 'The frame refused at least {n} resource(s) across {hosts} host(s)',
        ru: 'Кадр не пропустил как минимум {n} ресурс(ов) к {hosts} хост(ам)',
      },
      'creative.blocked.hint': {
        uk: 'Це не порожній креатив — це навмисна відмова: нічого не пішло до рекламодавця.',
        en: 'This is not an empty creative — it is a deliberate refusal: nothing reached the advertiser.',
        ru: 'Это не пустой креатив — это намеренный отказ: ничего не ушло к рекламодателю.',
      },
      'creative.blocked.details': { uk: 'Показати', en: 'Show', ru: 'Показать' },
      'creative.blocked.hosts': { uk: 'Хости', en: 'Hosts', ru: 'Хосты' },
      'creative.blocked.kinds': { uk: 'Типи', en: 'Kinds', ru: 'Типы' },
      // Directive → the thing the analyst recognises. "needs pictures" and
      // "needs to execute" are different answers to the wave-2 question.
      'creative.blocked.kind.img-src': { uk: 'зображення', en: 'images', ru: 'изображения' },
      'creative.blocked.kind.script-src': { uk: 'скрипти', en: 'scripts', ru: 'скрипты' },
      'creative.blocked.kind.style-src': { uk: 'стилі', en: 'styles', ru: 'стили' },
      'creative.blocked.kind.font-src': { uk: 'шрифти', en: 'fonts', ru: 'шрифты' },
      'creative.blocked.kind.frame-src': {
        uk: 'вкладені кадри',
        en: 'nested frames',
        ru: 'вложенные кадры',
      },
      'creative.blocked.kind.connect-src': { uk: "з'єднання", en: 'connections', ru: 'соединения' },
      'creative.blocked.kind.media-src': { uk: 'медіа', en: 'media', ru: 'медиа' },
      'creative.blocked.kind.default-src': { uk: 'інше', en: 'other', ru: 'другое' },
      // ── what the payload turned out to be ───────────────────────────────
      // Each of these says what the body IS. The old behaviour was to paint
      // it as markup and let the analyst conclude the tool was broken.
      'creative.kind.json': {
        uk: 'Це JSON без native-ассетів — рендерити нічого',
        en: 'This is JSON with no native assets — there is nothing to render',
        ru: 'Это JSON без native-ассетов — рендерить нечего',
      },
      'creative.kind.url': {
        uk: 'adm — це посилання, а не розмітка. Не переходили за ним і не завантажували.',
        en: 'The adm is a link, not markup. It was not followed and not fetched.',
        ru: 'adm — это ссылка, а не разметка. По ней не переходили и её не загружали.',
      },
      'creative.kind.unidentified': {
        uk: 'Не вдалося впізнати формат креатива — показую як текст',
        en: 'The creative format was not recognised — showing it as text',
        ru: 'Не удалось опознать формат креатива — показываю как текст',
      },
      'creative.kind.decoded': {
        uk: 'Спершу розкодовано з base64',
        en: 'Decoded from base64 first',
        ru: 'Сначала раскодировано из base64',
      },
      'creative.kind.vast': {
        uk: 'vast · відео xml · лише перегляд, без відтворення',
        en: 'vast · video xml · preview-only, no playback',
        ru: 'vast · видео xml · только просмотр, без воспроизведения',
      },
      'creative.kind.trimmed': {
        uk: '… обрізано (приховано {n} символів)',
        en: '… trimmed ({n} chars hidden)',
        ru: '… обрезано (скрыто {n} символов)',
      },
      'creative.macros.unresolved': {
        uk: 'Нерозвʼязані макроси в розмітці: {list}. Вони лишились літералами — аукціону не було.',
        en: 'Unresolved macros in the markup: {list}. They stay literal — no auction took place.',
        ru: 'Неразрешённые макросы в разметке: {list}. Они остались литералами — аукциона не было.',
      },
    },
  };

  if (typeof window.registerI18nModule === 'function') {
    window.registerI18nModule(SPEC);
  } else {
    (window.kt_i18n_modules = window.kt_i18n_modules || []).push(SPEC);
  }
})();
