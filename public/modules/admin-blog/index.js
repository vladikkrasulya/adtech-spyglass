/* ============================================================
   public/modules/admin-blog/index.js — /admin/blog section module.

   Single page: lists pending drafts, per-row actions:
     - Approve + publish (to DB)
     - Approve + promote (to markdown, prompts for slug)
     - Reject

   Auth: token-input form stores token in sessionStorage.
   All admin XHRs send Authorization: Bearer <token>.
   ============================================================ */
'use strict';

import { escapeHtml } from '/core/utils.js';

const TOKEN_KEY = 'ortbtools_admin_token';

const L = {
  title: { en: 'Blog Admin', uk: 'Адмін блогу', ru: 'Админ блога' },
  authTitle: { en: 'Admin Auth', uk: 'Авторизація', ru: 'Авторизация' },
  authLabel: { en: 'Bearer Token', uk: 'Bearer-токен', ru: 'Bearer-токен' },
  authBtn: { en: 'Connect', uk: 'Підключитись', ru: 'Подключиться' },
  loading: { en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' },
  noItems: { en: 'No pending drafts.', uk: 'Немає draft-ів.', ru: 'Нет черновиков.' },
  refresh: { en: '↻ Refresh', uk: '↻ Оновити', ru: '↻ Обновить' },
  logout: { en: 'Logout', uk: 'Вийти', ru: 'Выйти' },
  publish: { en: 'Publish', uk: 'Опублікувати', ru: 'Опубликовать' },
  promote: { en: 'Promote →MD', uk: 'Promote →MD', ru: 'Promote →MD' },
  reject: { en: 'Reject', uk: 'Відхилити', ru: 'Отклонить' },
  slugPrompt: { en: 'Enter slug for this post:', uk: 'Введіть slug:', ru: 'Введите slug:' },
  // The drafts table shipped with its column headers and its two action
  // tooltips written straight into the markup in English, so under uk and ru
  // the only part of this page still speaking English was the part naming
  // what each column and each button does.
  colTitle: { en: 'Title', uk: 'Заголовок', ru: 'Заголовок' },
  colCategory: { en: 'Category', uk: 'Категорія', ru: 'Категория' },
  colLang: { en: 'Lang', uk: 'Мова', ru: 'Язык' },
  colSummary: { en: 'Summary', uk: 'Опис', ru: 'Описание' },
  colCreated: { en: 'Created', uk: 'Створено', ru: 'Создан' },
  colActions: { en: 'Actions', uk: 'Дії', ru: 'Действия' },
  publishHint: {
    en: 'Publish to the database',
    uk: 'Опублікувати в базу',
    ru: 'Опубликовать в базу',
  },
  promoteHint: {
    en: 'Promote to a markdown post',
    uk: 'Перенести в markdown-пост',
    ru: 'Перенести в markdown-пост',
  },
  // The reject confirm() dialog, the promote alert(), and the two error
  // surfaces (list-fetch failure banner + adminPost() failure alert) were
  // hardcoded English literals bypassing this module's own L/pick() table.
  confirmReject: {
    en: 'Reject this draft?',
    uk: 'Відхилити цей драфт?',
    ru: 'Отклонить этот черновик?',
  },
  promotedPrefix: {
    en: 'Promoted! ',
    uk: 'Перенесено в markdown! ',
    ru: 'Перенесено в markdown! ',
  },
  errorPrefix: {
    en: 'Error: ',
    uk: 'Помилка: ',
    ru: 'Ошибка: ',
  },
};

function pick(map, lang) {
  if (!map) return '';
  return map[lang] || map['en'] || '';
}

function getSavedToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}
function saveToken(t) {
  try {
    sessionStorage.setItem(TOKEN_KEY, t);
  } catch {}
}
function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

// `new Date('nonsense')` does not throw, so this try/catch never fired: it
// returned an Invalid Date and `toLocaleString()` on one is the literal
// English string "Invalid Date". A draft that reached the queue without a
// usable created_at printed that in the Created column. Same call as the
// public listing makes — and the same answer: state no date rather than a
// wrong one.
function formatDate(s, lang) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString(lang === 'uk' ? 'uk-UA' : lang === 'ru' ? 'ru-RU' : 'en-US');
  } catch {
    return String(s).slice(0, 16).replace('T', ' ');
  }
}

export default {
  id: 'admin-blog',
  css: '/modules/admin-blog/admin-blog.css',
  route: '/admin/blog',
  manifest: {
    title: { en: 'Blog Admin', uk: 'Адмін блогу', ru: 'Админ блога' },
  },

  async mount(root, ctx) {
    const lang = ctx.lang || 'en';

    let token = getSavedToken();

    function renderAuthForm() {
      root.innerHTML = `
        <section class="ablog-section">
          <h1>${escapeHtml(pick(L.authTitle, lang))}</h1>
          <form class="ablog-auth" id="authForm">
            <label for="tokenInput">${escapeHtml(pick(L.authLabel, lang))}</label>
            <input type="password" id="tokenInput" class="ablog-input" autocomplete="off" placeholder="Bearer …" />
            <button type="submit" class="ablog-btn ablog-btn--primary">${escapeHtml(pick(L.authBtn, lang))}</button>
          </form>
        </section>
      `;
      root.querySelector('#authForm').addEventListener(
        'submit',
        (e) => {
          e.preventDefault();
          const val = root.querySelector('#tokenInput').value.trim();
          if (!val) return;
          token = val;
          saveToken(token);
          loadDrafts();
        },
        { signal: ctx.signal },
      );
    }

    async function loadDrafts() {
      root.innerHTML = `
        <section class="ablog-section">
          <header class="ablog-head">
            <h1>${escapeHtml(pick(L.title, lang))}</h1>
            <div class="ablog-head-actions">
              <button type="button" class="ablog-btn" id="refreshBtn">${escapeHtml(pick(L.refresh, lang))}</button>
              <button type="button" class="ablog-btn ablog-btn--ghost" id="logoutBtn">${escapeHtml(pick(L.logout, lang))}</button>
            </div>
          </header>
          <div id="draftsContainer"><p class="ablog-loading">${escapeHtml(pick(L.loading, lang))}</p></div>
        </section>
      `;
      root
        .querySelector('#refreshBtn')
        .addEventListener('click', () => loadDrafts(), { signal: ctx.signal });
      root.querySelector('#logoutBtn').addEventListener(
        'click',
        () => {
          clearToken();
          token = '';
          renderAuthForm();
        },
        { signal: ctx.signal },
      );

      await fetchAndRender();
    }

    async function fetchAndRender() {
      const container = root.querySelector('#draftsContainer');
      if (!container) return;
      try {
        const resp = await fetch('/api/admin/blog/drafts?status=pending', {
          headers: { Authorization: 'Bearer ' + token },
          signal: ctx.signal,
        });
        if (resp.status === 401) {
          clearToken();
          token = '';
          renderAuthForm();
          return;
        }
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        if (!data.drafts || !data.drafts.length) {
          container.innerHTML = `<p class="ablog-empty">${escapeHtml(pick(L.noItems, lang))}</p>`;
          return;
        }
        container.innerHTML = renderTable(data.drafts, lang);

        // Wire action buttons
        container.querySelectorAll('[data-action]').forEach((btn) => {
          btn.addEventListener(
            'click',
            async () => {
              const id = btn.dataset.id;
              const action = btn.dataset.action;
              await handleAction(id, action);
            },
            { signal: ctx.signal },
          );
        });
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (container)
          container.innerHTML = `<p class="ablog-error">${escapeHtml(pick(L.errorPrefix, lang))}${escapeHtml(e.message)}</p>`;
      }
    }

    async function handleAction(id, action) {
      if (action === 'reject') {
        if (!confirm(pick(L.confirmReject, lang))) return;
        await adminPost('/api/admin/blog/reject', { id });
        await fetchAndRender();
        return;
      }
      if (action === 'publish') {
        await adminPost('/api/admin/blog/approve', { id, action: 'publish' });
        await fetchAndRender();
        return;
      }
      if (action === 'promote') {
        const slug = prompt(pick(L.slugPrompt, lang));
        if (!slug) return;
        const result = await adminPost('/api/admin/blog/approve', { id, action: 'promote', slug });
        if (result && result.hint) {
          alert(pick(L.promotedPrefix, lang) + result.hint);
        }
        await fetchAndRender();
        return;
      }
    }

    async function adminPost(url, body) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (resp.status === 401) {
          clearToken();
          token = '';
          renderAuthForm();
          return null;
        }
        return await resp.json();
      } catch (e) {
        if (e.name !== 'AbortError') alert(pick(L.errorPrefix, lang) + e.message);
        return null;
      }
    }

    // ── Initial render ─────────────────────────────────────
    if (token) {
      await loadDrafts();
    } else {
      renderAuthForm();
    }
  },
};

function renderTable(drafts, lang) {
  const rows = drafts
    .map(
      (d) => `
    <tr>
      <td class="ablog-td ablog-td--title">
        ${escapeHtml(d.title)}
        ${d.url ? `<a class="ablog-link" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">↗</a>` : ''}
      </td>
      <td class="ablog-td">${escapeHtml(d.category)}</td>
      <td class="ablog-td">${escapeHtml(d.lang)}</td>
      <td class="ablog-td ablog-td--summary">${escapeHtml((d.summary || '').slice(0, 100))}${(d.summary || '').length > 100 ? '…' : ''}</td>
      <td class="ablog-td ablog-td--date">${escapeHtml(formatDate(d.created_at, lang))}</td>
      <td class="ablog-td ablog-td--actions">
        <button class="ablog-btn ablog-btn--publish" data-action="publish" data-id="${escapeHtml(d.id)}" title="${escapeHtml(pick(L.publishHint, lang))}">${escapeHtml(pick(L.publish, lang))}</button>
        <button class="ablog-btn ablog-btn--promote" data-action="promote" data-id="${escapeHtml(d.id)}" title="${escapeHtml(pick(L.promoteHint, lang))}">${escapeHtml(pick(L.promote, lang))}</button>
        <button class="ablog-btn ablog-btn--reject"  data-action="reject"  data-id="${escapeHtml(d.id)}">${escapeHtml(pick(L.reject, lang))}</button>
      </td>
    </tr>`,
    )
    .join('');
  return `
    <div class="ablog-table-wrap">
      <table class="ablog-table">
        <thead>
          <tr>
            <th>${escapeHtml(pick(L.colTitle, lang))}</th>
            <th>${escapeHtml(pick(L.colCategory, lang))}</th>
            <th>${escapeHtml(pick(L.colLang, lang))}</th>
            <th>${escapeHtml(pick(L.colSummary, lang))}</th>
            <th>${escapeHtml(pick(L.colCreated, lang))}</th>
            <th>${escapeHtml(pick(L.colActions, lang))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
