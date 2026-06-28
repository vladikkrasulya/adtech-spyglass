'use strict';

/**
 * lib/landings.js — programmatic-SEO landing pages (pure, no I/O).
 *
 * Each landing is a real content page (spec explainer + a live sample the user
 * can open in the validator), server-rendered into #app-root so crawlers and
 * no-JS visitors get the full text without running the SPA. The set is keyed by
 * sectionPath and MUST mirror the matching SECTION_SEO entries in lib/seo.js so
 * the dynamic sitemap (renderSitemap iterates SECTION_SEO) and per-route
 * canonical/hreflang (sectionSeo + applySeoToHtml) cover them for free.
 *
 * Content quality is the whole game here: thin/templated pages read as doorway
 * pages post-2024 Core Updates, so every landing carries a genuine explanation
 * + a working "open in validator" deep-link, not a stamped template.
 *
 * Pure by design — server.js only asks isLanding()/injectLanding(); no fs/CH.
 */

const { escapeHtml, localizedPath } = require('./seo');

// IAB Content Taxonomy 1.0 — trilingual label maps for the /iab-categories
// table. Reused from the validator's decoder so the page never drifts from what
// the inspector actually decodes. tier-1 codes only (IAB1…IAB26); dashed
// children and the leading _meta keys are filtered out.
const IAB_TAX = {
  en: require('../packages/core/iab-categories.en.json'),
  uk: require('../packages/core/iab-categories.uk.json'),
  ru: require('../packages/core/iab-categories.ru.json'),
};
const IAB_TIER1 = Object.keys(IAB_TAX.en)
  .filter((k) => /^IAB\d+$/.test(k))
  .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));

const LANGS = ['en', 'uk', 'ru'];
const FALLBACK = 'en';

function pick(map, lang) {
  if (!map) return '';
  return map[lang] != null ? map[lang] : map[FALLBACK] != null ? map[FALLBACK] : '';
}

// ── content ────────────────────────────────────────────────────────────────
// `sample` is the slug handed to /inspector?sample=<slug> (resolved by
// /api/v1/sample → samples/synthetic-<slug>.json | <slug>.json). null = no CTA
// sample (content-only landing, e.g. the IAB taxonomy table).
//
// `sections[].body` is an array of paragraph strings; `sections[].list` is an
// optional array of bullet strings rendered after the paragraphs.
const LANDINGS = {
  '/openrtb/2-6': {
    sample: 'iab-banner-valid',
    cta: {
      en: 'Open a valid OpenRTB 2.6 BidRequest in the validator',
      uk: 'Відкрити валідний OpenRTB 2.6 BidRequest у валідаторі',
      ru: 'Открыть валидный OpenRTB 2.6 BidRequest в валидаторе',
    },
    specLinks: [
      {
        label: 'IAB Tech Lab — OpenRTB 2.6 spec (PDF)',
        href: 'https://iabtechlab.com/wp-content/uploads/2022/04/OpenRTB-2-6_FINAL.pdf',
      },
      {
        label: 'OpenRTB GitHub (AdCOM / OpenRTB)',
        href: 'https://github.com/InteractiveAdvertisingBureau/openrtb',
      },
    ],
    h1: {
      en: 'OpenRTB 2.6 Validator',
      uk: 'Валідатор OpenRTB 2.6',
      ru: 'Валидатор OpenRTB 2.6',
    },
    lede: {
      en: 'Paste an OpenRTB 2.6 BidRequest or BidResponse and get a human-readable validation — no upload, no signup. Your payload is analyzed on the server and never stored. This page explains what 2.6 added over 2.5 and the fields most likely to trip a validator.',
      uk: 'Встав OpenRTB 2.6 BidRequest або BidResponse і отримай зрозумілу валідацію онлайн — без завантаження й реєстрації. Payload аналізується на сервері й не зберігається. Нижче — що саме 2.6 додав до 2.5 і які поля найчастіше валять валідацію.',
      ru: 'Вставь OpenRTB 2.6 BidRequest или BidResponse и получи понятную валидацию онлайн — без загрузки и регистрации. Payload анализируется на сервере и не сохраняется. Ниже — что именно 2.6 добавил к 2.5 и какие поля чаще всего валят валидацию.',
    },
    sections: [
      {
        h2: {
          en: 'What OpenRTB 2.6 changes',
          uk: 'Що змінює OpenRTB 2.6',
          ru: 'Что меняет OpenRTB 2.6',
        },
        body: {
          en: [
            'OpenRTB 2.6 is a backward-compatible evolution of 2.5: a valid 2.5 request is still a valid 2.6 request. The release is centred on video and CTV, where the unit of sale shifted from a single impression to a structured ad pod.',
            'It also folds in signals that had been living in extensions — most notably the supply chain object — so they now have a first-class home in the core spec.',
          ],
          uk: [
            'OpenRTB 2.6 — зворотно-сумісна еволюція 2.5: валідний 2.5-запит лишається валідним 2.6-запитом. Реліз сфокусований на відео й CTV, де одиниця продажу змістилася з окремого показу на структурований ad pod.',
            'Він також забирає в ядро сигнали, що жили в розширеннях, — насамперед об’єкт supply chain, який тепер має офіційне місце у специфікації.',
          ],
          ru: [
            'OpenRTB 2.6 — обратно-совместимая эволюция 2.5: валидный 2.5-запрос остаётся валидным 2.6-запросом. Релиз сфокусирован на видео и CTV, где единица продажи сместилась с отдельного показа на структурированный ad pod.',
            'Он также забирает в ядро сигналы, жившие в расширениях, — прежде всего объект supply chain, у которого теперь есть официальное место в спецификации.',
          ],
        },
      },
      {
        h2: {
          en: 'Key additions over 2.5',
          uk: 'Ключові доповнення до 2.5',
          ru: 'Ключевые дополнения к 2.5',
        },
        body: {
          en: ['The additions worth knowing when you debug 2.6 traffic:'],
          uk: ['Доповнення, які варто знати під час дебагу 2.6-трафіку:'],
          ru: ['Дополнения, которые стоит знать при дебаге 2.6-трафика:'],
        },
        list: {
          en: [
            'Ad Pods (Video.podid, podseq, slotinpod, mincpmpersec) — structured CTV/long-form breaks instead of a single video impression.',
            'SupplyChain (source.schain) — promoted from the schain extension into the spec for end-to-end seller transparency.',
            'DOOH groundwork and refreshed durations (Video.rqddurs, maxseq) for sequenced creatives.',
            'Network & Channel objects (site/app.content.network, .channel) for CTV inventory identity.',
          ],
          uk: [
            'Ad Pods (Video.podid, podseq, slotinpod, mincpmpersec) — структуровані CTV/long-form блоки замість одного відеопоказу.',
            'SupplyChain (source.schain) — піднято з розширення schain у саму специфікацію для наскрізної прозорості продавців.',
            'Підготовка під DOOH і оновлені тривалості (Video.rqddurs, maxseq) для секвенованих креативів.',
            'Об’єкти Network і Channel (site/app.content.network, .channel) для ідентичності CTV-інвентарю.',
          ],
          ru: [
            'Ad Pods (Video.podid, podseq, slotinpod, mincpmpersec) — структурированные CTV/long-form блоки вместо одного видеопоказа.',
            'SupplyChain (source.schain) — поднят из расширения schain в саму спецификацию для сквозной прозрачности продавцов.',
            'Подготовка под DOOH и обновлённые длительности (Video.rqddurs, maxseq) для секвенированных креативов.',
            'Объекты Network и Channel (site/app.content.network, .channel) для идентичности CTV-инвентаря.',
          ],
        },
      },
      {
        h2: {
          en: 'Common validation pitfalls',
          uk: 'Часті помилки валідації',
          ru: 'Частые ошибки валидации',
        },
        body: {
          en: [
            'Most "2.6" errors are not new objects — they are old mistakes that 2.6 made easier to make. Watch for a SupplyChain object that is still duplicated in source.ext.schain (pick one), pods that reference a podid no impression declares, and currency mismatches between cur and bid.price now that pod-level CPM-per-second floors exist.',
            'Paste a real request below and the validator flags these inline, with the exact JSON path and the spec section behind each finding.',
          ],
          uk: [
            'Більшість «2.6»-помилок — не нові об’єкти, а старі похибки, які 2.6 зробив легшими. Слідкуй за об’єктом SupplyChain, що досі дублюється в source.ext.schain (лиши один), за подами, що посилаються на podid, якого не оголошує жоден показ, і за розбіжностями валют між cur і bid.price тепер, коли є pod-рівневі флори CPM-за-секунду.',
            'Встав справжній запит нижче — валідатор підсвітить це inline, з точним JSON-шляхом і розділом специфікації за кожною знахідкою.',
          ],
          ru: [
            'Большинство «2.6»-ошибок — не новые объекты, а старые промахи, которые 2.6 сделал легче. Следи за объектом SupplyChain, всё ещё дублирующимся в source.ext.schain (оставь один), за подами, ссылающимися на podid, который не объявляет ни один показ, и за расхождениями валют между cur и bid.price теперь, когда есть pod-уровневые флоры CPM-за-секунду.',
            'Вставь настоящий запрос ниже — валидатор подсветит это inline, с точным JSON-путём и разделом спецификации за каждой находкой.',
          ],
        },
      },
    ],
  },

  '/openrtb/2-5': {
    sample: 'iab-banner-valid',
    cta: {
      en: 'Open a valid OpenRTB 2.5 BidRequest in the validator',
      uk: 'Відкрити валідний OpenRTB 2.5 BidRequest у валідаторі',
      ru: 'Открыть валидный OpenRTB 2.5 BidRequest в валидаторе',
    },
    specLinks: [
      {
        label: 'IAB Tech Lab — OpenRTB 2.5 spec (PDF)',
        href: 'https://www.iab.com/wp-content/uploads/2016/03/OpenRTB-API-Specification-Version-2-5-FINAL.pdf',
      },
      {
        label: 'OpenRTB GitHub',
        href: 'https://github.com/InteractiveAdvertisingBureau/openrtb',
      },
    ],
    h1: { en: 'OpenRTB 2.5 Validator', uk: 'Валідатор OpenRTB 2.5', ru: 'Валидатор OpenRTB 2.5' },
    lede: {
      en: 'OpenRTB 2.5 is the workhorse of programmatic — most live bid traffic still speaks it. Paste a BidRequest or BidResponse and validate it online — no upload or signup; analyzed on the server and never stored.',
      uk: 'OpenRTB 2.5 — робоча конячка programmatic: більшість живого трафіку досі говорить саме ним. Встав BidRequest або BidResponse і перевір його онлайн — без завантаження й реєстрації; аналіз на сервері, payload не зберігається.',
      ru: 'OpenRTB 2.5 — рабочая лошадка programmatic: большая часть живого трафика до сих пор говорит именно им. Вставь BidRequest или BidResponse и проверь его онлайн — без загрузки и регистрации; анализ на сервере, payload не сохраняется.',
    },
    sections: [
      {
        h2: { en: 'What OpenRTB 2.5 is', uk: 'Що таке OpenRTB 2.5', ru: 'Что такое OpenRTB 2.5' },
        body: {
          en: [
            'Finalised in 2016, 2.5 is the de-facto baseline for real-time bidding. It defines the BidRequest / BidResponse pair, the impression array, the four creative types (banner, video, native, audio) and the inventory context objects (site, app, device, user).',
            'Almost every SSP and DSP integration in the wild is 2.5 or a 2.5 dialect, which is why most "weird traffic" debugging starts here.',
          ],
          uk: [
            'Фіналізований у 2016-му, 2.5 — фактичний базовий стандарт real-time bidding. Він визначає пару BidRequest / BidResponse, масив показів, чотири типи креативу (banner, video, native, audio) та об’єкти контексту інвентарю (site, app, device, user).',
            'Майже кожна жива інтеграція SSP і DSP — це 2.5 або його діалект, тому більшість розборів «дивного трафіку» починається саме тут.',
          ],
          ru: [
            'Финализированный в 2016-м, 2.5 — фактический базовый стандарт real-time bidding. Он определяет пару BidRequest / BidResponse, массив показов, четыре типа креатива (banner, video, native, audio) и объекты контекста инвентаря (site, app, device, user).',
            'Почти каждая живая интеграция SSP и DSP — это 2.5 или его диалект, поэтому большинство разборов «странного трафика» начинается именно здесь.',
          ],
        },
      },
      {
        h2: {
          en: 'The objects that matter',
          uk: 'Об’єкти, що мають значення',
          ru: 'Объекты, которые имеют значение',
        },
        body: {
          en: ['When you read a 2.5 request, these carry the signal:'],
          uk: ['Коли читаєш 2.5-запит, ось що несе сигнал:'],
          ru: ['Когда читаешь 2.5-запрос, вот что несёт сигнал:'],
        },
        list: {
          en: [
            'imp[] with exactly one of banner / video / native / audio per impression.',
            'bidfloor + bidfloorcur — and bid.price must be in the same currency as cur[].',
            'source.ext.schain — the supply chain (promoted to a core object in 2.6).',
            'regs.ext.gdpr / us_privacy and user.ext.consent — the privacy signals graders check first.',
          ],
          uk: [
            'imp[] рівно з одним із banner / video / native / audio на показ.',
            'bidfloor + bidfloorcur — і bid.price має бути у тій самій валюті, що й cur[].',
            'source.ext.schain — ланцюг постачання (у 2.6 став основним об’єктом).',
            'regs.ext.gdpr / us_privacy і user.ext.consent — сигнали приватності, які перевіряють першими.',
          ],
          ru: [
            'imp[] ровно с одним из banner / video / native / audio на показ.',
            'bidfloor + bidfloorcur — и bid.price должен быть в той же валюте, что и cur[].',
            'source.ext.schain — цепочка поставок (в 2.6 стала основным объектом).',
            'regs.ext.gdpr / us_privacy и user.ext.consent — сигналы приватности, которые проверяют первыми.',
          ],
        },
      },
      {
        h2: {
          en: 'Common validation pitfalls',
          uk: 'Часті помилки валідації',
          ru: 'Частые ошибки валидации',
        },
        body: {
          en: [
            'The recurring 2.5 mistakes: a missing imp[].id, banner.w/h set alongside a banner.format[] that disagrees, the wrong auction type in at, a bid.price in a currency that is not in cur[], and secure:1 inventory served an http:// creative.',
            'Paste a real request and the validator flags each inline with the exact JSON path and the spec clause behind it.',
          ],
          uk: [
            'Повторювані помилки 2.5: відсутній imp[].id, banner.w/h поруч із banner.format[], що з ними не збігається, неправильний тип аукціону в at, bid.price у валюті, якої немає в cur[], і secure:1-інвентар, якому віддали http://-креатив.',
            'Встав справжній запит — валідатор підсвітить кожну помилку inline з точним JSON-шляхом і пунктом специфікації.',
          ],
          ru: [
            'Повторяющиеся ошибки 2.5: отсутствующий imp[].id, banner.w/h рядом с banner.format[], который с ними не совпадает, неправильный тип аукциона в at, bid.price в валюте, которой нет в cur[], и secure:1-инвентарь, которому отдали http://-креатив.',
            'Вставь настоящий запрос — валидатор подсветит каждую ошибку inline с точным JSON-путём и пунктом спецификации.',
          ],
        },
      },
    ],
  },

  '/openrtb/3-0': {
    sample: 'ortb30-clean',
    cta: {
      en: 'Open a valid OpenRTB 3.0 object in the validator',
      uk: 'Відкрити валідний OpenRTB 3.0 об’єкт у валідаторі',
      ru: 'Открыть валидный OpenRTB 3.0 объект в валидаторе',
    },
    specLinks: [
      {
        label: 'IAB Tech Lab — OpenRTB 3.0',
        href: 'https://github.com/InteractiveAdvertisingBureau/openrtb/blob/master/OpenRTB%20v3.0%20FINAL.md',
      },
      {
        label: 'AdCOM 1.0 (Advertising Common Object Model)',
        href: 'https://github.com/InteractiveAdvertisingBureau/AdCOM',
      },
    ],
    h1: { en: 'OpenRTB 3.0 Validator', uk: 'Валідатор OpenRTB 3.0', ru: 'Валидатор OpenRTB 3.0' },
    lede: {
      en: 'OpenRTB 3.0 re-architects the model: a thin transport envelope plus AdCOM for the ad and placement objects. Paste a 3.0 object and validate the new shape online — analyzed on the server, never stored.',
      uk: 'OpenRTB 3.0 переархітектурує модель: тонкий транспортний конверт плюс AdCOM для об’єктів реклами й розміщення. Встав 3.0-об’єкт і перевір нову структуру онлайн — аналіз на сервері, payload не зберігається.',
      ru: 'OpenRTB 3.0 переархитектурирует модель: тонкий транспортный конверт плюс AdCOM для объектов рекламы и размещения. Вставь 3.0-объект и проверь новую структуру онлайн — анализ на сервере, payload не сохраняется.',
    },
    sections: [
      {
        h2: { en: 'What changed in 3.0', uk: 'Що змінилось у 3.0', ru: 'Что изменилось в 3.0' },
        body: {
          en: [
            '3.0 splits responsibilities cleanly: the OpenRTB layer carries transport and auction mechanics, while AdCOM carries the actual ad, placement and context objects. Everything lives under a top-level openrtb envelope with ver, domainspec and domainver.',
            'It is not a drop-in upgrade from 2.x — the field names and nesting are different on purpose.',
          ],
          uk: [
            '3.0 чітко розділяє відповідальності: рівень OpenRTB несе транспорт і механіку аукціону, а AdCOM — самі об’єкти реклами, розміщення й контексту. Усе живе під верхнім конвертом openrtb із ver, domainspec і domainver.',
            'Це не безшовний апгрейд з 2.x — назви полів і вкладеність відрізняються навмисно.',
          ],
          ru: [
            '3.0 чётко разделяет ответственности: уровень OpenRTB несёт транспорт и механику аукциона, а AdCOM — сами объекты рекламы, размещения и контекста. Всё живёт под верхним конвертом openrtb с ver, domainspec и domainver.',
            'Это не бесшовный апгрейд с 2.x — имена полей и вложенность отличаются намеренно.',
          ],
        },
      },
      {
        h2: {
          en: 'AdCOM, not BidRequest fields',
          uk: 'AdCOM, а не поля BidRequest',
          ru: 'AdCOM, а не поля BidRequest',
        },
        body: {
          en: ['The mental remap from 2.x:'],
          uk: ['Перемапування мислення з 2.x:'],
          ru: ['Перемапирование мышления с 2.x:'],
        },
        list: {
          en: [
            'item[] replaces imp[] — each item references an AdCOM Placement.',
            'media / ad objects live in AdCOM, not inline on the bid.',
            'SupplyChain sits on source; creative type is ctype (an AdCOM enum), not protocols.',
            'domainspec / domainver declare which AdCOM version the payload speaks.',
          ],
          uk: [
            'item[] замінює imp[] — кожен item посилається на AdCOM Placement.',
            'об’єкти media / ad живуть в AdCOM, а не inline у ставці.',
            'SupplyChain — на source; тип креативу це ctype (enum AdCOM), а не protocols.',
            'domainspec / domainver оголошують, якою версією AdCOM говорить payload.',
          ],
          ru: [
            'item[] заменяет imp[] — каждый item ссылается на AdCOM Placement.',
            'объекты media / ad живут в AdCOM, а не inline в ставке.',
            'SupplyChain — на source; тип креатива это ctype (enum AdCOM), а не protocols.',
            'domainspec / domainver объявляют, какой версией AdCOM говорит payload.',
          ],
        },
      },
      {
        h2: {
          en: 'Why adoption is slow — and where 3.0 breaks',
          uk: 'Чому впровадження повільне — і де 3.0 ламається',
          ru: 'Почему внедрение медленное — и где 3.0 ломается',
        },
        body: {
          en: [
            'Most SSPs still run 2.x, so real 3.0 traffic is rare and 3.0 bugs are usually 2.x habits leaking through: 2.x field names dropped into the 3.0 envelope, a missing or wrong domainver, or AdCOM enums used as if they were 2.x protocols values.',
            'Paste a 3.0 object and the validator checks the envelope and the AdCOM layer together, naming the exact path of each mismatch.',
          ],
          uk: [
            'Більшість SSP досі на 2.x, тож реального 3.0-трафіку мало, а баги 3.0 — зазвичай звички 2.x, що протікають: назви полів 2.x у конверті 3.0, відсутній чи неправильний domainver, або enum-и AdCOM, вжиті як значення protocols із 2.x.',
            'Встав 3.0-об’єкт — валідатор перевірить конверт і шар AdCOM разом, називаючи точний шлях кожної невідповідності.',
          ],
          ru: [
            'Большинство SSP до сих пор на 2.x, поэтому реального 3.0-трафика мало, а баги 3.0 — обычно привычки 2.x, которые протекают: имена полей 2.x в конверте 3.0, отсутствующий или неправильный domainver, либо enum-ы AdCOM, использованные как значения protocols из 2.x.',
            'Вставь 3.0-объект — валидатор проверит конверт и слой AdCOM вместе, называя точный путь каждого несоответствия.',
          ],
        },
      },
    ],
  },

  '/vast': {
    sample: 'vast-clean-inline',
    cta: {
      en: 'Open a clean inline VAST in the validator',
      uk: 'Відкрити чистий inline VAST у валідаторі',
      ru: 'Открыть чистый inline VAST в валидаторе',
    },
    specLinks: [
      {
        label: 'IAB Tech Lab — VAST 4.x',
        href: 'https://iabtechlab.com/standards/video-ad-serving-template-vast/',
      },
    ],
    h1: { en: 'VAST Validator', uk: 'Валідатор VAST', ru: 'Валидатор VAST' },
    lede: {
      en: 'VAST is the XML that delivers a video or CTV creative — usually returned inside bid.adm. Open a clean inline VAST plus its bid envelope and inspect the structure online — analyzed on the server, never stored.',
      uk: 'VAST — це XML, що доставляє відео- чи CTV-креатив, зазвичай у bid.adm. Відкрий чистий inline VAST разом із його bid-конвертом і досліди структуру онлайн — аналіз на сервері, payload не зберігається.',
      ru: 'VAST — это XML, доставляющий видео- или CTV-креатив, обычно в bid.adm. Открой чистый inline VAST вместе с его bid-конвертом и изучи структуру онлайн — анализ на сервере, payload не сохраняется.',
    },
    sections: [
      {
        h2: { en: 'What VAST is', uk: 'Що таке VAST', ru: 'Что такое VAST' },
        body: {
          en: [
            'VAST (Video Ad Serving Template) is the IAB XML format a player fetches to render a video ad. In programmatic it usually arrives as the bid.adm string. An ad is either InLine (the creative itself: MediaFiles + tracking) or a Wrapper that points at another VAST.',
          ],
          uk: [
            'VAST (Video Ad Serving Template) — IAB-формат XML, який плеєр отримує, щоб відрендерити відеорекламу. У programmatic він зазвичай приходить рядком bid.adm. Реклама — це або InLine (сам креатив: MediaFiles + трекінг), або Wrapper, що вказує на інший VAST.',
          ],
          ru: [
            'VAST (Video Ad Serving Template) — IAB-формат XML, который плеер получает, чтобы отрендерить видеорекламу. В programmatic он обычно приходит строкой bid.adm. Реклама — это либо InLine (сам креатив: MediaFiles + трекинг), либо Wrapper, указывающий на другой VAST.',
          ],
        },
      },
      {
        h2: {
          en: 'Wrapper chains and where they break',
          uk: 'Ланцюги Wrapper і де вони ламаються',
          ru: 'Цепочки Wrapper и где они ломаются',
        },
        body: {
          en: [
            'Wrappers chain: wrapper → wrapper → inline. Each hop adds latency and tracking, and players cap the redirect depth — a chain that never resolves to an InLine is a dead ad. Most failures are a wrapper with no VASTAdTagURI, a missing Impression or Error node, insecure (http) MediaFiles in a secure context, or deprecated VPAID in a CTV environment that does not run it.',
          ],
          uk: [
            'Wrapper-и ланцюжаться: wrapper → wrapper → inline. Кожен крок додає затримку й трекінг, а плеєри обмежують глибину редіректів — ланцюг, що ніколи не доходить до InLine, це мертва реклама. Більшість збоїв: wrapper без VASTAdTagURI, відсутній вузол Impression або Error, незахищені (http) MediaFiles у secure-контексті, або застарілий VPAID у CTV-середовищі, яке його не запускає.',
          ],
          ru: [
            'Wrapper-ы сцепляются: wrapper → wrapper → inline. Каждый шаг добавляет задержку и трекинг, а плееры ограничивают глубину редиректов — цепочка, которая никогда не доходит до InLine, это мёртвая реклама. Большинство сбоев: wrapper без VASTAdTagURI, отсутствующий узел Impression или Error, незащищённые (http) MediaFiles в secure-контексте, или устаревший VPAID в CTV-среде, которая его не запускает.',
          ],
        },
      },
      {
        h2: {
          en: 'Common validation pitfalls',
          uk: 'Часті помилки валідації',
          ru: 'Частые ошибки валидации',
        },
        body: {
          en: [
            'The validator reads the adm as XML and crosschecks it against the bid: empty or non-XML adm, a duration that disagrees with the impression, missing tracking events, VPAID where the request asked for it to be off, and insecure media URLs are all surfaced inline with the spec reference.',
          ],
          uk: [
            'Валідатор читає adm як XML і звіряє його зі ставкою: порожній чи не-XML adm, тривалість, що не збігається з показом, відсутні tracking-події, VPAID там, де запит просив його вимкнути, і незахищені media-URL — усе підсвічується inline з посиланням на специфікацію.',
          ],
          ru: [
            'Валидатор читает adm как XML и сверяет его со ставкой: пустой или не-XML adm, длительность, не совпадающая с показом, отсутствующие tracking-события, VPAID там, где запрос просил его выключить, и незащищённые media-URL — всё подсвечивается inline со ссылкой на спецификацию.',
          ],
        },
      },
    ],
  },

  '/native': {
    sample: 'native-clean',
    cta: {
      en: 'Open a valid OpenRTB Native request in the validator',
      uk: 'Відкрити валідний OpenRTB Native запит у валідаторі',
      ru: 'Открыть валидный OpenRTB Native запрос в валидаторе',
    },
    specLinks: [
      {
        label: 'IAB Tech Lab — Native Ads 1.2',
        href: 'https://iabtechlab.com/standards/openrtb-native/',
      },
    ],
    h1: {
      en: 'OpenRTB Native Validator',
      uk: 'Валідатор OpenRTB Native',
      ru: 'Валидатор OpenRTB Native',
    },
    lede: {
      en: 'Native ads carry a request-inside-the-request: a stringified Native markup object describing the assets the publisher will render. Open a valid native request and crosscheck assets request↔response online — analyzed on the server, never stored.',
      uk: 'Нативна реклама несе запит усередині запиту: рядок-об’єкт Native-розмітки, що описує ассети, які відрендерить видавець. Відкрий валідний native-запит і звір ассети запит↔відповідь онлайн — аналіз на сервері, payload не зберігається.',
      ru: 'Нативная реклама несёт запрос внутри запроса: строку-объект Native-разметки, описывающую ассеты, которые отрендерит издатель. Открой валидный native-запрос и сверь ассеты запрос↔ответ онлайн — анализ на сервере, payload не сохраняется.',
    },
    sections: [
      {
        h2: {
          en: 'How native works in OpenRTB',
          uk: 'Як native працює в OpenRTB',
          ru: 'Как native работает в OpenRTB',
        },
        body: {
          en: [
            'A native impression sets imp[].native, whose request field is a JSON string (not an object) holding a Native 1.2 markup request: a ver, a context, and an assets[] array of titles, images and data fields, each with an id. The bid response echoes those ids back with the actual content.',
          ],
          uk: [
            'Нативний показ задає imp[].native, де поле request — це JSON-рядок (не об’єкт) із Native 1.2 markup-запитом: ver, context і масив assets[] із заголовків, зображень і data-полів, кожне зі своїм id. Bid-відповідь повертає ці id з фактичним контентом.',
          ],
          ru: [
            'Нативный показ задаёт imp[].native, где поле request — это JSON-строка (не объект) с Native 1.2 markup-запросом: ver, context и массив assets[] из заголовков, изображений и data-полей, каждое со своим id. Bid-ответ возвращает эти id с фактическим контентом.',
          ],
        },
      },
      {
        h2: { en: 'Asset crosscheck', uk: 'Crosscheck ассетів', ru: 'Crosscheck ассетов' },
        body: {
          en: [
            'The contract is the asset id. Every required asset declared in the request must come back in the response, the ids must line up, and image types must match. This validator parses the stringified native request and crosschecks it against the response native assets, so a missing title or a stray extra image is caught — not just a schema pass.',
          ],
          uk: [
            'Контракт — це id ассета. Кожен required-ассет, оголошений у запиті, має повернутись у відповіді, id мають збігатись, а типи зображень — відповідати. Цей валідатор парсить рядковий native-запит і звіряє його з native-ассетами відповіді, тож відсутній заголовок чи зайве зображення буде впіймано — не лише прохід по схемі.',
          ],
          ru: [
            'Контракт — это id ассета. Каждый required-ассет, объявленный в запросе, должен вернуться в ответе, id должны совпадать, а типы изображений — соответствовать. Этот валидатор парсит строковый native-запрос и сверяет его с native-ассетами ответа, так что отсутствующий заголовок или лишнее изображение будет пойман — не только проход по схеме.',
          ],
        },
      },
      {
        h2: {
          en: 'Common validation pitfalls',
          uk: 'Часті помилки валідації',
          ru: 'Частые ошибки валидации',
        },
        body: {
          en: [
            'The classic native mistakes: sending request as a JSON object instead of a string, omitting a required asset, asset ids that do not match between request and response, and mixing Native 1.1 and 1.2 field shapes. Open the sample and the validator decodes the embedded markup and flags each one.',
          ],
          uk: [
            'Класичні native-помилки: відправка request об’єктом замість рядка, пропуск required-ассета, id ассетів, що не збігаються між запитом і відповіддю, і змішування форматів полів Native 1.1 та 1.2. Відкрий зразок — валідатор декодує вбудовану розмітку й підсвітить кожну.',
          ],
          ru: [
            'Классические native-ошибки: отправка request объектом вместо строки, пропуск required-ассета, id ассетов, не совпадающие между запросом и ответом, и смешивание форматов полей Native 1.1 и 1.2. Открой образец — валидатор декодирует встроенную разметку и подсветит каждую.',
          ],
        },
      },
    ],
  },

  '/iab-categories': {
    sample: null,
    kind: 'iab-table',
    specLinks: [
      {
        label: 'IAB Tech Lab — Content Taxonomy',
        href: 'https://iabtechlab.com/standards/content-taxonomy/',
      },
    ],
    h1: {
      en: 'IAB Content Taxonomy — Category Codes',
      uk: 'Контент-таксономія IAB — коди категорій',
      ru: 'Контент-таксономия IAB — коды категорий',
    },
    lede: {
      en: 'The IABx codes that show up in cat[], bcat[], pcat[], sectioncat[] and pagecat[] come from the IAB Content Taxonomy. Here is the tier-1 reference — filter it, then open any bid in the validator to see codes decoded inline.',
      uk: 'Коди IABx, що з’являються в cat[], bcat[], pcat[], sectioncat[] і pagecat[], походять з контент-таксономії IAB. Ось довідник першого рівня — відфільтруй його, а потім відкрий будь-яку ставку у валідаторі, щоб побачити коди розшифрованими inline.',
      ru: 'Коды IABx, появляющиеся в cat[], bcat[], pcat[], sectioncat[] и pagecat[], происходят из контент-таксономии IAB. Вот справочник первого уровня — отфильтруй его, а затем открой любую ставку в валидаторе, чтобы увидеть коды расшифрованными inline.',
    },
    sections: [
      {
        h2: { en: 'What these codes are', uk: 'Що це за коди', ru: 'Что это за коды' },
        body: {
          en: [
            'These are IAB Content Taxonomy 1.0 codes (the legacy IABx-y format, e.g. IAB9-11). Tier-1 codes (IAB1…IAB26) name a top-level subject; the dashed children narrow it. They flag inventory category (cat), blocked categories (bcat) and page/section context. Taxonomy 2.0/3.0 replaced these with numeric IDs, but the legacy codes still dominate live traffic.',
          ],
          uk: [
            'Це коди контент-таксономії IAB 1.0 (легасі-формат IABx-y, напр. IAB9-11). Коди першого рівня (IAB1…IAB26) називають верхню тему; дочірні з дефісом її звужують. Вони позначають категорію інвентарю (cat), заблоковані категорії (bcat) і контекст сторінки/секції. Таксономія 2.0/3.0 замінила їх числовими ID, але легасі-коди досі домінують у живому трафіку.',
          ],
          ru: [
            'Это коды контент-таксономии IAB 1.0 (легаси-формат IABx-y, напр. IAB9-11). Коды первого уровня (IAB1…IAB26) называют верхнюю тему; дочерние с дефисом её сужают. Они обозначают категорию инвентаря (cat), заблокированные категории (bcat) и контекст страницы/секции. Таксономия 2.0/3.0 заменила их числовыми ID, но легаси-коды до сих пор доминируют в живом трафике.',
          ],
        },
      },
    ],
  },
};

// ── helpers ──────────────────────────────────────────────────────────────
function isLanding(sectionPath) {
  return Object.prototype.hasOwnProperty.call(LANDINGS, sectionPath);
}

function landingPaths() {
  return Object.keys(LANDINGS);
}

// ── SSR rendering ──────────────────────────────────────────────────────────
function renderSection(sec, lang) {
  const h2 = escapeHtml(pick(sec.h2, lang));
  const paras = (pick(sec.body, lang) || []).map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  const items = pick(sec.list, lang);
  const list =
    Array.isArray(items) && items.length
      ? `<ul class="landing__list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
      : '';
  return `<section class="landing__block"><h2>${h2}</h2>${paras}${list}</section>`;
}

// Render the IAB Content Taxonomy tier-1 table + a client-filtered search box.
// Rows carry data-landing-row and the input data-landing-filter; the landing
// client module wires the filter (no-JS still gets the full, readable table).
function renderIabTable(lang) {
  const map = IAB_TAX[lang] || IAB_TAX.en;
  const en = IAB_TAX.en;
  const rows = IAB_TIER1.map((code) => {
    const label = escapeHtml(map[code] || en[code] || '');
    return `<tr data-landing-row><td><code>${escapeHtml(code)}</code></td><td>${label}</td></tr>`;
  }).join('');
  const ph = pick(
    { en: 'Filter categories…', uk: 'Фільтр категорій…', ru: 'Фильтр категорий…' },
    lang,
  );
  const thCode = pick({ en: 'Code', uk: 'Код', ru: 'Код' }, lang);
  const thCat = pick({ en: 'Category', uk: 'Категорія', ru: 'Категория' }, lang);
  return (
    `<section class="landing__block">` +
    `<input type="search" class="landing__filter" data-landing-filter placeholder="${escapeHtml(
      ph,
    )}" aria-label="${escapeHtml(ph)}" />` +
    `<table class="landing__table"><thead><tr><th>${escapeHtml(thCode)}</th><th>${escapeHtml(
      thCat,
    )}</th></tr></thead><tbody>${rows}</tbody></table></section>`
  );
}

/**
 * Render the landing body that replaces <main id="app-root">. Returns '' for an
 * unknown path so callers can guard with isLanding() and never inject empties.
 */
function renderLandingBody(sectionPath, lang) {
  const cfg = LANDINGS[sectionPath];
  if (!cfg) return '';
  const L = LANGS.includes(lang) ? lang : FALLBACK;

  const h1 = escapeHtml(pick(cfg.h1, L));
  const lede = escapeHtml(pick(cfg.lede, L));
  const blocks = (cfg.sections || []).map((s) => renderSection(s, L)).join('');
  const table = cfg.kind === 'iab-table' ? renderIabTable(L) : '';

  let cta = '';
  if (cfg.sample) {
    const href = `${localizedPath('/inspector', L)}?sample=${encodeURIComponent(cfg.sample)}`;
    cta = `<p class="landing__cta"><a class="landing__cta-btn" href="${escapeHtml(href)}">${escapeHtml(
      pick(cfg.cta, L),
    )} →</a></p>`;
  }

  const refs = (cfg.specLinks || [])
    .map(
      (s) =>
        `<li><a href="${escapeHtml(s.href)}" rel="nofollow noopener" target="_blank">${escapeHtml(
          s.label,
        )}</a></li>`,
    )
    .join('');
  const refsBlock = refs
    ? `<section class="landing__block landing__refs"><h2>${escapeHtml(
        pick({ en: 'Specification', uk: 'Специфікація', ru: 'Спецификация' }, L),
      )}</h2><ul class="landing__list">${refs}</ul></section>`
    : '';

  return (
    `<section class="landing"><header class="landing__hero"><h1>${h1}</h1>` +
    `<p class="landing__lede">${lede}</p>${cta}</header>` +
    blocks +
    table +
    refsBlock +
    `</section>`
  );
}

/**
 * Replace the shell's <main id="app-root"> with the rendered landing + inject
 * the landing stylesheet once. Mirrors seo.injectPostSsr. No-op for unknown
 * paths.
 */
function injectLanding(html, sectionPath, lang) {
  if (!isLanding(sectionPath)) return html;
  const body = renderLandingBody(sectionPath, lang);
  html = html.replace(
    /<main id="app-root">[\s\S]*?<\/main>/i,
    `<main id="app-root">${body}</main>`,
  );
  if (!/\/modules\/landing\/landing\.css/.test(html)) {
    html = html.replace(
      /<\/head>/i,
      `    <link rel="stylesheet" href="/modules/landing/landing.css" />\n  </head>`,
    );
  }
  return html;
}

module.exports = {
  LANDINGS,
  isLanding,
  landingPaths,
  renderLandingBody,
  injectLanding,
};
