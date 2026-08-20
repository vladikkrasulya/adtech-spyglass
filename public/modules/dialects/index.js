/* ============================================================
   public/modules/dialects/index.js — /dialects section module.

   One home for rule sets, in two blocks (per the v2 mockup):

     1. SHIPPED OVERLAYS — the three built-in dialects as cards.
        The card that is currently in effect carries an ACTIVE eyebrow,
        an accent outline and four corner marks; the others say
        AVAILABLE. Clicking a card makes it the active dialect (the
        same `ortbtools_dialect_v1` key the inspector's footer picker
        writes), which is what the old per-card "Copy slug" button was
        a roundabout way of doing.

     2. DISCOVERED IN YOUR TRAFFIC — the field clusters Discovery
        found locally, one row each: title, the field paths, how many
        payloads carried the whole cluster, a confidence word, and a
        "Build overlay" button that opens the Discovery builder with
        that cluster preselected. This is the surface the footer chip
        (modules/intel/banner.js) and the builder modal
        (modules/intel/builder.js) used to be the only way into.

     3. YOUR OVERLAYS — only rendered when the browser actually holds
        temporary dialects built from (2). Not in the mockup, which
        had no way to know the feature exists; same card language as
        block 1 so it does not read as a new idea.

   Data sources:
     - GET /api/v1/finding-catalog        → rule counts per dialect
     - window.OrtbtoolsIntelStorage       → local Discovery index (IDB)
     - localStorage `ortbtools_dialect_v1`→ active dialect
   ============================================================ */
'use strict';

const FALLBACK_LANG = 'en';

function pick(map, lang) {
  if (!map) return '';
  return map[lang] || map[FALLBACK_LANG] || Object.values(map)[0] || '';
}

/** `{n}` style interpolation. Always feed the result through escapeHtml. */
function fmt(str, params) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) =>
    params && params[k] != null ? String(params[k]) : m,
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tx(map, lang, params) {
  return escapeHtml(fmt(pick(map, lang), params));
}

// ── Localised strings ─────────────────────────────────────────────

const L = {
  title: { en: 'Dialects', uk: 'Діалекти', ru: 'Диалекты' },
  subtitle: {
    en: 'One home for rule sets — the overlays that ship with ortbtools, and the field clusters Discovery found in your own traffic.',
    uk: 'Одне місце для наборів правил — overlay, що йдуть у комплекті, і кластери полів, які Discovery знайшов у твоєму трафіку.',
    ru: 'Одно место для наборов правил — overlay, которые идут в комплекте, и кластеры полей, которые Discovery нашёл в твоём трафике.',
  },

  shippedHeading: {
    en: 'Shipped overlays',
    uk: 'Вбудовані overlay',
    ru: 'Встроенные overlay',
  },
  discoveredHeading: {
    en: 'Discovered in your traffic',
    uk: 'Знайдено у твоєму трафіку',
    ru: 'Найдено в твоём трафике',
  },
  customHeading: {
    en: 'Your overlays',
    uk: 'Твої overlay',
    ru: 'Твои overlay',
  },

  discoveredNote: {
    en: 'field paths only — values never leave your browser',
    uk: 'лише шляхи полів — значення не залишають браузер',
    ru: 'только пути полей — значения не покидают браузер',
  },
  newBadge: { en: '{n} new', uk: '{n} нових', ru: '{n} новых' },

  eyebrowActive: { en: 'active', uk: 'активний', ru: 'активный' },
  eyebrowAvailable: { en: 'available', uk: 'доступний', ru: 'доступный' },
  eyebrowExpired: { en: 'expired', uk: 'протермінований', ru: 'просроченный' },

  maintained: { en: 'maintained', uk: 'підтримується', ru: 'поддерживается' },
  rulesMeta: { en: '{n} rules', uk: '{n} правил', ru: '{n} правил' },
  fieldsMeta: { en: '{n} fields', uk: '{n} полів', ru: '{n} полей' },

  /* `payload` stays a bare Latin term in uk/ru, as it is everywhere else
     in i18n.js; declining it ("PAYLOAD’ІВ") reads worse than leaving the
     unit undeclined the way MB or ms would be. */
  payloadsLabel: { en: 'payloads', uk: 'payload', ru: 'payload' },
  confidenceLabel: { en: 'confidence', uk: 'впевненість', ru: 'уверенность' },
  confHigh: { en: 'high', uk: 'висока', ru: 'высокая' },
  confMedium: { en: 'medium', uk: 'середня', ru: 'средняя' },
  confLow: { en: 'low', uk: 'низька', ru: 'низкая' },

  buildOverlay: { en: 'Build overlay', uk: 'Зібрати overlay', ru: 'Собрать overlay' },
  groupTitle: { en: '{name} group', uk: 'Група {name}', ru: 'Группа {name}' },

  discoveredEmpty: {
    en: 'Nothing yet. Discovery watches the ext.* field paths in payloads you analyse, entirely in this browser — run a few through the inspector and the clusters show up here.',
    uk: 'Поки порожньо. Discovery дивиться на шляхи ext.* полів у payload, які ти аналізуєш, повністю в цьому браузері — прожени кілька через інспектор, і кластери зʼявляться тут.',
    ru: 'Пока пусто. Discovery смотрит на пути ext.* полей в payload, которые ты анализируешь, полностью в этом браузере — прогони несколько через инспектор, и кластеры появятся здесь.',
  },

  toastActivated: {
    en: '{name} is the active dialect',
    uk: '{name} — активний діалект',
    ru: '{name} — активный диалект',
  },

  /* An expired overlay is still applied by the runtime — it just adds a
     `temp.dialect_expired` note to every analysis. So this is a warning
     about what the reader will see next, not a refusal. */
  toastActivatedExpired: {
    en: '{name} is active, but it expired on {date} — rebuild it from a cluster',
    uk: '{name} активний, але протермінований {date} — збери його заново з кластера',
    ru: '{name} активен, но просрочен {date} — собери его заново из кластера',
  },

  expiredOn: { en: 'expired {date}', uk: 'протерміновано {date}', ru: 'просрочен {date}' },
  validUntil: { en: 'until {date}', uk: 'до {date}', ru: 'до {date}' },

  untitledOverlay: {
    en: 'Untitled overlay',
    uk: 'Overlay без назви',
    ru: 'Overlay без названия',
  },
  noFields: {
    en: 'no field paths — this overlay checks nothing',
    uk: 'жодного шляху поля — цей overlay нічого не перевіряє',
    ru: 'ни одного пути поля — этот overlay ничего не проверяет',
  },

  removeOverlay: { en: 'Remove', uk: 'Видалити', ru: 'Удалить' },
  confirmRemove: {
    en: 'Remove the overlay “{name}”? Discovery can build it again from the same cluster.',
    uk: 'Видалити overlay «{name}»? Discovery збере його знову з того ж кластера.',
    ru: 'Удалить overlay «{name}»? Discovery соберёт его снова из того же кластера.',
  },
  toastRemoved: { en: '{name} removed', uk: '{name} видалено', ru: '{name} удалён' },
  toastRemoveFailed: {
    en: 'Could not remove {name}',
    uk: 'Не вдалося видалити {name}',
    ru: 'Не удалось удалить {name}',
  },

  loading: { en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' },
  error: {
    en: 'Failed to load catalog.',
    uk: 'Помилка завантаження каталогу.',
    ru: 'Ошибка загрузки каталога.',
  },
};

// ── Built-in dialect definitions ──────────────────────────────────
//
// Titles match what the inspector's footer picker prints for the same
// dialect (paintFooterDialect in ortbtools.app.js), so the card and the
// footer name the same thing.
//
// `{n}` in a description is the live rule count from the catalog — the
// mockup carries the number in the baseline's description ("214 finding
// ids"), and reading it off the catalog keeps it from going stale.

const BUILTIN_DIALECTS = [
  {
    slug: 'iab',
    /* the baseline is "maintained" rather than a rule count — the count
       is in its description, where the mockup puts it. */
    meta: 'maintained',
    title: { en: 'Standard IAB', uk: 'Standard IAB', ru: 'Standard IAB' },
    desc: {
      en: 'Baseline oRTB 2.5 / 2.6 / 3.0 rules — required fields, types, enums, payload integrity. {n} finding ids, all with spec references.',
      uk: 'Базові правила oRTB 2.5 / 2.6 / 3.0 — обовʼязкові поля, типи, enum, цілісність payload. {n} finding id, усі з посиланнями на специфікацію.',
      ru: 'Базовые правила oRTB 2.5 / 2.6 / 3.0 — обязательные поля, типы, enum, целостность payload. {n} finding id, все со ссылками на спецификацию.',
    },
  },
  {
    slug: 'ext-rtb',
    meta: 'rules',
    title: { en: 'Vendor · RTB', uk: 'Vendor · RTB', ru: 'Vendor · RTB' },
    desc: {
      en: 'Extra rules for extended-RTB vendors: ext.bsection / ext.btags blocking arrays, ext.subage push detection, restricted macro set.',
      uk: 'Додаткові правила для extended-RTB вендорів: блокуючі масиви ext.bsection / ext.btags, виявлення push через ext.subage, обмежений набір макросів.',
      ru: 'Дополнительные правила для extended-RTB вендоров: блокирующие массивы ext.bsection / ext.btags, обнаружение push через ext.subage, ограниченный набор макросов.',
    },
  },
  {
    slug: 'inpage-push',
    meta: 'rules',
    title: {
      en: 'Vendor · In-Page Push',
      uk: 'Vendor · In-Page Push',
      ru: 'Vendor · In-Page Push',
    },
    desc: {
      en: 'In-page push shapes that never pass IAB validation as-is — bid.ext.title / image / url instead of adm/nurl.',
      uk: 'Формати in-page push, які не проходять IAB-валідацію як є — bid.ext.title / image / url замість adm/nurl.',
      ru: 'Форматы in-page push, которые не проходят IAB-валидацию как есть — bid.ext.title / image / url вместо adm/nurl.',
    },
  },
];

// ── Active dialect ────────────────────────────────────────────────
//
// Shares the storage key and the temp-dialect rules with activeDialect() /
// setActiveDialect() in ortbtools.app.js. It is duplicated rather than
// imported because ortbtools.app.js is a classic script with no exports;
// KEEP IN SYNC with its DIALECT_STORAGE_KEY block.
//
// The one place the two deliberately DIVERGE is `?dialect=`. In the
// inspector the parameter is part of the page's own state — its
// setActiveDialect writes the URL back on every change, so reading the URL
// first is self-consistent there. Here it is not: this page's
// setActiveDialect leaves the URL alone (a ?dialect on /dialects would
// describe a page that does no validating), so a URL-first read made the
// page immovable — every card click wrote localStorage and toasted, while
// the ACTIVE eyebrow and aria-pressed stayed on whatever the URL said.
// Measured on /dialects?dialect=ext-rtb: two clicks, two toasts naming two
// different dialects, storage on a third, and not one pixel changed.
//
// So on this page the parameter is a REQUEST to change the setting, taken
// once at mount (takeUrlDialect below) and then removed from the URL;
// everything after that reads the stored value, which is also the value the
// inspector will validate against. The page can no longer contradict itself.

const DIALECT_STORAGE_KEY = 'ortbtools_dialect_v1';
const KNOWN_DIALECTS = new Set(['iab', 'ext-rtb', 'inpage-push']);

function isTempDialect(value) {
  return typeof value === 'string' && value.startsWith('temp:');
}

function isKnownDialect(value) {
  return KNOWN_DIALECTS.has(value) || isTempDialect(value);
}

/** The dialect actually in effect: the stored choice, or the baseline. */
function activeDialect() {
  try {
    const fromStorage = localStorage.getItem(DIALECT_STORAGE_KEY);
    if (fromStorage && isKnownDialect(fromStorage)) return fromStorage;
  } catch (_e) {
    /* private mode */
  }
  return 'iab';
}

/**
 * Reads `?dialect=` once and strips it from the URL, so a reload (or the
 * next repaint) cannot resurrect a value the reader has since changed.
 * Returns the requested slug when it names something we can activate, else
 * null. Stripping happens for any `?dialect`, valid or not — leaving an
 * unusable one in the address bar is the same lie in slower motion.
 */
function takeUrlDialect() {
  let requested = null;
  try {
    const url = new URL(location.href);
    requested = url.searchParams.get('dialect');
    if (requested == null) return null;
    url.searchParams.delete('dialect');
    const query = url.searchParams.toString();
    history.replaceState(history.state, '', url.pathname + (query ? '?' + query : '') + url.hash);
  } catch (_e) {
    return null;
  }
  return isKnownDialect(requested) ? requested : null;
}

function setActiveDialect(slug) {
  if (!isKnownDialect(slug)) return;
  try {
    localStorage.setItem(DIALECT_STORAGE_KEY, slug);
  } catch (_e) {
    /* quota / private mode — best effort */
  }
  // Keep the inspector's footer label and the intel spec cache in step.
  // The URL is deliberately NOT rewritten here: ?dialect on /dialects
  // would describe a page that is not the one doing the validating.
  if (typeof window.paintFooterDialect === 'function') window.paintFooterDialect();
  if (window.OrtbtoolsIntel && typeof window.OrtbtoolsIntel.activate === 'function') {
    window.OrtbtoolsIntel.activate(isTempDialect(slug) ? slug : null);
  }
}

// ── Discovery clusters ────────────────────────────────────────────
//
// Trimmed copy of packages/core/intel/cluster.js — KEEP IN SYNC. Same
// inlining convention (and the same thresholds) as
// modules/intel/builder.js, so the `fields.join('|')` signature this
// produces matches the one the builder modal renders, which is what
// lets "Build overlay" preselect a row's cluster in that modal.

const MS_PER_DAY = 24 * 3600 * 1000;
const MIN_FIELD_SCORE = 5;
const MIN_COOCCURRENCE = 3;
const MAX_CLUSTER_SIZE = 8;
/** Same window modules/intel/observer.js calls a "new" observation. */
const NEW_WITHIN_MS = 24 * 3600 * 1000;

function applyDecay(prev, lastSeenAt, now) {
  if (typeof prev !== 'number' || !Number.isFinite(prev) || prev <= 0) return 0;
  if (typeof lastSeenAt !== 'number' || lastSeenAt <= 0) return prev;
  const elapsed = now - lastSeenAt;
  if (elapsed <= 0) return prev;
  const halfLives = elapsed / MS_PER_DAY;
  if (halfLives >= 30) return 0;
  return prev * Math.pow(0.5, halfLives);
}

function pushMap(map, key, value) {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(value);
}

/**
 * `payloads` is the smallest raw co-occurrence count between the anchor
 * and any of its partners: a lower bound on how many payloads carried
 * the whole cluster. `cohesion` divides that by the rarest member's own
 * observation count — 1.0 means those fields have never been seen apart.
 * Both are counts of payloads seen in THIS browser; nothing about them
 * is sent anywhere.
 */
function detectClusters(observations, coOccurrences, now) {
  const fieldScores = new Map();
  const fieldCounts = new Map();
  for (const r of observations || []) {
    const decayed = applyDecay(r.decayedScore || 0, r.lastSeenAt || 0, now);
    if (decayed > 0) {
      fieldScores.set(r.path, decayed);
      fieldCounts.set(r.path, Math.max(fieldCounts.get(r.path) || 0, r.count || 0));
    }
  }

  const adjacency = new Map();
  const rawPairCount = new Map();
  for (const c of coOccurrences || []) {
    const decayed = applyDecay(
      c.decayedScore != null ? c.decayedScore : c.count || 0,
      c.lastSeenAt || 0,
      now,
    );
    if (decayed < MIN_COOCCURRENCE) continue;
    pushMap(adjacency, c.pathA, { partner: c.pathB, weight: decayed });
    pushMap(adjacency, c.pathB, { partner: c.pathA, weight: decayed });
    rawPairCount.set(c.pathA + '\u241F' + c.pathB, c.count || 0);
    rawPairCount.set(c.pathB + '\u241F' + c.pathA, c.count || 0);
  }

  const anchors = Array.from(fieldScores.entries())
    .filter(([, score]) => score >= MIN_FIELD_SCORE)
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path);

  const clusters = [];
  const seenSig = new Set();
  for (const anchor of anchors) {
    const partners = (adjacency.get(anchor) || [])
      .filter(({ partner }) => (fieldScores.get(partner) || 0) >= MIN_FIELD_SCORE)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_CLUSTER_SIZE - 1)
      .map((p) => p.partner);
    if (partners.length < 2) continue;

    const fields = [anchor, ...partners].sort();
    const sig = fields.join('|');
    if (seenSig.has(sig)) continue;
    seenSig.add(sig);

    let totalCount = 0;
    for (const f of fields) totalCount += fieldScores.get(f) || 0;

    let payloads = Infinity;
    for (const partner of partners) {
      payloads = Math.min(payloads, rawPairCount.get(anchor + '\u241F' + partner) || 0);
    }
    if (!Number.isFinite(payloads)) payloads = 0;

    let rarest = Infinity;
    for (const f of fields) rarest = Math.min(rarest, fieldCounts.get(f) || 0);
    const cohesion = rarest > 0 ? payloads / rarest : 0;

    const isNew = fields.some((f) => {
      const rec = (observations || []).find((r) => r.path === f);
      return rec && rec.firstSeenAt && now - rec.firstSeenAt <= NEW_WITHIN_MS;
    });

    clusters.push({
      anchorPath: anchor,
      fields,
      sig,
      totalCount,
      payloads,
      cohesion,
      isNew,
    });
  }

  clusters.sort((a, b) => b.totalCount - a.totalCount);
  return clusters;
}

/**
 * A cluster seen in fewer than MIN_FIELD_SCORE payloads is never called
 * more than "low", however tightly its fields travel together — a
 * perfect ratio over four payloads is a coincidence, not a pattern.
 */
function confidenceKey(cluster) {
  if (cluster.payloads < MIN_FIELD_SCORE) return 'confLow';
  if (cluster.cohesion >= 0.8) return 'confHigh';
  if (cluster.cohesion >= 0.5) return 'confMedium';
  return 'confLow';
}

/** `imp.ext.viewability_provider` → `Viewability provider`. */
function prettifyLeaf(path) {
  const leaf = String(path).split('.').pop() || String(path);
  const words = leaf.replace(/[_-]+/g, ' ').trim();
  if (!words) return String(path);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function fetchClusters() {
  const storage = window.OrtbtoolsIntelStorage;
  if (!storage) return [];
  try {
    const [observations, coOccurrences] = await Promise.all([
      storage.listObservations(),
      storage.listCoOccurrences(),
    ]);
    return detectClusters(observations || [], coOccurrences || [], Date.now());
  } catch (_e) {
    // Discovery is best-effort; an IDB hiccup must not take the page down.
    return [];
  }
}

async function fetchCustomDialects() {
  const storage = window.OrtbtoolsIntelStorage;
  if (!storage) return [];
  try {
    return (await storage.listTempDialects()) || [];
  } catch (_e) {
    return [];
  }
}

// ── Catalog counts ────────────────────────────────────────────────

/**
 * Counts EVERY row the catalog returns for a dialect, not just the rows
 * on the validator's error/warning/info scale — crosscheck rows and
 * mirror notes are rules too, and a count that quietly drops 58 of 330
 * is the defect the severity registry was built to remove.
 */
async function fetchCatalogStats(signal) {
  const r = await fetch('/api/v1/finding-catalog', { signal });
  if (!r.ok) throw new Error('catalog HTTP ' + r.status);
  const data = await r.json();
  const items = data.items || [];
  const extrtb = items.filter((f) => f.id.startsWith('extrtb.'));
  const inpage = items.filter((f) => f.id.startsWith('inpage-push.'));
  const iab = items.filter((f) => !f.id.startsWith('extrtb.') && !f.id.startsWith('inpage-push.'));
  return {
    iab: iab.length,
    'ext-rtb': extrtb.length,
    'inpage-push': inpage.length,
  };
}

// ── HTML renderers ────────────────────────────────────────────────

function renderShell(lang) {
  return `
    <div class="dlc-page">
      <div class="dlc-band">
        <h1 class="dlc-band__title">${tx(L.title, lang)}</h1>
        <p class="dlc-band__sub">${tx(L.subtitle, lang)}</p>
      </div>
      <div class="dlc-scroll">
        <section class="dlc-block" id="dlc-shipped-root">
          <p class="dlc-loading">${tx(L.loading, lang)}</p>
        </section>
        <section class="dlc-block" id="dlc-custom-root" hidden></section>
        <section class="dlc-block" id="dlc-discovered-root">
          <p class="dlc-loading">${tx(L.loading, lang)}</p>
        </section>
      </div>
    </div>
  `;
}

function renderBlockHead(lang, headingKey, opts) {
  const o = opts || {};
  const badge = o.badge
    ? `<span class="dlc-badge">${tx(L.newBadge, lang, { n: o.badge })}</span>`
    : '';
  const note = o.note ? `<span class="dlc-block__note">${tx(L.discoveredNote, lang)}</span>` : '';
  return `
    <div class="dlc-block__head">
      <span class="dlc-block__eyebrow">${tx(L[headingKey], lang)}</span>
      ${badge}
      <span class="dlc-block__rule"></span>
      ${note}
    </div>
  `;
}

const CORNER_MARKS = ['tl', 'tr', 'bl', 'br']
  .map((pos) => `<i class="dlc-card__mark dlc-card__mark--${pos}" aria-hidden="true">+</i>`)
  .join('');

function renderCard(lang, opts) {
  const isActive = opts.isActive;
  // EXPIRED outranks AVAILABLE but not ACTIVE: an expired overlay that is in
  // effect is still in effect, and the eyebrow's job is to name the state the
  // reader is in. The expiry is then carried by the meta line, which shows it
  // for the active card too.
  const eyebrow = isActive
    ? tx(L.eyebrowActive, lang)
    : opts.isExpired
      ? tx(L.eyebrowExpired, lang)
      : tx(L.eyebrowAvailable, lang);
  return `
    <button type="button"
            class="dlc-card${isActive ? ' dlc-card--active' : ''}${
              opts.isExpired ? ' dlc-card--expired' : ''
            }"
            data-action="activate"
            data-slug="${escapeHtml(opts.slug)}"
            aria-pressed="${isActive ? 'true' : 'false'}">
      ${isActive ? CORNER_MARKS : ''}
      <span class="dlc-card__eyebrow">${eyebrow}</span>
      <span class="dlc-card__title">${escapeHtml(opts.title)}</span>
      <span class="dlc-card__desc">${opts.descHtml}</span>
      <span class="dlc-card__meta">${opts.metaHtml}</span>
    </button>
  `;
}

/**
 * Escapes the copy first, then substitutes `{n}` for a marked-up count, so
 * the rule count is one addressable element wherever a card puts it —
 * mid-sentence in the baseline's description, at the end of an overlay's
 * footer. The count is the card's one load-bearing number; leaving it as
 * loose digits inside a paragraph makes it unassertable.
 */
function countedHtml(template, n) {
  const value = n == null ? '—' : n;
  return escapeHtml(template).replace(
    '{n}',
    '<span class="dlc-card__count">' + escapeHtml(value) + '</span>',
  );
}

function renderShipped(lang, counts, active) {
  const cards = BUILTIN_DIALECTS.map((d) => {
    const n = counts[d.slug];
    const metaHtml =
      d.meta === 'maintained'
        ? escapeHtml(d.slug + ' · ' + pick(L.maintained, lang))
        : escapeHtml(d.slug + ' · ') + countedHtml(pick(L.rulesMeta, lang), n);
    return renderCard(lang, {
      slug: d.slug,
      isActive: active === d.slug,
      title: pick(d.title, lang),
      descHtml: countedHtml(pick(d.desc, lang), n),
      metaHtml,
    });
  }).join('');
  return renderBlockHead(lang, 'shippedHeading') + `<div class="dlc-grid">${cards}</div>`;
}

/**
 * A temporary overlay carries `validUntil` (the builder sets it 30 days
 * out). Past that moment the runtime still applies the overlay, but every
 * analysis it touches carries a `temp.dialect_expired` note — see
 * applyTempDialect in modules/intel/index.js. So an expired overlay is not
 * dead, it is spent, and the card has to say which of the two it is instead
 * of reading exactly like a fresh one.
 */
function isExpiredSpec(spec, now) {
  return !!(spec && spec.validUntil && now > spec.validUntil);
}

function shortDate(ts, lang) {
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  const loc = lang === 'uk' ? 'uk-UA' : lang === 'ru' ? 'ru-RU' : 'en-GB';
  return d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderCustom(lang, specs, active, now) {
  const cards = specs
    .map((spec) => {
      const fields = spec.fields || [];
      const expired = isExpiredSpec(spec, now);
      const name = spec.name || pick(L.untitledOverlay, lang);
      // A spec with no field paths validates nothing. "custom · 0 fields"
      // over an empty description let that read as a card that had simply
      // not loaded yet.
      const descHtml = fields.length
        ? escapeHtml(fields.map((f) => f.path).join(' · '))
        : tx(L.noFields, lang);
      const life = spec.validUntil
        ? ' · ' +
          tx(expired ? L.expiredOn : L.validUntil, lang, { date: shortDate(spec.validUntil, lang) })
        : '';
      const card = renderCard(lang, {
        slug: spec.id,
        isActive: active === spec.id,
        isExpired: expired,
        title: name,
        descHtml,
        metaHtml:
          escapeHtml('custom · ') + countedHtml(pick(L.fieldsMeta, lang), fields.length) + life,
      });
      // The remove control sits UNDER the card rather than inside it: the
      // card is itself a <button>, and a button inside a button is not
      // markup a browser will honour. It is also the only way to get rid of
      // an overlay from the UI — storage.deleteTempDialect() had no caller
      // anywhere in public/ before this.
      const remove =
        `<button type="button" class="dlc-cardx" data-action="delete-temp"` +
        ` data-slug="${escapeHtml(spec.id)}"` +
        ` aria-label="${tx(L.confirmRemove, lang, { name })}">${tx(L.removeOverlay, lang)}</button>`;
      return `<div class="dlc-cardwrap">${card}${remove}</div>`;
    })
    .join('');
  return renderBlockHead(lang, 'customHeading') + `<div class="dlc-grid">${cards}</div>`;
}

function renderDiscovered(lang, clusters) {
  const newCount = clusters.filter((c) => c.isNew).length;
  const head = renderBlockHead(lang, 'discoveredHeading', { badge: newCount || 0, note: true });
  if (!clusters.length) {
    return head + `<p class="dlc-empty">${tx(L.discoveredEmpty, lang)}</p>`;
  }
  const rows = clusters
    .map((c) => {
      const confidence = tx(L[confidenceKey(c)], lang);
      return `
      <div class="dlc-row">
        <div class="dlc-row__main">
          <div class="dlc-row__title">${tx(L.groupTitle, lang, { name: prettifyLeaf(c.anchorPath) })}</div>
          <div class="dlc-row__paths" title="${escapeHtml(c.fields.join(' · '))}">${escapeHtml(c.fields.join(' · '))}</div>
        </div>
        <div class="dlc-row__stat">
          <div class="dlc-row__stat-num">${c.payloads}</div>
          <div class="dlc-row__stat-label">${tx(L.payloadsLabel, lang)}</div>
        </div>
        <div class="dlc-row__stat dlc-row__stat--conf">
          <div class="dlc-row__stat-num">${confidence}</div>
          <div class="dlc-row__stat-label">${tx(L.confidenceLabel, lang)}</div>
        </div>
        <button type="button" class="dlc-ghost" data-action="build-overlay" data-sig="${escapeHtml(c.sig)}">
          ${tx(L.buildOverlay, lang)}
        </button>
      </div>
    `;
    })
    .join('');
  return head + `<div class="dlc-rows">${rows}</div>`;
}

// ── Toast helper ─────────────────────────────────────────────────

/**
 * Shows one toast and returns the element it created, so the caller can take
 * it back down again. The shell's toast() (ctx.toast) appends into
 * #toastContainer and returns nothing, so the element is identified by
 * comparing the container's last child before and after the call — the only
 * handle available without reaching into shell-owned code.
 */
function showToast(message, type, ctxToast) {
  const host = document.getElementById('toastContainer');
  if (ctxToast) {
    const before = host ? host.lastElementChild : null;
    ctxToast(message, type || 'success');
    const after = host ? host.lastElementChild : null;
    return after && after !== before ? after : null;
  }
  const el = document.createElement('div');
  el.textContent = message;
  el.className = 'dlc-toast';
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 320);
  }, 2400);
  return el;
}

/**
 * Announcing the active dialect is a statement about the CURRENT state, not
 * an entry in a log — so this page keeps at most one of them on screen.
 *
 * Measured before this existed: twelve quick card clicks queued twelve
 * toasts, seventeen after a few more, stacking 912px down the right-hand
 * column and burying the third card behind toasts that contradicted each
 * other (audit/dialects-04-toast-stack.png). Two mechanisms fix that:
 * activations inside COALESCE_MS collapse into one announcement (rapid
 * switching says only where you landed), and a new announcement removes the
 * previous one if it is still standing.
 */
const TOAST_COALESCE_MS = 320;

function createAnnouncer(ctxToast) {
  let timer = null;
  let pending = null;
  let live = null;

  function flush() {
    timer = null;
    const next = pending;
    pending = null;
    if (!next) return;
    if (live && live.isConnected) live.remove();
    live = showToast(next.message, next.type, ctxToast);
  }

  return {
    say(message, type) {
      pending = { message, type: type || 'success' };
      clearTimeout(timer);
      timer = setTimeout(flush, TOAST_COALESCE_MS);
    },
    cancel() {
      clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

// ── Module export ─────────────────────────────────────────────────

export default {
  id: 'dialects',
  css: '/modules/dialects/dialects.css',
  route: '/dialects',
  manifest: {
    title: L.title,
  },

  async mount(root, ctx) {
    const lang = ctx.lang || FALLBACK_LANG;
    root.innerHTML = renderShell(lang);

    const shippedRoot = root.querySelector('#dlc-shipped-root');
    const customRoot = root.querySelector('#dlc-custom-root');
    const discoveredRoot = root.querySelector('#dlc-discovered-root');

    let counts = {};
    let countsFailed = false;
    let clusters = [];
    let customSpecs = [];

    async function loadAll() {
      const [statsResult, clusterResult, customResult] = await Promise.allSettled([
        fetchCatalogStats(ctx.signal),
        fetchClusters(),
        fetchCustomDialects(),
      ]);
      if (statsResult.status === 'fulfilled') {
        counts = statsResult.value;
      } else if (statsResult.reason && statsResult.reason.name !== 'AbortError') {
        countsFailed = true;
      }
      clusters = clusterResult.status === 'fulfilled' ? clusterResult.value : [];
      customSpecs = customResult.status === 'fulfilled' ? customResult.value : [];
    }

    function paint() {
      const active = activeDialect();
      const now = Date.now();
      if (shippedRoot) {
        shippedRoot.innerHTML = countsFailed
          ? renderShipped(lang, counts, active) + `<p class="dlc-error">${tx(L.error, lang)}</p>`
          : renderShipped(lang, counts, active);
      }
      if (customRoot) {
        customRoot.hidden = customSpecs.length === 0;
        customRoot.innerHTML = customSpecs.length
          ? renderCustom(lang, customSpecs, active, now)
          : '';
      }
      if (discoveredRoot) discoveredRoot.innerHTML = renderDiscovered(lang, clusters);
    }

    const announcer = createAnnouncer(ctx.toast);
    ctx.addCleanup(() => announcer.cancel());

    await loadAll();
    if (ctx.signal && ctx.signal.aborted) return;

    // `?dialect=` is honoured ONCE, here, as a request to change the stored
    // setting — see takeUrlDialect. A temp overlay that this browser has no
    // record of is dropped rather than activated: the runtime would find no
    // spec behind it, and the page would name an overlay nobody can see.
    const requested = takeUrlDialect();
    if (
      requested &&
      requested !== activeDialect() &&
      (!isTempDialect(requested) || customSpecs.some((s) => s && s.id === requested))
    ) {
      setActiveDialect(requested);
    }
    paint();

    // A dialect built in the Discovery modal becomes active immediately —
    // repaint so the new overlay shows up under "Your overlays" wearing
    // the ACTIVE eyebrow instead of the page lying until the next visit.
    window.addEventListener(
      'ortbtools:intel-dialect-changed',
      async () => {
        customSpecs = await fetchCustomDialects();
        paint();
      },
      { signal: ctx.signal },
    );

    root.addEventListener(
      'click',
      async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn || !root.contains(btn)) return;
        const action = btn.dataset.action;

        if (action === 'activate') {
          e.preventDefault();
          const slug = btn.dataset.slug || '';
          if (activeDialect() === slug) return;
          setActiveDialect(slug);
          paint();
          const spec = customSpecs.find((s) => s && s.id === slug) || null;
          const label =
            (BUILTIN_DIALECTS.find((d) => d.slug === slug) || {}).title ||
            ((spec || {}).name ?? pick(L.untitledOverlay, lang));
          const name = typeof label === 'string' ? label : pick(label, lang);
          // An expired overlay is applied with a `temp.dialect_expired` note
          // on every analysis. Saying "✓ active" and nothing else is how the
          // reader ends up reading that note as a surprise.
          if (isExpiredSpec(spec, Date.now())) {
            announcer.say(
              fmt(pick(L.toastActivatedExpired, lang), {
                name,
                date: shortDate(spec.validUntil, lang),
              }),
              'error',
            );
          } else {
            announcer.say(fmt(pick(L.toastActivated, lang), { name }), 'success');
          }
          return;
        }

        if (action === 'delete-temp') {
          e.preventDefault();
          const slug = btn.dataset.slug || '';
          const spec = customSpecs.find((s) => s && s.id === slug);
          const storage = window.OrtbtoolsIntelStorage;
          if (!spec || !storage || typeof storage.deleteTempDialect !== 'function') return;
          const name = spec.name || pick(L.untitledOverlay, lang);
          if (!window.confirm(fmt(pick(L.confirmRemove, lang), { name }))) return;
          try {
            await storage.deleteTempDialect(slug);
          } catch (_err) {
            announcer.say(fmt(pick(L.toastRemoveFailed, lang), { name }), 'error');
            return;
          }
          if (ctx.signal && ctx.signal.aborted) return;
          // Deleting the overlay that was in effect must not leave the app
          // pointed at a spec nothing can resolve any more — fall back to the
          // dialect it was built on top of, or the baseline.
          if (activeDialect() === slug) {
            const parent = spec.parentDialect;
            setActiveDialect(KNOWN_DIALECTS.has(parent) ? parent : 'iab');
          }
          customSpecs = await fetchCustomDialects();
          if (ctx.signal && ctx.signal.aborted) return;
          paint();
          announcer.say(fmt(pick(L.toastRemoved, lang), { name }), 'success');
          return;
        }

        if (action === 'build-overlay') {
          e.preventDefault();
          const builder = window.OrtbtoolsIntelBuilder;
          if (!builder || typeof builder.open !== 'function') return;
          await builder.open();
          // The modal lists the same clusters under the same signature;
          // clicking its "use" button for ours preselects the fields the
          // reader was actually looking at. Purely a convenience — the
          // modal is perfectly usable if the row is not among its top 5.
          try {
            const sig = btn.dataset.sig || '';
            const pickBtn = document.querySelector(
              '#ortbtoolsIntelBuilder [data-cluster-pick="' + CSS.escape(sig) + '"]',
            );
            if (pickBtn) pickBtn.click();
          } catch (_e) {
            /* preselection is best-effort */
          }
        }
      },
      { signal: ctx.signal },
    );
  },

  async unmount(_root) {
    /* registry sweeps DOM; section CSS persists (loaded once via mod.css) */
  },
};
