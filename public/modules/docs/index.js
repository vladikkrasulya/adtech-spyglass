/* ============================================================
   public/modules/docs/index.js — /docs section module.

   The section is a THREE-column doc reader, not a landing hub:

     rail (shell)  |  contents sidebar (this module)  |  article

   It used to be a card grid whose five tiles mostly bounced the
   reader out to /about — a standalone page with its own topbar, its
   own nav and an "← ortbtools" escape hatch. Four clicks out of five
   left the app to read a paragraph. The sidebar replaces the grid:
   the topics are always visible, the active one is marked, and the
   prose renders inside the shell so the rail, the breadcrumb and the
   footer strip stay where they were.

   Two sub-pages share the shell:

     1. Reader (default /docs) — contents sidebar + one article,
        selected by the URL fragment (/docs#crosscheck). No new routes
        were needed for that, which matters: route registration lives
        in shell-boot.js, outside this module.
     2. Finding catalog (/docs/findings) — auto-generated table of
        every finding ID with severity badge, message template, and
        spec-ref link. Now rendered INSIDE the same sidebar shell, so
        the catalog is a topic in the section rather than a dead end.

   Backend used:
     - GET /api/v1/finding-catalog?lang=<lang>
   ============================================================ */
'use strict';

import { localePath, stripLocale } from '/core/routes.js';

const FALLBACK_LANG = 'en';

function pick(map, lang) {
  if (!map) return '';
  return map[lang] || map[FALLBACK_LANG] || Object.values(map)[0] || '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// localePrefix() used to live here as one of six verbatim copies across
// modules. Route construction now goes through /core/routes.js so the docs
// links agree with the server's own route table (lib/locale-routes.js).

// ── Localised strings ────────────────────────────────────────────

const L = {
  // The section name itself lives in manifest.title below — the reader has
  // no page-level h1 of its own any more, only the active topic's.
  contents: { en: 'Contents', uk: 'Зміст', ru: 'Содержание' },

  // Contents groups. Uppercase belongs to this level only — the group
  // header — and to nothing else on the page.
  groupStart: { en: 'Getting started', uk: 'Початок роботи', ru: 'Начало работы' },
  groupValidation: { en: 'Validation', uk: 'Валідація', ru: 'Валидация' },
  groupPrivacy: { en: 'Privacy & data', uk: 'Приватність і дані', ru: 'Приватность и данные' },
  groupAutomation: { en: 'Automation', uk: 'Автоматизація', ru: 'Автоматизация' },

  // Finding catalog page
  catalogTitle: { en: 'Finding catalog', uk: 'Каталог findings', ru: 'Каталог findings' },
  catalogSub: {
    en: 'Auto-generated from finding message files. Each ID maps to a severity, human-readable message, and IAB spec section.',
    uk: 'Автоматично згенеровано з файлів повідомлень. Кожен ID → серйозність, читабельне повідомлення, розділ специфікації IAB.',
    ru: 'Автоматически сгенерировано из файлов сообщений. Каждый ID → серьёзность, читаемое сообщение, раздел спецификации IAB.',
  },
  chipAll: { en: 'All', uk: 'Всі', ru: 'Все' },
  filterLabel: {
    en: 'Filter by scale and severity',
    uk: 'Фільтр за шкалою та рівнем',
    ru: 'Фильтр по шкале и уровню',
  },
  dualNote: {
    en: '{n} IDs are emitted at either of two levels and are listed under both.',
    uk: '{n} ID видаються на одному з двох рівнів і показані під обома.',
    ru: '{n} ID выдаются на одном из двух уровней и показаны под обоими.',
  },
  sevOr: { en: 'or', uk: 'або', ru: 'или' },
  colId: { en: 'Finding ID', uk: 'Finding ID', ru: 'Finding ID' },
  colSev: { en: 'Severity', uk: 'Серйозність', ru: 'Серьёзность' },
  colMsg: { en: 'Message', uk: 'Повідомлення', ru: 'Сообщение' },
  colSpec: { en: 'Spec ref', uk: 'Специфікація', ru: 'Спецификация' },
  specLink: { en: 'IAB spec ↗', uk: 'IAB spec ↗', ru: 'IAB spec ↗' },
  loading: { en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' },
  errorLoad: {
    en: 'Failed to load catalog:',
    uk: 'Не вдалося завантажити каталог:',
    ru: 'Не удалось загрузить каталог:',
  },
  findingsCount: { en: '{n} findings', uk: '{n} findings', ru: '{n} findings' },
  findingsCountOf: {
    en: '{n} of {total} findings',
    uk: '{n} з {total} findings',
    ru: '{n} из {total} findings',
  },
};

// ── The doc set ──────────────────────────────────────────────────
//
// The mockup draws fifteen contents entries across four groups and one
// article. It cannot know which of them we can honestly write, so every
// topic below is a claim this build can back:
//
//   - the mockup's own article ("What ortbtools checks") is reproduced
//     as the default topic, down to the three-pass callout and the
//     50-entry history note — HISTORY_MAX in ortbtools.app.js is 50;
//   - "Embedding a view" documents the real `?embed=1` view mode;
//   - the CLI topic says plainly that @ortbtools/cli is NOT on npm,
//     because docs/NPM_PUBLISH.md lists it Unpublished and a docs page
//     promising `npm i -g` would be the lie that test guards against;
//   - "Finding catalog" is a route entry, not prose: /docs/findings
//     already exists and generates itself from the message files.
//
// Article bodies are block lists rather than HTML strings so the type
// scale is applied by the stylesheet in one place, and so a translator
// edits a sentence rather than a tag.

/** `{ t: 'lead' | 'p' | 'h2' | 'note', v: <lang map> }` */
const lead = (v) => ({ t: 'lead', v });
const p = (v) => ({ t: 'p', v });
const h2 = (v) => ({ t: 'h2', v });
const note = (v) => ({ t: 'note', v });
/** Numbered box: a label and rows of `{ k: bold lead-in, v: body }`. */
const callout = (label, rows) => ({ t: 'callout', label, rows });

const TOPICS = [
  // ── Getting started ────────────────────────────────────────────
  {
    id: 'what-we-check',
    group: 'groupStart',
    title: {
      en: 'What ortbtools checks',
      uk: 'Що перевіряє ortbtools',
      ru: 'Что проверяет ortbtools',
    },
    body: [
      lead({
        en: 'Paste a BidRequest or BidResponse and the engine answers one question: would this payload actually trade? Three passes run every time — structural validation against the spec you pin, semantic crosscheck between the two sides, and format detection that classifies the creative and its runtime context.',
        uk: 'Встав BidRequest або BidResponse — і рушій відповідає на одне питання: чи цей payload справді торгувався б? Щоразу виконуються три проходи: структурна валідація проти закріпленої специфікації, семантична крос-перевірка між двома сторонами і детекція формату, яка класифікує креатив та його контекст виконання.',
        ru: 'Вставь BidRequest или BidResponse — и движок отвечает на один вопрос: торговался бы этот payload на самом деле? Каждый раз выполняются три прохода: структурная валидация против закреплённой спецификации, семантическая кросс-проверка между двумя сторонами и детекция формата, которая классифицирует креатив и его контекст выполнения.',
      }),
      callout({ en: 'The three passes', uk: 'Три проходи', ru: 'Три прохода' }, [
        {
          k: { en: 'Validation', uk: 'Валідація', ru: 'Валидация' },
          v: {
            en: 'every required field, enum and type against oRTB 2.5, 2.6 or 3.0. Findings carry a stable id and a spec reference where a maintained mapping exists.',
            uk: 'кожне обовʼязкове поле, enum і тип проти oRTB 2.5, 2.6 або 3.0. Findings несуть стабільний id і посилання на специфікацію там, де є підтримуване відображення.',
            ru: 'каждое обязательное поле, enum и тип против oRTB 2.5, 2.6 или 3.0. Findings несут стабильный id и ссылку на спецификацию там, где есть поддерживаемое соответствие.',
          },
        },
        {
          k: { en: 'Crosscheck', uk: 'Крос-перевірка', ru: 'Кросс-проверка' },
          v: {
            en: 'bid.impid against imp.id, price against bidfloor, creative size against the impression, adomain against the block lists, native asset ids.',
            uk: 'bid.impid проти imp.id, ціна проти bidfloor, розмір креативу проти імпресії, adomain проти блок-листів, asset-id у native.',
            ru: 'bid.impid против imp.id, цена против bidfloor, размер креатива против импрессии, adomain против блок-листов, asset-id в native.',
          },
        },
        {
          k: { en: 'Format detection', uk: 'Детекція формату', ru: 'Детекция формата' },
          v: {
            en: 'banner, video, audio, native, push, pops or inpage, plus context (web, inapp, ctv, dooh) and creative protocol.',
            uk: 'banner, video, audio, native, push, pops чи inpage, плюс контекст (web, inapp, ctv, dooh) і протокол креативу.',
            ru: 'banner, video, audio, native, push, pops или inpage, плюс контекст (web, inapp, ctv, dooh) и протокол креатива.',
          },
        },
      ]),
      h2({
        en: 'What it does not do',
        uk: 'Чого він не робить',
        ru: 'Чего он не делает',
      }),
      p({
        en: 'It does not guess. Unknown vendor extensions stay unknown and are surfaced as questions, not warnings — an unmapped field is a gap in your dialect, not an error in your payload. Nothing is sent to a model; the rules engine is deterministic, so the same input always produces the same output.',
        uk: 'Він не вгадує. Невідомі вендорські розширення лишаються невідомими і показуються як питання, а не попередження: незамаплене поле — це прогалина у твоєму діалекті, а не помилка у payload. Нічого не надсилається до моделі; рушій правил детермінований, тож той самий вхід завжди дає той самий вихід.',
        ru: 'Он не угадывает. Неизвестные вендорские расширения остаются неизвестными и показываются как вопросы, а не предупреждения: незамапленное поле — это пробел в твоём диалекте, а не ошибка в payload. Ничего не отправляется в модель; движок правил детерминирован, поэтому один и тот же вход всегда даёт один и тот же выход.',
      }),
      note({
        en: 'Your payload is sent over HTTPS, analyzed transiently and not persisted on the server. Up to 50 recent entries stay in your browser for History.',
        uk: 'Твій payload надсилається по HTTPS, аналізується транзитно і не зберігається на сервері. До 50 останніх записів лишаються у твоєму браузері для Історії.',
        ru: 'Твой payload отправляется по HTTPS, анализируется транзитно и не сохраняется на сервере. До 50 последних записей остаются в твоём браузере для Истории.',
      }),
    ],
  },
  {
    id: 'first-analysis',
    group: 'groupStart',
    title: { en: 'Your first analysis', uk: 'Перший аналіз', ru: 'Первый анализ' },
    body: [
      lead({
        en: 'The Inspector is two panes: BidRequest on the left, BidResponse on the right. Fill either one, or both — with both present you also get the crosscheck pass. Ctrl+Enter runs the analysis; ? opens the keyboard cheat sheet.',
        uk: 'Інспектор — це дві панелі: BidRequest ліворуч, BidResponse праворуч. Заповни одну або обидві: коли є обидві, додається ще й прохід крос-перевірки. Ctrl+Enter запускає аналіз, ? відкриває шпаргалку гарячих клавіш.',
        ru: 'Инспектор — это две панели: BidRequest слева, BidResponse справа. Заполни одну или обе: когда есть обе, добавляется ещё и проход кросс-проверки. Ctrl+Enter запускает анализ, ? открывает шпаргалку горячих клавиш.',
      }),
      callout(
        {
          en: 'Three ways to get a payload in',
          uk: 'Три способи внести payload',
          ru: 'Три способа внести payload',
        },
        [
          {
            k: { en: 'Paste', uk: 'Вставити', ru: 'Вставить' },
            v: {
              en: 'drop raw JSON into either pane. A clickunder, teaser or pop GET URL works too — the server decodes its query into a request object before validating.',
              uk: 'кинь сирий JSON у будь-яку панель. GET-URL клікандера, тизера чи попа теж підходить — сервер розбирає його query у обʼєкт запиту перед валідацією.',
              ru: 'брось сырой JSON в любую панель. GET-URL кликандера, тизера или попа тоже подходит — сервер разбирает его query в объект запроса перед валидацией.',
            },
          },
          {
            k: { en: 'Samples', uk: 'Зразки', ru: 'Образцы' },
            v: {
              en: 'open the Samples section and load a canonical payload for the format you are debugging.',
              uk: 'відкрий розділ Samples і завантаж канонічний payload для формату, який ти дебажиш.',
              ru: 'открой раздел Samples и загрузи канонический payload для формата, который ты дебажишь.',
            },
          },
          {
            k: { en: 'Share link', uk: 'Лінк-поділка', ru: 'Ссылка-шаринг' },
            v: {
              en: 'a share link carries the payload deflate-compressed in the URL fragment and fills both panes when it opens.',
              uk: 'лінк для поділки несе payload, стиснутий deflate, у фрагменті URL і заповнює обидві панелі при відкритті.',
              ru: 'ссылка-шаринг несёт payload, сжатый deflate, во фрагменте URL и заполняет обе панели при открытии.',
            },
          },
        ],
      ),
      h2({ en: 'Reading the result', uk: 'Як читати результат', ru: 'Как читать результат' }),
      p({
        en: 'The summary panel names the format, the context and the detected oRTB version with its confidence. Findings group into Validation, Crosscheck and Behavior tabs. If bid.adm carries an HTML creative it renders in a sandboxed iframe, so you see the ad without giving it your session.',
        uk: 'Панель підсумку називає формат, контекст і визначену версію oRTB разом з упевненістю. Findings групуються у вкладки Validation, Crosscheck і Behavior. Якщо bid.adm несе HTML-креатив, він рендериться у sandbox-iframe — ти бачиш рекламу, не віддаючи їй свою сесію.',
        ru: 'Панель сводки называет формат, контекст и определённую версию oRTB вместе с уверенностью. Findings группируются во вкладки Validation, Crosscheck и Behavior. Если bid.adm несёт HTML-креатив, он рендерится в sandbox-iframe — ты видишь рекламу, не отдавая ей свою сессию.',
      }),
    ],
  },
  {
    id: 'reading-a-finding',
    group: 'groupStart',
    title: { en: 'Reading a finding', uk: 'Як читати finding', ru: 'Как читать finding' },
    body: [
      lead({
        en: 'A finding is a record, not a sentence of prose. Every one of them carries the same parts, and each part is there so you can act on it without asking anyone what it meant.',
        uk: 'Finding — це запис, а не речення прози. Кожен з них має ті самі частини, і кожна частина існує, щоб ти міг діяти, не питаючи ні в кого, що це означало.',
        ru: 'Finding — это запись, а не предложение прозы. У каждого из них те же части, и каждая часть существует, чтобы ты мог действовать, не спрашивая ни у кого, что это значило.',
      }),
      callout({ en: 'Anatomy of a finding', uk: 'Анатомія finding', ru: 'Анатомия finding' }, [
        {
          k: { en: 'The id', uk: 'Ідентифікатор', ru: 'Идентификатор' },
          v: {
            en: 'a stable dotted name such as imp.missing or payload.duplicate_key. It does not change between releases, so you can suppress it, grep it, or file a ticket against it.',
            uk: 'стабільна крапкова назва на кшталт imp.missing чи payload.duplicate_key. Вона не змінюється між релізами, тож її можна вимкнути, грепнути або завести на неї тікет.',
            ru: 'стабильное точечное имя вроде imp.missing или payload.duplicate_key. Оно не меняется между релизами, поэтому его можно отключить, грепнуть или завести на него тикет.',
          },
        },
        {
          k: { en: 'The severity', uk: 'Рівень', ru: 'Уровень' },
          v: {
            en: 'error, warning, info or question on the validator scale. Crosscheck rules run on their own scale, where crit ≈ error and ok means the check passed.',
            uk: 'error, warning, info або question на шкалі валідатора. Правила крос-перевірки мають власну шкалу, де crit ≈ error, а ok означає, що перевірку пройдено.',
            ru: 'error, warning, info или question на шкале валидатора. Правила кросс-проверки имеют свою шкалу, где crit ≈ error, а ok означает, что проверка пройдена.',
          },
        },
        {
          k: { en: 'Path and spec ref', uk: 'Шлях і специфікація', ru: 'Путь и спецификация' },
          v: {
            en: 'a JSON path to the exact offending location, plus a deep link into the IAB spec where a maintained mapping exists. Vendor, behavior and meta findings may legitimately have none.',
            uk: 'JSON-шлях до точного місця проблеми плюс глибоке посилання в специфікацію IAB там, де є підтримуване відображення. У вендорських, поведінкових і мета-findings його законно може не бути.',
            ru: 'JSON-путь к точному месту проблемы плюс глубокая ссылка в спецификацию IAB там, где есть поддерживаемое соответствие. У вендорских, поведенческих и мета-findings его законно может не быть.',
          },
        },
      ]),
      h2({
        en: 'Questions are not warnings',
        uk: 'Питання — це не попередження',
        ru: 'Вопросы — это не предупреждения',
      }),
      p({
        en: 'A question means the engine saw a signal it has no rule for — usually a vendor ext.* field. That is information about your dialect coverage, not a defect in the payload, which is why it is a separate level rather than a quiet warning. The finding catalog lists every id the engine can emit, with the scale it is emitted on.',
        uk: 'Питання означає, що рушій побачив сигнал, для якого не має правила — зазвичай вендорське поле ext.*. Це інформація про покриття твого діалекту, а не дефект payload, тому це окремий рівень, а не тихе попередження. Каталог findings перелічує кожен id, який рушій може видати, разом зі шкалою.',
        ru: 'Вопрос означает, что движок увидел сигнал, для которого у него нет правила — обычно вендорское поле ext.*. Это информация о покрытии твоего диалекта, а не дефект payload, поэтому это отдельный уровень, а не тихое предупреждение. Каталог findings перечисляет каждый id, который движок может выдать, вместе со шкалой.',
      }),
    ],
  },

  // ── Validation ─────────────────────────────────────────────────
  {
    id: 'ortb-versions',
    group: 'groupValidation',
    title: { en: 'oRTB 2.5 / 2.6 / 3.0', uk: 'oRTB 2.5 / 2.6 / 3.0', ru: 'oRTB 2.5 / 2.6 / 3.0' },
    body: [
      lead({
        en: 'ortbtools does not ask which version you are on. It reads signature fields — imp.rwdd, device.sua, regs.gpp_sid, source.schain — and assigns the payload to the 2.5, 2.6 or 3.0 bucket, returning the confidence and the signals it used. Dated 2.6 revisions are grouped into 2.6.',
        uk: 'ortbtools не питає, на якій ти версії. Він читає сигнатурні поля — imp.rwdd, device.sua, regs.gpp_sid, source.schain — і відносить payload до кошика 2.5, 2.6 чи 3.0, повертаючи впевненість і використані сигнали. Датовані ревізії 2.6 групуються в 2.6.',
        ru: 'ortbtools не спрашивает, на какой ты версии. Он читает сигнатурные поля — imp.rwdd, device.sua, regs.gpp_sid, source.schain — и относит payload к корзине 2.5, 2.6 или 3.0, возвращая уверенность и использованные сигналы. Датированные ревизии 2.6 группируются в 2.6.',
      }),
      h2({
        en: 'Pinning the version you target',
        uk: 'Закріплення потрібної версії',
        ru: 'Закрепление нужной версии',
      }),
      p({
        en: 'Detection says what the payload looks like; pinning says what it should be. Pass expectedVersion in the API — or --expect-version on the CLI — and a payload that detects elsewhere raises version.mismatch as a warning instead of quietly validating against the wrong rulebook.',
        uk: 'Детекція каже, на що payload схожий; закріплення каже, чим він має бути. Передай expectedVersion в API — або --expect-version у CLI — і payload, який визначився інакше, підніме version.mismatch як попередження замість тихої валідації за чужим набором правил.',
        ru: 'Детекция говорит, на что payload похож; закрепление говорит, чем он должен быть. Передай expectedVersion в API — или --expect-version в CLI — и payload, определившийся иначе, поднимет version.mismatch как предупреждение вместо тихой валидации по чужому набору правил.',
      }),
      note({
        en: 'Detection is heuristic by construction: a 2.6 payload that uses none of the 2.6 fields is indistinguishable from 2.5. That is why the confidence and the signal list come back alongside the verdict rather than instead of it.',
        uk: 'Детекція евристична за побудовою: payload 2.6, який не використовує жодного поля 2.6, не відрізнити від 2.5. Саме тому впевненість і список сигналів повертаються поруч із вердиктом, а не замість нього.',
        ru: 'Детекция эвристична по построению: payload 2.6, не использующий ни одного поля 2.6, не отличить от 2.5. Именно поэтому уверенность и список сигналов возвращаются рядом с вердиктом, а не вместо него.',
      }),
    ],
  },
  {
    id: 'crosscheck',
    group: 'groupValidation',
    title: { en: 'Crosscheck rules', uk: 'Правила крос-перевірки', ru: 'Правила кросс-проверки' },
    body: [
      lead({
        en: 'Validation reads each side alone. Crosscheck reads them against each other and answers a different question: does this response actually answer this request?',
        uk: 'Валідація читає кожну сторону окремо. Крос-перевірка читає їх одна проти одної і відповідає на інше питання: чи ця відповідь справді відповідає на цей запит?',
        ru: 'Валидация читает каждую сторону отдельно. Кросс-проверка читает их друг против друга и отвечает на другой вопрос: действительно ли этот ответ отвечает на этот запрос?',
      }),
      callout(
        {
          en: 'What crosscheck compares',
          uk: 'Що порівнює крос-перевірка',
          ru: 'Что сравнивает кросс-проверка',
        },
        [
          {
            k: { en: 'Identity', uk: 'Ідентичність', ru: 'Идентичность' },
            v: {
              en: 'bid.impid must name an imp.id that exists in the request. A bid answering no impression is a crit, not a warning.',
              uk: 'bid.impid має називати imp.id, який існує в запиті. Ставка, що не відповідає жодній імпресії, — це crit, а не попередження.',
              ru: 'bid.impid должен называть imp.id, который существует в запросе. Ставка, не отвечающая ни одной импрессии, — это crit, а не предупреждение.',
            },
          },
          {
            k: { en: 'Price and size', uk: 'Ціна і розмір', ru: 'Цена и размер' },
            v: {
              en: 'price against bidfloor in the request currency, and creative w/h against the sizes offered in imp.banner.format[].',
              uk: 'ціна проти bidfloor у валюті запиту, а w/h креативу — проти розмірів, запропонованих у imp.banner.format[].',
              ru: 'цена против bidfloor в валюте запроса, а w/h креатива — против размеров, предложенных в imp.banner.format[].',
            },
          },
          {
            k: { en: 'Native assets', uk: 'Native-асети', ru: 'Native-ассеты' },
            v: {
              en: 'response asset ids matched against the request asset ids, so a missing or extra asset is named instead of silently rendering wrong.',
              uk: 'asset-id відповіді звіряються з asset-id запиту, тож відсутній чи зайвий асет називається, а не тихо рендериться неправильно.',
              ru: 'asset-id ответа сверяются с asset-id запроса, поэтому отсутствующий или лишний ассет называется, а не тихо рендерится неправильно.',
            },
          },
        ],
      ),
      h2({ en: 'Its own severity scale', uk: 'Власна шкала рівнів', ru: 'Своя шкала уровней' }),
      p({
        en: 'Crosscheck results carry crit, warn and ok — a separate enum from the validator error / warning / info / question. ok is the check passing, not a mild problem, which is why the finding catalog keeps the two scales in separate groups instead of one flat list.',
        uk: 'Результати крос-перевірки несуть crit, warn і ok — окремий enum від валідаторних error / warning / info / question. ok — це пройдена перевірка, а не легка проблема, тому каталог findings тримає дві шкали в окремих групах, а не одним пласким списком.',
        ru: 'Результаты кросс-проверки несут crit, warn и ok — отдельный enum от валидаторных error / warning / info / question. ok — это пройденная проверка, а не лёгкая проблема, поэтому каталог findings держит две шкалы в отдельных группах, а не одним плоским списком.',
      }),
    ],
  },
  {
    id: 'pops-clickunder',
    group: 'groupValidation',
    title: { en: 'Pops & clickunder', uk: 'Попи і клікандер', ru: 'Попы и кликандер' },
    body: [
      lead({
        en: 'Not everything on the market is an oRTB object. Push, popunder and in-page widget traffic arrives as vendor JSON-feed shapes or as a plain GET URL, and both are first-class inputs here rather than something to convert by hand first.',
        uk: 'Не все на ринку — обʼєкт oRTB. Push, popunder і трафік in-page віджетів приходить як вендорські форми JSON-feed або як звичайний GET-URL, і обидва тут повноцінні входи, а не щось, що спершу треба конвертувати руками.',
        ru: 'Не всё на рынке — объект oRTB. Push, popunder и трафик in-page виджетов приходит как вендорские формы JSON-feed или как обычный GET-URL, и оба здесь полноценные входы, а не то, что сперва надо конвертировать руками.',
      }),
      h2({ en: 'URL payloads', uk: 'URL як payload', ru: 'URL как payload' }),
      p({
        en: 'Paste a clickunder, teaser or pop request URL into the request pane and the server decodes its query into a request object before validating. You get the same findings vocabulary as a JSON payload, so the two kinds of traffic are readable side by side.',
        uk: 'Встав URL запиту клікандера, тизера чи попа в панель запиту — сервер розбере його query в обʼєкт запиту перед валідацією. Ти отримаєш той самий словник findings, що й для JSON-payload, тож два види трафіку читаються поряд.',
        ru: 'Вставь URL запроса кликандера, тизера или попа в панель запроса — сервер разберёт его query в объект запроса перед валидацией. Ты получишь тот же словарь findings, что и для JSON-payload, поэтому два вида трафика читаются рядом.',
      }),
      h2({
        en: 'What the behavior probe adds',
        uk: 'Що додає поведінкова проба',
        ru: 'Что добавляет поведенческая проба',
      }),
      p({
        en: 'Format detection tells you the payload is a pop. The Behavior tab tells you what the creative does once rendered: invisible click traps, frame-bust attempts, programmatic clicks that anticipate a real one, permission abuse and frozen-thread heartbeats — all caught inside a sandboxed iframe with no allow-same-origin.',
        uk: 'Детекція формату каже, що payload — це поп. Вкладка Behavior каже, що креатив робить після рендеру: невидимі клік-пастки, спроби frame-bust, програмні кліки, що випереджають справжній, зловживання дозволами і завмирання головного потоку — усе це ловиться всередині sandbox-iframe без allow-same-origin.',
        ru: 'Детекция формата говорит, что payload — это поп. Вкладка Behavior говорит, что креатив делает после рендера: невидимые клик-ловушки, попытки frame-bust, программные клики, опережающие настоящий, злоупотребление разрешениями и замирание главного потока — всё это ловится внутри sandbox-iframe без allow-same-origin.',
      }),
    ],
  },
  {
    id: 'vast-native',
    group: 'groupValidation',
    title: { en: 'VAST & native', uk: 'VAST і native', ru: 'VAST и native' },
    body: [
      lead({
        en: 'Video and native are the two places where the payload and the creative disagree most often, so both get a decode pass rather than a field check alone.',
        uk: 'Video і native — два місця, де payload і креатив розходяться найчастіше, тож обидва отримують прохід декодування, а не лише перевірку полів.',
        ru: 'Video и native — два места, где payload и креатив расходятся чаще всего, поэтому оба получают проход декодирования, а не только проверку полей.',
      }),
      h2({ en: 'VAST', uk: 'VAST', ru: 'VAST' }),
      p({
        en: 'video.protocols is read against the creative actually carried in adm — VAST 2, 3 and 4, wrappers included. Instream, outstream, CTV and rewarded (imp.rwdd) are distinguished from each other, and audio runs the same path for DAAST and VAST-audio.',
        uk: 'video.protocols звіряється з креативом, що реально лежить в adm — VAST 2, 3 і 4, разом із wrapper-ами. Instream, outstream, CTV і rewarded (imp.rwdd) розрізняються між собою, а audio йде тим самим шляхом для DAAST і VAST-audio.',
        ru: 'video.protocols сверяется с креативом, который реально лежит в adm — VAST 2, 3 и 4, включая wrapper-ы. Instream, outstream, CTV и rewarded (imp.rwdd) различаются между собой, а audio идёт тем же путём для DAAST и VAST-audio.',
      }),
      h2({ en: 'Native', uk: 'Native', ru: 'Native' }),
      p({
        en: 'IAB Native 1.1 and 1.2 are both supported, including the classic mistakes: the request sent as a JSON object instead of a string, a required asset omitted, asset ids that do not match between the two sides, and 1.1 / 1.2 field shapes mixed in one payload. The markup embedded in adm is decoded so each one is flagged separately.',
        uk: 'Підтримуються і IAB Native 1.1, і 1.2, разом із класичними помилками: запит надіслано обʼєктом JSON замість рядка, пропущено обовʼязковий асет, asset-id не збігаються між сторонами, форми полів 1.1 і 1.2 змішані в одному payload. Розмітка, вкладена в adm, декодується, тож кожна помилка позначається окремо.',
        ru: 'Поддерживаются и IAB Native 1.1, и 1.2, включая классические ошибки: запрос отправлен объектом JSON вместо строки, пропущен обязательный ассет, asset-id не совпадают между сторонами, формы полей 1.1 и 1.2 смешаны в одном payload. Разметка, вложенная в adm, декодируется, поэтому каждая ошибка отмечается отдельно.',
      }),
    ],
  },
  {
    id: 'dialects',
    group: 'groupValidation',
    title: { en: 'Dialect overlays', uk: 'Оверлеї діалектів', ru: 'Оверлеи диалектов' },
    body: [
      lead({
        en: 'A dialect is an overlay on the IAB rulebook: the vendor ext.* fields, custom macros and constraints that one specific SSP or DSP actually enforces. The default overlay is iab — the clean spec, no extensions.',
        uk: 'Діалект — це оверлей поверх набору правил IAB: вендорські поля ext.*, кастомні макроси й обмеження, які реально вимагає конкретний SSP або DSP. Типовий оверлей — iab: чиста специфікація, без розширень.',
        ru: 'Диалект — это оверлей поверх набора правил IAB: вендорские поля ext.*, кастомные макросы и ограничения, которые реально требует конкретный SSP или DSP. Оверлей по умолчанию — iab: чистая спецификация, без расширений.',
      }),
      callout({ en: 'Choosing an overlay', uk: 'Вибір оверлею', ru: 'Выбор оверлея' }, [
        {
          k: { en: 'In the app', uk: 'У застосунку', ru: 'В приложении' },
          v: {
            en: 'the Dialects section lists the overlays available to you and what each one adds on top of the IAB rules.',
            uk: 'розділ Dialects перелічує доступні тобі оверлеї і те, що кожен додає поверх правил IAB.',
            ru: 'раздел Dialects перечисляет доступные тебе оверлеи и то, что каждый добавляет поверх правил IAB.',
          },
        },
        {
          k: { en: 'Per request', uk: 'На запит', ru: 'На запрос' },
          v: {
            en: 'append `?dialect=<name>` to the URL, or send the dialect query parameter to `POST /api/analyze`.',
            uk: 'додай `?dialect=<name>` до URL або надішли параметр dialect у запиті `POST /api/analyze`.',
            ru: 'добавь `?dialect=<name>` к URL или отправь параметр dialect в запросе `POST /api/analyze`.',
          },
        },
        {
          k: { en: 'Built in', uk: 'Вбудовані', ru: 'Встроенные' },
          v: {
            en: 'iab, ext-rtb and inpage-push ship with the engine; the public UI stays generic unless you pick otherwise.',
            uk: 'iab, ext-rtb та inpage-push постачаються з рушієм; публічний UI лишається загальним, поки ти не обереш інше.',
            ru: 'iab, ext-rtb и inpage-push поставляются с движком; публичный UI остаётся общим, пока ты не выберешь иное.',
          },
        },
      ]),
      h2({
        en: 'Why an overlay instead of more rules',
        uk: 'Чому оверлей, а не більше правил',
        ru: 'Почему оверлей, а не больше правил',
      }),
      p({
        en: 'Because an unmapped ext.* field is not an error. Without an overlay the engine surfaces it as a question; with the right overlay the same field becomes a known signal with a rule of its own. Coverage is a property of your dialect, and the two readings are kept apart on purpose.',
        uk: 'Бо незамаплене поле ext.* — це не помилка. Без оверлею рушій показує його як питання; з правильним оверлеєм те саме поле стає відомим сигналом із власним правилом. Покриття — це властивість твого діалекту, і два прочитання навмисно тримаються окремо.',
        ru: 'Потому что незамапленное поле ext.* — это не ошибка. Без оверлея движок показывает его как вопрос; с правильным оверлеем то же поле становится известным сигналом со своим правилом. Покрытие — это свойство твоего диалекта, и два прочтения намеренно держатся отдельно.',
      }),
    ],
  },

  // ── Privacy & data ─────────────────────────────────────────────
  {
    id: 'what-we-store',
    group: 'groupPrivacy',
    title: { en: 'What we store', uk: 'Що ми зберігаємо', ru: 'Что мы храним' },
    body: [
      lead({
        en: 'Anonymous analysis persists nothing. Your payload reaches `POST /api/analyze` over HTTPS, the validator runs on it in memory, the findings come back, and the body is gone. Derived metrics — counts, detected version, format — may be recorded; the bodies are not.',
        uk: 'Анонімний аналіз не зберігає нічого. Твій payload доходить до `POST /api/analyze` по HTTPS, валідатор проходить по ньому в памʼяті, findings повертаються, і тіло зникає. Похідні метрики — лічильники, визначена версія, формат — можуть записуватись; тіла — ні.',
        ru: 'Анонимный анализ не сохраняет ничего. Твой payload доходит до `POST /api/analyze` по HTTPS, валидатор проходит по нему в памяти, findings возвращаются, и тело исчезает. Производные метрики — счётчики, определённая версия, формат — могут записываться; тела — нет.',
      }),
      callout(
        {
          en: 'Where a payload can live',
          uk: 'Де payload може жити',
          ru: 'Где payload может жить',
        },
        [
          {
            k: { en: 'Your browser', uk: 'Твій браузер', ru: 'Твой браузер' },
            v: {
              en: 'up to 50 recent request / response pairs in localStorage for History. Clearing site data removes them.',
              uk: 'до 50 останніх пар запит / відповідь у localStorage для Історії. Очищення даних сайту їх видаляє.',
              ru: 'до 50 последних пар запрос / ответ в localStorage для Истории. Очистка данных сайта их удаляет.',
            },
          },
          {
            k: { en: 'A share link', uk: 'Лінк для поділки', ru: 'Ссылка-шаринг' },
            v: {
              en: 'the payload is compressed into the URL fragment. Browsers do not send the fragment in the HTTP request, so it is not in that request or its access log.',
              uk: 'payload стискається у фрагмент URL. Браузери не надсилають фрагмент у HTTP-запиті, тож його немає ні в запиті, ні в його access-лозі.',
              ru: 'payload сжимается во фрагмент URL. Браузеры не отправляют фрагмент в HTTP-запросе, поэтому его нет ни в запросе, ни в его access-логе.',
            },
          },
          {
            k: { en: 'Your library', uk: 'Твоя бібліотека', ru: 'Твоя библиотека' },
            v: {
              en: 'only when you explicitly save. Bodies saved through the web UI are encrypted in the browser before upload.',
              uk: 'лише коли ти явно зберігаєш. Тіла, збережені через веб-інтерфейс, шифруються в браузері перед відправкою.',
              ru: 'только когда ты явно сохраняешь. Тела, сохранённые через веб-интерфейс, шифруются в браузере перед отправкой.',
            },
          },
        ],
      ),
      h2({
        en: 'What stays readable to the server',
        uk: 'Що лишається читабельним для сервера',
        ru: 'Что остаётся читаемым для сервера',
      }),
      p({
        en: 'Titles, statuses, sample notes, partner profiles and dialect mappings are metadata and are stored in the clear — they are what the library searches and groups by. The request and response bodies are not among them.',
        uk: 'Заголовки, статуси, нотатки до зразків, профілі партнерів і мапінги діалектів — це метадані, що зберігаються відкрито: саме за ними бібліотека шукає й групує. Тіла запиту та відповіді до них не належать.',
        ru: 'Заголовки, статусы, заметки к образцам, профили партнёров и маппинги диалектов — это метаданные, хранящиеся открыто: именно по ним библиотека ищет и группирует. Тела запроса и ответа к ним не относятся.',
      }),
    ],
  },
  {
    id: 'browser-encryption',
    group: 'groupPrivacy',
    title: { en: 'Browser encryption', uk: 'Шифрування в браузері', ru: 'Шифрование в браузере' },
    body: [
      lead({
        en: 'Request and response bodies saved through the web UI are encrypted in your browser before upload. The key never leaves the page, so the server cannot decrypt those bodies — a database dump yields opaque blobs rather than payloads that are merely inconvenient to read.',
        uk: 'Тіла запитів і відповідей, збережені через веб-інтерфейс, шифруються у твоєму браузері перед відправкою. Ключ не залишає сторінку, тож сервер не може розшифрувати ці тіла — дамп бази дає непрозорі блоби, а не payload, який просто незручно читати.',
        ru: 'Тела запросов и ответов, сохранённые через веб-интерфейс, шифруются в твоём браузере перед отправкой. Ключ не покидает страницу, поэтому сервер не может расшифровать эти тела — дамп базы даёт непрозрачные блобы, а не payload, который просто неудобно читать.',
      }),
      h2({
        en: 'How the key is derived',
        uk: 'Як виводиться ключ',
        ru: 'Как выводится ключ',
      }),
      p({
        en: 'A Key Encryption Key is derived from your password with PBKDF2 and wraps the data key. Changing your password rewraps the data key; it does not re-encrypt or expose the bodies. The server stores the wrap, never the key bytes themselves.',
        uk: 'Key Encryption Key виводиться з твого пароля через PBKDF2 і загортає ключ даних. Зміна пароля перезагортає ключ даних; вона не перешифровує і не розкриває тіла. Сервер зберігає обгортку, а не самі байти ключа.',
        ru: 'Key Encryption Key выводится из твоего пароля через PBKDF2 и заворачивает ключ данных. Смена пароля перезаворачивает ключ данных; она не перешифровывает и не раскрывает тела. Сервер хранит обёртку, а не сами байты ключа.',
      }),
      note({
        en: 'Encryption covers saved bodies only. Titles, notes and partner metadata stay server-readable, and anonymous analysis never sends a body to storage at all.',
        uk: 'Шифрування покриває лише збережені тіла. Заголовки, нотатки й метадані партнерів лишаються читабельними для сервера, а анонімний аналіз узагалі не надсилає тіло у сховище.',
        ru: 'Шифрование покрывает только сохранённые тела. Заголовки, заметки и метаданные партнёров остаются читаемыми для сервера, а анонимный анализ вообще не отправляет тело в хранилище.',
      }),
    ],
  },
  {
    id: 'recovery-keys',
    group: 'groupPrivacy',
    title: { en: 'Recovery keys', uk: 'Ключі відновлення', ru: 'Ключи восстановления' },
    body: [
      lead({
        en: 'A 32-character hex recovery key is generated at registration and shown exactly once. It is the only path back to your encrypted bodies if you forget your password, because the server holds the wrap and not the key.',
        uk: 'Ключ відновлення з 32 hex-символів генерується при реєстрації і показується рівно один раз. Це єдиний шлях назад до твоїх зашифрованих тіл, якщо ти забудеш пароль, бо сервер тримає обгортку, а не ключ.',
        ru: 'Ключ восстановления из 32 hex-символов генерируется при регистрации и показывается ровно один раз. Это единственный путь назад к твоим зашифрованным телам, если ты забудешь пароль, потому что сервер держит обёртку, а не ключ.',
      }),
      h2({ en: 'Why once', uk: 'Чому один раз', ru: 'Почему один раз' }),
      p({
        en: 'Because storing it anywhere we could show it again would defeat the model. The dialog that shows it gates its own close behind a confirmation — Esc, the backdrop and the "I saved it" button all pass through the same gate — so it cannot be dismissed by reflex.',
        uk: 'Бо зберігання його там, звідки ми могли б показати повторно, знищило б саму модель. Діалог, що його показує, ставить на власне закриття підтвердження — Esc, клік по фону і кнопка «Я зберіг» проходять через ті самі ворота — тож його не можна закрити рефлексом.',
        ru: 'Потому что хранение его там, откуда мы могли бы показать повторно, разрушило бы саму модель. Диалог, который его показывает, ставит на собственное закрытие подтверждение — Esc, клик по фону и кнопка «Я сохранил» проходят через те же ворота — поэтому его нельзя закрыть рефлексом.',
      }),
      note({
        en: 'Lose both the password and the recovery key and encrypted bodies cannot be recovered by anyone, including us. Account metadata survives; the bodies do not.',
        uk: 'Втратиш і пароль, і ключ відновлення — зашифровані тіла не відновить ніхто, включно з нами. Метадані акаунта виживуть; тіла — ні.',
        ru: 'Потеряешь и пароль, и ключ восстановления — зашифрованные тела не восстановит никто, включая нас. Метаданные аккаунта выживут; тела — нет.',
      }),
    ],
  },

  // ── Automation ─────────────────────────────────────────────────
  {
    id: 'cli',
    group: 'groupAutomation',
    title: { en: 'CLI', uk: 'CLI', ru: 'CLI' },
    body: [
      lead({
        en: 'The CLI runs the same engine as this site, locally, with no network calls — payloads never leave the machine. It lives as an npm workspace inside the ortbtools repository.',
        uk: 'CLI запускає той самий рушій, що й цей сайт, локально, без мережевих викликів — payload не залишає машину. Він живе як npm-workspace усередині репозиторію ortbtools.',
        ru: 'CLI запускает тот же движок, что и этот сайт, локально, без сетевых вызовов — payload не покидает машину. Он живёт как npm-workspace внутри репозитория ortbtools.',
      }),
      note({
        en: '@ortbtools/cli is not published to the npm registry yet, so there is no global install to copy. The commands below run the workspace binary from the repository root.',
        uk: '@ortbtools/cli ще не опубліковано в реєстрі npm, тож глобального встановлення, яке можна скопіювати, не існує. Команди нижче запускають бінарник workspace з кореня репозиторію.',
        ru: '@ortbtools/cli ещё не опубликован в реестре npm, поэтому глобальной установки, которую можно скопировать, не существует. Команды ниже запускают бинарник workspace из корня репозитория.',
      }),
      callout({ en: 'Everyday commands', uk: 'Щоденні команди', ru: 'Ежедневные команды' }, [
        {
          k: { en: 'validate', uk: 'validate', ru: 'validate' },
          v: {
            en: '`node packages/cli/bin/ortbtools.js validate bid-request.json` — or "-" instead of a filename to read stdin, for log and curl pipelines.',
            uk: '`node packages/cli/bin/ortbtools.js validate bid-request.json` — або «-» замість імені файлу, щоб читати stdin, для пайплайнів із логів і curl.',
            ru: '`node packages/cli/bin/ortbtools.js validate bid-request.json` — или «-» вместо имени файла, чтобы читать stdin, для пайплайнов из логов и curl.',
          },
        },
        {
          k: { en: 'crosscheck', uk: 'crosscheck', ru: 'crosscheck' },
          v: {
            en: '`node packages/cli/bin/ortbtools.js crosscheck request.json response.json` runs the semantic pass over both sides at once.',
            uk: '`node packages/cli/bin/ortbtools.js crosscheck request.json response.json` проганяє семантичний прохід по обох сторонах одразу.',
            ru: '`node packages/cli/bin/ortbtools.js crosscheck request.json response.json` прогоняет семантический проход по обеим сторонам сразу.',
          },
        },
        {
          k: { en: 'detect', uk: 'detect', ru: 'detect' },
          v: {
            en: '`node packages/cli/bin/ortbtools.js detect payload.json` answers the "what even is this?" question before you start reading rules.',
            uk: '`node packages/cli/bin/ortbtools.js detect payload.json` відповідає на питання «що це взагалі таке?» ще до читання правил.',
            ru: '`node packages/cli/bin/ortbtools.js detect payload.json` отвечает на вопрос «что это вообще такое?» ещё до чтения правил.',
          },
        },
      ]),
      h2({ en: 'In CI', uk: 'У CI', ru: 'В CI' }),
      p({
        en: '`--json` prints machine-readable output and `--fail-on warn` sets the exit code, so a pipeline can block on a severity threshold instead of on grep. `--expect-version 2.5` compares heuristic detection with the version you actually target.',
        uk: '`--json` друкує машинно-читабельний вивід, а `--fail-on warn` виставляє код виходу, тож пайплайн може блокуватись на порозі серйозності, а не на grep. `--expect-version 2.5` порівнює евристичну детекцію з версією, на яку ти реально цілишся.',
        ru: '`--json` печатает машиночитаемый вывод, а `--fail-on warn` выставляет код выхода, поэтому пайплайн может блокироваться на пороге серьёзности, а не на grep. `--expect-version 2.5` сравнивает эвристическую детекцию с версией, на которую ты реально целишься.',
      }),
    ],
  },
  {
    id: 'http-api',
    group: 'groupAutomation',
    title: { en: 'HTTP API v1', uk: 'HTTP API v1', ru: 'HTTP API v1' },
    body: [
      lead({
        en: '`POST /api/analyze` is the programmatic surface. Send bidReq, bidRes or both, and get back the same findings, crosscheck and detection the inspector shows you.',
        uk: '`POST /api/analyze` — програмна поверхня. Надішли bidReq, bidRes або обидва і отримай ті самі findings, крос-перевірку й детекцію, які показує інспектор.',
        ru: '`POST /api/analyze` — программная поверхность. Отправь bidReq, bidRes или оба и получи те же findings, кросс-проверку и детекцию, которые показывает инспектор.',
      }),
      callout({ en: 'The contract', uk: 'Контракт', ru: 'Контракт' }, [
        {
          k: { en: 'Query', uk: 'Query', ru: 'Query' },
          v: {
            en: 'locale (en / uk / ru) picks the language of the finding messages; dialect picks the overlay the rules run under.',
            uk: 'locale (en / uk / ru) обирає мову повідомлень findings; dialect обирає оверлей, під яким працюють правила.',
            ru: 'locale (en / uk / ru) выбирает язык сообщений findings; dialect выбирает оверлей, под которым работают правила.',
          },
        },
        {
          k: { en: 'Body', uk: 'Тіло', ru: 'Тело' },
          v: {
            en: 'bidReq and bidRes objects, at least one of them, plus optional opts.disabledRules and opts.expectedVersion.',
            uk: 'обʼєкти bidReq і bidRes, щонайменше один з них, плюс необовʼязкові opts.disabledRules та opts.expectedVersion.',
            ru: 'объекты bidReq и bidRes, минимум один из них, плюс необязательные opts.disabledRules и opts.expectedVersion.',
          },
        },
        {
          k: { en: 'Limits', uk: 'Ліміти', ru: 'Лимиты' },
          v: {
            en: '60 calls per minute per IP; over that the endpoint answers 429 with code rate_limited.',
            uk: '60 викликів на хвилину на IP; понад це ендпоінт відповідає 429 із кодом rate_limited.',
            ru: '60 вызовов в минуту на IP; сверх того эндпоинт отвечает 429 с кодом rate_limited.',
          },
        },
      ]),
      h2({ en: 'Stability', uk: 'Стабільність', ru: 'Стабильность' }),
      p({
        en: 'Documented fields are additive-only within a major version: new response fields may appear, documented shapes will not change or disappear. Finding ids follow the core package stability contract, which is what makes suppressing one by id safe to leave in a pipeline.',
        uk: 'Задокументовані поля змінюються лише додаванням у межах мажорної версії: нові поля відповіді можуть зʼявлятись, задокументовані форми не змінюються і не зникають. Ідентифікатори findings підпорядковані контракту стабільності core-пакета — саме тому вимкнення одного по id безпечно лишати в пайплайні.',
        ru: 'Задокументированные поля меняются только добавлением в пределах мажорной версии: новые поля ответа могут появляться, задокументированные формы не меняются и не исчезают. Идентификаторы findings подчинены контракту стабильности core-пакета — именно поэтому отключение одного по id безопасно оставлять в пайплайне.',
      }),
      note({
        en: 'Payload bodies are processed transiently and are not persisted by this endpoint. Derived validation metrics may be recorded.',
        uk: 'Тіла payload обробляються транзитно і не зберігаються цим ендпоінтом. Похідні метрики валідації можуть записуватись.',
        ru: 'Тела payload обрабатываются транзитно и не сохраняются этим эндпоинтом. Производные метрики валидации могут записываться.',
      }),
    ],
  },
  {
    id: 'embedding',
    group: 'groupAutomation',
    title: { en: 'Embedding a view', uk: 'Вбудовування вигляду', ru: 'Встраивание вида' },
    body: [
      lead({
        en: 'Append `?embed=1` and the shell strips itself: no rail, no topbar, the inspector full-bleed in whatever frame you put it in. It is the shortest way to drop a live validator into an internal dashboard or a runbook page.',
        uk: 'Додай `?embed=1` — і оболонка знімає себе: без рейки, без топбару, інспектор на всю ширину того фрейму, у який ти його поставиш. Це найкоротший шлях вставити живий валідатор у внутрішній дашборд або сторінку ранбуку.',
        ru: 'Добавь `?embed=1` — и оболочка снимает себя: без рейки, без топбара, инспектор во всю ширину того фрейма, в который ты его поставишь. Это кратчайший путь вставить живой валидатор во внутренний дашборд или страницу ранбука.',
      }),
      h2({ en: 'What stays', uk: 'Що лишається', ru: 'Что остаётся' }),
      p({
        en: 'The engine, the panes and the findings. What goes is the chrome around them: the navigation rail and the topbar are hidden and the shell switches to a single-block layout, so the embed inherits whatever width you give it instead of fighting for its own.',
        uk: 'Рушій, панелі й findings. Зникає обрамлення довкола них: навігаційна рейка і топбар ховаються, а оболонка переходить у однoблочний layout, тож вбудова успадковує ту ширину, яку ти їй даси, замість боротись за власну.',
        ru: 'Движок, панели и findings. Исчезает обрамление вокруг них: навигационная рейка и топбар прячутся, а оболочка переходит в одноблочный layout, поэтому встройка наследует ту ширину, которую ты ей дашь, вместо борьбы за свою.',
      }),
      note({
        en: 'The embed runs against this origin and the same transient analysis path. It is a view mode, not a separate deployment or an authenticated API.',
        uk: 'Вбудова працює проти цього ж origin і того самого транзитного шляху аналізу. Це режим показу, а не окремий деплой чи автентифікований API.',
        ru: 'Встройка работает против этого же origin и того же транзитного пути анализа. Это режим показа, а не отдельный деплой или аутентифицированный API.',
      }),
    ],
  },
];

const TOPIC_BY_ID = new Map(TOPICS.map((t) => [t.id, t]));
const DEFAULT_TOPIC = TOPICS[0].id;

/**
 * Contents order, groups included. `finding-catalog` is a ROUTE entry, not a
 * fragment: /docs/findings is a registered route that generates itself from
 * the message files, so the sidebar links to it rather than reprinting it.
 */
const CONTENTS = [
  { group: 'groupStart', items: ['what-we-check', 'first-analysis', 'reading-a-finding'] },
  {
    group: 'groupValidation',
    items: [
      'ortb-versions',
      'crosscheck',
      'pops-clickunder',
      'vast-native',
      'dialects',
      'finding-catalog',
    ],
  },
  { group: 'groupPrivacy', items: ['what-we-store', 'browser-encryption', 'recovery-keys'] },
  { group: 'groupAutomation', items: ['cli', 'http-api', 'embedding'] },
];

const CATALOG_ENTRY = 'finding-catalog';

// ── Severity vocabulary ──────────────────────────────────────────
//
// /api/v1/finding-catalog publishes `severity` on the scale named by the
// row's own `family`, and the two scales that carry levels overlap in
// spelling: validator `warning` and crosscheck `warn` are members of two
// different enums, and crosscheck `ok` is the check PASSING, not a mild
// problem.
//
// This page used to ignore `family` completely, and both halves of it were
// wrong against the served data:
//
//   - the filter chips were a hardcoded all / error / warning / info, so on
//     the 2026-08-14 catalog 58 of the 344 served rows (34 crosscheck, 23
//     mirror notes, 1 `question`) matched no chip and were reachable only
//     under "All" — a reference table you cannot filter to the row you want;
//   - severityBadge() collapsed every severity it did not recognise to the
//     `info` CSS class, so a crosscheck row rendered an info-blue badge
//     whose text read "crit" — the colour and the word contradicting each
//     other on screen.
//
// Everything below is keyed on family+severity for that reason. None of it
// is a closed list of what the catalog may contain: the chips are built
// from the rows actually served, so a level added to findings.js tomorrow
// gets its own chip without this file being touched. Only ORDER and LABELS
// are declared here, and both degrade rather than drop: a pair nobody has
// named sorts last, shows its verbatim token, and lands on the neutral base
// badge — which cannot contradict the word it carries.

const FAMILY_UNKNOWN = 'unknown';

/**
 * Preferred display order. Anything not listed sorts after, never away.
 * `unknown` serves no rows today — the two ids that had no emitter were
 * deleted from messages/*.json — but it is a family severity-registry.js
 * still returns, so it stays ordered, labelled and styled here.
 */
const FAMILY_ORDER = ['validator', 'crosscheck', 'mirror-note', FAMILY_UNKNOWN];
const SEVERITY_ORDER = [
  'error',
  'crit',
  'warning',
  'warn',
  'question',
  'info',
  'ok',
  'none',
  FAMILY_UNKNOWN,
];

/**
 * family token → heading, plus one line saying what that scale means. The
 * note is what makes `ok` and `none` readable: `ok` is a pass, and a mirror
 * note has no level at all rather than a quiet `info` (which is what the
 * old suffix-guessing catalog invented for all 23 of them).
 */
const FAMILY_TEXT = {
  validator: {
    label: { en: 'Validator', uk: 'Валідатор', ru: 'Валидатор' },
    note: {
      en: 'the level the validator puts on a finding',
      uk: 'рівень, який валідатор ставить на finding',
      ru: 'уровень, который валидатор ставит на finding',
    },
  },
  crosscheck: {
    label: { en: 'Crosscheck', uk: 'Крос-перевірка', ru: 'Кросс-проверка' },
    note: {
      en: 'a separate scale: crit ≈ error, warn ≈ warning, and ok means the check passed',
      uk: 'окрема шкала: crit ≈ error, warn ≈ warning, а ok означає, що перевірку пройдено',
      ru: 'отдельная шкала: crit ≈ error, warn ≈ warning, а ok означает, что проверка пройдена',
    },
  },
  'mirror-note': {
    label: { en: 'Mirror notes', uk: 'Нотатки mirror', ru: 'Заметки mirror' },
    note: {
      en: 'notes the mirror emits with no level attached at all',
      uk: 'нотатки, які mirror видає взагалі без рівня',
      ru: 'заметки, которые mirror выдаёт вообще без уровня',
    },
  },
  [FAMILY_UNKNOWN]: {
    label: { en: 'No emitter', uk: 'Без емітера', ru: 'Без эмитера' },
    note: {
      en: 'message text and a spec reference exist, but no rule emits this ID',
      uk: 'текст повідомлення і посилання на специфікацію є, але жодне правило не видає цей ID',
      ru: 'текст сообщения и ссылка на спецификацию есть, но ни одно правило не выдаёт этот ID',
    },
  },
};

/** `${family}/${severity}` → chip label. Unnamed pairs fall back to the token. */
const SEVERITY_TEXT = {
  'validator/error': { en: 'Error', uk: 'Помилки', ru: 'Ошибки' },
  'validator/warning': { en: 'Warning', uk: 'Попередження', ru: 'Предупреждения' },
  'validator/info': { en: 'Info', uk: 'Інфо', ru: 'Инфо' },
  'validator/question': { en: 'Question', uk: 'Питання', ru: 'Вопросы' },
  'crosscheck/crit': { en: 'Critical', uk: 'Критичні', ru: 'Критичные' },
  'crosscheck/warn': { en: 'Warning', uk: 'Попередження', ru: 'Предупреждения' },
  'crosscheck/ok': { en: 'Passed', uk: 'Пройдено', ru: 'Пройдено' },
  'mirror-note/none': { en: 'No level', uk: 'Без рівня', ru: 'Без уровня' },
  'unknown/unknown': { en: 'Unknown', uk: 'Невідомо', ru: 'Неизвестно' },
};

/**
 * A response without `family` is a body cached before the registry landed
 * (Cache-Control on the endpoint is 300s). 'unknown' is what the catalog
 * itself calls a row it cannot place — safer than assuming the validator
 * scale, which is the assumption this whole change removes.
 */
function familyOf(item) {
  return (item && item.family) || FAMILY_UNKNOWN;
}

/** Every level an ID can be emitted at; `severity` alone is the fallback. */
function severitiesOf(item) {
  const list = item && Array.isArray(item.severities) ? item.severities.filter(Boolean) : [];
  if (list.length) return list;
  return [(item && item.severity) || FAMILY_UNKNOWN];
}

/** Position in a preference list; values it does not name sort last. */
function orderIndex(order, value) {
  const i = order.indexOf(value);
  return i < 0 ? order.length : i;
}

function familyLabel(family, lang) {
  const t = FAMILY_TEXT[family];
  return t ? pick(t.label, lang) : family;
}

function familyNote(family, lang) {
  const t = FAMILY_TEXT[family];
  return t ? pick(t.note, lang) : '';
}

function severityLabel(family, sev, lang) {
  const t = SEVERITY_TEXT[family + '/' + sev];
  return t ? pick(t, lang) : sev;
}

/** CSS-safe fragment of a class name. */
function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

/**
 * Group the served rows into (family, severity) facets — one chip each.
 *
 * A row is counted once per level it can be emitted at, not once per row,
 * which is the same rule matchesFilter() uses. So `payload.duplicate_key`
 * (error on a consequential path, warning elsewhere) is counted under both
 * chips and shows under both, and every chip's number is exactly the number
 * of rows that chip reveals.
 */
function buildFacets(items) {
  const byKey = new Map();
  for (const item of items) {
    const family = familyOf(item);
    for (const sev of severitiesOf(item)) {
      const key = family + '/' + sev;
      const rec = byKey.get(key) || { key, family, severity: sev, n: 0 };
      rec.n++;
      byKey.set(key, rec);
    }
  }

  const facets = [...byKey.values()];
  const families = [];
  for (const f of facets) if (families.indexOf(f.family) < 0) families.push(f.family);
  families.sort((a, b) => orderIndex(FAMILY_ORDER, a) - orderIndex(FAMILY_ORDER, b));

  return families.map((family) => ({
    family,
    facets: facets
      .filter((f) => f.family === family)
      .sort(
        (a, b) => orderIndex(SEVERITY_ORDER, a.severity) - orderIndex(SEVERITY_ORDER, b.severity),
      ),
  }));
}

/** `all`, or a `${family}/${severity}` facet key. */
function matchesFilter(item, filter) {
  if (filter === 'all') return true;
  const cut = filter.indexOf('/');
  if (cut < 0) return false;
  return (
    familyOf(item) === filter.slice(0, cut) &&
    severitiesOf(item).indexOf(filter.slice(cut + 1)) >= 0
  );
}

// ── Reader shell ─────────────────────────────────────────────────

/**
 * 24x24 viewBox, stroke 1.5, currentColor — the house icon contract. The
 * cards this page used to carry drew their icons in emoji, which renders as
 * a different glyph on every platform and carries no colour from the theme.
 */
const ICON_INFO =
  '<svg class="docs-note__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>';

function renderContents(lang, activeId) {
  const groups = CONTENTS.map((g) => {
    const links = g.items
      .map((id) => {
        const isCatalog = id === CATALOG_ENTRY;
        const title = isCatalog
          ? pick(L.catalogTitle, lang)
          : pick(TOPIC_BY_ID.get(id).title, lang);
        const href = isCatalog ? localePath('/docs/findings', lang) : '#' + id;
        const on = id === activeId;
        // data-topic marks the fragment links the module handles itself;
        // the catalog link is a real navigation and is left to the router.
        const hook = isCatalog ? '' : ` data-topic="${escapeHtml(id)}"`;
        return (
          `<a class="docs-toc__link${on ? ' is-active' : ''}" href="${escapeHtml(href)}"${hook}` +
          (on ? ' aria-current="page"' : '') +
          `>${escapeHtml(title)}</a>`
        );
      })
      .join('');
    return (
      `<p class="docs-toc__group">${escapeHtml(pick(L[g.group], lang))}</p>` +
      `<div class="docs-toc__links">${links}</div>`
    );
  }).join('');

  return (
    `<aside class="docs-toc" aria-label="${escapeHtml(pick(L.contents, lang))}">` +
    `<nav class="docs-toc__inner">${groups}</nav></aside>`
  );
}

/**
 * Escape first, then turn `backticks` into inline code.
 *
 * The mockup writes oRTB field names as plain prose — bid.impid, bidfloor —
 * and that is followed here, because a paragraph where every field name is a
 * grey pill reads as a table of contents rather than a sentence. Backticks
 * are reserved for the thing the mockup has no counterpart for: a literal you
 * are meant to TYPE. A shell command set in the body face is genuinely harder
 * to copy correctly, and the flags disappear into the surrounding words.
 *
 * The replacement runs after escapeHtml(), so the only markup that can reach
 * the page is the <code> this function writes.
 */
function inline(map, lang) {
  return escapeHtml(pick(map, lang)).replace(/`([^`]+)`/g, '<code class="docs-code">$1</code>');
}

/** Article body blocks → HTML. Sizes are the stylesheet's business, not this. */
function renderBlocks(blocks, lang) {
  return blocks
    .map((b) => {
      if (b.t === 'lead') return `<p class="docs-lead">${inline(b.v, lang)}</p>`;
      if (b.t === 'p') return `<p class="docs-p">${inline(b.v, lang)}</p>`;
      if (b.t === 'h2') return `<h2 class="docs-h2">${escapeHtml(pick(b.v, lang))}</h2>`;
      if (b.t === 'note') {
        return `<div class="docs-note">${ICON_INFO}<span>${inline(b.v, lang)}</span></div>`;
      }
      if (b.t === 'callout') {
        const rows = b.rows
          .map(
            (r, i) =>
              `<div class="docs-callout__row">` +
              `<span class="docs-callout__num">${String(i + 1).padStart(2, '0')}</span>` +
              `<span class="docs-callout__text"><b>${escapeHtml(pick(r.k, lang))}</b> — ` +
              `${inline(r.v, lang)}</span></div>`,
          )
          .join('');
        return (
          `<div class="docs-callout">` +
          `<div class="docs-callout__label">${escapeHtml(pick(b.label, lang))}</div>` +
          rows +
          `</div>`
        );
      }
      return '';
    })
    .join('');
}

function groupLabelOf(topicId, lang) {
  const t = TOPIC_BY_ID.get(topicId);
  return t ? pick(L[t.group], lang) : '';
}

function renderArticle(topicId, lang) {
  const topic = TOPIC_BY_ID.get(topicId) || TOPIC_BY_ID.get(DEFAULT_TOPIC);
  return (
    `<article class="docs-article">` +
    `<p class="docs-eyebrow">${escapeHtml(groupLabelOf(topic.id, lang))}</p>` +
    `<h1 class="docs-h1">${escapeHtml(pick(topic.title, lang))}</h1>` +
    renderBlocks(topic.body, lang) +
    `</article>`
  );
}

/**
 * sidebar + article column. `wide` drops the 680px reading measure for the
 * finding catalog, whose table needs the room a paragraph does not.
 */
function renderReaderShell(lang, activeId, innerHtml, wide) {
  return (
    `<div class="docs-reader">` +
    renderContents(lang, activeId) +
    `<div class="docs-column${wide ? ' docs-column--wide' : ''}" data-article>${innerHtml}</div>` +
    `</div>`
  );
}

/** The fragment names the topic; anything unknown falls back to the first. */
function topicFromHash() {
  const raw = (typeof location !== 'undefined' && location.hash ? location.hash : '').replace(
    /^#/,
    '',
  );
  return TOPIC_BY_ID.has(raw) ? raw : DEFAULT_TOPIC;
}

function mountReader(root, lang, signal) {
  let active = topicFromHash();
  root.innerHTML = renderReaderShell(lang, active, renderArticle(active, lang), false);

  const column = root.querySelector('[data-article]');

  function show(id, push) {
    active = TOPIC_BY_ID.has(id) ? id : DEFAULT_TOPIC;
    if (column) column.innerHTML = renderArticle(active, lang);
    for (const a of root.querySelectorAll('.docs-toc__link[data-topic]')) {
      const on = a.dataset.topic === active;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    if (push && typeof window !== 'undefined' && window.history) {
      window.history.pushState(null, '', '#' + active);
    }
    if (column) column.scrollTop = 0;
  }

  // Delegated so the handler survives the contents being re-rendered, and
  // preventDefault()ed so switching topics does not scroll the shell to an
  // anchor that is not there. pushState keeps Back working; popstate below
  // is what makes it work, since pushState fires no hashchange of its own.
  root.addEventListener(
    'click',
    (e) => {
      const link = e.target.closest && e.target.closest('.docs-toc__link[data-topic]');
      if (!link) return;
      e.preventDefault();
      show(link.dataset.topic, true);
    },
    { signal },
  );

  if (typeof window !== 'undefined' && window.addEventListener) {
    const onPop = () => show(topicFromHash(), false);
    window.addEventListener('popstate', onPop, { signal });
    window.addEventListener('hashchange', onPop, { signal });
  }
}

// ── Finding catalog view ─────────────────────────────────────────

/**
 * The class carries BOTH halves of the pair. It used to be picked from the
 * severity string alone with `info` as the catch-all, so a crosscheck row
 * rendered `<span class="docs-badge docs-badge--info">crit</span>` — an
 * info-blue pill reading "crit". A pair the stylesheet has no rule for now
 * falls through to the neutral base `.docs-badge`, which asserts nothing.
 *
 * The badge text stays the verbatim token the API published: this table is
 * the reference for what `severity` can hold, so it has to show the value,
 * not a translation of it. The localised reading is in the title and in the
 * chip that filters by it.
 */
function severityBadge(family, sev, lang) {
  const cls = 'docs-badge--' + slug(family) + '-' + slug(sev);
  const title = familyLabel(family, lang) + ' · ' + severityLabel(family, sev, lang);
  return `<span class="docs-badge ${cls}" title="${escapeHtml(title)}">${escapeHtml(sev)}</span>`;
}

/**
 * Every level the ID can carry, plus the scale they are on. Showing only
 * `severity` would hide the second level of the four IDs that have one
 * (`payload.duplicate_key`, `payload.unsafe_number` and the two
 * `behavior.malicious.*`) with nothing on screen to say so.
 */
function severityCell(item, lang) {
  const family = familyOf(item);
  const badges = severitiesOf(item)
    .map((s) => severityBadge(family, s, lang))
    .join(`<span class="docs-sev__or">${escapeHtml(pick(L.sevOr, lang))}</span>`);
  return (
    badges +
    `<span class="docs-sev__family" title="${escapeHtml(familyLabel(family, lang))}">` +
    escapeHtml(family) +
    `</span>`
  );
}

function renderCatalogArticle(lang) {
  return `
    <article class="docs-article docs-catalog">
      <p class="docs-eyebrow">${escapeHtml(pick(L.groupValidation, lang))}</p>
      <h1 class="docs-h1">${escapeHtml(pick(L.catalogTitle, lang))}</h1>
      <p class="docs-lead">${escapeHtml(pick(L.catalogSub, lang))}</p>
      <!-- Chips are built from the response, not hardcoded: a hardcoded
           all/error/warning/info left 60 of the 346 served rows matching no
           chip at all. Empty until the fetch lands. -->
      <div class="docs-facets" data-facets role="group" aria-label="${escapeHtml(pick(L.filterLabel, lang))}"></div>
      <p class="docs-stats" data-stats></p>
      <div class="docs-loading">${escapeHtml(pick(L.loading, lang))}</div>
    </article>
  `;
}

/** Chip row per family, so `warn` is never read on the `warning` scale. */
function renderFacets(groups, total, dualCount, lang) {
  const chip = (filter, label, n, title) =>
    `<button type="button" class="docs-chip" data-filter="${escapeHtml(filter)}" aria-pressed="false" title="${escapeHtml(title)}">` +
    `${escapeHtml(label)} <span class="docs-chip__n">${n}</span></button>`;

  const groupsHtml = groups
    .map((g) => {
      const note2 = familyNote(g.family, lang);
      const chips = g.facets
        .map((f) => chip(f.key, severityLabel(f.family, f.severity, lang), f.n, f.key))
        .join('');
      return `
      <div class="docs-chip-group">
        <p class="docs-chip-group__label">
          <span class="docs-chip-group__name">${escapeHtml(familyLabel(g.family, lang))}</span>
          ${note2 ? `<span class="docs-chip-group__note">${escapeHtml(note2)}</span>` : ''}
        </p>
        <div class="docs-chips">${chips}</div>
      </div>`;
    })
    .join('');

  // Chip counts add up to more than the row count when an ID carries two
  // levels. Saying so beats a table whose numbers quietly do not sum.
  const dual = dualCount
    ? `<p class="docs-facets__note">${escapeHtml(pick(L.dualNote, lang).replace('{n}', dualCount))}</p>`
    : '';

  return (
    `<div class="docs-chips docs-chips--all">${chip('all', pick(L.chipAll, lang), total, 'all')}</div>` +
    `<div class="docs-chip-groups">${groupsHtml}</div>` +
    dual
  );
}

function renderTable(items, lang) {
  const rows = items
    .map((item) => {
      const specCell = item.specRef
        ? `<a href="${escapeHtml(item.specRef)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pick(L.specLink, lang))}</a>`
        : '—';
      return `
      <tr id="finding-${escapeHtml(item.id)}">
        <td class="col-id">${escapeHtml(item.id)}</td>
        <td class="col-sev">${severityCell(item, lang)}</td>
        <td class="col-msg">${escapeHtml(item.message)}</td>
        <td class="col-spec">${specCell}</td>
      </tr>
    `;
    })
    .join('');

  if (!rows) {
    return `<p class="docs-empty">—</p>`;
  }

  return `
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead>
          <tr>
            <th>${escapeHtml(pick(L.colId, lang))}</th>
            <th>${escapeHtml(pick(L.colSev, lang))}</th>
            <th>${escapeHtml(pick(L.colMsg, lang))}</th>
            <th>${escapeHtml(pick(L.colSpec, lang))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function fetchCatalog(lang, signal) {
  const r = await fetch(`/api/v1/finding-catalog?lang=${encodeURIComponent(lang)}`, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).items || [];
}

async function mountCatalog(root, lang, signal) {
  // The catalog is a topic in the section, not a page that escaped it: same
  // contents sidebar, same article column, only the measure is widened.
  root.innerHTML = renderReaderShell(lang, CATALOG_ENTRY, renderCatalogArticle(lang), true);

  let allItems = [];
  let activeFilter = 'all';

  const statsEl = root.querySelector('[data-stats]');
  const facetsEl = root.querySelector('[data-facets]');

  // Container for the table — replaces loading spinner once
  const contentWrap = document.createElement('div');
  contentWrap.className = 'docs-content-wrap';
  const loadingEl = root.querySelector('.docs-loading');
  if (loadingEl) loadingEl.replaceWith(contentWrap);

  function applyFilter(filter) {
    activeFilter = filter;
    const filtered = filter === 'all' ? allItems : allItems.filter((i) => matchesFilter(i, filter));

    // Update chip active states
    root.querySelectorAll('.docs-chip').forEach((chip) => {
      const on = chip.dataset.filter === filter;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    // Update stats. Under a facet the denominator matters — "11 findings"
    // out of context reads as the whole catalog.
    if (statsEl) {
      statsEl.textContent = pick(filter === 'all' ? L.findingsCount : L.findingsCountOf, lang)
        .replace('{n}', filtered.length)
        .replace('{total}', allItems.length);
    }

    // Render table into stable content container
    contentWrap.innerHTML = renderTable(filtered, lang);
  }

  // Delegated, because the chips do not exist until the response lands and
  // are re-rendered wholesale when it does — per-chip listeners bound in the
  // shell would have nothing to bind to.
  if (facetsEl) {
    facetsEl.addEventListener(
      'click',
      (e) => {
        const chip = e.target.closest('.docs-chip');
        if (chip) applyFilter(chip.dataset.filter);
      },
      { signal },
    );
  }

  // Fetch data
  try {
    allItems = await fetchCatalog(lang, signal);
    const dualCount = allItems.filter((i) => severitiesOf(i).length > 1).length;
    if (facetsEl) {
      facetsEl.innerHTML = renderFacets(buildFacets(allItems), allItems.length, dualCount, lang);
    }
    applyFilter(activeFilter);
  } catch (e) {
    if (e.name === 'AbortError') return;
    // Written into contentWrap, not `.docs-loading`: that element was
    // replaced by contentWrap above before the fetch ever started, so the
    // old `root.querySelector('.docs-loading')` here always found null and
    // a failed catalog load left the page silently blank.
    contentWrap.innerHTML =
      '<p class="docs-empty">' + escapeHtml(pick(L.errorLoad, lang) + ' ' + e.message) + '</p>';
  }
}

// ── Module export ────────────────────────────────────────────────

export default {
  id: 'docs',
  css: '/modules/docs/docs.css',
  route: '/docs',
  manifest: {
    title: { en: 'Docs', uk: 'Документація', ru: 'Документация' },
  },

  async mount(root, ctx) {
    const lang = ctx.lang || FALLBACK_LANG;

    // Determine which sub-page to render by pathname. stripLocale() is the
    // same prefix-removal the server and nav use — the inline regex this
    // replaced also ate the prefix of any path merely *starting* with those
    // two letters (/ukraine → /raine).
    const { path: canonical } = stripLocale(location.pathname);
    const isFindingsCatalog = canonical === '/docs/findings';

    if (isFindingsCatalog) {
      await mountCatalog(root, lang, ctx.signal);
    } else {
      mountReader(root, lang, ctx.signal);
    }
  },

  async unmount(_root) {
    /* registry sweeps DOM; section CSS persists (loaded once via mod.css) */
  },
};
