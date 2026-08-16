/* ============================================================
   public/modules/library/index.js — /library section module.

   THE SAMPLES TABLE (redesign, v2)
   ------------------------------------------------------------
   The mockup renders this screen as ONE full-bleed data table:
   a white page-header band, a filter row with a <select>, square
   filter chips and a right-aligned count, then a sticky column
   header over 63px hairline-separated rows. No cards, no tabs, no
   per-row buttons — the row itself is the link.

   Two places where the mockup could not know our product, and what
   we do instead (see notDone in the handover):

   1. THE CATALOG EXISTS. The mockup's Samples screen is one dataset:
      the signed-in user's saves. We also ship 29 public OpenRTB
      fixtures that anyone can open anonymously, and that is the
      default view here because it is the one an anonymous visitor
      can actually use. Deleting it to match the mockup would delete
      a feature, so the mockup's tab strip complaint is answered by
      moving the two scopes INTO the filter row as two of its chips —
      same chip treatment, same row, zero extra vertical space.

   2. THE COLUMNS DIFFER PER SCOPE. Saved samples carry exactly the
      mockup's five facts (partner, verdict, updated, body state), so
      the "My saves" scope is the mockup's grid verbatim:
      1fr 140px 130px 104px 96px. Catalog fixtures carry none of
      those — no partner, no timestamp, no encryption — so that scope
      keeps the same visual language over the four facts it has
      (category, format, body) plus a 32px action cell for Copy JSON,
      which is a real feature with no mockup equivalent.

   VERDICT is not invented. For saves it is the `status` column the
   analyzer wrote at save time (clean / warnings / errors / invalid,
   rendered through the same i18n keys the inspector uses). For
   catalog fixtures the severity channel rides on the category:
   attack patterns read danger, clean baselines read success, IAB
   reference fixtures stay neutral.

   Backend endpoints used:
     - GET /api/v1/sample/list — public catalog metadata (slug, label,
       category, format, note).
     - GET /api/v1/sample?type=SLUG — single sample fixture for Copy.
     - GET /api/samples — user's saved samples (auth required).
     - GET /api/partners — partner names for the PARTNER column.
     - GET /api/auth/me — auth check.
   ============================================================ */
'use strict';

const FALLBACK_LANG = 'en';

const CATEGORY_LABEL = {
  iab: { en: 'IAB fixtures', uk: 'IAB-зразки', ru: 'IAB-образцы' },
  valid: { en: 'Clean baselines', uk: 'Чисті базові', ru: 'Чистые базовые' },
  attack: { en: 'Attack patterns', uk: 'Шаблони атак', ru: 'Шаблоны атак' },
};

/* The red/amber/green channel on the catalog scope. A fixture filed under
   `attack` is a known-malicious specimen and an operator picking one off this
   list should see that before they load it; `valid` fixtures are the control
   cases. `iab` holds both good and deliberately-broken reference payloads, so
   it stays neutral rather than claiming something the category cannot support. */
const CATEGORY_SEV = { attack: 'danger', valid: 'ok', iab: '' };

const CATEGORY_ORDER = ['iab', 'valid', 'attack'];

const FORMAT_LABEL = {
  banner: { en: 'banner', uk: 'банер', ru: 'баннер' },
  video: { en: 'video', uk: 'відео', ru: 'видео' },
  vast: { en: 'VAST', uk: 'VAST', ru: 'VAST' },
  pop: { en: 'pop', uk: 'pop', ru: 'pop' },
  ortb30: { en: 'oRTB 3.0', uk: 'oRTB 3.0', ru: 'oRTB 3.0' },
  native: { en: 'native', uk: 'native', ru: 'native' },
};

/* Saved-sample `status` → the mockup's severity channel. The vocabulary is the
   analyzer's, written at save time by public/ortbtools.app.js (humanStatus);
   the labels come from the same i18n keys the inspector shows, so a verdict
   here and a verdict there are always the same words. */
const STATUS_SEV = {
  errors: 'danger',
  invalid: 'danger',
  warnings: 'warn',
  clean: 'ok',
};

const T = {
  title: { en: 'Samples', uk: 'Зразки', ru: 'Образцы' },
  subtitle: {
    en: 'Curated OpenRTB fixtures plus your saved payloads. Bodies are encrypted in your browser before upload; titles, notes and partner names stay server-readable.',
    uk: 'Куровані OpenRTB-фікстури плюс твої збережені payload’и. Тіла шифруються у браузері перед завантаженням; назви, нотатки й партнери лишаються читабельні серверу.',
    ru: 'Курируемые OpenRTB-фикстуры плюс твои сохранённые payload’ы. Тела шифруются в браузере перед загрузкой; названия, заметки и партнёры остаются читаемы серверу.',
  },
  newSample: { en: 'New sample', uk: 'Новий зразок', ru: 'Новый образец' },
  newSampleHint: {
    en: 'Paste a payload in the inspector, then save it — the body is encrypted in your browser before upload',
    uk: 'Встав payload в інспекторі й збережи — тіло шифрується у браузері перед завантаженням',
    ru: 'Вставь payload в инспекторе и сохрани — тело шифруется в браузере перед загрузкой',
  },
  scopeCatalog: { en: 'Catalog', uk: 'Каталог', ru: 'Каталог' },
  scopeSaved: { en: 'My saves', uk: 'Мої збереження', ru: 'Мои сохранения' },
  allCategories: { en: 'all categories', uk: 'усі категорії', ru: 'все категории' },
  allPartners: { en: 'all partners', uk: 'усі партнери', ru: 'все партнёры' },
  noPartner: { en: '— no partner —', uk: '— без партнера —', ru: '— без партнёра —' },
  none: { en: '— none —', uk: '— немає —', ru: '— нет —' },
  colTitle: { en: 'title', uk: 'назва', ru: 'название' },
  colCategory: { en: 'category', uk: 'категорія', ru: 'категория' },
  colFormat: { en: 'format', uk: 'формат', ru: 'формат' },
  colBody: { en: 'body', uk: 'тіло', ru: 'тело' },
  colPartner: { en: 'partner', uk: 'партнер', ru: 'партнёр' },
  colVerdict: { en: 'verdict', uk: 'вердикт', ru: 'вердикт' },
  colUpdated: { en: 'saved', uk: 'збережено', ru: 'сохранено' },
  colActions: { en: 'actions', uk: 'дії', ru: 'действия' },
  bodyPublic: { en: 'public', uk: 'публічне', ru: 'публичное' },
  reqRes: { en: 'request + response', uk: 'запит + відповідь', ru: 'запрос + ответ' },
  reqOnly: { en: 'request', uk: 'запит', ru: 'запрос' },
  resOnly: { en: 'response', uk: 'відповідь', ru: 'ответ' },
  noBody: { en: 'no body', uk: 'без тіла', ru: 'без тела' },
  notAnalyzed: { en: 'not analyzed', uk: 'не аналізовано', ru: 'не анализировано' },
  copyJson: { en: 'Copy JSON', uk: 'Копіювати JSON', ru: 'Копировать JSON' },
  loading: { en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' },
  countCatalog: {
    en: '{n} samples · {m} categories',
    uk: '{n} зразків · {m} категорій',
    ru: '{n} образцов · {m} категорий',
  },
  countSaved: {
    en: '{n} samples · {m} partners',
    uk: '{n} зразків · {m} партнерів',
    ru: '{n} образцов · {m} партнёров',
  },
  countFiltered: {
    en: '{k} of {n} samples',
    uk: '{k} з {n} зразків',
    ru: '{k} из {n} образцов',
  },
  emptyCatalog: { en: 'No samples yet.', uk: 'Поки що зразків немає.', ru: 'Образцов пока нет.' },
  emptyFacet: {
    en: 'Nothing matches this filter.',
    uk: 'За цим фільтром нічого немає.',
    ru: 'По этому фильтру ничего нет.',
  },
  signInPrompt: {
    en: 'Sign in to see your saved samples. The web UI encrypts bid bodies before upload; titles, notes, and partner metadata remain server-readable.',
    uk: 'Увійди, щоб побачити збережені зразки. Вебінтерфейс шифрує bid-тіла перед завантаженням; назви, нотатки й дані партнерів читає сервер.',
    ru: 'Войди, чтобы увидеть сохранённые образцы. Веб-интерфейс шифрует bid-тела перед загрузкой; названия, заметки и данные партнёров читает сервер.',
  },
  signIn: { en: 'Sign in', uk: 'Увійти', ru: 'Войти' },
  lockedPrompt: {
    en: 'Your saved bid bodies are encrypted. Unlock them from the cabinet to view samples here.',
    uk: 'Твої збережені bid-тіла зашифровані. Розблокуй їх у кабінеті, щоб побачити зразки тут.',
    ru: 'Твои сохранённые bid-тела зашифрованы. Разблокируй их в кабинете, чтобы увидеть образцы здесь.',
  },
  openCabinet: { en: 'Open cabinet', uk: 'Відкрити кабінет', ru: 'Открыть кабинет' },
  emptySaved: {
    en: 'No saved samples yet. Save one from the inspector to add the first.',
    uk: 'Поки що збережень немає. Збережи зразок в інспекторі, щоб додати перше.',
    ru: 'Сохранений пока нет. Сохрани образец в инспекторе, чтобы добавить первое.',
  },
  loadFailed: { en: 'Could not load', uk: 'Не вдалося завантажити', ru: 'Не удалось загрузить' },
};

function pick(map, lang) {
  if (!map) return '';
  return map[lang] || map[FALLBACK_LANG] || Object.values(map)[0] || '';
}

function fill(s, vars) {
  return String(s).replace(/\{(\w+)\}/g, (_m, k) => (vars[k] == null ? '' : String(vars[k])));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function localePrefix(lang) {
  return lang === 'en' ? '' : '/' + lang;
}

/* Same-day saves read as a clock time, older ones as a date — the mockup's
   UPDATED column mixes "12:04" and "Aug 14" for exactly this reason: within a
   working session the time is the discriminator, across days the date is. */
function formatSaved(ts, lang) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  const loc = lang === 'uk' ? 'uk-UA' : lang === 'ru' ? 'ru-RU' : 'en-GB';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(loc, { month: 'short', day: 'numeric' });
}

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
  'focusable="false"><rect x="9" y="9" width="11" height="11" rx="1.5"></rect>' +
  '<path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path></svg>';

/* ── shell ─────────────────────────────────────────────────────── */

function renderShell(lang, localeP) {
  const newSample = pick(T.newSample, lang);
  return `
    <section class="lib-section">
      <header class="lib-head">
        <div class="lib-head__text">
          <h1 class="lib-head__title">${escapeHtml(pick(T.title, lang))}</h1>
          <p class="lib-head__sub">${escapeHtml(pick(T.subtitle, lang))}</p>
        </div>
        <a class="lib-btn lib-btn--primary" href="${escapeHtml(localeP)}/inspector"
           title="${escapeHtml(pick(T.newSampleHint, lang))}">${escapeHtml(newSample)}</a>
      </header>
      <div class="lib-filters" data-filters></div>
      <div class="lib-body" data-body>
        <p class="lib-note">${escapeHtml(pick(T.loading, lang))}</p>
      </div>
    </section>
  `;
}

/* ── filter row ────────────────────────────────────────────────── */

function facetOptions(state, lang) {
  if (state.scope === 'catalog') {
    const present = CATEGORY_ORDER.filter((c) =>
      (state.catalog || []).some((i) => i.category === c),
    );
    return [{ value: 'all', label: pick(T.allCategories, lang) }].concat(
      present.map((c) => ({ value: c, label: pick(CATEGORY_LABEL[c], lang) })),
    );
  }
  const opts = [{ value: 'all', label: pick(T.allPartners, lang) }];
  for (const p of state.partners) opts.push({ value: String(p.id), label: p.name });
  const hasUnassigned = savedSamples(state).some((s) => s.partner_id == null);
  if (hasUnassigned) opts.push({ value: 'none', label: pick(T.noPartner, lang) });
  return opts;
}

function renderFilters(state, lang) {
  const opts = facetOptions(state, lang);
  const disabled = opts.length <= 1 ? ' disabled' : '';
  const chip = (scope, label) =>
    `<button type="button" class="lib-chip${state.scope === scope ? ' is-on' : ''}" ` +
    `data-scope="${scope}" aria-pressed="${state.scope === scope}">${escapeHtml(label)}</button>`;
  return `
    <select class="lib-select" data-facet aria-label="${escapeHtml(
      pick(state.scope === 'catalog' ? T.allCategories : T.allPartners, lang),
    )}"${disabled}>
      ${opts
        .map(
          (o) =>
            `<option value="${escapeHtml(o.value)}"${o.value === state.facet ? ' selected' : ''}>` +
            `${escapeHtml(o.label)}</option>`,
        )
        .join('')}
    </select>
    ${chip('catalog', pick(T.scopeCatalog, lang))}
    ${chip('saved', pick(T.scopeSaved, lang))}
    <span class="lib-count" data-count>${escapeHtml(countText(state, lang))}</span>
  `;
}

function savedSamples(state) {
  return (state.saved && state.saved.samples) || [];
}

function countText(state, lang) {
  // The count sits at the end of the FILTER row, so it answers the question
  // that row asks. Unfiltered it reports the shape of the whole collection
  // (the mockup's "24 samples · 6 partners"); with a facet selected it reports
  // what is on screen against that total, because a count that ignores the
  // filter next to it is a count nobody can use.
  if (state.scope === 'catalog') {
    const items = state.catalog || [];
    if (state.facet !== 'all') {
      return fill(pick(T.countFiltered, lang), {
        k: visibleItems(state).length,
        n: items.length,
      });
    }
    const cats = new Set(items.map((i) => i.category)).size;
    return fill(pick(T.countCatalog, lang), { n: items.length, m: cats });
  }
  // Nothing to count until we know there is a library to count: "0 samples ·
  // 0 partners" beside a sign-in prompt reads as an empty library rather than
  // as a locked one.
  if (!state.saved || state.saved.state !== 'ok') return '';
  const items = savedSamples(state);
  if (state.facet !== 'all') {
    return fill(pick(T.countFiltered, lang), { k: visibleItems(state).length, n: items.length });
  }
  const partners = new Set(items.filter((s) => s.partner_id != null).map((s) => s.partner_id)).size;
  return fill(pick(T.countSaved, lang), { n: items.length, m: partners });
}

/* ── rows ──────────────────────────────────────────────────────── */

function visibleItems(state) {
  if (state.scope === 'catalog') {
    const items = state.catalog || [];
    return state.facet === 'all' ? items : items.filter((i) => i.category === state.facet);
  }
  const items = savedSamples(state);
  if (state.facet === 'all') return items;
  if (state.facet === 'none') return items.filter((s) => s.partner_id == null);
  return items.filter((s) => String(s.partner_id) === state.facet);
}

function colHead(labels) {
  return `<div class="lib-colhead" role="row">${labels
    .map(
      (l) =>
        `<span${l.hidden ? ' class="lib-sr"' : ''} role="columnheader">${escapeHtml(l.text)}</span>`,
    )
    .join('')}</div>`;
}

function titleCell(href, label, meta, hint) {
  return (
    `<span class="lib-row__title" role="cell">` +
    `<a class="lib-row__link" href="${escapeHtml(href)}"${
      hint ? ` title="${escapeHtml(hint)}"` : ''
    }>${escapeHtml(label)}</a>` +
    (meta ? `<span class="lib-row__meta">${escapeHtml(meta)}</span>` : '') +
    `</span>`
  );
}

function renderCatalogRow(item, lang, localeP) {
  const href = `${localeP}/inspector?sample=${encodeURIComponent(item.slug)}`;
  const fmt = pick(FORMAT_LABEL[item.format] || { en: item.format || '' }, lang);
  const cat = pick(CATEGORY_LABEL[item.category] || { en: item.category || '' }, lang);
  const sev = CATEGORY_SEV[item.category] || '';
  return (
    `<div class="lib-row" data-row role="row" data-slug="${escapeHtml(item.slug)}">` +
    titleCell(href, item.label, item.slug, item.note) +
    `<span class="lib-row__cat" role="cell" data-sev="${sev}">${escapeHtml(cat)}</span>` +
    `<span class="lib-row__mono" role="cell">${escapeHtml(fmt)}</span>` +
    `<span class="lib-row__state" role="cell">${escapeHtml(pick(T.bodyPublic, lang))}</span>` +
    `<span class="lib-row__act" role="cell">` +
    `<button type="button" class="lib-iconbtn" data-action="copy-sample" ` +
    `data-slug="${escapeHtml(item.slug)}" title="${escapeHtml(pick(T.copyJson, lang))}" ` +
    `aria-label="${escapeHtml(pick(T.copyJson, lang))}">${COPY_ICON}</button>` +
    `</span>` +
    `</div>`
  );
}

function renderSavedRow(s, lang, localeP, partnerName, t) {
  const href = `${localeP}/account#sample-${encodeURIComponent(s.id)}`;
  const req = Number(s.req_len) > 0;
  const res = Number(s.res_len) > 0;
  const shape = req && res ? T.reqRes : req ? T.reqOnly : res ? T.resOnly : T.noBody;
  const notes = (s.notes || '').trim();
  const meta = pick(shape, lang) + (notes ? ' · ' + notes : '');
  const sev = STATUS_SEV[s.status] || '';
  // `status` is the analyzer's verdict, stored at save time. A sample saved
  // without a run has none — say so rather than painting a green "clean" the
  // server never earned.
  const verdict = sev ? t('status.' + s.status) : pick(T.notAnalyzed, lang);
  // "IV present" / "no IV" is the cabinet's vetted wording for this exact
  // column (db.js derives is_encrypted from req_iv presence and nothing more).
  // Reused here so the two screens never disagree about what we can prove.
  const body = Number(s.is_encrypted) ? t('cabinet.pill.encrypted') : t('cabinet.pill.plain');
  return (
    `<div class="lib-row" data-row role="row" data-id="${escapeHtml(s.id)}">` +
    titleCell(href, s.title || '(no title)', meta, notes || undefined) +
    `<span class="lib-row__partner" role="cell">${escapeHtml(
      partnerName || pick(T.none, lang),
    )}</span>` +
    `<span class="lib-row__verdict" role="cell" data-sev="${sev}">${escapeHtml(verdict)}</span>` +
    `<span class="lib-row__mono" role="cell">${escapeHtml(formatSaved(s.created_at, lang))}</span>` +
    `<span class="lib-row__state" role="cell">${escapeHtml(body)}</span>` +
    `</div>`
  );
}

function note(text, action) {
  return `<div class="lib-note">${text}${action || ''}</div>`;
}

/* The grid is a table to a screen reader as much as to an eye: the column
   header row only means anything if the rows under it are announced as rows of
   the same table. `table` > `row` > `cell` is the whole contract; no rowgroup
   is needed for a flat list. */
function table(scope, label, inner) {
  return (
    `<div class="lib-table lib-table--${scope}" role="table" ` +
    `aria-label="${escapeHtml(label)}">${inner}</div>`
  );
}

function renderBody(state, lang, localeP, t) {
  if (state.scope === 'catalog') {
    if (state.catalog == null) return note(escapeHtml(pick(T.loading, lang)));
    if (state.catalogError) {
      return note(escapeHtml(pick(T.loadFailed, lang) + ': ' + state.catalogError));
    }
    const items = visibleItems(state);
    const head = colHead([
      { text: pick(T.colTitle, lang) },
      { text: pick(T.colCategory, lang) },
      { text: pick(T.colFormat, lang) },
      { text: pick(T.colBody, lang) },
      { text: pick(T.colActions, lang), hidden: true },
    ]);
    const label = pick(T.scopeCatalog, lang);
    if (!items.length) {
      return (
        table('catalog', label, head) +
        note(escapeHtml(pick(state.catalog.length ? T.emptyFacet : T.emptyCatalog, lang)))
      );
    }
    return table(
      'catalog',
      label,
      head + items.map((i) => renderCatalogRow(i, lang, localeP)).join(''),
    );
  }

  const saved = state.saved;
  if (saved == null) return note(escapeHtml(pick(T.loading, lang)));
  if (saved.state === 'anonymous') {
    return note(
      `<p>${escapeHtml(pick(T.signInPrompt, lang))}</p>`,
      `<a class="lib-btn lib-btn--primary" href="${escapeHtml(localeP)}/account">${escapeHtml(
        pick(T.signIn, lang),
      )}</a>`,
    );
  }
  if (saved.state === 'locked') {
    return note(
      `<p>${escapeHtml(pick(T.lockedPrompt, lang))}</p>`,
      `<a class="lib-btn lib-btn--primary" href="${escapeHtml(localeP)}/account">${escapeHtml(
        pick(T.openCabinet, lang),
      )}</a>`,
    );
  }
  const head = colHead([
    { text: pick(T.colTitle, lang) },
    { text: pick(T.colPartner, lang) },
    { text: pick(T.colVerdict, lang) },
    { text: pick(T.colUpdated, lang) },
    { text: pick(T.colBody, lang) },
  ]);
  const items = visibleItems(state);
  const label = pick(T.scopeSaved, lang);
  if (!items.length) {
    const msg = savedSamples(state).length ? T.emptyFacet : T.emptySaved;
    return table('saved', label, head) + note(escapeHtml(pick(msg, lang)));
  }
  const byId = new Map(state.partners.map((p) => [String(p.id), p.name]));
  return table(
    'saved',
    label,
    head +
      items
        .map((s) => renderSavedRow(s, lang, localeP, byId.get(String(s.partner_id)), t))
        .join(''),
  );
}

/* ── data ──────────────────────────────────────────────────────── */

async function fetchCatalog(signal) {
  const r = await fetch('/api/v1/sample/list', { signal });
  if (!r.ok) throw new Error('catalog HTTP ' + r.status);
  const items = (await r.json()).items || [];
  // The mockup's list is flat and sorted by recency. Fixtures have no
  // recency, so the stable ordering is the one the old grouped view taught:
  // reference first, then baselines, then attacks — alphabetical inside each.
  // Sorting here rather than trusting the API keeps the order the same
  // whichever way the catalog file is later reordered on disk.
  return items.slice().sort((a, b) => {
    const ga = CATEGORY_ORDER.indexOf(a.category);
    const gb = CATEGORY_ORDER.indexOf(b.category);
    if (ga !== gb)
      return (ga < 0 ? CATEGORY_ORDER.length : ga) - (gb < 0 ? CATEGORY_ORDER.length : gb);
    return String(a.label || '').localeCompare(String(b.label || ''));
  });
}

async function fetchPartners(signal) {
  try {
    const r = await fetch('/api/partners', { credentials: 'same-origin', signal });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : data.partners || [];
  } catch (_e) {
    return [];
  }
}

async function fetchSavedState(signal) {
  // Probe auth — /api/auth/me returns 200 with user info if logged in, 401 otherwise.
  let me = null;
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin', signal });
    if (r.ok) me = await r.json();
  } catch (_e) {
    /* fail-open → treat as anonymous */
  }
  if (!me || !me.user) return { state: 'anonymous', samples: [] };

  try {
    const r = await fetch('/api/samples', { credentials: 'same-origin', signal });
    if (r.status === 401) return { state: 'anonymous', samples: [] };
    if (!r.ok) return { state: 'locked', samples: [] };
    const data = await r.json();
    // Backend returns {success, samples:[...]} or similar.
    const samples = Array.isArray(data) ? data : data.samples || data.items || [];
    return { state: 'ok', samples };
  } catch (_e) {
    return { state: 'locked', samples: [] };
  }
}

const COPY_TOAST = {
  ok: { en: 'Copied', uk: 'Скопійовано', ru: 'Скопировано' },
  err: { en: 'Copy failed: ', uk: 'Помилка копіювання: ', ru: 'Ошибка копирования: ' },
  empty: {
    en: 'sample carries no payload',
    uk: 'зразок не містить даних',
    ru: 'образец не содержит данных',
  },
};

// GET /api/v1/sample ALWAYS answers with both keys and sends `{}` for the one
// the fixture on disk does not carry (modules/sample/handler.js:88-110), so
// "present" has to mean "has at least one field", not "is truthy".
function hasFields(v) {
  return v != null && typeof v === 'object' && Object.keys(v).length > 0;
}

// Repairs one specific wrong shape, identified by looking at it.
//
// Older servers copied the parsed fixture with `Object.assign({}, sample)`,
// which turns a top-level JSON *array* into an index-keyed object
// ({"0":…,"1":…}) — a shape that exists nowhere on disk.
// samples/behavior-scenarios.json is such an array and is listed in the
// catalog like any other row, so Copy handed that shape straight to the user.
// Servers from 7f883f4 onward send the array; this function then sees no
// index-keyed object and returns its input untouched.
//
// Deliberately a shape test and not a version check. A version check would be
// a record of when the server changed, and would have to be right about a
// deploy that has not happened yet — the failure this whole batch is made of.
// This asks the payload what it is, so it is correct against both servers and
// needs no one to remember a date. It costs one Object.keys per copy.
function unflattenArray(payload) {
  const keys = Object.keys(payload);
  // `[].every()` is vacuously true, so an empty object would otherwise leave
  // here as `[]` — a different wrong shape than the one we came to fix. The
  // caller happens to screen those out today; this does not rely on that.
  if (!keys.length) return payload;
  return keys.every((k, i) => k === String(i)) ? keys.map((k) => payload[k]) : payload;
}

// Which of the two payloads is the sample the row actually advertises?
//
// The row's own metadata cannot answer this: `format` (banner/video/vast/pop/
// native/ortb30, see FORMAT_LABEL above) says what kind of ad the fixture is
// about, never whether the fixture is a request or a response — VAST and
// oRTB 3.0 rows exist in both directions. The only reliable discriminator is
// which side the API did not invent.
//
// Pre-fix this preferred ANY non-empty bid_request, which is exactly the wrong
// preference: for every legacy 2.x BidResponse fixture (top-level seatbid[])
// the API SYNTHESISES a demo BidRequest — example.com, IP 203.0.113.42, a
// 300x250 banner (handler.js:112-144) — and returns it beside the real
// response. So a row labelled as a VAST BidResponse copied that invented
// request, with no seatbid anywhere in it. oRTB 3.0 response fixtures only
// looked correct because handler.js:106 leaves bid_request empty for them.
//
// bid_response is never fabricated — handler.js sends either `{}` or the
// fixture verbatim — so a non-empty bid_response IS the file on disk, and any
// bid_request next to it is demo scaffolding. Deliberate rule for a fixture
// that would some day genuinely carry both: still copy the response, because a
// row that advertises a response must never answer with a request. Fixtures
// that are requests (iab-*, ortb30 requests, native, pop requests) reach the
// second branch and copy their own request unchanged.
function selectSamplePayload(data) {
  if (hasFields(data.bid_response)) return unflattenArray(data.bid_response);
  if (hasFields(data.bid_request)) return unflattenArray(data.bid_request);
  return null;
}

async function copySampleToClipboard(slug, signal, toast, lang) {
  try {
    const r = await fetch(`/api/v1/sample?type=${encodeURIComponent(slug)}`, { signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const payload = selectSamplePayload(data);
    // Better a visible failure than a silent `{}` on the clipboard.
    if (!payload) throw new Error(pick(COPY_TOAST.empty, lang));
    const text = JSON.stringify(payload, null, 2);
    await navigator.clipboard.writeText(text);
    if (toast) toast(pick(COPY_TOAST.ok, lang), 'success');
  } catch (e) {
    if (e.name !== 'AbortError' && toast) toast(pick(COPY_TOAST.err, lang) + e.message, 'error');
  }
}

/* ── module ────────────────────────────────────────────────────── */

export default {
  id: 'library',
  css: '/modules/library/library.css',
  route: '/library',
  manifest: {
    title: { en: 'Samples', uk: 'Зразки', ru: 'Образцы' },
  },

  async mount(root, ctx) {
    const lang = ctx.lang || FALLBACK_LANG;
    const localeP = localePrefix(lang);
    const t = typeof ctx.t === 'function' ? ctx.t : (k) => k;

    const state = {
      scope: 'catalog',
      facet: 'all',
      catalog: null,
      catalogError: null,
      saved: null,
      partners: [],
      savedHydrated: false,
    };

    root.innerHTML = renderShell(lang, localeP);
    const filterRow = root.querySelector('[data-filters]');
    const bodyEl = root.querySelector('[data-body]');

    const paintFilters = () => {
      filterRow.innerHTML = renderFilters(state, lang);
    };
    const paintBody = () => {
      bodyEl.innerHTML = renderBody(state, lang, localeP, t);
    };
    const paintCount = () => {
      const el = filterRow.querySelector('[data-count]');
      if (el) el.textContent = countText(state, lang);
    };

    paintFilters();

    const hydrateSaved = async () => {
      if (state.savedHydrated) return;
      state.savedHydrated = true;
      try {
        state.saved = await fetchSavedState(ctx.signal);
        if (state.saved.state === 'ok') {
          state.partners = await fetchPartners(ctx.signal);
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        state.saved = { state: 'locked', samples: [] };
      }
      if (state.scope === 'saved') {
        paintFilters();
        paintBody();
      }
    };

    root.addEventListener(
      'click',
      (e) => {
        const scopeBtn = e.target.closest('[data-scope]');
        if (scopeBtn) {
          const next = scopeBtn.dataset.scope;
          if (next === state.scope) return;
          state.scope = next;
          state.facet = 'all';
          paintFilters();
          paintBody();
          if (next === 'saved') hydrateSaved();
          return;
        }
        const copyBtn = e.target.closest('[data-action="copy-sample"]');
        if (copyBtn) {
          // The row is a stretched link; a click on its action must not
          // navigate as well.
          e.preventDefault();
          e.stopPropagation();
          copySampleToClipboard(copyBtn.dataset.slug, ctx.signal, ctx.toast, lang);
        }
      },
      { signal: ctx.signal },
    );

    root.addEventListener(
      'change',
      (e) => {
        const sel = e.target.closest('[data-facet]');
        if (!sel) return;
        state.facet = sel.value;
        paintBody();
        paintCount();
      },
      { signal: ctx.signal },
    );

    // Listeners first, then the fetch: the scope chips are on screen from the
    // first paint, and a click during the catalog round-trip would otherwise
    // land on nothing. Switching scope mid-flight is safe — both paints read
    // state.scope, so the catalog's arrival repaints whichever view is current.
    try {
      state.catalog = await fetchCatalog(ctx.signal);
    } catch (e) {
      if (e.name === 'AbortError') return;
      state.catalog = [];
      state.catalogError = e.message;
    }
    paintFilters();
    paintBody();
  },

  async unmount(_root) {
    /* registry sweeps DOM; section CSS persists (loaded once via mod.css) */
  },
};
