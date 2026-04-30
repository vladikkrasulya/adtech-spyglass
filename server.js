'use strict';

/**
 * Spyglass v8 — OpenRTB inspector tuned for Kadam.net SSP/DSP.
 *
 *   POST /api/analyze   — { bidReq, bidRes } → { validation, diff }
 *   POST /api/proxy     — restricted SSRF-safe forwarder to a small allow-list
 *   GET  /              — static UI (public/index.html, public/spyglass.app.js,
 *                         public/design-system.css [bind-mounted from portal])
 *
 * Validator is Kadam-aware: subage* for push, ext.bsection/btags blocking,
 * site.ext.idzone, ISO-3166 alpha-3 country codes, ISO-639 alpha-2 language,
 * native asset structure, response bid shape, native adm parsing.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Partners, Samples } = require('./db');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── Validator ────────────────────────────────────────────────────────────────

function err(level, msg, p) { return { level, msg, path: p || '' }; }
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const ISO_3166_ALPHA3 = /^[A-Z]{3}$/; // device.geo.country
const ISO_639_ALPHA2  = /^[a-z]{2}(-[A-Z]{2})?$/; // device.language

function detectType(obj) {
  if (!isObj(obj)) return 'unknown';
  if (obj.id && Array.isArray(obj.imp)) return 'oRTB BidRequest';
  if (obj.id && Array.isArray(obj.seatbid)) return 'oRTB BidResponse';
  if (Array.isArray(obj) || (obj.result && obj.result.listing)) return 'Kadam Feed Response';
  if (obj.version && obj.items) return 'JSON Feed 1.1';
  return 'unknown';
}

function validateRequest(req) {
  const errors = [];
  let isPush = false;

  // Root structure
  if (!isStr(req.id))                   errors.push(err('danger',  'Немає id запиту. Без нього SSP не зможе сматчити свій лог зі ставкою — додай BidRequest.id (будь-який унікальний рядок).', 'id'));
  if (!Array.isArray(req.imp) || !req.imp.length)
                                        errors.push(err('danger',  'Порожній imp[]. Запит без жодного слота — це порожня аукціонна нота, біддер нічого не пропонуватиме. Додай хоча б один elemen у imp[].', 'imp'));
  if (!req.site && !req.app)            errors.push(err('danger',  'Не вказано ні site, ні app. Біддеру треба знати куди рендериться креатив (сайт чи мобільний застосунок) — інакше він не зможе таргетувати і відмовиться.', 'site/app'));

  if (req.at != null && req.at !== 1 && req.at !== 2)
                                        errors.push(err('warning', 'Тип аукціону at дивний — допустимо 1 (first-price, типово для CPC) або 2 (second-price, дефолт за специфікацією). Будь-що інше біддер не зрозуміє.', 'at'));

  // Device
  const dev = req.device || {};
  if (!isObj(req.device))               errors.push(err('danger',  'Немає блоку device. Без нього неможливо визначити пристрій користувача — Kadam відмовиться біддити.', 'device'));
  if (!dev.ip && !dev.ipv6)             errors.push(err('danger',  'У device немає ip і ipv6. Геотаргетинг та антифрод спираються саме на адресу — без неї ставки не буде.', 'device.ip'));
  if (!isStr(dev.ua))                   errors.push(err('danger',  'Немає device.ua (User-Agent). Для Kadam це критичний сигнал: визначення браузера/ОС/мобайл — без нього запит відсіюється.','device.ua'));
  if (dev.geo && dev.geo.country && !ISO_3166_ALPHA3.test(dev.geo.country))
                                        errors.push(err('warning', `Країна "${dev.geo.country}" не у форматі ISO-3166 alpha-3. Потрібно три літери великими: "UKR", "POL", "USA". Двобуквений ("UA") тут не підходить.`, 'device.geo.country'));
  if (dev.language && !ISO_639_ALPHA2.test(dev.language))
                                        errors.push(err('warning', `Мова "${dev.language}" не у форматі ISO-639 alpha-2. Очікується "uk", "en", або з регіоном "fa-IR". Невалідне значення зменшує викуп.`, 'device.language'));
  else if (!dev.language)               errors.push(err('info',    'device.language не задано. Не критично, але мова користувача — корисний сигнал для біддера, додавання підвищує викуп.', 'device.language'));

  // User
  if (req.user && req.user.gender && !['M', 'F', 'O'].includes(req.user.gender))
                                        errors.push(err('warning', `user.gender = "${req.user.gender}" — недопустиме. За специфікацією тільки M (чоловік), F (жінка) або O (інше). Інакше біддер ігнорує поле.`, 'user.gender'));

  // Site / App
  if (req.site && !isStr(req.site.domain))
                                        errors.push(err('warning', 'site.domain не вказано. Це доменна категоризація — без неї Kadam не зможе перевірити whitelist/blacklist і знизить ставку.', 'site.domain'));
  if (req.app && !isStr(req.app.bundle))
                                        errors.push(err('warning', 'app.bundle не вказано. Без bundle ID (наприклад "com.example.app") неможливо ідентифікувати застосунок — таргетинг по інвентарю не працює.', 'app.bundle'));

  // bcat
  if (req.bcat && !Array.isArray(req.bcat))
                                        errors.push(err('warning', 'bcat має бути масивом рядків з IAB-категоріями (наприклад ["IAB7-39","IAB25"]). Зараз — не масив, біддер ігнорує блокування.', 'bcat'));

  // Kadam-specific: ext.bsection / ext.btags
  const ext = req.ext || {};
  if (ext.bsection && !Array.isArray(ext.bsection))
                                        errors.push(err('warning', 'ext.bsection — Kadam-розширення для блокування секцій. Має бути масивом цілих чисел, інакше ігнорується і блок не діє.', 'ext.bsection'));
  if (ext.btags && !Array.isArray(ext.btags))
                                        errors.push(err('warning', 'ext.btags — Kadam-розширення для блокування тегів. Має бути масивом цілих чисел, інакше ігнорується і блок не діє.', 'ext.btags'));

  // Per-impression validation
  (req.imp || []).forEach((imp, i) => {
    const p = `imp[${i}]`;
    const human = `Слот #${i + 1}`;
    if (!isStr(imp.id))                 errors.push(err('danger',  `${human}: немає imp.id. Без id не вийде звʼязати ставку з конкретним слотом — біддер відсіє.`, `${p}.id`));
    if (imp.bidfloor != null && !isNum(imp.bidfloor))
                                        errors.push(err('warning', `${human}: bidfloor має бути числом (наприклад 0.05). Зараз — інший тип, аукціон буде проводитись без флора.`, `${p}.bidfloor`));

    const hasFormat = !!(imp.banner || imp.video || imp.native || imp.audio);
    if (!hasFormat)                     errors.push(err('danger',  `${human}: не вказано формат креативу. Треба хоча б один: banner, video, native або audio — інакше біддеру нічого пропонувати.`, p));

    if (imp.banner) {
      const b = imp.banner;
      const hasFormatArr = Array.isArray(b.format) && b.format.length > 0;
      if ((!isNum(b.w) || !isNum(b.h)) && !hasFormatArr)
                                        errors.push(err('danger',  `${human}: банер без розмірів. Вкажи w і h (наприклад 300×250) або масив format[{w,h},...] — без цього креатив нікуди вставити.`, `${p}.banner`));
    }
    if (imp.video) {
      if (!Array.isArray(imp.video.mimes) || !imp.video.mimes.length)
                                        errors.push(err('danger',  `${human}: відео без video.mimes. Перерахуй MIME-типи що приймає плеєр (наприклад ["video/mp4"]) — інакше біддер не знає чим відповідати.`, `${p}.video.mimes`));
      if (!Array.isArray(imp.video.protocols) || !imp.video.protocols.length)
                                        errors.push(err('warning', `${human}: бажано додати video.protocols — список версій VAST (наприклад [2,3,5,6]). Без цього біддер припускає найпоширеніший і може промахнутись.`, `${p}.video.protocols`));
    }
    if (imp.native) {
      try {
        const native = typeof imp.native.request === 'string'
          ? JSON.parse(imp.native.request)
          : imp.native.request;
        if (!isObj(native) || !isObj(native.native) || !Array.isArray(native.native.assets))
                                        errors.push(err('danger',  `${human}: native запит без assets[]. Native 1.1 вимагає список ассетів (title, image, data) — без них креатив зібрати неможливо.`, `${p}.native.request`));
        if (!imp.native.ver)             errors.push(err('warning', `${human}: не вказано native.ver. Рекомендується "1.1" або "1.2", щоб біддер знав яку версію специфікації використовувати.`,    `${p}.native.ver`));
      } catch (e)                        { errors.push(err('danger',  `${human}: native.request — не валідний JSON (${e.message}). Це поле має бути JSON-рядком зі структурою native, або вже розпарсеним обʼєктом.`, `${p}.native.request`)); }
    }

    // Push hint detection
    const impExt = imp.ext || {};
    const sitePush = (req.site && req.site.ext && req.site.ext.idzone) ? String(req.site.ext.idzone) : '';
    const isLikelyPush = !!(impExt.subage != null || impExt.subage0 != null || impExt.subage_dt || impExt.subage_ts ||
                            /push|sub/i.test(sitePush));
    if (isLikelyPush) {
      isPush = true;
      if (impExt.subage == null)        errors.push(err('warning', `${human}: для push-показу не вказано ext.subage (вік підписки в днях). Без нього Kadam трактує підписника як "невідомого" і знижує ставку — додай число.`, `${p}.ext.subage`));
    }
  });

  if (isPush) {
    errors.push(err('info', 'Це push-трафік. Щоб максимізувати викуп, заповни subage / subage0 / subage_dt — Kadam використовує їх для оцінки якості підписника.', 'imp.ext'));
  }

  return { type: 'oRTB BidRequest' + (isPush ? ' (push)' : ''), errors };
}

function validateResponse(res) {
  const errors = [];
  if (!isStr(res.id))                   errors.push(err('danger',  'У відповіді немає id. Має бути той самий, що й у BidRequest.id — інакше SSP не зможе сматчити пару запит/відповідь і відкине ставку.', 'id'));
  if (!Array.isArray(res.seatbid))      errors.push(err('danger',  'Немає seatbid[]. Це масив сідбідів — без нього у відповіді просто немає ставок.',         'seatbid'));
  (res.seatbid || []).forEach((sb, i) => {
    const sp = `seatbid[${i}]`;
    const sn = `сідбід #${i + 1}`;
    if (!Array.isArray(sb.bid) || !sb.bid.length)
                                        errors.push(err('danger',  `${sn}: порожній bid[]. Сідбід без жодної ставки — еквівалентно "no bid", біддеру немає сенсу його відсилати.`,     `${sp}.bid`));
    (sb.bid || []).forEach((b, j) => {
      const bp = `${sp}.bid[${j}]`;
      const bn = `${sn} → ставка #${j + 1}`;
      if (!isStr(b.id))                 errors.push(err('danger',  `${bn}: немає bid.id. Це унікальний ідентифікатор ставки, потрібен для звітів і дебагу — додай будь-який рядок.`,                         `${bp}.id`));
      if (!isStr(b.impid))              errors.push(err('danger',  `${bn}: немає bid.impid. Має посилатись на конкретний imp.id з запиту, інакше SSP не знає на який слот ця ставка.`, `${bp}.impid`));
      if (!isNum(b.price))              errors.push(err('danger',  `${bn}: немає або не число bid.price. Це сама ставка в CPM/CPC — без неї аукціон не зможе її врахувати.`,             `${bp}.price`));
      if (!isStr(b.adm) && !isStr(b.nurl))
                                        errors.push(err('warning', `${bn}: ні adm, ні nurl. Один з них обовʼязковий: adm — інлайн-креатив (HTML/VAST/Native JSON), nurl — URL за яким SSP підтягне креатив.`, `${bp}.adm`));
      // Macros — Kadam only supports these three
      const macroRe = /\$\{(\w+)\}/g;
      const seen = new Set();
      ['nurl', 'burl', 'lurl', 'adm'].forEach((k) => {
        const v = b[k];
        if (typeof v !== 'string') return;
        let m; while ((m = macroRe.exec(v))) seen.add(m[1]);
      });
      const SUPPORTED = new Set(['AUCTION_PRICE', 'AUCTION_CURRENCY', 'AUCTION_LOSS']);
      seen.forEach((macro) => {
        if (!SUPPORTED.has(macro))      errors.push(err('warning', `${bn}: макрос \${${macro}} не підставляється Kadam-ом. Підтримуються лише три: AUCTION_PRICE, AUCTION_CURRENCY, AUCTION_LOSS — інші залишаться літеральним рядком у креативі.`, bp));
      });
      if (!Array.isArray(b.adomain) || !b.adomain.length)
                                        errors.push(err('warning', `${bn}: немає adomain[]. Це список доменів рекламодавця — без нього SSP не може звірити з блокліст-доменами видавця і може забанити ставку.`, `${bp}.adomain`));
    });
  });
  return { type: 'oRTB BidResponse', errors };
}

function validateFeedResponse(arrOrObj) {
  const errors = [];
  // Clickunder: { result: { listing: [{url, bid}, ...] } }
  if (isObj(arrOrObj) && isObj(arrOrObj.result) && Array.isArray(arrOrObj.result.listing)) {
    arrOrObj.result.listing.forEach((row, i) => {
      const p = `result.listing[${i}]`;
      const n = `Кліклістинг #${i + 1}`;
      if (!isStr(row.url))               errors.push(err('danger',  `${n}: не вказано url. Це сама ціль кліку — без URL клікандер немає куди редіректити.`,                        `${p}.url`));
      if (!isNum(row.bid))               errors.push(err('danger',  `${n}: bid має бути числом (ставка за клік). Без нього аукціон не може врахувати пропозицію.`,               `${p}.bid`));
    });
    return { type: 'Kadam Feed Response (clickunder)', errors };
  }
  // Push: array of materials
  if (Array.isArray(arrOrObj)) {
    arrOrObj.forEach((m, i) => {
      const p = `[${i}]`;
      const n = `Push-матеріал #${i + 1}`;
      if (!isStr(m.id))                  errors.push(err('danger',  `${n}: немає id. Унікальний ідентифікатор матеріалу — використовується для звітів і dedup.`,                         `${p}.id`));
      if (!isStr(m.click_url) && !isStr(m.link))
                                         errors.push(err('danger',  `${n}: немає ні click_url, ні link. Куди веде клік — обовʼязкове поле, інакше показ безглуздий.`,          `${p}.click_url`));
      if (!isNum(m.cpc) && !isNum(m.price))
                                         errors.push(err('danger',  `${n}: немає cpc / price. Має бути ставка (число) за клік чи показ — без неї біддер не порахує економіку.`,         `${p}.cpc`));
      if (!isStr(m.title))               errors.push(err('warning', `${n}: бажано задати title — заголовок, що зʼявляється в push-нотифікації.`,                    `${p}.title`));
      if (!isStr(m.image_url))           errors.push(err('warning', `${n}: бажано додати image_url — велике зображення підвищує CTR push-показу.`,                `${p}.image_url`));
      if (!isStr(m.icon_url) && !isStr(m.nurl))
                                         errors.push(err('warning', `${n}: немає nurl (та не "зашитий" у icon_url) — win-нотіс не спрацює, статистика покази/виграші буде розсинхронована.`, `${p}.nurl`));
    });
    return { type: 'Kadam Feed Response (push)', errors };
  }
  return { type: 'unknown feed shape', errors: [err('danger', 'Не схоже ні на push (масив матеріалів), ні на клікандер ({result: {listing: [...]}}). Перевір формат — Kadam Feed має одну з цих двох структур.')] };
}

function validateORTB(obj) {
  if (!isObj(obj) && !Array.isArray(obj)) {
    return { type: 'unknown', status: 'Invalid', errors: [err('danger', 'Очікується JSON-обʼєкт або масив. Інші типи (рядок, число) не є валідним RTB-payload-ом.')] };
  }
  const t = detectType(obj);
  let errors = [];
  let resolvedType = t;

  if (t === 'oRTB BidRequest') {
    const v = validateRequest(obj);
    errors = v.errors;
    resolvedType = v.type;
  } else if (t === 'oRTB BidResponse') {
    const v = validateResponse(obj);
    errors = v.errors;
    resolvedType = v.type;
  } else if (t === 'Kadam Feed Response') {
    const v = validateFeedResponse(obj);
    errors = v.errors;
    resolvedType = v.type;
  } else if (t === 'JSON Feed 1.1') {
    return { type: 'JSON Feed 1.1', status: 'Valid', errors: [] };
  } else {
    errors = [err('danger', 'Не вдалося визначити тип payload-у. Очікується oRTB BidRequest (з imp[]), BidResponse (з seatbid[]) або Kadam Feed (push-масив чи клікандер з result.listing).')];
  }

  const hasDanger = errors.some((e) => e.level === 'danger');
  const status = hasDanger ? 'Critical' : (errors.length ? 'Healthy' : 'Healthy');
  return { type: resolvedType, status, errors };
}

// ── Crosscheck (semantic request ↔ response validation) ────────────────────
// Replaces the old deep-diff which compared incompatible shapes. Returns a
// list of structured findings: matches, mismatches, blocked-by-rule, etc.
//
// Each finding: { ok, level, msg, path, detail? }
//   ok=true → green check (everything aligned)
//   ok=false + level='warn' → soft mismatch (won't block, but worth knowing)
//   ok=false + level='crit' → hard mismatch (this bid would be filtered)

function pushOk(out, msg, p, detail)   { out.push({ ok: true,  level: 'ok',   msg, path: p || '', detail }); }
function pushWarn(out, msg, p, detail) { out.push({ ok: false, level: 'warn', msg, path: p || '', detail }); }
function pushCrit(out, msg, p, detail) { out.push({ ok: false, level: 'crit', msg, path: p || '', detail }); }

function crosscheck(req, res) {
  const out = [];
  if (!isObj(req) || !Array.isArray(req.imp)) {
    return [{ ok: false, level: 'crit', msg: 'Немає валідного BidRequest для звірки. Встав запит у ліве поле, щоб порівняти його з відповіддю.', path: 'req' }];
  }
  if (!isObj(res) || !Array.isArray(res.seatbid) || !res.seatbid.length) {
    return [{ ok: false, level: 'crit', msg: 'У відповіді немає seatbid[] або вона пуста — нема чого звіряти. Встав BidResponse з хоча б одним сідбідом.', path: 'res' }];
  }

  // 1. id match
  if (res.id === req.id)                          pushOk(out,  `id запиту і відповіді збігаються ("${req.id}") — SSP зможе сматчити пару.`, 'id');
  else                                            pushCrit(out, `id не збігається: запит "${req.id}", відповідь "${res.id}". SSP відкине ставку — id у відповіді має точно дублювати id запиту.`, 'id');

  // 2. currency match
  const reqCur = Array.isArray(req.cur) ? req.cur : ['USD'];
  if (res.cur && !reqCur.includes(res.cur))       pushWarn(out, `Валюта відповіді "${res.cur}" не входить у дозволені запитом ${JSON.stringify(reqCur)}. SSP може конвертувати або забанити — узгодь з cur у запиті.`, 'cur');
  else if (res.cur)                               pushOk(out,   `Валюта "${res.cur}" входить у дозволені запитом — порядок.`, 'cur');

  // Build imp-by-id index for O(1) lookups
  const impById = new Map();
  for (const imp of req.imp) if (imp && imp.id) impById.set(imp.id, imp);

  // Aggregate bids across all seatbids
  const bcat = Array.isArray(req.bcat) ? new Set(req.bcat) : new Set();
  const badv = Array.isArray(req.badv) ? new Set(req.badv) : new Set();
  let totalBids = 0;
  let bidsAboveFloor = 0;
  const winningByImp = new Map(); // impid → highest accepted price

  res.seatbid.forEach((sb, sbi) => {
    const bids = Array.isArray(sb.bid) ? sb.bid : [];
    bids.forEach((bid, bi) => {
      totalBids++;
      const bp = `seatbid[${sbi}].bid[${bi}]`;
      const bn = `Сідбід #${sbi + 1} → ставка #${bi + 1}`;

      // 3a. impid reference
      const imp = impById.get(bid.impid);
      if (!imp) {
        pushCrit(out, `${bn}: impid "${bid.impid}" не відповідає жодному imp.id у запиті — ставка посилається в нікуди, SSP її викине.`, `${bp}.impid`);
        return; // can't continue this bid's checks
      }
      pushOk(out, `${bn}: impid "${bid.impid}" звʼязався зі слотом imp.id "${imp.id}".`, `${bp}.impid`);

      // 3b. price vs floor
      const floor = Number(imp.bidfloor) || 0;
      const price = Number(bid.price) || 0;
      if (price >= floor) {
        bidsAboveFloor++;
        pushOk(out, `${bn}: ціна ${price.toFixed(4)} ≥ флор ${floor.toFixed(4)} — ставка проходить аукціон.`, `${bp}.price`);
        const cur = winningByImp.get(bid.impid) || 0;
        if (price > cur) winningByImp.set(bid.impid, price);
      } else {
        pushCrit(out, `${bn}: ціна ${price.toFixed(4)} нижча за флор ${floor.toFixed(4)} — ставка відсівається на рівні аукціону. Підніми price або знизь bidfloor у запиті.`, `${bp}.price`);
      }

      // 3c. blocked categories
      if (Array.isArray(bid.cat) && bcat.size) {
        const violated = bid.cat.filter((c) => bcat.has(c));
        if (violated.length) pushCrit(out, `${bn}: категорії ${JSON.stringify(violated)} є у блоклісті bcat запиту — креатив заборонений видавцем, ставка не пройде.`, `${bp}.cat`);
        else                 pushOk(out,   `${bn}: жодна з категорій bid.cat не у блоклісті bcat — порядок.`, `${bp}.cat`);
      }

      // 3d. blocked advertisers (rare on Kadam but spec'd in oRTB)
      if (Array.isArray(bid.adomain) && badv.size) {
        const violated = bid.adomain.filter((d) => badv.has(d));
        if (violated.length) pushCrit(out, `${bn}: домен рекламодавця ${JSON.stringify(violated)} є у блоклісті badv — видавець забанив цей бренд, ставка не пройде.`, `${bp}.adomain`);
      }

      // 3e. format crosscheck
      if (imp.banner && (bid.w || bid.h)) {
        const formatList = Array.isArray(imp.banner.format) ? imp.banner.format : [];
        const declared = (imp.banner.w && imp.banner.h) ? [{ w: imp.banner.w, h: imp.banner.h }] : [];
        const allSizes = [...declared, ...formatList];
        const fits = allSizes.some((f) => Number(f.w) === Number(bid.w) && Number(f.h) === Number(bid.h));
        if (allSizes.length && !fits)              pushWarn(out, `${bn}: розмір креативу ${bid.w}×${bid.h} не співпадає з жодним з допустимих (${allSizes.map((f) => `${f.w}×${f.h}`).join(', ')}). Креатив може обрізатись або не вставитись у плейсмент.`, `${bp}.size`);
        else if (allSizes.length)                  pushOk(out,   `${bn}: розмір креативу ${bid.w}×${bid.h} підходить під слот.`, `${bp}.size`);
      }

      // 3f. native asset crossmatch (the most common Native bug)
      if (imp.native && bid.adm) {
        const cm = nativeAssetCrosscheck(imp.native, bid.adm);
        if (cm.error) pushWarn(out, `${bn}: ${cm.error}`, `${bp}.adm`);
        else {
          if (cm.missing.length) pushCrit(out, `${bn}: у native-відповіді не вистачає обовʼязкових ассетів (id: ${cm.missing.join(', ')}). Без них SSP не зможе зібрати креатив — додай ці поля у adm.native.assets[].`, `${bp}.adm`, cm);
          else                   pushOk(out,   `${bn}: усі ${cm.requiredIds.length} обовʼязкових native-ассетів на місці.`, `${bp}.adm`, cm);
          if (cm.extra.length)   pushWarn(out, `${bn}: у native-відповіді є несподівані ассети (id: ${cm.extra.join(', ')}). Запит їх не вимагав — SSP їх ігноруватиме, але це маркер невідповідності темплейтів.`, `${bp}.adm`, cm);
        }
      }

      // 3g. video adm should be VAST
      if (imp.video && bid.adm) {
        const isVast = /^\s*<\?xml|<VAST/i.test(String(bid.adm).trim());
        if (!isVast)                               pushWarn(out, `${bn}: слот відеоформату, але adm не схожий на VAST XML. Плеєр не зможе відрендерити цей креатив — у відео-відповіді має бути <VAST>...</VAST>.`, `${bp}.adm`);
        else                                       pushOk(out,   `${bn}: adm — валідний VAST XML для відео-слоту.`, `${bp}.adm`);
      }
    });
  });

  // 4. Auction summary
  const impsTotal = req.imp.length;
  const impsFilled = winningByImp.size;
  const topPrice = Math.max(0, ...winningByImp.values()).toFixed(4);
  pushOk(out, `Підсумок аукціону: ${totalBids} ставок · ${bidsAboveFloor} над флором · ${impsFilled} з ${impsTotal} слотів заповнено · найвища ціна ${topPrice}.`, 'auction');

  return out;
}

// Compares request native asset IDs against response native assets in adm.
function nativeAssetCrosscheck(impNative, adm) {
  // Parse request's native spec
  let nativeReq;
  try {
    nativeReq = typeof impNative.request === 'string' ? JSON.parse(impNative.request) : impNative.request;
  } catch { return { error: 'imp.native.request — не валідний JSON. Це поле має бути JSON-рядком зі специфікацією native-слоту.' }; }
  const requestedAssets = (nativeReq && nativeReq.native && Array.isArray(nativeReq.native.assets)) ? nativeReq.native.assets : [];
  const requiredIds = requestedAssets.filter((a) => a && a.required === 1 && a.id != null).map((a) => Number(a.id));
  const allRequestIds = requestedAssets.filter((a) => a && a.id != null).map((a) => Number(a.id));

  // Parse response's native adm
  let nativeRes;
  try {
    nativeRes = typeof adm === 'string' ? JSON.parse(adm) : adm;
  } catch { return { error: 'bid.adm — не валідний JSON для native-відповіді. Очікується {"native":{"assets":[...],"link":...}}.' }; }
  const responseAssets = (nativeRes && nativeRes.native && Array.isArray(nativeRes.native.assets)) ? nativeRes.native.assets : [];
  const providedIds = responseAssets.filter((a) => a && a.id != null).map((a) => Number(a.id));

  const provided = new Set(providedIds);
  const missing = requiredIds.filter((id) => !provided.has(id));
  const allReq = new Set(allRequestIds);
  const extra = providedIds.filter((id) => !allReq.has(id));

  return { requiredIds, providedIds, missing, extra };
}

// ── Static file serving ─────────────────────────────────────────────────────

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain',
};

function serveStaticFile(req, res) {
  const rawUrl = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const sanitized = decodeURIComponent(rawUrl).replace(/\\/g, '/');
  const normalized = path.normalize(sanitized).replace(/^(\.\.(\/|\\))+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  const resolved = path.resolve(filePath);

  // Path-traversal guard
  if (resolved.indexOf(path.resolve(PUBLIC_DIR)) !== 0) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ct = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-cache' });
    res.end(content);
  });
}

// ── Proxy (test harness, allow-listed) ──────────────────────────────────────

function handleProxy(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      const { url, data } = JSON.parse(body);
      const targetUrl = new URL(url);
      const ALLOWED_HOSTS = ['httpbin.org', 'postman-echo.com', 'webhook.site'];
      const hostname = targetUrl.hostname;
      const isAllowed = ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));
      if (!isAllowed) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'Host not allowed. Proxy is restricted to public test endpoints only.' })); return;
      }
      const client = targetUrl.protocol === 'https:' ? https : http;
      const proxyReq = client.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (proxyRes) => {
        let resData = '';
        proxyRes.on('data', (d) => { resData += d; });
        proxyRes.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: proxyRes.statusCode, data: resData }));
        });
      });
      proxyReq.on('error', (e) => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
      proxyReq.write(JSON.stringify(data));
      proxyReq.end();
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ── /api/analyze: validate request + response, diff them ───────────────────

function handleAnalyze(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      const { bidReq, bidRes } = JSON.parse(body);
      // Validate request — primary signal in the panel.
      const validation = validateORTB(bidReq || {});
      // Bonus: validate response if provided, append its issues to the same list.
      if (bidRes && Object.keys(bidRes).length) {
        const resValidation = validateORTB(bidRes);
        if (resValidation.errors && resValidation.errors.length) {
          validation.errors = validation.errors.concat(
            resValidation.errors.map((e) => ({ ...e, msg: '[response] ' + e.msg }))
          );
          if (resValidation.status === 'Critical' && validation.status !== 'Critical') {
            validation.status = 'Critical';
          }
        }
      }
      // Semantic crosscheck: matters only when both sides are present.
      const cross = (bidReq && bidRes && Object.keys(bidRes).length)
        ? crosscheck(bidReq, bidRes)
        : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, validation, crosscheck: cross }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ── DB-backed CRUD: partners + samples ──────────────────────────────────────

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function handleApi(req, res, parsed) {
  const { pathname, searchParams } = parsed;
  const method = req.method;

  // ── partners ────────────────────────────────────────────────────────────
  if (pathname === '/api/partners' && method === 'GET') {
    return sendJson(res, 200, { success: true, partners: Partners.list() });
  }
  if (pathname === '/api/partners' && method === 'POST') {
    return readJson(req).then((b) => {
      if (!b.name || !String(b.name).trim()) return sendJson(res, 400, { success: false, error: 'name required' });
      const p = Partners.create(b);
      sendJson(res, 200, { success: true, partner: p });
    }).catch((e) => sendJson(res, 400, { success: false, error: e.message }));
  }
  let m = pathname.match(/^\/api\/partners\/(\d+)$/);
  if (m && method === 'PATCH') {
    const id = Number(m[1]);
    return readJson(req).then((b) => {
      const p = Partners.update(id, b);
      if (!p) return sendJson(res, 404, { success: false, error: 'not found' });
      sendJson(res, 200, { success: true, partner: p });
    }).catch((e) => sendJson(res, 400, { success: false, error: e.message }));
  }
  if (m && method === 'DELETE') {
    const ok = Partners.delete(Number(m[1]));
    return sendJson(res, ok ? 200 : 404, { success: ok });
  }

  // ── samples ─────────────────────────────────────────────────────────────
  if (pathname === '/api/samples' && method === 'GET') {
    const pid = searchParams.get('partner_id');
    let partnerId;
    if (pid === 'unassigned') partnerId = 'unassigned';
    else if (pid != null && pid !== '') partnerId = Number(pid);
    return sendJson(res, 200, { success: true, samples: Samples.list({ partnerId }) });
  }
  if (pathname === '/api/samples' && method === 'POST') {
    return readJson(req).then((b) => {
      if (!b.title || !String(b.title).trim()) return sendJson(res, 400, { success: false, error: 'title required' });
      const s = Samples.create(b);
      sendJson(res, 200, { success: true, sample: s });
    }).catch((e) => sendJson(res, 400, { success: false, error: e.message }));
  }
  m = pathname.match(/^\/api\/samples\/(\d+)$/);
  if (m && method === 'GET') {
    const s = Samples.get(Number(m[1]));
    if (!s) return sendJson(res, 404, { success: false, error: 'not found' });
    return sendJson(res, 200, { success: true, sample: s });
  }
  if (m && method === 'PATCH') {
    const id = Number(m[1]);
    return readJson(req).then((b) => {
      const s = Samples.update(id, b);
      if (!s) return sendJson(res, 404, { success: false, error: 'not found' });
      sendJson(res, 200, { success: true, sample: s });
    }).catch((e) => sendJson(res, 400, { success: false, error: e.message }));
  }
  if (m && method === 'DELETE') {
    const ok = Samples.delete(Number(m[1]));
    return sendJson(res, ok ? 200 : 404, { success: ok });
  }

  return false;
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;

  if (pathname === '/api/analyze' && req.method === 'POST') return handleAnalyze(req, res);
  if (pathname === '/api/proxy'   && req.method === 'POST') return handleProxy(req, res);
  if (pathname.startsWith('/api/partners') || pathname.startsWith('/api/samples')) {
    if (handleApi(req, res, parsed) !== false) return;
    return sendJson(res, 405, { success: false, error: 'method not allowed' });
  }
  serveStaticFile(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Spyglass v8 backend running at http://0.0.0.0:' + PORT);
});
