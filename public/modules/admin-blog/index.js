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

const TOKEN_KEY = 'spyglass_admin_token';

const L = {
  title:     { en: 'Blog Admin',      uk: 'Адмін блогу',      ru: 'Админ блога'    },
  authTitle: { en: 'Admin Auth',      uk: 'Авторизація',       ru: 'Авторизация'    },
  authLabel: { en: 'Bearer Token',    uk: 'Bearer-токен',      ru: 'Bearer-токен'   },
  authBtn:   { en: 'Connect',         uk: 'Підключитись',      ru: 'Подключиться'   },
  loading:   { en: 'Loading…',        uk: 'Завантаження…',     ru: 'Загрузка…'      },
  noItems:   { en: 'No pending drafts.', uk: 'Немає draft-ів.', ru: 'Нет черновиков.' },
  refresh:   { en: '↻ Refresh',       uk: '↻ Оновити',         ru: '↻ Обновить'     },
  logout:    { en: 'Logout',          uk: 'Вийти',             ru: 'Выйти'          },
  publish:   { en: 'Publish',         uk: 'Опублікувати',      ru: 'Опубликовать'   },
  promote:   { en: 'Promote →MD',     uk: 'Promote →MD',       ru: 'Promote →MD'    },
  reject:    { en: 'Reject',          uk: 'Відхилити',         ru: 'Отклонить'      },
  slugPrompt: { en: 'Enter slug for this post:', uk: 'Введіть slug:', ru: 'Введите slug:' },
};

function pick(map, lang) {
  if (!map) return '';
  return map[lang] || map['en'] || '';
}

function getSavedToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
function saveToken(t) {
  try { sessionStorage.setItem(TOKEN_KEY, t); } catch {}
}
function clearToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

function formatDate(s) {
  try { return new Date(s).toLocaleString(); } catch { return s || ''; }
}

export default {
  id: 'admin-blog',
  route: '/admin/blog',
  manifest: {
    title: { en: 'Blog Admin', uk: 'Адмін блогу', ru: 'Админ блога' },
  },

  async mount(root, ctx) {
    const lang = ctx.lang || 'en';

    // Load CSS
    const cssHref = new URL('./admin-blog.css', import.meta.url).href;
    const linkEl = document.createElement('link');
    linkEl.rel = 'stylesheet';
    linkEl.href = cssHref;
    document.head.appendChild(linkEl);
    ctx.addCleanup(() => linkEl.remove());

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
      root.querySelector('#authForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const val = root.querySelector('#tokenInput').value.trim();
        if (!val) return;
        token = val;
        saveToken(token);
        loadDrafts();
      }, { signal: ctx.signal });
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
      root.querySelector('#refreshBtn').addEventListener('click', () => loadDrafts(), { signal: ctx.signal });
      root.querySelector('#logoutBtn').addEventListener('click', () => {
        clearToken();
        token = '';
        renderAuthForm();
      }, { signal: ctx.signal });

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
          btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const action = btn.dataset.action;
            await handleAction(id, action);
          }, { signal: ctx.signal });
        });
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (container) container.innerHTML = `<p class="ablog-error">Error: ${escapeHtml(e.message)}</p>`;
      }
    }

    async function handleAction(id, action) {
      if (action === 'reject') {
        if (!confirm('Reject this draft?')) return;
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
          alert('Promoted! ' + result.hint);
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
        if (e.name !== 'AbortError') alert('Error: ' + e.message);
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
      <td class="ablog-td ablog-td--date">${escapeHtml(formatDate(d.created_at))}</td>
      <td class="ablog-td ablog-td--actions">
        <button class="ablog-btn ablog-btn--publish" data-action="publish" data-id="${escapeHtml(d.id)}" title="Publish to DB">${escapeHtml(pick(L.publish, lang))}</button>
        <button class="ablog-btn ablog-btn--promote" data-action="promote" data-id="${escapeHtml(d.id)}" title="Promote to markdown">${escapeHtml(pick(L.promote, lang))}</button>
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
            <th>Title</th><th>Category</th><th>Lang</th><th>Summary</th><th>Created</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
