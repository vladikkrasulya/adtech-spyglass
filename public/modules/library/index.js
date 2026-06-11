/* ============================================================
   public/modules/library/index.js — /library section module.

   Stage 1 of ROADMAP. Two tabs:

     1. Каталог зразків (public): fetches /api/v1/sample/list and renders
        cards grouped by category (IAB · Чисті · Атаки). Each card has
        Load (→ /inspector?sample=SLUG) and Copy (clipboard) buttons.

     2. Мої збереження (ZK-encrypted): if user is logged in, fetches
        /api/samples and renders the saved bid request/response history.
        If not logged in, shows a sign-in prompt that navigates to /account.

   Backend endpoints used:
     - GET /api/v1/sample/list — public catalog metadata (slug, label,
       category, format, note). Stage 1 addition.
     - GET /api/v1/sample?type=SLUG — single sample fixture for Copy.
     - GET /api/samples — user's saved samples (auth required).
     - GET /api/auth/me — auth check.
   ============================================================ */
'use strict';

const FALLBACK_LANG = 'en';
const CATEGORY_LABEL = {
  iab: { en: 'IAB fixtures', uk: 'IAB-зразки', ru: 'IAB-образцы' },
  valid: { en: 'Clean baselines', uk: 'Чисті базові', ru: 'Чистые базовые' },
  attack: { en: 'Attack patterns', uk: 'Шаблони атак', ru: 'Шаблоны атак' },
};
const FORMAT_LABEL = {
  banner: { en: 'banner', uk: 'банер', ru: 'баннер' },
  video: { en: 'video', uk: 'відео', ru: 'видео' },
  vast: { en: 'VAST', uk: 'VAST', ru: 'VAST' },
  pop: { en: 'pop / clickunder', uk: 'pop / clickunder', ru: 'pop / clickunder' },
  ortb30: { en: 'oRTB 3.0', uk: 'oRTB 3.0', ru: 'oRTB 3.0' },
  native: { en: 'native', uk: 'native', ru: 'native' },
};

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

function localePrefix(lang) {
  return lang === 'en' ? '' : '/' + lang;
}

function renderShell(lang) {
  const titles = {
    section: pick({ en: 'Library', uk: 'Бібліотека', ru: 'Библиотека' }, lang),
    subtitle: pick(
      {
        en: 'Curated OpenRTB test cases plus your private ZK-encrypted saves.',
        uk: 'Куровані OpenRTB тест-кейси плюс твої приватні ZK-зашифровані збереження.',
        ru: 'Курируемые OpenRTB тест-кейсы плюс твои приватные ZK-зашифрованные сохранения.',
      },
      lang,
    ),
    tabCatalog: pick({ en: 'Catalog', uk: 'Каталог', ru: 'Каталог' }, lang),
    tabSaved: pick({ en: 'My saves', uk: 'Мої збереження', ru: 'Мои сохранения' }, lang),
    loading: pick({ en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' }, lang),
  };
  return `
    <section class="lib-section">
      <header class="lib-section__head">
        <h1>${escapeHtml(titles.section)}</h1>
        <p class="lib-section__sub">${escapeHtml(titles.subtitle)}</p>
        <div class="lib-tabs" role="tablist">
          <button type="button" class="lib-tab is-active" data-tab="catalog" role="tab" aria-selected="true">
            ${escapeHtml(titles.tabCatalog)}
          </button>
          <button type="button" class="lib-tab" data-tab="saved" role="tab" aria-selected="false">
            ${escapeHtml(titles.tabSaved)}
          </button>
        </div>
      </header>
      <div class="lib-panel" data-panel="catalog">
        <div class="lib-loading">${escapeHtml(titles.loading)}</div>
      </div>
      <div class="lib-panel" data-panel="saved" hidden>
        <div class="lib-loading">${escapeHtml(titles.loading)}</div>
      </div>
    </section>
  `;
}

function renderCard(item, lang, localeP) {
  const fmt = pick(FORMAT_LABEL[item.format] || { en: item.format }, lang);
  const loadLabel = pick(
    { en: 'Open in inspector', uk: 'Відкрити в інспекторі', ru: 'Открыть в инспекторе' },
    lang,
  );
  const copyLabel = pick({ en: 'Copy JSON', uk: 'Копіювати JSON', ru: 'Копировать JSON' }, lang);
  const inspectorHref = `${localeP}/inspector?sample=${encodeURIComponent(item.slug)}`;
  return `
    <article class="lib-card" data-slug="${escapeHtml(item.slug)}">
      <header class="lib-card__head">
        <h3 class="lib-card__title">${escapeHtml(item.label)}</h3>
        <span class="lib-card__format">${escapeHtml(fmt)}</span>
      </header>
      ${item.note ? `<p class="lib-card__note">${escapeHtml(item.note)}</p>` : ''}
      <footer class="lib-card__actions">
        <a class="lib-card__btn lib-card__btn--primary" href="${escapeHtml(inspectorHref)}" data-action="load-sample" data-slug="${escapeHtml(item.slug)}">
          → ${escapeHtml(loadLabel)}
        </a>
        <button type="button" class="lib-card__btn" data-action="copy-sample" data-slug="${escapeHtml(item.slug)}">
          ${escapeHtml(copyLabel)}
        </button>
      </footer>
    </article>
  `;
}

function renderCatalogPanel(items, lang) {
  const localeP = localePrefix(lang);
  const groups = ['iab', 'valid', 'attack'];
  const empty = pick(
    { en: 'No samples yet.', uk: 'Поки що зразків немає.', ru: 'Образцов пока нет.' },
    lang,
  );
  if (!items || !items.length) {
    return `<p class="lib-empty">${escapeHtml(empty)}</p>`;
  }
  return groups
    .map((g) => {
      const groupItems = items.filter((i) => i.category === g);
      if (!groupItems.length) return '';
      const groupLabel = pick(CATEGORY_LABEL[g], lang);
      return `
        <div class="lib-group">
          <h2 class="lib-group__title">${escapeHtml(groupLabel)} <span class="lib-group__count">${groupItems.length}</span></h2>
          <div class="lib-grid">${groupItems.map((i) => renderCard(i, lang, localeP)).join('')}</div>
        </div>
      `;
    })
    .join('');
}

function renderSavedPanel(state, samples, lang) {
  const localeP = localePrefix(lang);
  if (state === 'anonymous') {
    const prompt = pick(
      {
        en: 'Sign in to see your zero-knowledge encrypted samples. The server stores ciphertext only.',
        uk: 'Увійди щоб побачити свої zero-knowledge зашифровані зразки. На сервері зберігається лише шифротекст.',
        ru: 'Войди чтобы увидеть свои zero-knowledge зашифрованные образцы. На сервере хранится только шифротекст.',
      },
      lang,
    );
    const signIn = pick({ en: 'Sign in', uk: 'Увійти', ru: 'Войти' }, lang);
    return `
      <div class="lib-empty">
        <p>${escapeHtml(prompt)}</p>
        <a class="lib-card__btn lib-card__btn--primary" href="${localeP || ''}/account">${escapeHtml(signIn)}</a>
      </div>
    `;
  }
  if (state === 'locked') {
    const msg = pick(
      {
        en: 'Your library is encrypted. Unlock it from the cabinet to view samples here.',
        uk: 'Твоя бібліотека зашифрована. Розблокуй її в кабінеті щоб побачити зразки тут.',
        ru: 'Твоя библиотека зашифрована. Разблокируй её в кабинете чтобы увидеть образцы здесь.',
      },
      lang,
    );
    const goToAccount = pick(
      { en: 'Open cabinet', uk: 'Відкрити кабінет', ru: 'Открыть кабинет' },
      lang,
    );
    return `
      <div class="lib-empty">
        <p>${escapeHtml(msg)}</p>
        <a class="lib-card__btn lib-card__btn--primary" href="${localeP || ''}/account">${escapeHtml(goToAccount)}</a>
      </div>
    `;
  }
  if (!samples || !samples.length) {
    const empty = pick(
      {
        en: 'No saved samples yet. Use 💾 Save in the inspector to add the first one.',
        uk: 'Поки що збережень немає. Натисни 💾 Зберегти в інспекторі щоб додати перше.',
        ru: 'Сохранений пока нет. Нажми 💾 Сохранить в инспекторе чтобы добавить первое.',
      },
      lang,
    );
    return `<p class="lib-empty">${escapeHtml(empty)}</p>`;
  }
  return `
    <div class="lib-grid">
      ${samples.map((s) => renderSavedCard(s, lang, localeP)).join('')}
    </div>
  `;
}

function renderSavedCard(s, lang, localeP) {
  const created = s.created_at
    ? new Date(s.created_at).toLocaleString(lang === 'en' ? 'en-GB' : lang)
    : '';
  const openLabel = pick({ en: 'Open', uk: 'Відкрити', ru: 'Открыть' }, lang);
  return `
    <article class="lib-card lib-card--saved" data-id="${escapeHtml(s.id)}">
      <header class="lib-card__head">
        <h3 class="lib-card__title">${escapeHtml(s.title || '(no title)')}</h3>
        <span class="lib-card__format">${escapeHtml(created)}</span>
      </header>
      ${s.label ? `<p class="lib-card__note">${escapeHtml(s.label)}</p>` : ''}
      <footer class="lib-card__actions">
        <a class="lib-card__btn lib-card__btn--primary" href="${localeP || ''}/account#sample-${escapeHtml(s.id)}">
          ${escapeHtml(openLabel)}
        </a>
      </footer>
    </article>
  `;
}

async function fetchCatalog(signal) {
  const r = await fetch('/api/v1/sample/list', { signal });
  if (!r.ok) throw new Error('catalog HTTP ' + r.status);
  return (await r.json()).items || [];
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
  ok: { en: '✓ Copied', uk: '✓ Скопійовано', ru: '✓ Скопировано' },
  err: { en: 'Copy failed: ', uk: 'Помилка копіювання: ', ru: 'Ошибка копирования: ' },
};

async function copySampleToClipboard(slug, signal, toast, lang) {
  try {
    const r = await fetch(`/api/v1/sample?type=${encodeURIComponent(slug)}`, { signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const text = JSON.stringify(
      data.bid_request && Object.keys(data.bid_request).length
        ? data.bid_request
        : data.bid_response,
      null,
      2,
    );
    await navigator.clipboard.writeText(text);
    if (toast) toast(pick(COPY_TOAST.ok, lang), 'success');
  } catch (e) {
    if (e.name !== 'AbortError' && toast) toast(pick(COPY_TOAST.err, lang) + e.message, 'error');
  }
}

export default {
  id: 'library',
  css: '/modules/library/library.css',
  route: '/library',
  manifest: {
    title: { en: 'Library', uk: 'Бібліотека', ru: 'Библиотека' },
  },

  async mount(root, ctx) {
    const lang = ctx.lang || FALLBACK_LANG;

    root.innerHTML = renderShell(lang);
    const catalogPanel = root.querySelector('[data-panel="catalog"]');
    const savedPanel = root.querySelector('[data-panel="saved"]');

    // Hydrate catalog tab.
    try {
      const items = await fetchCatalog(ctx.signal);
      catalogPanel.innerHTML = renderCatalogPanel(items, lang);
    } catch (e) {
      if (e.name !== 'AbortError') {
        catalogPanel.innerHTML = `<p class="lib-empty">Failed to load catalog: ${escapeHtml(e.message)}</p>`;
      }
    }

    // Hydrate saved tab lazily on first activation.
    let savedHydrated = false;
    const hydrateSaved = async () => {
      if (savedHydrated) return;
      savedHydrated = true;
      try {
        const { state, samples } = await fetchSavedState(ctx.signal);
        savedPanel.innerHTML = renderSavedPanel(state, samples, lang);
      } catch (e) {
        if (e.name !== 'AbortError') {
          savedPanel.innerHTML = `<p class="lib-empty">Error: ${escapeHtml(e.message)}</p>`;
        }
      }
    };

    // Tab switching.
    const tabs = root.querySelectorAll('.lib-tab');
    tabs.forEach((t) => {
      t.addEventListener(
        'click',
        () => {
          tabs.forEach((x) => {
            x.classList.toggle('is-active', x === t);
            x.setAttribute('aria-selected', x === t ? 'true' : 'false');
          });
          const which = t.dataset.tab;
          catalogPanel.hidden = which !== 'catalog';
          savedPanel.hidden = which !== 'saved';
          if (which === 'saved') hydrateSaved();
        },
        { signal: ctx.signal },
      );
    });

    // Card action delegation. Load is a real <a> so the shell's pushState
    // interceptor handles it; we only need to wire Copy.
    root.addEventListener(
      'click',
      (e) => {
        const btn = e.target.closest('[data-action="copy-sample"]');
        if (!btn) return;
        e.preventDefault();
        copySampleToClipboard(btn.dataset.slug, ctx.signal, ctx.toast, lang);
      },
      { signal: ctx.signal },
    );
  },

  async unmount(_root) {
    /* registry sweeps DOM; section CSS persists (loaded once via mod.css) */
  },
};
