# Тріаж каталогу гіпотез про тихі поломки

> **Historical snapshot (2026-08-13).** This triage records which hypotheses could be tested with
> what was available on that date, and the results of the sixteen that were. Bucket membership is a
> statement about tooling, not about truth. Use the
> [platform baseline](../specs/000-platform-baseline/plan.md) for current behavior and the
> [Spec Kit roadmap](../specs/ROADMAP.md) for active work.

Дата перевірки: 2026-08-14. Каталог: `docs/hypothesis-catalogue-2026-08-13.md` з коміту
`27592162e75768582981922d1e9289e0ddd3109a`. Ізольований worktree перед роботою
fast-forward-нуто до `feat/url-search-feed` (`ca1f80aba684fd9d25aad7d9b0528845ca5ea6f8`).

Цей документ розрізняє три речі:

- **гіпотезу каталогу** — формулювання, яке ще нічого не доводить;
- **кошик** — що саме потрібно, аби гіпотезу підтвердити або спростувати;
- **замір** — лише реально виконаний локальний експеримент із точним input, версією й сирим output.

Кошик **A** означає, що достатньо локального Node, публічного пакета, фікстури або первинної
специфікації. **B** означає відсутній toolchain/schema. **C** означає sandbox, керований endpoint,
реальний плеєр або production/vendor telemetry. Позиції C не перевірялися.

Окремо про походження: **джерело A каталогу не має посилань на рівні позицій і містить доведену
внутрішню суперечність**. Його вісім рядків нижче класифіковано від нуля; формулювання джерела не
використовувалося як доказ. Джерело B має тип джерела в кожному рядку, але його рядки так само
лишалися гіпотезами до заміру.

## Підсумок тріажу

| Обсяг                         | A: тут і зараз | B: бракує інструмента | C: бракує доступу/живої системи |  Разом |
| ----------------------------- | -------------: | --------------------: | ------------------------------: | -----: |
| Каталог A1–A8 + B1–B48        |             33 |                    12 |                              11 |     56 |
| Локальна позиція L1 (`langb`) |              1 |                     0 |                               0 |      1 |
| **Усього в цьому документі**  |         **34** |                **12** |                          **11** | **57** |

Заміряно 16 унікальних позицій: L1, A3, A8, B5, B12, B16, B18, B21, B22, B25, B29,
B32, B33, B35, B36 і B37. П'ять уже перевірених знахідок із супровідного research snapshot
не перероблялися; перетинні B10, B19, B38 і B40 лише класифіковано.

## Повний тріаж

### Джерело A — без пооб'єктних посилань, із внутрішньою суперечністю

| #   | Позиція                                                 | Кошик | Чим міряти / чого бракує                                                                                                                               |
| --- | ------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Бід видаляється через відсутність DSA-декларації        | B     | Потрібен локальний pinned PBS-Go або PBS-Java runtime із DSA validation, non-bid і debug tracing; відповідних Go/JVM toolchain у середовищі немає.     |
| A2  | Фатальний збій через ліниве декодування TCF             | B     | Потрібні OpenJDK/JVM, `javac`, Maven/Gradle і запінена версія `iabtcf-java`; жодного з них немає.                                                      |
| A3  | Спотворення `[ERRORCODE]` у `vast-client-js`            | A     | Node, pinned `@dailymotion/vast-client`, fake `Image`, офіційна таблиця кодів. **Заміряно.**                                                           |
| A4  | `schain.nodes[].sid`: Integer замість String у Protobuf | B     | Потрібні `protoc`, точна partner `.proto`, extension registry і strict decoder; для порівняння стеків також Go/JVM.                                    |
| A5  | Конфлікт `site`/`app`/`dooh` після FPD merge            | C     | Взаємовиключність перевіряється специфікацією, merge — локальним PBS, але заявлений тихий drop строгим DSP потребує DSP sandbox і outcome trace.       |
| A6  | Одночасні `keywords` і `kwarray`                        | C     | Нормативна частина локальна, PBS-поведінка потребує runtime, а заявлений DSP drop — strict-DSP sandbox/result trace.                                   |
| A7  | Втрата `schain` після переходу на Prebid.js 10          | A     | Pinned Prebid.js 10, локальний browser/npm fixture і synthetic adapter; живий bidder не потрібен.                                                      |
| A8  | `regs.coppa` як boolean замість integer                 | A     | OpenRTB Regs spec, Node, raw type/presence fixtures і pinned parser/model. **Заміряно для ortbtools; широка міжпарсерна теза лишається невизначеною.** |

### Джерело B — 48 позицій із типами джерел у каталозі

| #   | Позиція                                               | Кошик | Чим міряти / чого бракує                                                                                                                        |
| --- | ----------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Debug-режим змінює саму систему                       | B     | PBJS transport-частина локальна; для PBS `test:1`, складу учасників і reporting потрібен pinned PBS runtime із synthetic bidders.               |
| B2  | IAB-валідний бід стає Google/BidSwitch-invalid        | C     | Потрібні sandbox account/profile, buyer IDs, контрольований запит і partner rejection reason.                                                   |
| B3  | PBS не викликає bidder через effective `tmax`         | B     | Pinned PBS-Go/Java, synthetic bidder endpoint і timing trace; Go/JVM відсутні.                                                                  |
| B4  | EIDs у двох homes, один масив зникає                  | B     | PBJS merge локальний; для повного порівняння потрібен PBS-Go/Java normalization runtime.                                                        |
| B5  | Переїзд 2.5↔2.6 стирає privacy, schain і rewarded     | A     | Специфікація + synthetic transformer fixture. **Заміряно частково; знайдено omission `us_privacy` у local advisor.**                            |
| B6  | VAST грає, але wrapper beacons губляться              | C     | Реальний VAST player, контрольований wrapper chain і beacon endpoints із HTTP logs.                                                             |
| B7  | GPP control увімкнений, EIDs усе одно передані        | A     | Pinned Prebid.js version, local GPP/EID fixture і Chrome/Firefox.                                                                               |
| B8  | PBS AMP губить US privacy                             | B     | PBS-Go AMP→ORTB runtime із consent-warning fixture; Go відсутній.                                                                               |
| B9  | Різні wrapper-depth limits; Prebid додає hop          | A     | IAB VAST spec, public IMA support docs, pinned `vast-client-js`/Prebid source і fixtures. Фактична поведінка конкретного player build була б C. |
| B10 | `URLSearchParams` псує `%%…%%`                        | A     | WHATWG `URLSearchParams`; уже виміряно в супровідному дослідженні, тут не повторювалося.                                                        |
| B11 | Xandr ігнорує `tmax`/`banner.api` без enablement      | C     | Xandr account/profile flags, sandbox request і result trace.                                                                                    |
| B12 | OpenRTB 3.0 читають як 2.x                            | A     | 3.0 fixture + pinned 2.x/3.0 decoders. **Заміряно на ortbtools.**                                                                               |
| B13 | Google opportunity flattening псує кореляцію          | C     | Google request logs із `google_query_id`, multi-format/deal/pod sandbox traffic.                                                                |
| B14 | 204 не містить no-bid reason за дизайном              | C     | Vendor telemetry або контрольований endpoint, де відомі routing block, buyer no-bid і disabled feedback.                                        |
| B15 | Player обирає не той MediaFile                        | C     | Реальні players і контрольовані MediaFile endpoints із codec, MIME header, delivery та bitrate matrix.                                          |
| B16 | gzip wrapper не збігається з bytes                    | A     | Node `zlib`, exact bytes і `Content-Encoding` fixture. **Заміряно.**                                                                            |
| B17 | JSON↔Protobuf round-trip губить data                  | B     | `protoc`, точна partner schema, extension registry і partner int64 mapping; за потреби Go/JVM runtime.                                          |
| B18 | Native/VAST markup має неправильну decode depth       | A     | Outer JSON + inner JSON/XML fixtures, Node і XML parser. **Заміряно.**                                                                          |
| B19 | Duplicate JSON keys зникають до validation            | A     | Raw tokenizer/`JSON.parse`; уже виміряно окремо, тут не повторювалося.                                                                          |
| B20 | TCF vendor bit помилково вважають дозволом            | A     | `@iabtcf/core`, pinned GVL, publisher restrictions, purpose/vendor basis fixtures і policy oracle зі спеки.                                     |
| B21 | GPP section present ≠ applicable                      | A     | `@iabgpp/cmpapi`, GPP fixture й окремий applicable SID set. **Заміряно.**                                                                       |
| B22 | TC string structural-valid, policy-invalid            | A     | `@iabtcf/core`, crafted TC fixture і pinned TCF policy constraints. **Заміряно.**                                                               |
| B23 | CMP race дає auction без consent                      | A     | Local Prebid.js build, controlled CMP stub, timestamped lifecycle trace у наявних Chrome/Firefox.                                               |
| B24 | `plcmt` різниться між PBS Go і Java                   | B     | Обидва toolchain: Go + PBS-Go і JVM/Maven + PBS-Java, з однаковим pinned fixture.                                                               |
| B25 | `&amp;` у CDATA змінює tracking URL                   | A     | XML DOM parser + WHATWG URL. **Заміряно.**                                                                                                      |
| B26 | OMID script loaded ≠ measurement works                | C     | Реальна OMID/IMA integration, browser player, verification session/resources і controlled access modes.                                         |
| B27 | VMAP XSD-valid, але IMA підтримує subset              | A     | VMAP XSD, valid fixtures і public pinned IMA support table. Runtime claim про конкретний build була б C.                                        |
| B28 | VAST Wrapper controls змішують із VMAP defaults       | A     | VAST/VMAP primary specs і XSD fixtures.                                                                                                         |
| B29 | VAST XSD verdict суперечить spec                      | A     | Official pinned IAB VAST repo, `xmllint`, fixtures. **4.3-частину заміряно; 4.2-частина не визначена.**                                         |
| B30 | Media ladder/mezzanine XSD-valid, але SSAI-unusable   | A     | VAST XSD і normative media ladder/mezzanine text; реальна SSAI ingest acceptance окремо була б C.                                               |
| B31 | PBS tracking rewrite залежить від literal XML         | B     | Go toolchain і pinned PBS-Go `endpoints/events` dependencies/tests; Go відсутній.                                                               |
| B32 | VAST array macro кодує comma як `%2C`                 | A     | Pinned `@dailymotion/vast-client` + official IAB macro catalogue. **Заміряно.**                                                                 |
| B33 | `cattax` default/scope змінює category IDs            | A     | OpenRTB 2.6 per-object tables + local migration fixture. **Заміряно.**                                                                          |
| B34 | Currency field присутнє, але partner не застосовує    | C     | Vungle/Xandr account configuration, sandbox auction і billing/result evidence.                                                                  |
| B35 | GPP enum/array приводиться до boolean або обрізається | A     | `@iabgpp/cmpapi`, enum/array fixtures і typed consumer. **Enum-truthiness mechanism заміряно; actual consumer й array-частину не визначено.**   |
| B36 | Unknown GPP section губиться                          | A     | `@iabgpp/cmpapi` і synthetic unknown-SID fixture. **Заміряно.**                                                                                 |
| B37 | Відсутній COPPA стає explicit `0`                     | A     | Pinned model, `{}`, `0`, `1` presence/round-trip matrix. **Заміряно лише validation path; whole claim не визначено.**                           |
| B38 | int64 змінюється після JS JSON round-trip             | A     | JS Number/JSON; уже виміряно окремо, тут не повторювалося.                                                                                      |
| B39 | JSON valid, але auction structurally impossible       | B     | Нормативну частину можна перевірити локально; exact PBS accept/sanitize/drop потребує pinned PBS runtime.                                       |
| B40 | Typo виглядає як future field                         | A     | Spec + raw/schema fixture; уже виміряно окремо, тут не повторювалося.                                                                           |
| B41 | Prebid Native перевіряє presence, не usability        | A     | Pinned Prebid.js Native source/tests і boundary fixtures. Actual renderer/file usability окремо було б C.                                       |
| B42 | `ads.txt` 404 зливається з zero sellers               | A     | Local HTTP server (404/empty/placeholder/HTML) + pinned public retriever/parser. Prevalence у трафіку цим не міряється.                         |
| B43 | `ads.txt` variables губляться, seller rows лишаються  | A     | ads.txt 1.1 fixture з variables/repeats/conflicts + pinned parser.                                                                              |
| B44 | `app-ads.txt` беруть із неauthoritative host          | A     | Static app-store metadata + public-suffix parser + authority fixtures; live store не потрібен для алгоритму.                                    |
| B45 | Seller ID псується numeric/case coercion              | A     | Static ads.txt/sellers.json/schain join fixtures з `00000001`, `1`, `EB_0001`, `eb_0001`.                                                       |
| B46 | `schain.complete=1` приймають як доказ validity       | A     | Supply-graph fixture з broken joins + SupplyChain/ads.txt/sellers.json specs і pinned validator.                                                |
| B47 | Malformed EID silently stripped by PBS                | B     | Go і pinned PBS-Go sanitation test path; Go відсутній.                                                                                          |
| B48 | SIMID у Wrapper не піднімається                       | C     | Current SIMID-capable IMA player, browser і controlled Wrapper/Inline fixtures; одного issue недостатньо.                                       |

### Локальна позиція поза каталогом

| #   | Позиція                                                               | Кошик | Чим міряти / чого бракує                                                                                        |
| --- | --------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| L1  | `site.langb` і `app.langb` помилково є definitive OpenRTB 2.6 signals | A     | Поточний `detectVersion`, pinned OpenRTB 2.6 object tables і exact fixtures. **Заміряно; дефект підтверджено.** |

## Виконані заміри

Порядок нижче: спершу додана користувачем high-priority L1, далі джерело A, потім позиції B
за зростанням pain rank. Висновки навмисно scoped до названого oracle; механізм у локальній
бібліотеці не видається за поведінку всіх партнерів.

### L1 — `Site.langb` / `App.langb` як вигадані definitive 2.6 signals

**Точний вхід.** Сім незалежних JS-об'єктів, по одному на виклик `detectVersion`:

```json
{"site":{"langb":"en"}}
{"app":{"langb":"en"}}
{"source":{},"site":{"langb":"en"}}
{"device":{"langb":"en"}}
{"site":{"content":{"langb":"en"}}}
{"seatbid":[{"bid":[{"langb":"en"}]}]}
{"wlangb":["en"]}
```

**Чим міряв.** Node `v22.23.2`; `packages/core/detect.js` на ortbtools commit
`ca1f80aba684fd9d25aad7d9b0528845ca5ea6f8`; первинна OpenRTB 2.6 specification на commit
`1debba8001f40eb14597102dec3205afddf811d4`.

**Фактичний stdout:**

```text
node=v22.23.2
{"input":{"site":{"langb":"en"}},"output":{"version":"2.6","confidence":1,"signals":["site.langb"]}}
{"input":{"app":{"langb":"en"}},"output":{"version":"2.6","confidence":1,"signals":["app.langb"]}}
{"input":{"source":{},"site":{"langb":"en"}},"output":{"version":"2.6","confidence":1,"signals":["site.langb"]}}
{"input":{"device":{"langb":"en"}},"output":{"version":"2.5","confidence":0.3,"signals":[]}}
{"input":{"site":{"content":{"langb":"en"}}},"output":{"version":"2.5","confidence":0.3,"signals":[]}}
{"input":{"seatbid":[{"bid":[{"langb":"en"}]}]},"output":{"version":"2.5","confidence":0.3,"signals":[]}}
{"input":{"wlangb":["en"]},"output":{"version":"2.5","confidence":0.3,"signals":[]}}
```

**Нормативна перевірка.** `langb` визначене в:

- [`Content.langb`, §3.2.16, lines 926–927](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L926-L927);
- [`Device.langb`, §3.2.18, lines 980–981](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L980-L981);
- [`Bid.langb`, §4.2.3, lines 1356–1357](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L1356-L1357).

На top-level `BidRequest` поле називається
[`wlangb`, lines 557–558](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L557-L558),
не `langb`. Повні таблиці
[`Site`, §3.2.13](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L822-L848)
і [`App`, §3.2.14](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L850-L879)
не містять `langb`; вони лише можуть містити `content`, а вже той має `langb`. Changelog 2.5→2.6
так само називає рівно §§3.2.1, 3.2.16, 3.2.18 і 4.2.3 для нового BCP-47 поля
([lines 2149–2154](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L2149-L2154)).

**Вердикт: підтверджено.** `Site.langb` і `App.langb` не існують у стандартній 2.6 wire model.
Обидва рядки треба прибрати з `SIGNALS_2_6`. Вони не просто мертві: typo/extension із цим ім'ям
дає confidence `1` і перебиває справжній 2.5 signal. Водночас поточний detector не розпізнає
чотири справжні 2.6 markers: `wlangb`, `device.langb`, `site.content.langb` / `app.content.langb`
та response-side `seatbid[].bid[].langb`.

**Що випливає для інструмента.** Прибрати `site.langb`, `app.langb`; окремим кодовим рішенням
розглянути п'ять нормативних paths вище як replacements. Не підвищувати версію на невідомому
полі лише через правдоподібне ім'я.

### A3 — `[ERRORCODE]` і unknown macros у `vast-client-js`

**Точний вхід:**

```json
{"url":"https://tracker.invalid/e?code=[ERRORCODE]","macros":{"ERRORCODE":"bogus"}}
{"url":"https://tracker.invalid/e?code=[ERRORCODE]","macros":{"ERRORCODE":"777"}}
{"url":"https://tracker.invalid/p?bp=[BREAKPOSITION]","macros":{}}
{"url":"https://tracker.invalid/p?x=[NOT_A_VAST_MACRO]","macros":{}}
```

**Чим міряв.** Node `v22.23.2`; `@dailymotion/vast-client@6.4.5` (upstream commit
`2ff2452c9102f6070b018c33a796f7cb1027538b`); official VAST 4.3 error table commit
`ccf49aa9c69528f369e7505131da2b1a95cc9b98`; fake `Image` перехоплював fired URLs без HTTP.

**Фактичний stdout:**

```text
node=v22.23.2
package=@dailymotion/vast-client@6.4.5
vast_client_commit=2ff2452c9102f6070b018c33a796f7cb1027538b
iab_vast4x_commit=ccf49aa9c69528f369e7505131da2b1a95cc9b98
official_error_codes=["100","101","102","200","201","202","203","204","205","206","300","301","302","303","304","400","401","402","403","405","406","407","408","409","410","411","500","501","502","503","600","601","602","603","604","900","901","902"]
official_contains_777=false
malformed_errorcode.input={"url":"https://tracker.invalid/e?code=[ERRORCODE]","macros":{"ERRORCODE":"bogus"}}
malformed_errorcode.fired=["https://tracker.invalid/e?code=900"]
unknown_three_digit_errorcode.input={"url":"https://tracker.invalid/e?code=[ERRORCODE]","macros":{"ERRORCODE":"777"}}
unknown_three_digit_errorcode.fired=["https://tracker.invalid/e?code=777"]
missing_supported_macro.input={"url":"https://tracker.invalid/p?bp=[BREAKPOSITION]","macros":{}}
missing_supported_macro.fired=["https://tracker.invalid/p?bp=-1"]
missing_unknown_macro.input={"url":"https://tracker.invalid/p?x=[NOT_A_VAST_MACRO]","macros":{}}
missing_unknown_macro.fired=["https://tracker.invalid/p?x=[NOT_A_VAST_MACRO]"]
```

**Вердикт: спростовано в заявленому формулюванні.** Бібліотека не замінює невідомий
тризначний code `777` на `900` і не замінює невідоме macro name на `-1`. Вона ставить `900`
для malformed non-three-digit `ERRORCODE`, ставить `-1` для відомого, але незаповненого macro,
і лишає справді невідомі code/name як є.

**Що випливає для інструмента.** Потрібні чотири окремі діагнози: malformed error code,
unknown three-digit code, missing known macro value, unknown macro name. Одне узагальнене правило
повторило б помилку каталогу.

### A8 — `regs.coppa` boolean проти integer

**Точний вхід.** Основа кожного request:

```json
{
  "id": "req-1",
  "imp": [{ "id": "imp-1", "banner": { "w": 300, "h": 250 } }],
  "user": { "id": "user-1" },
  "regs": {}
}
```

У `regs` по черзі: поле відсутнє, `"coppa":0`, `"coppa":1`, `"coppa":false`,
`"coppa":true`, `"coppa":"1"`.

**Чим міряв.** Node `v22.23.2`, `@ortbtools/core@0.31.0`, `validate`; OpenRTB 2.6
[`Regs.coppa` — integer](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L585-L592).

**Фактичний stdout:**

```text
node=v22.23.2
package=@ortbtools/core@0.31.0
{"name":"absent","input":"{\"id\":\"req-1\",\"imp\":[{\"id\":\"imp-1\",\"banner\":{\"w\":300,\"h\":250}}],\"user\":{\"id\":\"user-1\"},\"regs\":{}}","rawType":"absent","booleanCoercion":null,"coppaFindingIds":[]}
{"name":"integer-zero","input":"{\"id\":\"req-1\",\"imp\":[{\"id\":\"imp-1\",\"banner\":{\"w\":300,\"h\":250}}],\"user\":{\"id\":\"user-1\"},\"regs\":{\"coppa\":0}}","rawType":"number","booleanCoercion":false,"coppaFindingIds":[]}
{"name":"integer-one","input":"{\"id\":\"req-1\",\"imp\":[{\"id\":\"imp-1\",\"banner\":{\"w\":300,\"h\":250}}],\"user\":{\"id\":\"user-1\"},\"regs\":{\"coppa\":1}}","rawType":"number","booleanCoercion":true,"coppaFindingIds":["regs.coppa_pii_present"]}
{"name":"boolean-false","input":"{\"id\":\"req-1\",\"imp\":[{\"id\":\"imp-1\",\"banner\":{\"w\":300,\"h\":250}}],\"user\":{\"id\":\"user-1\"},\"regs\":{\"coppa\":false}}","rawType":"boolean","booleanCoercion":false,"coppaFindingIds":[]}
{"name":"boolean-true","input":"{\"id\":\"req-1\",\"imp\":[{\"id\":\"imp-1\",\"banner\":{\"w\":300,\"h\":250}}],\"user\":{\"id\":\"user-1\"},\"regs\":{\"coppa\":true}}","rawType":"boolean","booleanCoercion":true,"coppaFindingIds":[]}
{"name":"string-one","input":"{\"id\":\"req-1\",\"imp\":[{\"id\":\"imp-1\",\"banner\":{\"w\":300,\"h\":250}}],\"user\":{\"id\":\"user-1\"},\"regs\":{\"coppa\":\"1\"}}","rawType":"string","booleanCoercion":true,"coppaFindingIds":[]}
```

**Вердикт: не визначено для широкої міжпарсерної гіпотези; локальний механізм частково
підтверджено.** JavaScript truthiness справді розрізняє `0/1` як `false/true`, але поточний
ortbtools нічого не coerce: strict check спрацьовує тільки на integer `1`. Водночас boolean
`true` і string `"1"` проходять без type finding і не активують COPPA rule.

**Що випливає для інструмента.** Додати raw-type/schema verdict для `regs.coppa`; не вважати
truthiness еквівалентом enum semantics. Щоб довести «парсери поводяться по-різному», потрібна
окрема versioned parser matrix — її тут не було.

### B5 — relocation OpenRTB 2.5→2.6

**Точний вхід:**

```json
{
  "id": "r1",
  "imp": [
    {
      "id": "1",
      "video": {
        "protocol": 2,
        "ext": {
          "rewarded": 1
        }
      }
    }
  ],
  "regs": {
    "ext": {
      "gdpr": 1,
      "us_privacy": "1YNN"
    }
  },
  "source": {
    "ext": {
      "schain": {
        "ver": "1.0",
        "complete": 1,
        "nodes": [
          {
            "asi": "ssp.example",
            "sid": "seller-1",
            "hp": 1
          }
        ]
      }
    }
  },
  "user": {
    "ext": {
      "consent": "SYNTHETIC-TC",
      "eids": [
        {
          "source": "id.example",
          "uids": [
            {
              "id": "uid-1"
            }
          ]
        }
      ]
    }
  }
}
```

**Чим міряв.** Node `v22.23.2`; ortbtools migration advisor `1.6.1`, commit
`27592162e75768582981922d1e9289e0ddd3109a`.

**Фактичне спостереження до migration:**

```json
{
  "rwdd": null,
  "gdpr": null,
  "us_privacy_top": null,
  "us_privacy_ext": "1YNN",
  "schain": null,
  "consent": null,
  "eids": null
}
```

**Фактичний `operations` stdout:**

```json
[
  {
    "path": "/imp/0/rwdd",
    "op": "add",
    "before": null,
    "after": 1,
    "rule": "ortb26.imp.rwdd",
    "confidence": "likely"
  },
  {
    "path": "/imp/0/video/ext/rewarded",
    "op": "remove",
    "before": 1,
    "after": null,
    "rule": "ortb26.imp.rwdd",
    "confidence": "likely"
  },
  {
    "path": "/imp/0/video/protocol",
    "op": "remove",
    "before": 2,
    "after": null,
    "rule": "ortb26.video.protocols",
    "confidence": "certain"
  },
  {
    "path": "/imp/0/video/protocols",
    "op": "add",
    "before": null,
    "after": [2],
    "rule": "ortb26.video.protocols",
    "confidence": "certain"
  },
  {
    "path": "/regs/ext/gdpr",
    "op": "remove",
    "before": 1,
    "after": null,
    "rule": "ortb26.regs.gdpr",
    "confidence": "certain"
  },
  {
    "path": "/regs/gdpr",
    "op": "add",
    "before": null,
    "after": 1,
    "rule": "ortb26.regs.gdpr",
    "confidence": "certain"
  },
  {
    "path": "/source/ext/schain",
    "op": "remove",
    "before": {
      "ver": "1.0",
      "complete": 1,
      "nodes": [
        {
          "asi": "ssp.example",
          "sid": "seller-1",
          "hp": 1
        }
      ]
    },
    "after": null,
    "rule": "ortb26.source.schain",
    "confidence": "likely"
  },
  {
    "path": "/source/schain",
    "op": "add",
    "before": null,
    "after": {
      "ver": "1.0",
      "complete": 1,
      "nodes": [
        {
          "asi": "ssp.example",
          "sid": "seller-1",
          "hp": 1
        }
      ]
    },
    "rule": "ortb26.source.schain",
    "confidence": "likely"
  },
  {
    "path": "/user/consent",
    "op": "add",
    "before": null,
    "after": "SYNTHETIC-TC",
    "rule": "ortb26.user.consent",
    "confidence": "certain"
  },
  {
    "path": "/user/eids",
    "op": "add",
    "before": null,
    "after": [
      {
        "source": "id.example",
        "uids": [
          {
            "id": "uid-1"
          }
        ]
      }
    ],
    "rule": "ortb26.user.eids",
    "confidence": "likely"
  },
  {
    "path": "/user/ext/consent",
    "op": "remove",
    "before": "SYNTHETIC-TC",
    "after": null,
    "rule": "ortb26.user.consent",
    "confidence": "certain"
  },
  {
    "path": "/user/ext/eids",
    "op": "remove",
    "before": [
      {
        "source": "id.example",
        "uids": [
          {
            "id": "uid-1"
          }
        ]
      }
    ],
    "after": null,
    "rule": "ortb26.user.eids",
    "confidence": "likely"
  }
]
```

**Вердикт: частково підтверджено; historical claim частково не визначений.** Legacy homes для
rewarded, GDPR, schain, consent і EIDs невидимі читачеві нових paths; advisor пропонує для них
add/remove operations. Current OpenRTB 2.6 прямо визначає
[`Regs.us_privacy` на top level](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L585-L596),
тоді як exact input має тільки `regs.ext.us_privacy`; local advisor не запропонував виправлення.
Це підтверджений implementation gap advisor, не доказ проти каталогу. Щоб довести саме
історичне «поле переїхало 2.5→2.6», бракує pinned 2.5 normative origin у цьому замірі.

**Що випливає для інструмента.** Розщепити B5 по полях. Зберегти наявні proposals для
rewarded/GDPR/schain/consent/EIDs; додати test/finding для `regs.ext.us_privacy` у 2.6 payload
або довести, чому advisor свідомо його не переносить. Historical wording звірити окремо з pinned
2.5 contract.

### B12 — OpenRTB 3.0 через 2.x validator

**Точний вхід:**

```text
{
  "openrtb": {
    "ver": "3.0",
    "request": {
      "id": "r1",
      "item": [{"id":"1","spec":{"placement":{"display":{"w":300,"h":250}}}}],
      "context": {
        "site":{"id":"s1","domain":"publisher.example"},
        "device":{"ip":"192.0.2.1","ua":"Synthetic-UA","lang":"en"}
      }
    }
  }
}
```

**Чим міряв.** Node `v22.23.2`; ortbtools `1.6.1`, commit
`27592162e75768582981922d1e9289e0ddd3109a`; normal dispatcher і direct 2.x request rules.

**Фактичний stdout:**

```text
{
  "routed": {
    "type":"oRTB BidRequest",
    "version":{"version":"3.0","confidence":1,"signals":["openrtb"]},
    "status":"clean",
    "findings":[
      {"id":"request.30.deep_validation_limited","level":"info","path":""}
    ]
  },
  "forced_through_2x": {
    "findings": [
      {"id":"request.id_required","level":"error","path":"id"},
      {"id":"request.imp_required","level":"error","path":"imp"},
      {"id":"request.no_site_or_app","level":"error","path":"site/app"},
      {"id":"request.at_required","level":"error","path":"at"},
      {"id":"request.device_required","level":"error","path":"device"},
      {"id":"request.device.ip_required","level":"error","path":"device.ip"},
      {"id":"request.device.ua_required","level":"error","path":"device.ua"},
      {"id":"request.device.language_missing","level":"info","path":"device.language"}
    ]
  }
}
```

**Вердикт: механізм підтверджено для локального validator.** Dispatcher правильно бачить 3.0;
2.x rules не читають envelope і вважають auction fields відсутніми. Реальний drop у partner
system цим не виміряно.

**Що випливає для інструмента.** Wire-version detection має передувати minor/major-specific
validation; forced parser mode повинен бути явно позначений, а не виглядати як malformed auction.

### B16 — gzip bytes проти `Content-Encoding`

**Точний UTF-8 input body** — compact bytes, без пробілів або newline:

```text
{"id":"req-1","imp":[{"id":"1"}]}
```

Чотири exact комбінації: plain/no header, gzip/`Content-Encoding:gzip`, gzip/no header,
plain/`Content-Encoding:gzip`.

**Чим міряв.** Node `v22.23.2`, zlib `1.3.1-e00f703`, deterministic
`gzipSync(plain, { mtime: 0 })`; `gunzipSync` перед `JSON.parse` лише коли header дорівнював
`gzip`.

**Фактичний stdout:**

```text
node=v22.23.2
zlib=1.3.1-e00f703
plainUtf8={"id":"req-1","imp":[{"id":"1"}]}
plainHex=7b226964223a227265712d31222c22696d70223a5b7b226964223a2231227d5d7d
gzipHex=1f8b0800000000000003ab56ca4c51b2522a4a2dd43554d251cacc2d50b28aae86081a2ad5c6d602007851c36321000000
{"name":"plain_no_header","ok":true,"parsed":{"id":"req-1","imp":[{"id":"1"}]}}
{"name":"gzip_with_header","ok":true,"parsed":{"id":"req-1","imp":[{"id":"1"}]}}
{"name":"gzip_no_header","ok":false,"errorName":"SyntaxError","errorCode":null,"errorMessage":"Unexpected token '\u001f', \"\u001f�\b\u0000\u0000\u0000\u0000\u0000\u0000\u0003\"... is not valid JSON"}
{"name":"plain_with_gzip_header","ok":false,"errorName":"Error","errorCode":"Z_DATA_ERROR","errorMessage":"incorrect header check"}
```

**Вердикт: підтверджено на byte/parser boundary.** Обидва mismatch-напрями падають до ORTB
validation: один у JSON parser, другий у inflater.

**Що випливає для інструмента.** Зберігати й показувати raw bytes разом із transport headers;
повторно серіалізований JSON приховує дефект. Розрізняти `decompression_error` і
`compressed_bytes_without_header`.

### B18 — decode depth для Native і VAST

**Точний Native payload:**

```json
{ "ver": "1.2", "assets": [] }
```

Він передавався як raw object, JSON string один раз і JSON string двічі. Exact wire values є
у stdout нижче.

**Точний VAST payload:**

```xml
<VAST version="4.3"><Ad><InLine><AdTitle>x</AdTitle><Impression>https://tracker.invalid/i</Impression><Creatives/></InLine></Ad></VAST>
```

Він передавався як raw markup у зовнішньому JSON, correctly JSON-encoded string і double-encoded
string.

**Чим міряв.** Node `v22.23.2`, `JSON.parse`, `jsdom@29.1.1` XML parser. Нормативний type oracle:
OpenRTB 2.6 commit `1debba8001f40eb14597102dec3205afddf811d4`, де
[`imp.native.request` є JSON-encoded string](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L760-L774),
а `bid.adm` — string.

**Фактичний Native stdout:**

```text
node=v22.23.2
jsdom=29.1.1
--- native.request ---
raw_object.wire={"id":"req-1","imp":[{"id":"1","native":{"request":{"ver":"1.2","assets":[]}}}]}
raw_object.outer_type=object
raw_object.parse1=ERROR:"[object Object]" is not valid JSON
raw_object.parse2=SKIPPED
encoded_once.wire={"id":"req-1","imp":[{"id":"1","native":{"request":"{\"ver\":\"1.2\",\"assets\":[]}"}}]}
encoded_once.outer_type=string
encoded_once.parse1=object:{"ver":"1.2","assets":[]}
encoded_once.parse2=ERROR:"[object Object]" is not valid JSON
encoded_twice.wire={"id":"req-1","imp":[{"id":"1","native":{"request":"\"{\\\"ver\\\":\\\"1.2\\\",\\\"assets\\\":[]}\""}}]}
encoded_twice.outer_type=string
encoded_twice.parse1=string:"{\"ver\":\"1.2\",\"assets\":[]}"
encoded_twice.parse2=object:{"ver":"1.2","assets":[]}
```

**Фактичний VAST stdout:**

```text
node=v22.23.2
jsdom=29.1.1
raw_markup.wire={"id":"resp-1","seatbid":[{"bid":[{"id":"b1","impid":"1","adm":<VAST version="4.3"><Ad><InLine><AdTitle>x</AdTitle><Impression>https://tracker.invalid/i</Impression><Creatives/></InLine></Ad></VAST>}]}]}
raw_markup.outer_parse=ERROR:Unexpected token '<', ...""1","adm":<VAST vers"... is not valid JSON
encoded_once.wire={"id":"resp-1","seatbid":[{"bid":[{"id":"b1","impid":"1","adm":"<VAST version=\"4.3\"><Ad><InLine><AdTitle>x</AdTitle><Impression>https://tracker.invalid/i</Impression><Creatives/></InLine></Ad></VAST>"}]}]}
encoded_once.outer_type=string
encoded_once.xml_parsererrors=0
encoded_twice.wire={"id":"resp-1","seatbid":[{"bid":[{"id":"b1","impid":"1","adm":"\"<VAST version=\\\"4.3\\\"><Ad><InLine><AdTitle>x</AdTitle><Impression>https://tracker.invalid/i</Impression><Creatives/></InLine></Ad></VAST>\""}]}]}
encoded_twice.outer_type=string
encoded_twice.xml_parse=ERROR:about:blank:1:2: text data outside of root node.
encoded_twice.after_extra_json_parse="<VAST version=\"4.3\"><Ad><InLine><AdTitle>x</AdTitle><Impression>https://tracker.invalid/i</Impression><Creatives/></InLine></Ad></VAST>"
encoded_twice.xml_parsererrors_after_extra_parse=0
```

**Вердикт: підтверджено для wire-depth mechanism.** Правильний Native потребує рівно одного
inner JSON decode; правильний VAST після outer JSON parse треба передавати прямо XML parser.
Raw object і double encoding мають іншу семантику. Частоту в real traffic не виміряно.

**Що випливає для інструмента.** Показувати wire value, runtime type і decode-depth; окремо
діагностувати object, correct one-level і double-level payload. Не «лікувати» все рекурсивним
decode без межі.

### B21 — GPP section present не означає applicable

**Точний вхід:**

- GPP string: `DBABrw~CAAQAAAAAABA.QA~BAgAAABA.QA`
- applicable section IDs: `[8]`
- section 7 (`usnat`) `SaleOptOut=1`
- section 8 (`usca`) `SaleOptOut=2`

**Чим міряв.** Node `v22.23.2`, `@iabgpp/cmpapi@3.2.0`.

**Фактичний stdout:**

```text
node v22.23.2
package @iabgpp/cmpapi@3.2.0
input DBABrw~CAAQAAAAAABA.QA~BAgAAABA.QA
headerSectionIds [7,8]
parsedSectionNames ["usnat","usca"]
parsedSaleOptOut {"usnat":1,"usca":2}
applicableSections [8]
```

**Вердикт: підтверджено на рівні official data model/API.** Decoder повертає обидві присутні
sections; applicability залишається окремим set. Це не замір поведінки конкретного bidder, який
читає `regs.gpp_sid`.

Primary sources: [GPP header](https://github.com/InteractiveAdvertisingBureau/Global-Privacy-Platform/blob/03fdf0332d261ee896b77d7f9a10edde1498fc7c/Core/Consent%20String%20Specification.md?plain=1#L400-L442),
[applicability](https://github.com/InteractiveAdvertisingBureau/Global-Privacy-Platform/blob/03fdf0332d261ee896b77d7f9a10edde1498fc7c/implementation.md?plain=1#L263-L275).

**Що випливає для інструмента.** Виводити `present` і `applicable` окремо; не застосовувати
всі decoded sections автоматично й не називати header contents effective policy.

### B22 — structurally valid, policy-invalid TC string

**Точний вхід:**

```text
CQo4loAQo4loAAHABAENAADgAAAAADwAAAAAAAAAAAAA.IAAA.YAAAAAAAAAAA
```

String створено з `PolicyVersion=3`; на wire-рівні виставлено LI bits для purposes 3–6.

**Чим міряв.** Node `v22.23.2`; generator `@iabgpp/cmpapi@3.2.0`; decoder
`@iabtcf/core@1.5.6`; pinned TCF wire/policy constraints
([primary source](https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/bf398ec730d159d986c00c068c25119055db6c67/TCFv2/IAB%20Tech%20Lab%20-%20Consent%20string%20and%20vendor%20list%20formats%20v2.md?plain=1#L328-L350)).

**Фактичний stdout:**

```text
node v22.23.2
generator @iabgpp/cmpapi@3.2.0
decoder @iabtcf/core@1.5.6
input CQo4loAQo4loAAHABAENAADgAAAAADwAAAAAAAAAAAAA.IAAA.YAAAAAAAAAAA
decode OK
version 2
policyVersion 3
purposeLegitimateInterests [3,4,5,6]
```

**Вердикт: підтверджено для structural decoder.** Decoder прийняв string і повернув
policy-invalid values без exception. Readback підтвердив, що ручні wire bits — саме purposes
`[3,4,5,6]`; effective vendor decision не моделювався.

**Що випливає для інструмента.** Не називати успішний decode `valid`. Потрібні окремі verdicts:
`structural`, `policy` і `effective decision`, із pinned policy version.

### B25 — literal `&amp;` усередині CDATA

**Точні входи:**

```xml
<VAST version="4.3"><Ad><InLine><Impression><![CDATA[https://tracker.invalid/p.gif?a=1&amp;b=2]]></Impression></InLine></Ad></VAST>
<VAST version="4.3"><Ad><InLine><Impression>https://tracker.invalid/p.gif?a=1&amp;b=2</Impression></InLine></Ad></VAST>
```

**Чим міряв.** Node `v22.23.2`, `jsdom@29.1.1`, DOM XML parser, WHATWG `URL`.

**Фактичний stdout:**

```text
node=v22.23.2
jsdom=29.1.1
cdata.input="<VAST version=\"4.3\"><Ad><InLine><Impression><![CDATA[https://tracker.invalid/p.gif?a=1&amp;b=2]]></Impression></InLine></Ad></VAST>"
cdata.parsererrors=0
cdata.textContent="https://tracker.invalid/p.gif?a=1&amp;b=2"
cdata.query=[["a","1"],["amp;b","2"]]
entity.input="<VAST version=\"4.3\"><Ad><InLine><Impression>https://tracker.invalid/p.gif?a=1&amp;b=2</Impression></InLine></Ad></VAST>"
entity.parsererrors=0
entity.textContent="https://tracker.invalid/p.gif?a=1&b=2"
entity.query=[["a","1"],["b","2"]]
```

**Вердикт: підтверджено.** Обидва XML inputs well-formed. У CDATA п'ять символів `&amp;`
лишаються literal і створюють query key `amp;b`; у звичайному XML text entity декодується й
створює key `b`.

**Що випливає для інструмента.** Warning/repair має бути lexical-context aware: URI-bearing
CDATA можна перевіряти на literal HTML entity spelling, але глобальний HTML decode XML payload
псував би коректні дані.

### B29 — чи існує usable official VAST 4.3 XSD

**Точний вхід.** Файл `schemas/vast_4.3.xsd` з official
`InteractiveAdvertisingBureau/vast` commit `e0858cd714474bf17ef61065097456d7643ff838`, без змін;
`xmllint --noout` на цьому файлі.

**Чим міряв.** Git object inspection; `xmllint`, libxml `2.9.14`; SHA-256.

**Фактичний stdout/stderr:**

```text
upstream=https://github.com/InteractiveAdvertisingBureau/vast.git
commit=e0858cd714474bf17ef61065097456d7643ff838
artifact=/tmp/ortbtools-triage-iab-vast-e0858cd/schemas/vast_4.3.xsd
bytes=1
hex=0a
01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b  /tmp/ortbtools-triage-iab-vast-e0858cd/schemas/vast_4.3.xsd
xmllint: using libxml version 20914
/tmp/ortbtools-triage-iab-vast-e0858cd/schemas/vast_4.3.xsd:2: parser error : Start tag expected, '<' not found

^
exit_code=1
```

**Вердикт: частково підтверджено.** Official path/filename існує, але artifact — один newline,
не usable XSD і не компілюється. Тобто точніше казати «usable official 4.3 XSD unavailable»,
а не «файлу немає». Друга половина B29 — які саме VAST 4.2 spec elements відсутні в 4.2 XSD —
не вимірювалася, тому для всієї B29 verdict **не визначено**.

**Що випливає для інструмента.** Не трактувати existence filename як schema availability:
перевіряти ненульовий content і compilation. Для 4.3 показувати explicit `official XSD unusable`,
не фальшивий green/red schema verdict.

### B32 — comma в VAST array macro

**Точний вхід:**

```json
{
  "url": "https://tracker.invalid/pixel?mime=[MEDIAMIME]",
  "macros": { "MEDIAMIME": ["video/mp4", "application/x-mpegURL"] }
}
```

**Чим міряв.** Node `v22.23.2`; `@dailymotion/vast-client@6.4.5`, upstream commit
`2ff2452c9102f6070b018c33a796f7cb1027538b`; official IAB macro catalogue commit
`e0858cd714474bf17ef61065097456d7643ff838`; fake `Image` intercept.

**Фактичний stdout:**

```text
node=v22.23.2
package=@dailymotion/vast-client@6.4.5
vast_client_commit=2ff2452c9102f6070b018c33a796f7cb1027538b
iab_vast_commit=e0858cd714474bf17ef61065097456d7643ff838
spec_record={"name":"MEDIAMIME","datatype":"Array<string>","example":"Unencoded: <code>video/mp4,application/x-mpegURL</code><br>Encoded: <code>video%2Fmp4,application%2Fx-mpegURL</code>"}
input={"url":"https://tracker.invalid/pixel?mime=[MEDIAMIME]","macros":{"MEDIAMIME":["video/mp4","application/x-mpegURL"]}}
fired=["https://tracker.invalid/pixel?mime=video%2Fmp4%2Capplication%2Fx-mpegURL"]
```

**Вердикт: підтверджено.** Spec example percent-encodes each array element and leaves the comma
raw; library encoded the joined comma as `%2C`.

**Що випливає для інструмента.** Array macro values мають encode-итися поелементно й
join-итися raw comma. `%2C` між array elements варто діагностувати окремо від ordinary scalar
percent-encoding.

### B33 — `cattax` має локальний object scope

**Точний вхід:**

```json
{
  "id": "cattax-scope",
  "imp": [{ "id": "1", "banner": { "w": 300, "h": 250 } }],
  "site": {
    "cattax": 6,
    "cat": ["52"],
    "publisher": { "cat": ["IAB2-3"] },
    "content": { "cat": ["IAB3"], "producer": { "cat": ["IAB4"] } }
  }
}
```

**Чим міряв.** Node `v22.23.2`; `ortbtools@1.6.1`, commit
`27592162e75768582981922d1e9289e0ddd3109a`; `adviseMigration25To26`; pinned OpenRTB 2.6
per-object category tables.

**Фактичний stdout:**

```text
node v22.23.2
tool ortbtools@1.6.1
git 27592162e75768582981922d1e9289e0ddd3109a
input {"id":"cattax-scope","imp":[{"id":"1","banner":{"w":300,"h":250}}],"site":{"cattax":6,"cat":["52"],"publisher":{"cat":["IAB2-3"]},"content":{"cat":["IAB3"],"producer":{"cat":["IAB4"]}}}}
output [
  {
    "path": "/site/content/cattax",
    "op": "add",
    "before": null,
    "after": 1,
    "rule": "ortb26.category.cattax",
    "spec": "https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#appendix-b-specification-change-log",
    "confidence": "certain",
    "rationale": "Make the OpenRTB 2.5 default Content Taxonomy 1.0 explicit for 2.6."
  },
  {
    "path": "/site/content/producer/cattax",
    "op": "add",
    "before": null,
    "after": 1,
    "rule": "ortb26.category.cattax",
    "spec": "https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#appendix-b-specification-change-log",
    "confidence": "certain",
    "rationale": "Make the OpenRTB 2.5 default Content Taxonomy 1.0 explicit for 2.6."
  },
  {
    "path": "/site/publisher/cattax",
    "op": "add",
    "before": null,
    "after": 1,
    "rule": "ortb26.category.cattax",
    "spec": "https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#appendix-b-specification-change-log",
    "confidence": "certain",
    "rationale": "Make the OpenRTB 2.5 default Content Taxonomy 1.0 explicit for 2.6."
  }
]
```

**Вердикт: підтверджено для наявного advisor і узгоджується зі специфікацією.**
`site.cattax=6` не успадковано `publisher`, `content` і `producer`; кожному запропоновано власний
default `1`. Downstream bidder policy не вимірювалася.

Primary source tables assign their own `cattax` to
[`Site`](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L822-L846),
[`Publisher`](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L878-L891),
[`Content`](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L895-L934)
і [`Producer`](https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/1debba8001f40eb14597102dec3205afddf811d4/2.6.md#L938-L950),
кожен із default `1`; `site.cattax` не оголошено inherited.

**Що випливає для інструмента.** Резолвити taxonomy на кожному category-bearing object,
не як request-global value. Наявний migration advisor у цьому fixture поводиться правильно.

### B35 — enum value `1/2` і JavaScript truthiness

**Точний вхід.** У новій `usnat` section зроблено спробу по черзі встановити
`MspaCoveredTransaction` у `0`, `1`, `2`. Значення `1/2`, які пройшли validation, encode-илися
й декодувалися новою model; після цього до decoded number застосовано `Boolean(value)` і
звичайний `if (value)`. Значення `0` було відхилене до encoding.

Exact setup/API для кожного `inputValue`:

```text
const model = new GppModel();
model.setFieldValue('usnat', 'MspaCoveredTransaction', inputValue);
const encoded = model.encode();
const decodedValue = new GppModel(encoded).getFieldValue('usnat', 'MspaCoveredTransaction');
```

**Чим міряв.** Node `v22.23.2`, `@iabgpp/cmpapi@3.2.0`.

**Фактичний stdout:**

```text
node=v22.23.2
package=@iabgpp/cmpapi@3.2.0
section=usnat
field=MspaCoveredTransaction
{"inputValue":0,"error":"ValidationError: Invalid value '0'"}
{"inputValue":1,"encoded":"DBABLA~CAAAAAAAAABA.QA","decodedValue":1,"Boolean":true,"ifBranch":"taken"}
{"inputValue":2,"encoded":"DBABLA~CAAAAAAAAACA.QA","decodedValue":2,"Boolean":true,"ifBranch":"taken"}
```

**Вердикт: не визначено для повної гіпотези; механізм enum truthiness підтверджено.** Package
зберіг і повернув distinct values `1` та `2`, але обидва зайшли в той самий JS branch. Жодного
конкретного production consumer, який робить це coercion, не було названо чи запущено. Array
truncation і різні same-name field lengths також не вимірювалися.

**Що випливає для інструмента.** GPP enums мають лишатися typed enums, не booleans. Detector
може ловити `Boolean(enum)`-подібну projection лише у відомому mapper/consumer; не треба
позначати сам decoder defective — він повернув обидва значення правильно.

### B36 — unknown GPP SID губиться з object projection

**Точний вхід:**

```text
DBABBGA~AAAA
```

Input header має `SectionIds:[63]`; `AAAA` — opaque body невідомої section. Другий етап того
самого заміру додавав відому `usnat` section і повторно кодував model.

Exact setup і second-stage mutation:

```text
const model = new GppModel("DBABBGA~AAAA");
const parsedObject = model.toObject();
const modelHeaderAfterParse = model.getHeader();
const hasSectionId63 = model.hasSectionId(63);
const encodedWithoutMutation = model.encode();
model.setFieldValue("usnat", "SaleOptOut", 1);
const encodedAfterKnownMutation = model.encode();
const headerAfterKnownMutation = new GppModel(encodedAfterKnownMutation).getHeader();
```

**Чим міряв.** Node `v22.23.2`, `@iabgpp/cmpapi@3.2.0`; fixed-dispatch source pinned на
[`fd0546e…`](https://github.com/IABTechLab/iabgpp-es/blob/fd0546e7b28e7e186bc27aac6375e6c10a80e47e/modules/cmpapi/src/encoder/GppModel.ts?plain=1#L279-L390).

**Фактичний stdout:**

```text
{
  "node": "v22.23.2",
  "package": "@iabgpp/cmpapi@3.2.0",
  "input": "DBABBGA~AAAA",
  "inputHeader": {
    "Id": 3,
    "Version": 1,
    "SectionIds": [
      63
    ]
  },
  "parsedObject": {},
  "modelHeaderAfterParse": {
    "Id": 3,
    "Version": 1,
    "SectionIds": []
  },
  "hasSectionId63": false,
  "encodedWithoutMutation": "DBABBGA~AAAA",
  "encodedAfterKnownMutation": "DBABLA~CAAQAAAAAABA.QA",
  "headerAfterKnownMutation": {
    "Id": 3,
    "Version": 1,
    "SectionIds": [
      7
    ]
  }
}
```

**Вердикт: підтверджено.** Без mutation model ще повертає cached raw string byte-for-byte,
але object projection і model header вже втратили SID 63. Після звичайної known-section mutation
та re-encode unknown SID/body реально зникають. Semantic validity unknown body за визначенням
не перевірялася; вимірювалася opaque preservation.

**Що випливає для інструмента.** Unknown section треба зберігати окремо як `{sid, raw}` і
показувати `unsupported section`; decoded object не може бути єдиним source of truth. Mutation
має або round-trip-ити opaque sections, або явно вимагати підтвердження втрати.

### B37 — чи зливає ortbtools absent COPPA з explicit `0`

**Точні входи:**

```json
{"id":"req-1","imp":[{"id":"imp-1","banner":{"w":300,"h":250}}],"user":{"id":"user-1"},"regs":{}}
{"id":"req-1","imp":[{"id":"imp-1","banner":{"w":300,"h":250}}],"user":{"id":"user-1"},"regs":{"coppa":0}}
{"id":"req-1","imp":[{"id":"imp-1","banner":{"w":300,"h":250}}],"user":{"id":"user-1"},"regs":{"coppa":1}}
```

**Чим міряв.** Node `v22.23.2`, `@ortbtools/core@0.31.0`, `validate`; raw JS property-presence
check через `Object.hasOwn`.

**Фактичний stdout:**

```text
node=v22.23.2
package=@ortbtools/core@0.31.0
{"name":"absent","input":"{\"id\":\"req-1\",\"imp\":[{\"id\":\"imp-1\",\"banner\":{\"w\":300,\"h\":250}}],\"user\":{\"id\":\"user-1\"},\"regs\":{}}","hasOwnCoppa":false,"valueType":"undefined","coppaFindingIds":[]}
{"name":"zero","input":"{\"id\":\"req-1\",\"imp\":[{\"id\":\"imp-1\",\"banner\":{\"w\":300,\"h\":250}}],\"user\":{\"id\":\"user-1\"},\"regs\":{\"coppa\":0}}","hasOwnCoppa":true,"value":0,"valueType":"number","coppaFindingIds":[]}
{"name":"one","input":"{\"id\":\"req-1\",\"imp\":[{\"id\":\"imp-1\",\"banner\":{\"w\":300,\"h\":250}}],\"user\":{\"id\":\"user-1\"},\"regs\":{\"coppa\":1}}","hasOwnCoppa":true,"value":1,"valueType":"number","coppaFindingIds":["regs.coppa_pii_present"]}
```

**Вердикт: не визначено.** `hasOwnCoppa` перевіряв supplied JS input, не normalized/serialized
model output. Він доводить, що сам input здатен представити три стани; `coppa:1` додатково
активує COPPA/PII finding. Findings для absent і `0` однакові, тому цей output не доводить, що
validation model семантично їх розрізняє. Так само він не показує переходу absent→`0`. Окремий
best-practice generator у `mirror.js` має defaulting code, але це інший path і тут не замірявся.

**Що випливає для інструмента.** Перед backlog verdict потрібен exact parse/normalize/serialize
oracle з output presence check для `{}`, `0`, `1`. Не позначати поточну model ані safe, ані broken
за findings-only експериментом.

## Що спростовано

- **A3:** точне твердження джерела A про `vast-client-js` хибне. Unknown three-digit code не
  стає `900`, unknown macro name не стає `-1`; каталог змішав чотири різні cases.
- **L1 — припущення в коді, не каталог:** OpenRTB 2.6 не визначає `Site.langb` або `App.langb`;
  ці definitive signals вигадані й мають бути прибрані.

## Чого бракує в середовищі

Це зведена заявка з кошика B. На машині вже є Node `v22.23.2`, npm `10.9.8`, Python `3.13.5`,
Chrome, Firefox і `xmllint`/libxml `2.9.14`; вони не входять до заявки.

- **Go toolchain + pinned PBS-Go source/module cache/test dependencies.** Потрібно для A1,
  B1, B3, B4, B8, половини B24, B31, B39 і B47. Для B31 агент визначив test area
  `endpoints/events`; каталоговий pinned PBS-Go commit для B47 —
  `df0c2bf0f4e35df7a4b9602b19c3151fc4804f30`.
- **OpenJDK/JVM, `javac`, Maven/Gradle (або project wrapper) + pinned PBS-Java та
  `iabtcf-java`.** Потрібно для A1/A2, B1/B3/B4 і Java-половини B24. Версію JDK треба взяти
  з build metadata обраного pinned commit, а не вгадувати.
- **Protocol Buffers toolchain (`protoc`) + точні partner `.proto` schemas, extension registry
  і documented int64 mapping.** Потрібно для A4 та B17. Без partner schema generic OpenRTB proto
  не є валідним oracle для цих двох claims.

`npm install`/`npm ci` у hardlinked worktree не запускався. Потрібні для проб public packages
були встановлені лише у `/tmp` поза repository.

## Де найменша впевненість

- **B9 і B27** лежать на межі A/C. Їх віднесено до A, бо сформульовані через normative spec,
  public support docs і pinned code. Якщо питання змінити на actual behavior конкретного IMA
  build, потрібен живий player і кошик стане C.
- **A5, A6 і B39** compound: нормативну половину можна закрити локально, PBS-половину — після
  toolchain, а кінцевий strict-DSP/partner outcome — лише sandbox. Кошик обрано за найсильнішим
  твердженням рядка, не за його найпростішою підчастиною.
- **B21** доведено на official GPP data model, але не на конкретному bidder, що читає
  `regs.gpp_sid`.
- **B29** закрито тільки для official 4.3 artifact. Теза про missing 4.2 elements не мірялася.
- **B33** має spec support і local implementation oracle; downstream category interpretation
  не мірялася.
- **B35** доводить лише enum truthiness mechanism. Actual buggy consumer й array truncation
  не знайдені, тому whole-row verdict лишився `не визначено`.
- **B5 (`us_privacy`)**: omission у migration advisor не є spec oracle; ця підчастина потребує
  окремого pinned 2.5→2.6 normative comparison.
- **B37**: measured findings не містять normalized payload, тому presence semantics після
  parse/serialize лишилися невизначеними.
- **A8** показує silent wrong-type gap у ortbtools, але не заявлену source-A міжпарсерну matrix.

## Найбільша зміна плану

1. **Негайна локальна корекція після handoff:** прибрати `site.langb`/`app.langb`; вони дають
   false confidence `1`. Розглянути справжні 2.6 paths як replacement signals.
2. **Не реалізовувати A3 одним правилом.** Каталогова теза спростована; потрібна four-way
   classification, інакше detector сам створить false positives.
3. **Підняти B36 вище в backlog.** Future GPP section не лише відсутня в projection — вона
   реально вилітає після звичайної known-section mutation.
4. **B5 розщепити по полях і закрити advisor omission для `us_privacy`.** B37 лишити
   невизначеним до справжнього normalized round-trip.
