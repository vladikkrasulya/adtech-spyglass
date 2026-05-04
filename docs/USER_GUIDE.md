# Spyglass — як ним користуватись

**Spyglass** — приватний інспектор OpenRTB-трафіку. Вставив JSON, отримав
розбір: чи правильно сформований запит/відповідь, які поля обов'язкові,
чи проходить crosscheck request↔response, з якою версією oRTB маєш справу,
що саме каже специфікація IAB у конкретному пункті.

Запущено на власному залізі в Києві, без реклами, без трекерів,
без передачі ваших даних третім сторонам.

---

## Що Spyglass **вміє**

### Розбір BidRequest / BidResponse

- **Валідація структури** — перевіряє обов'язкові поля, типи, формати
  (наприклад: `imp[]` непорожній, `id` рядок, `tmax` число, `cur[]` коди ISO-4217)
- **Підтримка типів реклами** — banner, video, native, audio. Формат
  native parsed (1.1 і 1.2), VAST-протоколи у `video.protocols`, app vs site,
  rewarded (`imp.rwdd`)
- **Crosscheck request↔response** — перевіряє що `bid.impid` посилається на
  існуючий `imp.id`, що формат креативу збігається з `imp.banner/video`,
  що ціна не нижче за `bidfloor`, що розміри креативу матчать `imp.banner.format[]`
- **Native crosscheck** — звіряє asset-id у запиті з asset-id у відповіді,
  знаходить пропущені і зайві asset-и, ловить невалідний JSON у `adm`

### Detect & inform

- **Автодетект версії** — Spyglass аналізує сигнатурні поля (`imp.rwdd`,
  `device.sua`, `regs.gpp_sid`, `source.schain`) і визначає
  чи це oRTB 2.5 / 2.6 baseline / 2.6-202211 / 2.6-202309 / 3.0.
  Повертає рівень впевненості (`confidence`) і список знайдених сигналів
- **Spec deep-links** — кожна знахідка має посилання на конкретний параграф
  IAB-специфікації (`§3.2.10`, `§5.4` тощо), щоб ти не шукав вручну
- **Severity levels** — error / warning / info. UI підсвічує іконкою

### Діалекти (vendor overlays)

- **IAB** (за замовчуванням) — чиста IAB-специфікація без розширень
- **Vendor overlays** — Spyglass підтримує опціональні overlay-правила
  для конкретних SSP/DSP (їхні `ext.*` поля, custom-макроси, специфічні
  обмеження). Активуються через `?dialect=<vendor>` query-параметр —
  публічний UI лишається generic. Vendor-specific reference-tab і додаткові
  правила розкриваються лише для тих, хто свідомо обрав свій діалект.

### Ad preview

- Якщо в `bid.adm` є HTML-креатив — Spyglass рендерить його у sandboxed
  iframe (`sandbox="allow-scripts"`, без `allow-same-origin`). Бачиш як
  виглядає, без ризику для своєї сесії

### Особистий простір (опціонально, з акаунтом)

- **Збереження зразків** — реальні запити/відповіді що ти аналізуєш,
  з нотатками, групуванням за партнерами. Save-модал показує `оновити
запис · #N` коли поточний editor завантажений з бібліотеки — натиск
  "оновити" перезаписує існуючий запис, "зберегти як новий" — створює
  окремий.
- **Партнери** — каталог SSP/DSP/AdNetwork з якими працюєш. Drop-down
  фільтр над списком зразків звужує бібліотеку за партнером.
- **Zero-knowledge шифрування** — все що зберігається, шифрується
  на твоєму браузері ключем, похідним від твого пароля. **Сервер
  не може розшифрувати твої зразки** навіть якщо захоче. При забутому
  паролі є recovery key — без нього доступ втрачено назавжди.
- **Recovery key показується тільки раз** при реєстрації. Закриття вікна
  (Esc, кнопка "я зберіг", або клік повз) проходить через `confirm()`-діалог
  щоб випадково не втратити ключ.

### Локальна історія аналізів

- Кожен `analyze stream` додає запис у History sidebar (зліва внизу).
  Записи зберігаються у `localStorage` — переживають reload.
- Кожен запис має `👁` (peek) і `×` (delete). Peek показує JSON у
  read-only модалі без перезапису поточного editor — перевірити вміст
  без втрати роботи.
- Активний запис (той що зараз у editor) підсвічується акцентом.
- `clear` кнопка над списком очищає всю історію (не зачіпає бібліотеку).
- Cap 50 записів. На переповнення — викидається 50% найстаріших.

### Test harness (з акаунтом)

- `/api/proxy` — форвардер на публічні test-bin-и (`httpbin.org`, `postman-echo.com`)
  для перевірки SSP-side webhook-ів. Auth-захищений щоб не використовувати
  як abuse-amplifier

### Інтерфейс

- **Мова інтерфейсу** — кнопка `UK / EN` у нижньому правому куті. UI-fallback-text
  залишається українською (Phase 3 roadmap), але **знахідки валідації** і
  crosscheck-повідомлення повністю перекладені.
- **Тема** — кнопка `◐ ☾ ☀` поряд із мовою. Авто за prefers-color-scheme,
  або явний світлий/темний.
- **Mobile** — layout адаптується від ~720px (BID REQUEST/RESPONSE стекаються
  вертикально) і ~1024px (sidebar-и стають top/bottom). Пастити готовий JSON
  з телефона працює; великі редагування — все ж зручніше з десктопу.
- **Категорії** — окрема вкладка `categories`. Decoded IAB Content Taxonomy
  лейбли з `cat[] / bcat[] / pcat[]` (наприклад `IAB9-11 → Hobbies & Interests
→ Comic Books`). Англійська-only поки.

---

## Чого Spyglass **НЕ робить**

| Обмеження                                              | Чому                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Не робить реальні bid-и                                | Це інспектор JSON, не RTB-клієнт. Spyglass не підключається до жодного exchange            |
| Не виконує макроси (`${AUCTION_PRICE}` тощо) у runtime | Перевіряємо лише статично — чи макрос валідний, чи правильно записаний                     |
| Не показує реальний рендер креативу з третіх сторін    | iframe-preview лише локальний `adm` HTML, без VAST-плеєру і без external-tag fetching      |
| Не перевіряє повну oRTB 2.6 enforcement                | Поточна баzeline — 2.5 + детект 2.6 сигналів. **Strict 2.6 валідація — Phase 2 у roadmap** |
| Не зберігає твої зразки якщо ти не залогінений         | Анонім — все живе тільки у вкладці браузера; reload — і пусто                              |
| Не логує IP/User-Agent при `/api/analyze`              | Без auth-у — залишаєш мінімальний слід (Cloudflare Tunnel запис, але не наш)               |
| Не підтримує English UI                                | Поки тільки українська. `en.json` — заглушка, Phase 3 roadmap                              |
| Не оптимізує bid strategy / eCPM / yield               | Це інспектор, не yield manager                                                             |
| Не парсить TCF/GPP consent strings                     | Запланована окрема вкладка (Tier-2 AdTech extension у `kyivtech-portal/tools/`)            |
| Не валідує `ads.txt` / `sellers.json` / `app-ads.txt`  | Те саме — окремий тулз, не замішаний у oRTB-інспектор                                      |

---

## Які дані Spyglass використовує для аналізу

### Локально (in-process, на нашому сервері)

1. **Твій JSON** — все що ти вставляєш у `BID REQUEST` / `BID RESPONSE`
   текст-арії. Парситься як JSON, валідується.
2. **IAB OpenRTB 2.5 / 2.6 / 3.0 specs** — bundled markdown,
   використовується для генерації `specRef` deep-links
3. **Native 1.1 / 1.2 specs** — bundled, для asset-validation
4. **VAST 4.x protocol metadata** — для `video.protocols` validation
5. **`spec-refs.json`** — мапа finding-id → IAB spec anchor
6. **`messages/uk.json`** — 71 локалізована повідомлення
7. **Vendor dialect overlays** (тільки коли ти явно обрав `?dialect=<vendor>`)
   — bundled, без жодних викликів до vendor-API

### НЕ використовується

- ❌ Ніяких third-party API запитів під час аналізу
- ❌ Ніякі browser-fingerprinting / tracking pixels
- ❌ Жодних cookies для анонімних користувачів (тільки session-cookie
  після login)
- ❌ Жодних external CDN-ів — все self-hosted
- ❌ Жодного analytics (Google, Mixpanel, тощо)

### Flow аналізу

```
[твій JSON]
    ↓
parseJSON → validate(structure) → detectVersion → crosscheck
    ↓
findings[]: {id, level, path, params, msg, specRef}
    ↓
сервер форматує локалізований текст і повертає 200 JSON
```

Все робиться **синхронно в одному Node.js процесі**, без БД-доступу,
без external-fetch, без передачі назовні.

---

## Що зберігається на сервері

### Анонімні відвідувачі

**Нічого.** `/api/analyze` не пише в БД, не логує payload, не зберігає
історію викликів. Cloudflare Tunnel перед нами фіксує сам факт запиту
(IP, шлях, статус) — це стандартний access-log, не наш бекенд.

### Зареєстровані користувачі (коли логінишся)

| Що                                   | Як зберігається                                                       |
| ------------------------------------ | --------------------------------------------------------------------- |
| email + password hash                | bcrypt, 12 rounds                                                     |
| Сесія                                | in-memory (TTL 30 днів). Restart серверу — всі вилогінились           |
| Saved samples (`bid_req`, `bid_res`) | **AES-GCM ciphertext**. Сервер бачить байти, але не може розшифрувати |
| KDF salt + wrapped DEK + IVs         | Так. Без твого пароля — марно для атакера                             |
| Notes / metadata зразка              | Те саме шифрування                                                    |
| Партнери (label)                     | Те саме шифрування                                                    |
| `email_verified_at`                  | timestamp (тільки після verify-email)                                 |

Реалізація: пароль на клієнті → PBKDF2 600k SHA-256 → KEK → розгортає
збережений DEK → DEK шифрує контент. **Сервер не бачить пароля
і не може отримати DEK.** При зміні пароля DEK перепаковується (не
перегенерується), щоб не втратити доступ до старих зразків.

---

## Як читати результат

Кожна знахідка (`finding`) виглядає так:

```json
{
  "id": "imp.banner.size_required",
  "level": "error",
  "path": "imp[0].banner",
  "params": { "num": 1 },
  "msg": "imp[1] banner: потрібно вказати w+h або format[]",
  "specRef": "https://iabtechlab.com/...#322"
}
```

- **`level`** — `error` (порушення обов'язкового правила) /
  `warning` (підозріле, але не заборонено) / `info` (нотатка)
- **`path`** — JSON-path до проблемного поля у твоєму payload-і
- **`msg`** — людський текст, локалізований
- **`specRef`** — пряме посилання на параграф IAB-специфікації

**Загальний статус:**

- `errors` — є хоча б одна `level: error`
- `warnings` — лише warnings/info, але не clean
- `clean` — нічого не знайдено

---

## Швидкий приклад

Встав у поле **BID REQUEST**:

```json
{
  "id": "test-001",
  "imp": [
    {
      "id": "1",
      "banner": { "w": 300, "h": 250 },
      "bidfloor": 0.5
    }
  ],
  "site": { "id": "publisher-abc", "domain": "example.com" },
  "device": { "ua": "Mozilla/5.0", "ip": "1.2.3.4" }
}
```

Натисни **analyze stream** (або `Ctrl+Enter`) — побачиш:

- detected version: `2.5` (немає 2.6 сигналів)
- кілька warnings (наприклад: немає `at`, `tmax`, `cur`)
- spec-refs до IAB §3.2.1, §3.2.4

Додай у `BID RESPONSE`:

```json
{
  "id": "test-001",
  "seatbid": [
    {
      "bid": [
        {
          "id": "b1",
          "impid": "1",
          "price": 1.5,
          "adm": "<html>creative</html>",
          "adomain": ["example.com"],
          "w": 300,
          "h": 250
        }
      ]
    }
  ],
  "cur": "USD"
}
```

Тепер crosscheck активний — побачиш:

- `bid.impid → imp.id` матч ✓
- `bid.w/h → imp.banner.w/h` матч ✓
- `price > bidfloor` ✓
- ad preview у нижній правій картці (sandboxed)

---

## Підтримувані версії

| Тип     | Версія          | Статус                                                                  |
| ------- | --------------- | ----------------------------------------------------------------------- |
| OpenRTB | 2.5             | ✅ Validation + detection                                               |
| OpenRTB | 2.6 baseline    | ✅ Detection (signals: rwdd, sua, gpp_sid). Strict validation — Phase 2 |
| OpenRTB | 2.6-202211      | ✅ Detection. Strict validation — Phase 2                               |
| OpenRTB | 2.6-202309      | ✅ Detection. Strict validation — Phase 2                               |
| OpenRTB | 3.0             | ✅ Detection (envelope `openrtb.ver`). Strict validation — Phase 2      |
| Native  | 1.1             | ✅ Validation + asset matching                                          |
| Native  | 1.2             | ✅ Validation (eventtrackers signal)                                    |
| VAST    | 2 / 3 / 4.x     | ✅ `video.protocols` accept 2-12                                        |
| Dialect | IAB             | ✅ default                                                              |
| Dialect | Vendor overlays | ✅ опціонально, через `?dialect=<vendor>` query                         |
| Locale  | UK 🇺🇦           | ✅                                                                      |
| Locale  | EN              | ⏳ Phase 3 (en.json — stub)                                             |

---

## Що в roadmap

Кратко (повний — у [`ROADMAP.md`](../ROADMAP.md)):

- **Phase 2** — повна 2.6 enforcement, version-aware rules, native 1.1 vs 1.2 auto-switch
- **Phase 3** — English UI, theme polish
- **Phase 4-7** — productization, public/private split, account features ✅ shipped
- **Phase 8** — verify-email, password reset з збереженням DEK ✅ shipped
- Найближче — TCF/GPP/USP decoder як окрема вкладка, ads.txt/sellers.json checker

---

## Питання + контакт

Bug, feature request, "чому це не працює" — `hi@kyivtech.com.ua`
(приходить на мій Gmail через Cloudflare Email Routing).

Spyglass — це не комерційний продукт. Це open-tools, що допомагають
розбиратись з OpenRTB чесно і прозоро. Якщо щось корисне — користуйся.
Якщо знайшов помилку — напиши, виправлю.
