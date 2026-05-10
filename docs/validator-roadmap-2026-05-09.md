# Validator roadmap — pending after audit follow-up (2026-05-09)

Чотири пункти лишилися з аудиту валідатора. Цей документ — план як їх
закрити. Кожен пункт — самодостатній наряд: можна брати в довільному
порядку. Рекомендований порядок зверху вниз (від найдешевшого до
найбільшого; кожен наступний бажано після попереднього, бо вони
будують один на одному).

---

## ① API stability — sort + dedup + disabledRules ~ **3-4 години**

**Чому першим:** фундамент для всього іншого. Зараз findings віддаються
в порядку обходу коду; CI-консумери будуть сортувати самі. Дедуплу
немає (50 imps без id = 50 однакових findings). Немає способу
відключити правило per-call. Будь-який зовнішній консумер (GitHub
Action, дашборд, інтеграція) попросить це в перший день.

### Що міняти

**`packages/core/findings.js`** — додати дві утиліти:

```js
// Stable severity-first sort. Severity descending (errors first), then
// path ascending (lexicographic), then id ascending. Idempotent.
function sortFindings(findings) {
  const SEV = { error: 0, warning: 1, info: 2 };
  return findings.slice().sort((a, b) => {
    const sa = SEV[a.level] ?? 99;
    const sb = SEV[b.level] ?? 99;
    if (sa !== sb) return sa - sb;
    const pa = a.path || '';
    const pb = b.path || '';
    if (pa !== pb) return pa < pb ? -1 : 1;
    return (a.id || '').localeCompare(b.id || '');
  });
}

// Collapse repeats of the same (id, path) into one finding with `count`
// param. The first occurrence wins for params/msg.
function dedupFindings(findings) {
  const seen = new Map();
  const out = [];
  for (const f of findings) {
    const key = (f.id || '') + '\0' + (f.path || '');
    if (seen.has(key)) {
      const idx = seen.get(key);
      out[idx].params = { ...out[idx].params, count: (out[idx].params?.count || 1) + 1 };
    } else {
      seen.set(key, out.length);
      out.push({ ...f, params: { ...f.params, count: 1 } });
    }
  }
  return out;
}

module.exports = { ..., sortFindings, dedupFindings };
```

**`packages/core/index.js`** — застосувати в кінці `validate()`:

```js
function validate(payload, opts) {
  // ... existing detection + dispatch ...
  let findings =
    type === 'request' ? validateRequest(payload, ctx) : validateResponse(payload, ctx);

  // NEW: filter by disabledRules. Accepts exact ids or '*' suffix prefix
  // patterns: ['imp.*'] disables every imp.* rule.
  if (Array.isArray(opts?.disabledRules) && opts.disabledRules.length) {
    const exact = new Set(opts.disabledRules.filter((r) => !r.endsWith('*')));
    const prefixes = opts.disabledRules.filter((r) => r.endsWith('*')).map((r) => r.slice(0, -1));
    findings = findings.filter((f) => {
      if (exact.has(f.id)) return false;
      if (prefixes.some((p) => f.id.startsWith(p))) return false;
      return true;
    });
  }

  // NEW: dedup + sort. Order: dedup THEN sort (dedup uses original order
  // for "first occurrence wins"). Both deterministic.
  findings = dedupFindings(findings);
  findings = sortFindings(findings);

  // ... existing return ...
}
```

**`packages/core/crosscheck.js`** — застосувати ті самі утиліти в `crosscheck()`.

### Тести

Додати 3-4 коротких unit-тести в `packages/core/test/api-stability.test.js`
(якщо тестового файлу нема — створити):

1. `validate(req, { disabledRules: ['imp.bidfloorcur_missing'] })` — ніколи не повертає це id
2. `validate(req, { disabledRules: ['regs.*'] })` — нічого з regs.\*
3. Findings масив `[error, warning, error]` після sort = `[error, error, warning]`
4. Findings з трьома `{id:'x', path:'p'}` колапсяться в один з `count: 3`

### Документація

Оновити `packages/core/README.md`:

- Додати секцію "API stability contract"
- Описати порядок (severity DESC → path ASC → id ASC)
- Описати dedup (`count` param появляється)
- Описати `disabledRules: string[]`

### SemVer

Це **MINOR bump** (0.10.0 → 0.11.0): нова опція, нові гарантії контракту,
без break'у. App: 1.9.0 → 1.10.0, public v9.9.0 → v9.10.0.

### Відкрите питання (потребує твого рішення)

- Чи треба `severity_overrides: { 'imp.bidfloorcur_missing': 'info' }`?
  → ВІДКЛАСТИ. Спершу `disabledRules`, потім якщо CI-юзери попросять — додамо.

---

## ② Tier 1 hot keyword + hot_score column — **2 години**

**Чому другим:** дешевий window dressing, narrow impact, але прибирає
два дрібних артефакти що бачить агент при кожному аудиті.

### Що міняти

**(a) Tier 1 keyword scan тепер дивиться title + summary**

Зараз: `Mozok RSS Tick` workflow → нода "Poll feeds + notify hot" → код
викликає `classifyHot(item.title)`.

Місцезнаходження: n8n DB, `workflow_entity` row для `mozokrsstick00`.

Зміна (один рядок):

```diff
- if (classifyHot(title)) item.hot = true;
+ const haystack = title + ' ' + (item.summary || item.content || '').slice(0, 800);
+ if (classifyHot(haystack)) item.hot = true;
```

Чому 800: keyword scan коштує O(n×k) — обмежимо вхід, не сканувати
весь длинний матеріал. 800 chars покриває lede більшості новин.

Як патчити: скрипт типу `/tmp/patch-tier1-hot.py` (за патерном
existing patches we've used today).

**(b) `hot_score` column — drop**

Зараз: `items.hot_score REAL NOT NULL DEFAULT 0`. Завжди 0. Тиха технічна
рожа.

Рішення: **drop column**.

```sql
-- Postgres migration: simpler is better, hot_score never carried info
ALTER TABLE items DROP COLUMN hot_score;
```

Перевірити перед drop:

```bash
docker exec postgres psql -U postgres -d news -c \
  "SELECT count(*) FROM items WHERE hot_score != 0;"
# Має бути 0
```

Update CH replication script (`/srv/DATA/Stacks/clickhouse/scripts/replicate-news.sh`):

- `hot_score` НЕ йде в SELECT (він і не йшов раніше — там `hot_score_llm`)
- Підтвердити що `analytics.news_events` теж не має цієї колонки (немає)

Update будь-які SQL queries в:

- `Mozok News Daily Digest` workflow
- Portal `services/news.js`, `services/digest.js`, `services/goodNews.js`
- Spyglass admin stats? (ні, це інша БД)

Пошуковий рядок: `grep -rn 'hot_score[^_]' /srv/DATA/Stacks/`

### Тести

Після drop:

```bash
docker exec postgres psql -U postgres -d news -c "\d items" | grep hot_score
# Має бути порожньо
```

Запустити `Mozok RSS Tick` вручну — переконатись що INSERT не падає
(він не використовував `hot_score`, але всяке буває).

### SemVer

Це **PATCH** для портала (1.x.y → 1.x.y+1). Spyglass не зачіпається.

---

## ③ VAST validation — **1-2 дні**

**Чому третім:** найбільший impact на product differentiation. Spyglass
позиціонується як oRTB-валідатор; video creative — це VAST XML, і
ми НЕ перевіряємо нічого крім факту "це VAST" чи ні. Кожен серйозний
SSP має VAST-validator; це базовий feature який зараз відсутній.

### Що це таке

VAST (Video Ad Serving Template) — XML-стандарт IAB для відео-реклами.
Поточна версія: VAST 4.2 (2023). Production трафік: ~70% VAST 4.x,
~30% 3.x, decreasing 2.x.

VAST йде в `bid.adm` як рядок XML, починається з `<?xml` або `<VAST`.

### Архітектура

**Новий файл:** `packages/core/rules-vast.js`

```js
'use strict';

/**
 * VAST 2.x/3.x/4.x validation rules. Pure spec, no vendor dialects.
 * Triggered from rules-response when bid.adm matches the VAST sniff
 * (^\s*<\?xml or ^\s*<VAST).
 *
 * IAB VAST 4.2 spec:
 *   https://iabtechlab.com/wp-content/uploads/2022/09/VAST_4.2_Final_June-2019.pdf
 */

const { LEVELS, makeFinding } = require('./findings');
const F = makeFinding;

// Lightweight regex-based scanner. We deliberately avoid pulling in
// xmldom (heavy dep) — VAST patterns are well-defined and a focused
// scanner gets us 95% of value at 5% of cost. Production-grade
// validation can come later if user demand justifies the cost.

function isVastShape(adm) {
  if (typeof adm !== 'string') return false;
  return /^\s*(<\?xml|<VAST)/i.test(adm);
}

function detectVastVersion(adm) {
  const m = adm.match(/<VAST[^>]*\sversion=["'](\d+(?:\.\d+)?)["']/i);
  return m ? m[1] : null;
}

function countTagOccurrences(adm, tagName) {
  const re = new RegExp(`<${tagName}\\b`, 'gi');
  return (adm.match(re) || []).length;
}

function hasTag(adm, tagName) {
  return new RegExp(`<${tagName}\\b`, 'i').test(adm);
}

function getAllAttributes(adm, tagName, attr) {
  const re = new RegExp(`<${tagName}\\b[^>]*\\s${attr}=["']([^"']+)["']`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(adm)) !== null) out.push(m[1]);
  return out;
}

function validateVast(adm, path) {
  const findings = [];

  // R1. Version present + supported
  const ver = detectVastVersion(adm);
  if (!ver) {
    findings.push(F('vast.version_missing', LEVELS.ERROR, path));
  } else if (!/^[234](\.\d+)?$/.test(ver)) {
    findings.push(F('vast.version_unknown', LEVELS.WARNING, path, { ver }));
  }

  // R2. <Ad> count — exactly one Ad per VAST is the common case;
  //     ad pods (multiple <Ad>) are valid but worth surfacing as INFO.
  const adCount = countTagOccurrences(adm, 'Ad');
  if (adCount === 0) {
    findings.push(F('vast.ad_missing', LEVELS.ERROR, path));
  } else if (adCount > 1) {
    findings.push(F('vast.ad_pod', LEVELS.INFO, path, { count: adCount }));
  }

  // R3. InLine vs Wrapper — exactly one of the two is required per Ad.
  const hasInLine = hasTag(adm, 'InLine');
  const hasWrapper = hasTag(adm, 'Wrapper');
  if (!hasInLine && !hasWrapper) {
    findings.push(F('vast.inline_or_wrapper_required', LEVELS.ERROR, path));
  }

  // R4. AdSystem + AdTitle required in InLine
  if (hasInLine) {
    if (!hasTag(adm, 'AdSystem')) {
      findings.push(F('vast.adsystem_missing', LEVELS.ERROR, path));
    }
    if (!hasTag(adm, 'AdTitle')) {
      findings.push(F('vast.adtitle_missing', LEVELS.ERROR, path));
    }
  }

  // R5. Wrapper depth — VAST 4.x recommends ≤5. We can only see
  //     local depth (one wrapper per file); deeper chain is per-server
  //     traversal which is out of static scan scope. Surface VASTAdTagURI.
  if (hasWrapper && !hasTag(adm, 'VASTAdTagURI')) {
    findings.push(F('vast.wrapper_no_tag_uri', LEVELS.ERROR, path));
  }

  // R6. MediaFile / MediaFiles — InLine MUST have at least one MediaFile.
  if (hasInLine && !hasTag(adm, 'MediaFile')) {
    findings.push(F('vast.mediafile_missing', LEVELS.ERROR, path));
  }

  // R7. Insecure URLs in MediaFile / VASTAdTagURI / ClickThrough
  const TARGET_TAGS = ['MediaFile', 'VASTAdTagURI', 'ClickThrough', 'ClickTracking', 'Impression'];
  for (const tag of TARGET_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
    let m;
    while ((m = re.exec(adm)) !== null) {
      const url = (m[1] || '').trim();
      if (/^http:\/\//i.test(url)) {
        findings.push(
          F('vast.insecure_url', LEVELS.WARNING, path, { tag, url: url.slice(0, 100) }),
        );
      }
    }
  }

  // R8. Tracking events — InLine should have <Impression> at minimum.
  if (hasInLine && !hasTag(adm, 'Impression')) {
    findings.push(F('vast.impression_tracking_missing', LEVELS.WARNING, path));
  }

  // R9. VPAID — deprecated in VAST 4.1+, removed in 4.2. Flag.
  if (/<MediaFile\b[^>]*\sapiFramework=["']VPAID["']/i.test(adm)) {
    findings.push(F('vast.vpaid_deprecated', LEVELS.WARNING, path));
  }

  // R10. Linear must have Duration
  if (hasTag(adm, 'Linear') && !hasTag(adm, 'Duration')) {
    findings.push(F('vast.linear_duration_missing', LEVELS.ERROR, path));
  }

  return findings;
}

module.exports = { validateVast, isVastShape, detectVastVersion };
```

### Інтеграція в `rules-response.js`

```js
const { validateVast, isVastShape } = require('./rules-vast');

// In the per-bid loop, after the static scan:
if (isStr(b.adm) && isVastShape(b.adm)) {
  findings.push(
    ...validateVast(b.adm, `${bp}.adm`).map((f) => ({
      ...f,
      params: { sNum, bNum, ...f.params },
    })),
  );
}
```

### Нові message keys (10 правил × 3 локалі = 30 нових ключів)

`packages/core/messages/{en,uk,ru}.json` — додати з посиланням на VAST 4.2 spec:

```
vast.version_missing
vast.version_unknown
vast.ad_missing
vast.ad_pod
vast.inline_or_wrapper_required
vast.adsystem_missing
vast.adtitle_missing
vast.wrapper_no_tag_uri
vast.mediafile_missing
vast.insecure_url
vast.impression_tracking_missing
vast.vpaid_deprecated
vast.linear_duration_missing
```

`packages/core/spec-refs.json` — додати посилання на VAST 4.2 розділи.

### Тести

Створити 5-7 synthetic VAST samples в `samples/`:

- `synthetic-vast-clean.xml` — нормальний 4.2 InLine з MediaFile, ClickThrough, Impression
- `synthetic-vast-no-version.xml` — без `version=` атрибута
- `synthetic-vast-wrapper.xml` — Wrapper з VASTAdTagURI
- `synthetic-vast-no-mediafile.xml` — InLine без MediaFile (ERROR)
- `synthetic-vast-insecure-urls.xml` — http:// в MediaFile + ClickThrough (WARN)
- `synthetic-vast-vpaid.xml` — apiFramework="VPAID" (WARN — deprecated)
- `synthetic-vast-ad-pod.xml` — 3 <Ad> елементи (INFO)

Кожен — обгорнути в BidResponse-shape для тесту:
`{ id:..., seatbid:[{seat:..., bid:[{id:..., impid:'1', price:1.5, adomain:[...], adm: VAST_XML }]}]}`.

Розширити `synthetic-generator.js` щоб corpus включав VAST samples
(тоді 🎲 example menu автоматично їх покаже).

### UI ‑ dropdown

Додати в `template.{en,uk,ru}.html` (3 локалі) під "control" блок ще одну
секцію "video formats":

```html
<span class="menu-label">video</span>
<button data-action="load-demo" data-type="vast-clean">📺 VAST clean</button>
<button data-action="load-demo" data-type="vast-vpaid">📺 VAST VPAID (deprecated)</button>
<button data-action="load-demo" data-type="vast-insecure">📺 VAST insecure URLs</button>
```

### SemVer

**MINOR bump** (нова велика capability): core 0.11.0 → 0.12.0, app 1.10.0 → 1.11.0.

### Відкрите питання

- VAST 4.2 OMID (Open Measurement Interface Definition) — окремий
  стандарт, важливий для viewability. Чи додаємо? → ВІДКЛАСТИ. Сьогодні
  валідатор спершу має базові правила; OMID — окремий sprint.
- DAAST (Digital Audio Ad Serving Template) — той самий API що VAST,
  але для аудіо. → Якщо вже робимо VAST, доєднання DAAST = +2 години
  (та сама XML-структура, тільки інший top-level tag).

### Часовий бюджет

- Day 1 (5h): rules-vast.js + 13 message keys × 3 локалі + spec-refs
- Day 2 (4h): 5-7 synthetic VAST samples + UI dropdown items + tests
- - SemVer + CHANGELOG

---

## ④ oRTB 3.0 routing — **1 день**

**Чому останнім:** менший impact (більшість прод-трафіку це 2.x);
3.0 deeper validation потребує AdCOM знання якого зараз нема в кодовій
базі. Робимо МІНІМАЛЬНУ життєздатну імплементацію — детект + базовий
shape check + INFO finding "глибока 3.0 валідація обмежена".

### Що це таке

oRTB 3.0 (2018) — переробка протоколу від 2.x. Ключові зміни:

| 2.x                              | 3.0                                      |
| -------------------------------- | ---------------------------------------- |
| `{id, imp[], site, device, ...}` | `{openrtb: {ver:"3.0", request: {...}}}` |
| `imp` (impression)               | `item`                                   |
| `site/app` flat                  | `context: {site/app/...}`                |
| `regs` flat                      | `context.regs`                           |
| `device` flat                    | `context.device`                         |
| Banner/Video/Native inline       | AdCOM placement spec separate            |

Сьогодні Spyglass `index.js` route'ить 3.0 через звичайний
`validateRequest` — який припускає 2.x shape — і нічого корисного не
повертає. Треба окрему гілку.

### Архітектура

**Новий файл:** `packages/core/rules-request-30.js` (мінімальна версія):

```js
'use strict';

const { isObj, isStr, isNum } = require('./helpers');
const { LEVELS, makeFinding } = require('./findings');
const F = makeFinding;

/**
 * oRTB 3.0 BidRequest validation — MINIMAL shape check.
 *
 * Full AdCOM 1.0 + oRTB 3.0 deep validation is a separate sprint
 * (see docs/validator-roadmap-2026-05-09.md §④). This file emits
 * structural findings only: envelope shape, version match, presence
 * of required top-level fields. Returns an INFO finding noting that
 * deeper validation is limited; users with deep 3.0 traffic can
 * upgrade by demand.
 */
function validateRequest30(payload) {
  const findings = [];

  if (!isObj(payload.openrtb)) {
    findings.push(F('request.30.envelope_missing', LEVELS.ERROR, 'openrtb'));
    return findings;
  }
  const env = payload.openrtb;

  // ver field — required, '3.0' for now
  if (!isStr(env.ver) || !/^3\.\d+$/.test(env.ver)) {
    findings.push(F('request.30.ver_invalid', LEVELS.ERROR, 'openrtb.ver', { ver: env.ver }));
  }

  if (!isObj(env.request)) {
    findings.push(F('request.30.request_missing', LEVELS.ERROR, 'openrtb.request'));
    return findings;
  }
  const req = env.request;

  if (!isStr(req.id)) {
    findings.push(F('request.30.id_required', LEVELS.ERROR, 'openrtb.request.id'));
  }
  if (!Array.isArray(req.item) || !req.item.length) {
    findings.push(F('request.30.item_required', LEVELS.ERROR, 'openrtb.request.item'));
  }
  if (!isObj(req.context)) {
    findings.push(F('request.30.context_required', LEVELS.WARNING, 'openrtb.request.context'));
  }

  // Validate each item briefly
  (req.item || []).forEach((it, i) => {
    const ip = `openrtb.request.item[${i}]`;
    const num = i + 1;
    if (!isStr(it.id)) {
      findings.push(F('request.30.item.id_required', LEVELS.ERROR, `${ip}.id`, { num }));
    }
    if (!isNum(it.qty)) {
      findings.push(F('request.30.item.qty_required', LEVELS.WARNING, `${ip}.qty`, { num }));
    }
    if (!isObj(it.spec)) {
      findings.push(F('request.30.item.spec_required', LEVELS.WARNING, `${ip}.spec`, { num }));
    }
  });

  // Always emit the partial-validation note so users aren't surprised
  // by a thin findings list.
  findings.push(F('request.30.deep_validation_limited', LEVELS.INFO, 'openrtb'));

  return findings;
}

module.exports = { validateRequest30 };
```

### Подібний `rules-response-30.js` (структурно ж):

```js
function validateResponse30(payload) {
  // Check openrtb.response envelope, response.bidid, response.seatbid[]
  // structurally. Same partial-validation INFO note.
}
```

### Інтеграція в `index.js`

```js
const { validateRequest30 } = require('./rules-request-30');
const { validateResponse30 } = require('./rules-response-30');

function validate(payload, opts) {
  const det = detectVersion(payload);
  const ver = det.version;
  // ... existing dispatch ...

  if (ver === '3.0') {
    if (det.payloadType === 'request') return { findings: validateRequest30(payload), ... };
    if (det.payloadType === 'response') return { findings: validateResponse30(payload), ... };
  }
  // ... fall through to 2.x ...
}
```

### Detection improvement в `detect.js`

Додати до `detectVersion()` правило: якщо `payload.openrtb && payload.openrtb.ver` починається з '3' — це 3.0 з high confidence.

### Нові message keys (~10 ключів × 3 локалі = 30)

```
request.30.envelope_missing
request.30.ver_invalid
request.30.request_missing
request.30.id_required
request.30.item_required
request.30.context_required
request.30.item.id_required
request.30.item.qty_required
request.30.item.spec_required
request.30.deep_validation_limited
response.30.envelope_missing
response.30.bidid_required
response.30.seatbid_or_nbr_required
response.30.deep_validation_limited
```

### Тести

Створити 2-3 synthetic 3.0 samples:

- `synthetic-30-clean-request.json` — валідна 3.0 структура
- `synthetic-30-broken-envelope.json` — без `openrtb.ver`
- `synthetic-30-empty-items.json` — `item: []`

### UI dropdown

Додати в example menu:

```html
<span class="menu-label">oRTB 3.0</span>
<button data-action="load-demo" data-type="30-clean-request">🆕 3.0 clean</button>
<button data-action="load-demo" data-type="30-broken-envelope">🆕 3.0 broken envelope</button>
```

### SemVer

**MINOR bump** (нова версія підтримана): core 0.12.0 → 0.13.0, app 1.11.0 → 1.12.0.

### Відкрите питання

- Глибока AdCOM 1.0 валідація (item.spec.placement, etc.) — ВІДКЛАСТИ.
  Сьогодні: detect + envelope + INFO note. Якщо хтось дасть реальний
  3.0 traffic для аналізу — тоді deep dive.

### Часовий бюджет

1 день (8h): rules-request-30.js + rules-response-30.js + detection + 14 message keys × 3 локалі + 3 synthetic samples + UI hooks + tests + CHANGELOG.

---

## Загальна послідовність + бюджет

| #   | Що                          | Час     | SemVer impact                  |
| --- | --------------------------- | ------- | ------------------------------ |
| 1   | API stability               | 3-4 год | core 0.10→0.11 / app 1.9→1.10  |
| 2   | Tier 1 hot + drop hot_score | 2 год   | portal patch                   |
| 3   | VAST validation             | 1-2 дні | core 0.11→0.12 / app 1.10→1.11 |
| 4   | oRTB 3.0 routing            | 1 день  | core 0.12→0.13 / app 1.11→1.12 |

**Загалом: ~3-4 робочих дні** на повне закриття валідаторного боргу.

Можна робити в один захід або розбити по сесіях. Рекомендую:

- **Сесія A (3-4 год)**: №1 + №2 одним релізом 1.10.x
- **Сесія B (1-2 дні)**: №3 окремим релізом 1.11.0
- **Сесія C (1 день)**: №4 окремим релізом 1.12.0

Кожна сесія самодостатня, з тестами і CHANGELOG entry.

---

## Coding conventions (нагадування для будь-якої з сесій)

- Кожна нова finding потребує: правило в коді, ключ × 3 локалі, spec-ref entry
- Synthetic samples в `samples/` повинні мати `_note` поле що пояснює які findings має знайти валідатор
- Перед коміт: full regression через `/tmp/test-validator.py` (за патерном 2026-05-09)
- SemVer строго: feat → MINOR, fix → PATCH; bump в одному коміті — `package.json` × 2 + `version.js` + 6 HTML файлів (3 inspector × 3 about) + CHANGELOG

Файли тестів і скрипти-патчі живуть у `/tmp/` — це ОК для разових; постійні тести → `packages/core/test/`.
