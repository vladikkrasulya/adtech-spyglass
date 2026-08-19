/* ============================================================
   public/core/utils.js — shared technical utilities (ES module).

   Extracted from ortbtools.app.js on 2026-05-05 as the first step of
   the modular-architecture migration (Phase A of the plan in
   docs/stream-platform-pivot-2026-05-05.md). Behaviour is identical
   to the inlined originals; this is a pure code-organisation move.

   Future feature modules (inspector, stream, ads.txt, tcf-decoder)
   will import from this single source instead of redefining helpers.
   ============================================================ */

/* DOM helper — short alias for document.getElementById. */
export const $ = (id) => document.getElementById(id);

/* Safe HTML escape for any user-provided string — TEXT *and* ATTRIBUTE
   position.

   This used to build a text node and read back innerHTML, on the reasoning
   that the browser's own serialiser must be exhaustive. It is not, and the
   comment saying so is why nobody checked: text-node serialisation escapes
   `&`, `<` and `>` and deliberately leaves quotes alone, because inside text
   a quote needs no escaping. Every one of this project's call sites that
   interpolates into an attribute — `class="…${escapeHtml(v)}"` — was
   therefore injectable with a single `"`, which closes the attribute and
   lets the rest of the value become new attributes. A blog post whose
   category was `guide" onmouseover="…` shipped a live event handler onto
   the page, and `script-src 'unsafe-inline'` meant CSP did not stand in the
   way. Twelve modules import this function; ten call sites in blog/index.js
   and four in admin-blog/index.js sit in attribute position.

   The server-side helper of the same name in lib/seo.js always escaped
   quotes. Two functions, one name, different behaviour — the client half
   was the wrong one, and it was the half handling content the server had
   already decided was safe to hand over.

   An explicit table now, covering both quote characters. `&` runs first or
   it would double-escape the entities the later replacements introduce. */
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Toast notification — appends a transient pill into #toastContainer
   and fades it out after 2.5s. type: 'success' (default) or 'error'.
   Silently no-ops if the container is missing (e.g. before DOM ready,
   on surfaces without the toast region). */
export function toast(msg, type) {
  const c = $('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'success');
  t.innerHTML = (type === 'error' ? '⚠ ' : '✓ ') + escapeHtml(msg);
  c.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.3s';
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

/* i18n thin wrapper — delegates to window.t (set by /i18n.js) when
   available, falls back to the key itself. Lets module-scoped code
   import a stable `t` identifier even before i18n.js becomes a real
   module. Once it does, this re-export point goes away cleanly. */
export const t = (...args) => (typeof window.t === 'function' ? window.t(...args) : args[0]);

/* ── Tab badge severity (Phase B helpers, also extracted) ──────────
   setTabBadge mutates text + severity class on an inspector-tab badge.
   All four severity classes are stripped before the new one is added
   so toggling between specimens never leaves stale state.

   Manifesto rule 3 (state drives surface presence): when the badge
   has nothing to show ('' or '0'), hide it via the [hidden] attribute
   so the empty inspector chrome doesn't read as "0 0 0 0 0" — it just
   reads as a clean tab bar. Meaningful text ('✓', '!', '5', '—')
   passes through and shows the badge. Caller doesn't need to think
   about visibility — it follows the value.
*/
export function setTabBadge(id, opts) {
  const el = $(id);
  if (!el) return;
  const o = opts || {};
  if (o.text !== undefined) el.textContent = String(o.text);
  el.classList.remove('danger', 'warn', 'info', 'ok');
  if (o.severity) el.classList.add(o.severity);
  const txt = (el.textContent || '').trim();
  el.hidden = txt === '' || txt === '0';
}

/* Reduce a request/response findings[] to the worst severity class.
   Order: error > warning > info. Empty = 'ok' (clean). */
export function severityFromFindings(findings) {
  if (!Array.isArray(findings)) return null;
  if (findings.length === 0) return 'ok';
  if (findings.some((f) => f.level === 'error' || f.level === 'danger')) return 'danger';
  if (findings.some((f) => f.level === 'warning' || f.level === 'warn')) return 'warn';
  if (findings.some((f) => f.level === 'info')) return 'info';
  return null;
}

/* Crosscheck variant — uses CROSS_LEVELS vocabulary (ok/warn/crit).
   Empty array means "no specimen analysed yet" → null (badge stays
   neutral). Pure pass = 'ok'. */
export function severityFromCrosschecks(crosschecks) {
  if (!Array.isArray(crosschecks) || crosschecks.length === 0) return null;
  if (crosschecks.some((c) => c.level === 'crit')) return 'danger';
  if (crosschecks.some((c) => c.level === 'warn')) return 'warn';
  return 'ok';
}
