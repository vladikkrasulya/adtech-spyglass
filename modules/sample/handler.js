'use strict';

/**
 * modules/sample/handler.js — GET /api/v1/sample
 *
 * Extracted from server.js as part of the backend-module migration
 * (see lib/router.js narrow waist). Returns one synthetic example
 * pulled from the on-disk samples/ corpus so the Playground's
 * "🎲 приклад" button can pre-fill request + response editors with
 * real-looking JSON.
 *
 * Handler has no closure deps — only fs/path + shared http helpers —
 * so it exports the plain module shape rather than the factory shape
 * used by replay/health.
 *
 * Sample-shape autodetect (kept verbatim from server.js):
 *   - has `seatbid`            → 2.x BidResponse; synthesise minimal request
 *   - has `openrtb.response{}` → 3.0 BidResponse; load into response editor
 *   - has imp[]/item[]/openrtb → BidRequest; load into request editor
 */

const fs = require('fs');
const path = require('path');
const { sendJson, sendError } = require('../../lib/http');
const { listLocales } = require('@ortbtools/core');

// Resolve samples/ relative to the project root. __dirname here is
// .../modules/sample/, so '..', '..' walks up to the root where the
// samples/ directory lives. Using an absolute path here keeps the
// handler indifferent to process.cwd().
const SAMPLES_DIR = path.join(__dirname, '..', '..', 'samples');

// ── Locale-aware label/note lookup ──────────────────────────────────────
//
// samples/*.json fixtures are English-only on disk: label is derived from
// the filename and note is the fixture's own `_note` field, neither with
// any locale of their own. Both reach the user verbatim — item.label is
// the /library catalog's primary clickable title and item.note its hover
// tooltip (public/modules/library/index.js) — sitting next to that same
// row's properly-localized FORMAT_LABEL/CATEGORY_LABEL chips. samples/ is
// owned by a different package brief, so per that brief's own fallback
// instruction this table lives here instead of as {en,uk,ru} fields on
// each fixture. Keyed by slug (filename minus '.json') so it lines up
// with both handlers below without re-deriving anything.
//
// Caveat worth stating plainly: nothing today sends `?locale=` to
// /api/v1/sample or /api/v1/sample/list — not public/modules/library/
// index.js, .../search/index.js, .../inspector/index.js, nor
// ortbtools.app.js's 🎲 button, none of which this package owns. This
// table activates the instant one of those callers adds the query param;
// until then every request gets the DEFAULT_LOCALE row below, same as
// before this table existed.
const DEFAULT_LOCALE = 'en'; // canonical locale — mirrors server.js DEFAULT_LOCALE

function resolveSampleLocale(url) {
  const want = url.searchParams.get('locale');
  return want && listLocales().includes(want) ? want : DEFAULT_LOCALE;
}

const SAMPLE_LABELS = {
  'iab-banner-valid': {
    en: 'IAB banner — valid',
    uk: 'IAB банер — валідний',
    ru: 'IAB баннер — валидный',
  },
  'iab-banner-with-issues': {
    en: 'IAB banner — with issues',
    uk: 'IAB банер — з проблемами',
    ru: 'IAB баннер — с проблемами',
  },
  'iab-video-valid': {
    en: 'IAB video — valid',
    uk: 'IAB відео — валідне',
    ru: 'IAB видео — валидное',
  },
  'synthetic-adpod-malformed': {
    en: 'Adpod — malformed',
    uk: 'Adpod — некоректний',
    ru: 'Adpod — некорректный',
  },
  'synthetic-auto-redirect': { en: 'Auto-redirect', uk: 'Авто-редирект', ru: 'Авто-редирект' },
  'synthetic-clean-banner': { en: 'Clean banner', uk: 'Чистий банер', ru: 'Чистый баннер' },
  'synthetic-eids-malformed': {
    en: 'EIDs — malformed',
    uk: 'EIDs — некоректні',
    ru: 'EIDs — некорректные',
  },
  'synthetic-frame-bust-anchor': {
    en: 'Frame-bust (anchor)',
    uk: 'Frame-bust (anchor)',
    ru: 'Frame-bust (anchor)',
  },
  'synthetic-frame-bust-form': {
    en: 'Frame-bust (form)',
    uk: 'Frame-bust (form)',
    ru: 'Frame-bust (form)',
  },
  'synthetic-frozen-thread': {
    en: 'Frozen thread',
    uk: 'Заморожений потік',
    ru: 'Замороженный поток',
  },
  'synthetic-gdpr-no-consent': {
    en: 'GDPR — no consent',
    uk: 'GDPR — без згоди',
    ru: 'GDPR — без согласия',
  },
  'synthetic-heavy-cpu': {
    en: 'Heavy CPU',
    uk: 'Важке навантаження CPU',
    ru: 'Тяжёлая нагрузка CPU',
  },
  'synthetic-native-clean': { en: 'Native — clean', uk: 'Native — чистий', ru: 'Native — чистый' },
  'synthetic-ortb30-broken-envelope': {
    en: 'oRTB 3.0 — broken envelope',
    uk: 'oRTB 3.0 — зламаний envelope',
    ru: 'oRTB 3.0 — сломанный envelope',
  },
  'synthetic-ortb30-clean': {
    en: 'oRTB 3.0 — clean request',
    uk: 'oRTB 3.0 — чистий запит',
    ru: 'oRTB 3.0 — чистый запрос',
  },
  'synthetic-ortb30-clean-response': {
    en: 'oRTB 3.0 — clean response',
    uk: 'oRTB 3.0 — чиста відповідь',
    ru: 'oRTB 3.0 — чистый ответ',
  },
  'synthetic-ortb30-deep-errors': {
    en: 'oRTB 3.0 — deep errors',
    uk: 'oRTB 3.0 — глибокі помилки',
    ru: 'oRTB 3.0 — глубокие ошибки',
  },
  'synthetic-ortb30-deep-response-errors': {
    en: 'oRTB 3.0 — deep response errors',
    uk: 'oRTB 3.0 — глибокі помилки відповіді',
    ru: 'oRTB 3.0 — глубокие ошибки ответа',
  },
  'synthetic-pop-broken-adm': {
    en: 'Pop — broken adm',
    uk: 'Pop — зламаний adm',
    ru: 'Pop — сломанный adm',
  },
  'synthetic-pop-clean-request': {
    en: 'Pop — clean request',
    uk: 'Pop — чистий запит',
    ru: 'Pop — чистый запрос',
  },
  'synthetic-pop-clean-response': {
    en: 'Pop — clean response',
    uk: 'Pop — чиста відповідь',
    ru: 'Pop — чистый ответ',
  },
  'synthetic-popunder-feed': { en: 'Popunder feed', uk: 'Popunder feed', ru: 'Popunder feed' },
  'synthetic-schain-malformed': {
    en: 'SChain — malformed',
    uk: 'SChain — некоректний',
    ru: 'SChain — некорректный',
  },
  'synthetic-trap-invisible-overlay': {
    en: 'Invisible-overlay trap',
    uk: 'Пастка: невидимий оверлей',
    ru: 'Ловушка: невидимый оверлей',
  },
  'synthetic-vast-broken-inline': {
    en: 'VAST — broken InLine',
    uk: 'VAST — зламаний InLine',
    ru: 'VAST — сломанный InLine',
  },
  'synthetic-vast-clean-inline': {
    en: 'VAST — clean InLine',
    uk: 'VAST — чистий InLine',
    ru: 'VAST — чистый InLine',
  },
  'synthetic-vast-insecure-wrapper': {
    en: 'VAST — insecure Wrapper',
    uk: 'VAST — небезпечний Wrapper',
    ru: 'VAST — небезопасный Wrapper',
  },
  'synthetic-vast-vpaid-deprecated': {
    en: 'VAST — VPAID deprecated',
    uk: 'VAST — VPAID застарілий',
    ru: 'VAST — VPAID устаревший',
  },
  'behavior-scenarios': {
    en: 'Behavior scenarios',
    uk: 'Сценарії поведінки',
    ru: 'Сценарии поведения',
  },
};

// Only fixtures that actually carry a non-empty `_note` on disk get a row
// here — everything else keeps falling through to the '' fallback both
// handlers already pass in below, exactly as before this table existed.
const SAMPLE_NOTES = {
  'synthetic-auto-redirect': {
    en: "Synthetic fraud BidResponse — auto-redirect without user gesture. The adm renders a visible banner AND fires a setTimeout-driven location.href change 100ms after load. Probe hooks 2/3 (Location.href setter override) catch the assignment; classifyTrigger sees an empty event-stack so kind=auto_navigate. navContext attaches msSinceGesture=-1 (no gesture observed yet) and withinGestureGrace=false. Engine's autoRedirect rule promotes to behavior.malicious.auto_redirect (ERROR). Sandbox blocks the actual nav, but the intent is recorded.",
    uk: 'Синтетична фрод-BidResponse — авто-редирект без жесту користувача. adm рендерить видимий банер І запускає зміну location.href через setTimeout за 100мс після завантаження. Probe hooks 2/3 (перехоплення сеттера Location.href) фіксують присвоєння; classifyTrigger бачить порожній event-stack, тож kind=auto_navigate. navContext додає msSinceGesture=-1 (жесту ще не було) і withinGestureGrace=false. Правило autoRedirect рушія підвищує це до behavior.malicious.auto_redirect (ERROR). Sandbox блокує саму навігацію, але намір зафіксовано.',
    ru: 'Синтетический фрод-BidResponse — авто-редирект без жеста пользователя. adm рендерит видимый баннер И запускает изменение location.href через setTimeout спустя 100мс после загрузки. Probe hooks 2/3 (перехват сеттера Location.href) фиксируют присвоение; classifyTrigger видит пустой event-stack, поэтому kind=auto_navigate. navContext добавляет msSinceGesture=-1 (жеста ещё не было) и withinGestureGrace=false. Правило autoRedirect движка повышает это до behavior.malicious.auto_redirect (ERROR). Sandbox блокирует саму навигацию, но намерение зафиксировано.',
  },
  'synthetic-clean-banner': {
    en: "Clean baseline — well-formed BidResponse with a benign HTML banner. No frame-bust, no heavy CPU, no probes triggered, no auto-anything. Pure click-via-anchor with target=_blank rel=noopener. Validator should emit 0 ERROR findings (an INFO or WARN at most). Used as the control case for A/B comparisons against synthetic-* attack patterns — first-time visitors load this, hit Analyze, see what 'clean' looks like before exploring the malicious specimens.",
    uk: 'Чиста базова лінія — коректна BidResponse із безпечним HTML-банером. Без frame-bust, без важкого CPU, жоден probe не спрацьовує, жодного авто-чогось. Чистий клік через anchor з target=_blank rel=noopener. Валідатор має видати 0 ERROR-знахідок (щонайбільше INFO чи WARN). Використовується як контрольний кейс для A/B-порівнянь із synthetic-* атаками — новий відвідувач завантажує це, тисне Analyze і бачить, як виглядає «чисто», перш ніж дослідити шкідливі зразки.',
    ru: 'Чистая базовая линия — корректный BidResponse с безопасным HTML-баннером. Без frame-bust, без тяжёлой нагрузки CPU, ни один probe не срабатывает, никакого авто-чего-либо. Чистый клик через anchor с target=_blank rel=noopener. Валидатор должен выдать 0 ERROR-находок (максимум INFO или WARN). Используется как контрольный кейс для A/B-сравнений с synthetic-* атаками — новый посетитель загружает это, жмёт Analyze и видит, как выглядит «чисто», прежде чем исследовать вредоносные образцы.',
  },
  'synthetic-frame-bust-anchor': {
    en: 'Synthetic fraud BidResponse — anchor-based frame-bust. The adm renders a visible banner AND a hidden <a target="_top" href="..."> element which is .click()-ed programmatically 100ms after load (no user gesture). Probe hook 11 (capture-phase document click + closest anchor[target]) catches the navigation intent; engine emits behavior.malicious.frame_bust_anchor (ERROR — no gesture lineage). HTML-only frame-bust bypasses our window.open / Location.* hooks entirely because the browser routes target=_top anchors through the top-frame nav code path directly.',
    uk: 'Синтетична фрод-BidResponse — frame-bust через anchor. adm рендерить видимий банер І прихований елемент <a target="_top" href="...">, по якому програмно викликається .click() за 100мс після завантаження (без жесту користувача). Probe hook 11 (click на document у capture-фазі + closest anchor[target]) фіксує намір навігації; рушій видає behavior.malicious.frame_bust_anchor (ERROR — без ланцюжка жесту). HTML-only frame-bust повністю обходить наші хуки window.open / Location.*, бо браузер веде anchor з target=_top напряму через код навігації top-фрейму.',
    ru: 'Синтетический фрод-BidResponse — frame-bust через anchor. adm рендерит видимый баннер И скрытый элемент <a target="_top" href="...">, по которому программно вызывается .click() спустя 100мс после загрузки (без жеста пользователя). Probe hook 11 (click на document в capture-фазе + closest anchor[target]) фиксирует намерение навигации; движок выдаёт behavior.malicious.frame_bust_anchor (ERROR — без цепочки жеста). HTML-only frame-bust полностью обходит наши хуки window.open / Location.*, потому что браузер ведёт anchor с target=_top напрямую через код навигации top-фрейма.',
  },
  'synthetic-frame-bust-form': {
    en: 'Synthetic fraud BidResponse — form-based frame-bust. The adm renders a visible banner AND mounts a hidden <form target="_top" action="..."> that auto-submits 100ms after load (no user gesture). Probe hook 12.A (HTMLFormElement.prototype.submit) catches the call; engine emits behavior.malicious.frame_bust_form (ERROR). Sandbox itself blocks the actual top-frame navigation, but the intent is what we surface. Used as truth-ground for the form-bust rule during Phase 3.',
    uk: 'Синтетична фрод-BidResponse — frame-bust через форму. adm рендерить видимий банер І монтує приховану <form target="_top" action="...">, яка автоматично сабмітиться за 100мс після завантаження (без жесту користувача). Probe hook 12.A (перехоплення HTMLFormElement.prototype.submit) фіксує виклик; рушій видає behavior.malicious.frame_bust_form (ERROR). Sandbox сам блокує фактичну навігацію top-фрейму, але саме намір ми і показуємо. Використовується як еталон для правила form-bust у Фазі 3.',
    ru: 'Синтетический фрод-BidResponse — frame-bust через форму. adm рендерит видимый баннер И монтирует скрытую <form target="_top" action="...">, которая автоматически сабмитится спустя 100мс после загрузки (без жеста пользователя). Probe hook 12.A (перехват HTMLFormElement.prototype.submit) фиксирует вызов; движок выдаёт behavior.malicious.frame_bust_form (ERROR). Sandbox сам блокирует фактическую навигацию top-фрейма, но именно намерение мы и показываем. Используется как эталон для правила form-bust в Фазе 3.',
  },
  'synthetic-frozen-thread': {
    en: "Synthetic fraud BidResponse — frozen JS thread. The adm renders a visible banner AND fires while(true){} 200ms after load. The probe sends one heartbeat at probe_ready, then the thread blocks indefinitely — no further heartbeats reach the parent. The parent watchdog (ortbtools.app.js, FROZEN_THRESHOLD_MS=3500) detects the absence after 3.5s and injects a synthetic kind:'frozen_thread' event into __ortbtoolsBehavior.events; engine promotes it to behavior.malicious.frozen_thread (ERROR). This is the only Phase 4 vector that REQUIRES a parent-side detection — a frozen probe cannot self-report.",
    uk: "Синтетична фрод-BidResponse — заморожений JS-потік. adm рендерить видимий банер І запускає while(true){} за 200мс після завантаження. Probe надсилає один heartbeat на probe_ready, після чого потік блокується назавжди — жоден наступний heartbeat не доходить до батьківського вікна. Батьківський watchdog (ortbtools.app.js, FROZEN_THRESHOLD_MS=3500) фіксує відсутність через 3.5с і додає синтетичну подію kind:'frozen_thread' у __ortbtoolsBehavior.events; рушій підвищує це до behavior.malicious.frozen_thread (ERROR). Це єдиний вектор Фази 4, який ПОТРЕБУЄ детекції з боку батьківського вікна — заморожений probe не може повідомити сам про себе.",
    ru: "Синтетический фрод-BidResponse — замороженный JS-поток. adm рендерит видимый баннер И запускает while(true){} спустя 200мс после загрузки. Probe отправляет один heartbeat на probe_ready, после чего поток блокируется навсегда — ни один следующий heartbeat не доходит до родительского окна. Родительский watchdog (ortbtools.app.js, FROZEN_THRESHOLD_MS=3500) фиксирует отсутствие через 3.5с и добавляет синтетическое событие kind:'frozen_thread' в __ortbtoolsBehavior.events; движок повышает это до behavior.malicious.frozen_thread (ERROR). Это единственный вектор Фазы 4, который ТРЕБУЕТ детекции со стороны родительского окна — замороженный probe не может сообщить о себе сам.",
  },
  'synthetic-gdpr-no-consent': {
    en: 'Synthetic GDPR privacy scenario — EU traffic with regs.ext.gdpr=1 but no user.ext.consent TCF string. Validator should fire regs.gdpr_consent_missing. This is the most common privacy compliance gap seen in real programmatic traffic.',
    uk: 'Синтетичний GDPR-сценарій — EU-трафік із regs.ext.gdpr=1, але без TCF-рядка user.ext.consent. Валідатор має видати regs.gdpr_consent_missing. Це найпоширеніша прогалина privacy-комплаєнсу в реальному programmatic-трафіку.',
    ru: 'Синтетический GDPR-сценарий — EU-трафик с regs.ext.gdpr=1, но без TCF-строки user.ext.consent. Валидатор должен выдать regs.gdpr_consent_missing. Это самый распространённый пробел privacy-комплаенса в реальном programmatic-трафике.',
  },
  'synthetic-heavy-cpu': {
    en: "Synthetic fraud BidResponse — heavy CPU usage. The adm renders a visible banner AND chains setTimeout(blockingChunk, 0) where each chunk busy-loops for 120ms. This generates a stream of `longtask` PerformanceObserver entries (>50ms = longtask threshold). Cumulative blocking crosses the 4s-in-30s Chrome HAI window threshold within ~35 chunks (~5 seconds wall-clock). Probe hook 13 (PerformanceObserver longtask) accumulates duration; engine emits behavior.malicious.heavy_ad_cpu (ERROR) once breachedThreshold='window' fires. The setTimeout(_, 0) yield between chunks is critical — without it the thread freezes and we'd hit the watchdog instead.",
    uk: "Синтетична фрод-BidResponse — важке навантаження CPU. adm рендерить видимий банер І ланцюжком запускає setTimeout(blockingChunk, 0), де кожен chunk крутиться в busy-loop 120мс. Це генерує потік записів `longtask` у PerformanceObserver (поріг longtask — >50мс). Кумулятивне блокування перетинає поріг Chrome HAI 4с-за-30с приблизно за ~35 chunk-ів (~5 секунд реального часу). Probe hook 13 (PerformanceObserver longtask) накопичує тривалість; рушій видає behavior.malicious.heavy_ad_cpu (ERROR), щойно спрацьовує breachedThreshold='window'. Yield через setTimeout(_, 0) між chunk-ами критично важливий — без нього потік завис би і замість цього спрацював watchdog.",
    ru: "Синтетический фрод-BidResponse — тяжёлая нагрузка CPU. adm рендерит видимый баннер И цепочкой запускает setTimeout(blockingChunk, 0), где каждый chunk крутится в busy-loop 120мс. Это генерирует поток записей `longtask` в PerformanceObserver (порог longtask — >50мс). Кумулятивная блокировка пересекает порог Chrome HAI 4с-за-30с примерно за ~35 chunk-ов (~5 секунд реального времени). Probe hook 13 (PerformanceObserver longtask) накапливает длительность; движок выдаёт behavior.malicious.heavy_ad_cpu (ERROR), как только срабатывает breachedThreshold='window'. Yield через setTimeout(_, 0) между chunk-ами критически важен — без него поток завис бы и вместо этого сработал watchdog.",
  },
  'synthetic-native-clean': {
    en: 'Clean OpenRTB 2.5 Native 1.2 BidRequest — used by the /native landing CTA (?sample=native-clean) and the random sample pool. imp[].native.request is a stringified Native 1.2 markup request with title/img/data assets, each with an id the response must echo back.',
    uk: 'Чистий OpenRTB 2.5 Native 1.2 BidRequest — використовується CTA лендингу /native (?sample=native-clean) і пулом випадкових зразків. imp[].native.request — це рядковий запит розмітки Native 1.2 з title/img/data-ассетами, кожен зі своїм id, який відповідь має повторити.',
    ru: 'Чистый OpenRTB 2.5 Native 1.2 BidRequest — используется CTA лендинга /native (?sample=native-clean) и пулом случайных образцов. imp[].native.request — это строковый запрос разметки Native 1.2 с title/img/data-ассетами, каждый со своим id, который ответ должен повторить.',
  },
  'synthetic-ortb30-broken-envelope': {
    en: 'Broken oRTB 3.0 BidRequest — envelope present but required fields are missing or wrong: openrtb.ver is empty, openrtb.request.id is missing, item[0].id is missing, item[0].spec is missing, no context. Validator should emit ~5 ERRORs + 1 WARN + the deep_validation_limited INFO note. Useful to demonstrate every per-item rule firing in one paste.',
    uk: "Зламаний oRTB 3.0 BidRequest — envelope присутній, але обов'язкові поля відсутні або некоректні: openrtb.ver порожній, openrtb.request.id відсутній, item[0].id відсутній, item[0].spec відсутній, немає context. Валідатор має видати ~5 ERROR + 1 WARN + інформаційну нотатку deep_validation_limited. Зручно, щоб показати спрацювання кожного per-item правила в одному вставленні.",
    ru: 'Сломанный oRTB 3.0 BidRequest — envelope присутствует, но обязательные поля отсутствуют или некорректны: openrtb.ver пуст, openrtb.request.id отсутствует, item[0].id отсутствует, item[0].spec отсутствует, нет context. Валидатор должен выдать ~5 ERROR + 1 WARN + информационную заметку deep_validation_limited. Удобно, чтобы показать срабатывание каждого per-item правила в одной вставке.',
  },
  'synthetic-ortb30-clean': {
    en: 'Clean oRTB 3.0 BidRequest — all required envelope + item structure fields present. Validator should emit only the request.30.deep_validation_limited INFO note. This is the 3.0 control case.',
    uk: "Чистий oRTB 3.0 BidRequest — усі обов'язкові поля envelope та структури item на місці. Валідатор має видати лише інформаційну нотатку request.30.deep_validation_limited. Це контрольний кейс для 3.0.",
    ru: 'Чистый oRTB 3.0 BidRequest — все обязательные поля envelope и структуры item на месте. Валидатор должен выдать только информационную заметку request.30.deep_validation_limited. Это контрольный кейс для 3.0.',
  },
  'synthetic-ortb30-clean-response': {
    en: 'Clean oRTB 3.0 BidResponse — well-formed envelope with one seatbid carrying one bid. Validator should emit only the response.30.deep_validation_limited INFO note. The 3.0 control case for responses.',
    uk: 'Чиста oRTB 3.0 BidResponse — коректний envelope з одним seatbid, що несе одну ставку. Валідатор має видати лише інформаційну нотатку response.30.deep_validation_limited. Контрольний кейс 3.0 для відповідей.',
    ru: 'Чистый oRTB 3.0 BidResponse — корректный envelope с одним seatbid, несущим одну ставку. Валидатор должен выдать только информационную заметку response.30.deep_validation_limited. Контрольный кейс 3.0 для ответов.',
  },
  'synthetic-ortb30-deep-errors': {
    en: 'Synthetic oRTB 3.0 BidRequest containing context and placement spec validation errors.',
    uk: 'Синтетичний oRTB 3.0 BidRequest із помилками валідації context та placement spec.',
    ru: 'Синтетический oRTB 3.0 BidRequest с ошибками валидации context и placement spec.',
  },
  'synthetic-ortb30-deep-response-errors': {
    en: 'Synthetic oRTB 3.0 BidResponse containing creative and media validation errors.',
    uk: 'Синтетична oRTB 3.0 BidResponse із помилками валідації creative та media.',
    ru: 'Синтетический oRTB 3.0 BidResponse с ошибками валидации creative и media.',
  },
  'synthetic-pop-broken-adm': {
    en: 'Pop BidResponse with WRONG adm shape — bid declares popunder intent via bid.ext.adtype but ships banner HTML (<img>) in adm instead of a redirect / window.open script. pop-response plugin MUST fire bid.pop.adm_not_redirect (ERROR). This is the negative-case fixture for the pop-response rule.',
    uk: 'Pop BidResponse із НЕВІРНОЮ формою adm — bid декларує намір popunder через bid.ext.adtype, але постачає в adm банерний HTML (<img>) замість редиректу чи скрипту window.open. Плагін pop-response МАЄ видати bid.pop.adm_not_redirect (ERROR). Це негативний кейс для правила pop-response.',
    ru: 'Pop BidResponse с НЕВЕРНОЙ формой adm — bid декларирует намерение popunder через bid.ext.adtype, но поставляет в adm баннерный HTML (<img>) вместо редиректа или скрипта window.open. Плагин pop-response ДОЛЖЕН выдать bid.pop.adm_not_redirect (ERROR). Это негативный кейс для правила pop-response.',
  },
  'synthetic-pop-clean-request': {
    en: "Clean popunder BidRequest. Vendor-shape declaration via imp.ext.adtype + fcap + btype:[4] + secure:0. Validator should emit 0 imp.pop.* findings (all three pop-request rules satisfied). detectFormat() should tag this as ['banner','pops']. Use as the pop-side control case alongside iab-banner-valid.json.",
    uk: "Чистий popunder BidRequest. Декларація vendor-форми через imp.ext.adtype + fcap + btype:[4] + secure:0. Валідатор має видати 0 знахідок imp.pop.* (усі три правила pop-request виконані). detectFormat() має позначити це як ['banner','pops']. Використовуй як контрольний кейс для pop-сторони поряд із iab-banner-valid.json.",
    ru: "Чистый popunder BidRequest. Декларация vendor-формы через imp.ext.adtype + fcap + btype:[4] + secure:0. Валидатор должен выдать 0 находок imp.pop.* (все три правила pop-request выполнены). detectFormat() должен пометить это как ['banner','pops']. Используй как контрольный кейс для pop-стороны рядом с iab-banner-valid.json.",
  },
  'synthetic-pop-clean-response': {
    en: "Clean popunder BidResponse matching synthetic-pop-clean-request.json. Bid declares pop intent via bid.ext.adtype and ships a window.open script in adm. pop-response plugin's bid.pop.adm_not_redirect rule must NOT fire. detectFormat() should tag this as ['pops'].",
    uk: "Чиста popunder BidResponse, парна до synthetic-pop-clean-request.json. Bid декларує намір pop через bid.ext.adtype і постачає в adm скрипт window.open. Правило bid.pop.adm_not_redirect плагіна pop-response НЕ має спрацювати. detectFormat() має позначити це як ['pops'].",
    ru: "Чистая popunder BidResponse, парная к synthetic-pop-clean-request.json. Bid декларирует намерение pop через bid.ext.adtype и поставляет в adm скрипт window.open. Правило bid.pop.adm_not_redirect плагина pop-response НЕ должно сработать. detectFormat() должен пометить это как ['pops'].",
  },
  'synthetic-popunder-feed': {
    en: "Single-object JSON-feed popunder, pop vendor D-style shape: redirecturl + bid + frequency-cap metadata, no banner-like creative assets (no title / image / icon). detectFormat() should classify this as ['pops']. rules-feed dispatches by single-vendor detection — this lands in the bidredirect branch (which checks redirecturl + bid).",
    uk: "Single-object JSON-feed popunder, форма vendor D-style: redirecturl + bid + метадані частотного кепу, без банерних креатив-ассетів (без title / image / icon). detectFormat() має класифікувати це як ['pops']. rules-feed диспетчеризує за детекцією одного вендора — це потрапляє у гілку bidredirect (яка перевіряє redirecturl + bid).",
    ru: "Single-object JSON-feed popunder, форма vendor D-style: redirecturl + bid + метаданные частотного кепа, без баннерных креатив-ассетов (без title / image / icon). detectFormat() должен классифицировать это как ['pops']. rules-feed диспетчеризует по детекции одного вендора — это попадает в ветку bidredirect (которая проверяет redirecturl + bid).",
  },
  'synthetic-trap-invisible-overlay': {
    en: 'Synthetic fraud BidResponse — invisible-overlay click trap. The adm payload renders a visible banner image AND a transparent fullscreen <div> on top of it. Any click anywhere in the iframe lands on the trap div, not on the visible image. The Behavior probe (public/creative-probe.js) flags this as `invisible_overlay_click`; the engine (packages/core/behavior) promotes it to a `behavior.trap.invisible_overlay` finding (severity: error). Used as truth-ground for the heuristic during Phase 1.',
    uk: 'Синтетична фрод-BidResponse — click-пастка з невидимим оверлеєм. Payload у adm рендерить видиме банерне зображення І прозорий fullscreen <div> поверх нього. Будь-який клік у будь-якій точці iframe потрапляє на div-пастку, а не на видиме зображення. Behavior-probe (public/creative-probe.js) позначає це як `invisible_overlay_click`; рушій (packages/core/behavior) підвищує це до знахідки `behavior.trap.invisible_overlay` (рівень: error). Використовується як еталон для евристики під час Фази 1.',
    ru: 'Синтетический фрод-BidResponse — click-ловушка с невидимым оверлеем. Payload в adm рендерит видимое баннерное изображение И прозрачный fullscreen <div> поверх него. Любой клик в любой точке iframe попадает на div-ловушку, а не на видимое изображение. Behavior-probe (public/creative-probe.js) помечает это как `invisible_overlay_click`; движок (packages/core/behavior) повышает это до находки `behavior.trap.invisible_overlay` (уровень: error). Используется как эталон для эвристики во время Фазы 1.',
  },
  'synthetic-vast-broken-inline': {
    en: 'Broken VAST InLine — missing version attribute on <VAST>, missing <AdSystem>, missing <MediaFile>. Validator should emit: vast.version_missing (ERROR), vast.adsystem_missing (ERROR), vast.mediafile_missing (ERROR). Useful for showing all 3 InLine integrity rules firing in one paste.',
    uk: 'Зламаний VAST InLine — відсутній атрибут version у <VAST>, відсутній <AdSystem>, відсутній <MediaFile>. Валідатор має видати: vast.version_missing (ERROR), vast.adsystem_missing (ERROR), vast.mediafile_missing (ERROR). Зручно, щоб показати спрацювання всіх 3 правил цілісності InLine в одному вставленні.',
    ru: 'Сломанный VAST InLine — отсутствует атрибут version у <VAST>, отсутствует <AdSystem>, отсутствует <MediaFile>. Валидатор должен выдать: vast.version_missing (ERROR), vast.adsystem_missing (ERROR), vast.mediafile_missing (ERROR). Удобно, чтобы показать срабатывание всех 3 правил целостности InLine в одной вставке.',
  },
  'synthetic-vast-clean-inline': {
    en: 'Clean VAST 4.2 InLine. Valid BidResponse with a well-formed video creative. All required VAST elements present (version, AdSystem, AdTitle, MediaFile, Impression, ClickThrough). All URLs are https. Validator should emit 0 vast.* findings. Use as the video-side control case alongside synthetic-clean-banner.json.',
    uk: "Чистий VAST 4.2 InLine. Коректна BidResponse із правильно сформованим відео-креативом. Усі обов'язкові елементи VAST на місці (version, AdSystem, AdTitle, MediaFile, Impression, ClickThrough). Усі URL — https. Валідатор має видати 0 знахідок vast.*. Використовуй як контрольний кейс для відео-сторони поряд із synthetic-clean-banner.json.",
    ru: 'Чистый VAST 4.2 InLine. Корректный BidResponse с правильно сформированным видео-креативом. Все обязательные элементы VAST на месте (version, AdSystem, AdTitle, MediaFile, Impression, ClickThrough). Все URL — https. Валидатор должен выдать 0 находок vast.*. Используй как контрольный кейс для видео-стороны рядом с synthetic-clean-banner.json.',
  },
  'synthetic-vast-insecure-wrapper': {
    en: 'VAST 3.0 Wrapper with VASTAdTagURI present (so wrapper_no_tag_uri does NOT fire) but with three insecure http:// URLs in trackers. Validator should emit: vast.insecure_url WARN with count=3. Demonstrates the mixed-content rule on real wrapper traffic.',
    uk: 'VAST 3.0 Wrapper із наявним VASTAdTagURI (тому wrapper_no_tag_uri НЕ спрацьовує), але з трьома незахищеними http://-URL у трекерах. Валідатор має видати: vast.insecure_url WARN із count=3. Демонструє правило mixed-content на реальному wrapper-трафіку.',
    ru: 'VAST 3.0 Wrapper с присутствующим VASTAdTagURI (поэтому wrapper_no_tag_uri НЕ срабатывает), но с тремя незащищёнными http://-URL в трекерах. Валидатор должен выдать: vast.insecure_url WARN с count=3. Демонстрирует правило mixed-content на реальном wrapper-трафике.',
  },
  'synthetic-vast-vpaid-deprecated': {
    en: 'VAST 3.0 InLine declaring apiFramework="VPAID". VPAID was deprecated in VAST 4.1 and REMOVED in 4.2 — most modern SSPs flag it as legacy/risk. Validator should emit: vast.vpaid_deprecated WARN. Plus version is 3.0 (still supported), so no version_unknown. Plus a Linear without Duration → vast.linear_duration_missing ERROR. Useful to demo two of the new rules.',
    uk: 'VAST 3.0 InLine з декларацією apiFramework="VPAID". VPAID оголошено застарілим у VAST 4.1 і ВИДАЛЕНО у 4.2 — більшість сучасних SSP позначають це як legacy/ризик. Валідатор має видати: vast.vpaid_deprecated WARN. Плюс версія 3.0 (ще підтримується), тож version_unknown не спрацьовує. Плюс Linear без Duration → vast.linear_duration_missing ERROR. Зручно, щоб показати два нові правила одразу.',
    ru: 'VAST 3.0 InLine с декларацией apiFramework="VPAID". VPAID объявлен устаревшим в VAST 4.1 и УДАЛЁН в 4.2 — большинство современных SSP помечают это как legacy/риск. Валидатор должен выдать: vast.vpaid_deprecated WARN. Плюс версия 3.0 (ещё поддерживается), поэтому version_unknown не срабатывает. Плюс Linear без Duration → vast.linear_duration_missing ERROR. Удобно, чтобы показать два новых правила сразу.',
  },
};

function localizedLabel(slug, fallback, locale) {
  const row = SAMPLE_LABELS[slug];
  return (row && (row[locale] || row.en)) || fallback;
}

function localizedNote(slug, fallback, locale) {
  const row = SAMPLE_NOTES[slug];
  return (row && (row[locale] || row.en)) || fallback;
}

function handleSample(req, res) {
  try {
    const dir = SAMPLES_DIR;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('synthetic-') && f.endsWith('.json'));
    if (!files.length) return sendError(res, 503, 'no_samples', 'Sample corpus is empty');
    // Optional ?type=<slug> picks a specific specimen (e.g. type=clean-banner,
    // type=frame-bust-form). Slug is matched against the filename minus the
    // 'synthetic-' prefix and '.json' suffix. Anything unmatched falls back
    // to random — keeps the URL forgiving for bookmarks / typos.
    const url = new URL(req.url, 'http://x');
    const wanted = (url.searchParams.get('type') || '').trim();
    let pick = null;
    if (wanted) {
      // Explicit ?type= can resolve to either a synthetic-<slug>.json (the
      // random pool) or a non-prefixed <slug>.json (curated IAB fixtures
      // — iab-banner-valid, iab-video-valid). Random pick still uses the
      // synthetic-* filter below so curated fixtures stay opt-in.
      const allFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      const match = allFiles.find(
        (f) => f === 'synthetic-' + wanted + '.json' || f === wanted + '.json',
      );
      if (match) pick = match;
    }
    if (!pick) pick = files[Math.floor(Math.random() * files.length)];
    const sample = JSON.parse(fs.readFileSync(path.join(dir, pick), 'utf8'));
    const locale = resolveSampleLocale(url);
    const slug = pick.replace(/\.json$/, '');
    const fallbackLabel = pick
      .replace(/^synthetic-/, '')
      .replace(/\.json$/, '')
      .replace(/-/g, ' ');
    const label = localizedLabel(slug, fallbackLabel, locale);
    const note = localizedNote(slug, sample._note, locale);

    // Sample shape autodetect:
    //   - has `seatbid` → it IS a BidResponse; synthesize a matching 2.x
    //     BidRequest from the first bid (today's path, used by every
    //     creative-attack specimen)
    //   - has `openrtb` OR top-level `item[]` OR top-level `imp[]` → it
    //     IS a BidRequest; load it directly into the request editor and
    //     leave the response editor empty (used by 3.0 samples + future
    //     request-only specimens)
    const isPlainObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
    // Three discriminators:
    //   1. legacy 2.x BidResponse — has top-level `seatbid[]`
    //   2. oRTB 3.0 BidResponse — has `openrtb.response{}` envelope
    //   3. BidRequest (2.x or 3.0) — has imp[] / item[] / openrtb.request{}
    //      OR `openrtb` envelope without `response` (broken 3.0 request)
    const is2xResponse = Array.isArray(sample.seatbid);
    const is30Response = isPlainObj(sample.openrtb) && isPlainObj(sample.openrtb.response);
    const isBidResponse = is2xResponse || is30Response;
    const isBidRequest =
      !isBidResponse &&
      (isPlainObj(sample.openrtb) || Array.isArray(sample.item) || Array.isArray(sample.imp));
    // `Object.assign({}, sample)` on a top-level array produces an object with
    // numeric string keys — `{"0":…,"1":…}` — a shape that exists nowhere on
    // disk and that no consumer asked for. samples/behavior-scenarios.json is
    // such an array, and `handleSampleList` lists every .json in the directory,
    // so it reaches this path as an ordinary catalog card. The transformation
    // describes itself as a copy and is not one.
    const cleanSample = Array.isArray(sample) ? sample.slice() : Object.assign({}, sample);
    // `_note` is the human description lifted into the catalog row; it is only
    // ever present on object fixtures.
    if (!Array.isArray(cleanSample)) delete cleanSample._note;

    if (isBidRequest) {
      sendJson(res, 200, {
        success: true,
        label,
        _note: note,
        bid_request: cleanSample,
        bid_response: {},
      });
      return;
    }

    if (is30Response) {
      // 3.0 BidResponse — load into the response editor, leave request
      // editor empty (no synthesized 2.x request would make sense here).
      sendJson(res, 200, {
        success: true,
        label,
        _note: note,
        bid_request: {},
        bid_response: cleanSample,
      });
      return;
    }

    // Default: treat as BidResponse and synthesize a minimal 2.x request.
    const firstBid =
      (sample.seatbid && sample.seatbid[0] && sample.seatbid[0].bid && sample.seatbid[0].bid[0]) ||
      {};
    const request = {
      id: 'demo-' + String(sample.id || 'sample').slice(0, 40),
      imp: [
        {
          id: firstBid.impid || '1',
          banner: {
            w: firstBid.w || 300,
            h: firstBid.h || 250,
          },
          bidfloor: 0.1,
          bidfloorcur: 'USD',
        },
      ],
      site: {
        id: 'demo-site',
        domain: 'example.com',
        page: 'https://example.com/demo',
        cat: ['IAB1'],
      },
      device: {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        ip: '203.0.113.42',
        devicetype: 2,
      },
      user: { id: 'demo-user' },
      at: 2,
      tmax: 200,
      cur: ['USD'],
    };
    sendJson(res, 200, {
      success: true,
      label,
      _note: note,
      bid_request: request,
      bid_response: cleanSample,
    });
  } catch (e) {
    sendError(res, 500, 'sample_failed', e.message);
  }
}

// ── GET /api/v1/sample/list — public catalog metadata ──────────────
// Returns one row per sample in samples/ for the /library section.
// Reads from disk on each request (cheap, ~21 files). _note from the
// fixture is the human description, localized against the request
// locale via SAMPLE_NOTES (falls back to the fixture's own English
// _note for anything not in that table).
function handleSampleList(req, res, parsed) {
  try {
    const dir = SAMPLES_DIR;
    const url = parsed || new URL(req.url, 'http://x');
    const locale = resolveSampleLocale(url);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'README.md');
    const items = [];
    for (const f of files) {
      let noteFallback = '';
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (raw && typeof raw === 'object' && typeof raw._note === 'string') {
          noteFallback = raw._note;
        }
      } catch (_e) {
        /* invalid JSON — skip note */
      }
      const slug = f.replace(/\.json$/, '');
      const note = localizedNote(slug, noteFallback, locale);
      // Category: iab-* fixtures are IAB-spec exemplars; clean-* are valid
      // baselines; everything else is an attack/edge-case specimen.
      let category;
      if (slug.startsWith('iab-')) {
        category = 'iab';
      } else if (
        /clean/.test(slug) &&
        !/broken|with-issues|insecure|vpaid-deprecated|invisible|frame-bust|redirect|frozen|heavy|popunder-feed/.test(
          slug,
        )
      ) {
        category = 'valid';
      } else {
        category = 'attack';
      }
      // Format heuristic from slug — banner/video/native/pop/vast/ortb30.
      let format = 'banner';
      if (/video/.test(slug)) format = 'video';
      else if (/vast/.test(slug)) format = 'vast';
      else if (/pop|popunder/.test(slug)) format = 'pop';
      else if (/native/.test(slug)) format = 'native';
      else if (/ortb30/.test(slug)) format = 'ortb30';
      // Label = slug minus prefix, hyphens to spaces (fallback for any
      // slug not in SAMPLE_LABELS, and for the `en` row of one that is).
      const fallbackLabel = slug
        .replace(/^synthetic-/, '')
        .replace(/^iab-/, 'IAB ')
        .replace(/-/g, ' ');
      const label = localizedLabel(slug, fallbackLabel, locale);
      items.push({ slug, label, category, format, note });
    }
    // Stable ordering: iab → valid → attack, alphabetical within group.
    const order = { iab: 0, valid: 1, attack: 2 };
    items.sort((a, b) => {
      const c = (order[a.category] || 9) - (order[b.category] || 9);
      return c !== 0 ? c : a.slug.localeCompare(b.slug);
    });
    res.setHeader('Cache-Control', 'public, max-age=300');
    sendJson(res, 200, { ok: true, count: items.length, items });
  } catch (e) {
    sendError(res, 500, 'list_failed', e.message);
  }
}

// ── GET /api/v1/behavior/scenarios — behavior hub catalog ──────────
// Returns all scenario entries from samples/behavior-scenarios.json.
// Cached 300s. Used by the /behavior section module.
let _scenariosCache = null;
let _scenariosCacheAt = 0;
const SCENARIOS_CACHE_TTL = 300 * 1000;

function handleBehaviorScenarios(req, res) {
  try {
    const now = Date.now();
    if (!_scenariosCache || now - _scenariosCacheAt > SCENARIOS_CACHE_TTL) {
      const scenariosPath = path.join(SAMPLES_DIR, 'behavior-scenarios.json');
      _scenariosCache = JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));
      _scenariosCacheAt = now;
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    sendJson(res, 200, { ok: true, count: _scenariosCache.length, items: _scenariosCache });
  } catch (e) {
    sendError(res, 500, 'scenarios_failed', e.message);
  }
}

module.exports = {
  id: 'sample',
  routes: [
    { method: 'GET', path: '/api/v1/sample', handler: handleSample },
    { method: 'GET', path: '/api/v1/sample/list', handler: handleSampleList },
    { method: 'GET', path: '/api/v1/behavior/scenarios', handler: handleBehaviorScenarios },
  ],
};
