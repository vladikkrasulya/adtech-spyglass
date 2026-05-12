/* ============================================================
   modules/dialects/index.js — Full-page Dialects CRUD module
   (lazy-loaded ES module).

   Loaded when user navigates to /app/dialects (or any host route
   that calls openDialectsPage(rootEl)). Renders into the provided
   rootEl, takes over click handling via delegation, manages a
   list of dialects + their mapping rows. Uses native confirm()
   for destructive ops — acceptable for skeleton; replace with a
   nicer modal later.

   Exposed window APIs:
     - export async function openDialectsPage(rootEl)

   Backend: see modules/dialects/handler.js for the full API.
   ============================================================ */
import { $, escapeHtml, toast, t } from '/core/utils.js';

// Module-level state. The root element is captured on first open
// so re-renders can update the same DOM subtree.
const state = {
  rootEl: null,
  dialects: [],
  selectedDialectId: null,
  mappings: [],
};

export async function openDialectsPage(rootEl) {
  state.rootEl = rootEl;

  // Click delegation: one listener on the root, dispatches by
  // closest [data-action]. Survives re-renders since we never
  // detach rootEl itself.
  if (!rootEl.dataset.dialectsBound) {
    rootEl.dataset.dialectsBound = '1';
    rootEl.addEventListener('click', handleClick);
    rootEl.addEventListener('change', handleChange);
  }

  rerender();
  await loadDialects();
}

function rerender() {
  if (!state.rootEl) return;
  state.rootEl.innerHTML = renderPage();
}

function renderPage() {
  return `
    <div class="dialects-page">
      ${renderToolbar()}
      ${state.selectedDialectId ? renderDetail() : renderList()}
    </div>
  `;
}

function renderToolbar() {
  return `
    <div class="dialects-toolbar">
      <h1>${escapeHtml(t('dialects.page.title'))}</h1>
      <div class="dialects-toolbar-actions">
        <button class="btn" data-action="dialect-create">${escapeHtml(t('dialects.btn.new'))}</button>
        <button class="btn" data-action="dialect-import-pick">${escapeHtml(t('dialects.btn.import'))}</button>
        <input type="file" id="dialectsImportFile" data-action="dialect-import-file" accept=".json" style="display:none">
      </div>
    </div>
  `;
}

function renderList() {
  if (!state.dialects.length) {
    return `<div class="empty">${escapeHtml(t('dialects.empty.no_dialects'))}</div>`;
  }
  return `
    <div class="dialects-list">
      ${state.dialects
        .map(
          (d) => `
        <div class="dialect-item">
          <div class="dialect-info">
            <h3>${escapeHtml(d.name)}</h3>
            <span class="dialect-count">${d.mapping_count || 0} ${escapeHtml(t('dialects.mappings.title'))}</span>
            ${d.is_default ? `<span class="badge">${escapeHtml(t('dialects.badge.default'))}</span>` : ''}
          </div>
          <div class="dialect-actions">
            <button class="btn btn-sm" data-action="dialect-open" data-id="${escapeHtml(d.id)}">${escapeHtml(t('dialects.btn.open'))}</button>
            <button class="btn btn-sm" data-action="dialect-rename" data-id="${escapeHtml(d.id)}">${escapeHtml(t('dialects.btn.rename'))}</button>
            ${
              !d.is_default
                ? `<button class="btn btn-sm" data-action="dialect-set-default" data-id="${escapeHtml(d.id)}">${escapeHtml(t('dialects.btn.set_default'))}</button>`
                : ''
            }
            <button class="btn btn-sm" data-action="dialect-export" data-id="${escapeHtml(d.id)}">${escapeHtml(t('dialects.btn.export'))}</button>
            <button class="btn btn-sm btn-danger" data-action="dialect-delete" data-id="${escapeHtml(d.id)}">${escapeHtml(t('dialects.btn.delete'))}</button>
          </div>
        </div>`,
        )
        .join('')}
    </div>
  `;
}

function renderDetail() {
  const dialect = state.dialects.find((d) => d.id === state.selectedDialectId);
  if (!dialect) return renderList(); // dialect was deleted under us — fall back

  const rows = state.mappings.length
    ? `
      <table class="mappings-table">
        <thead>
          <tr>
            <th>${escapeHtml(t('dialects.mappings.col.path'))}</th>
            <th>${escapeHtml(t('dialects.mappings.col.value'))}</th>
            <th>${escapeHtml(t('dialects.mappings.col.label'))}</th>
            <th>${escapeHtml(t('dialects.mappings.col.notes'))}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${state.mappings.map(renderMappingRow).join('')}
        </tbody>
      </table>`
    : `<div class="empty">${escapeHtml(t('dialects.empty.no_mappings'))}</div>`;

  return `
    <div class="dialect-detail">
      <div class="detail-header">
        <button class="btn btn-ghost btn-sm" data-action="dialect-back">← ${escapeHtml(t('dialects.btn.cancel'))}</button>
        <h2>${escapeHtml(dialect.name)}</h2>
      </div>
      <div class="mappings-toolbar">
        <button class="btn" data-action="mapping-create">${escapeHtml(t('dialects.mappings.new'))}</button>
      </div>
      ${rows}
    </div>
  `;
}

function renderMappingRow(m) {
  // Drift detection placeholder: backend doesn't yet ship a "current"
  // fingerprint per validation request, so we can only flag mappings
  // whose stored shape_fingerprint hash exists. Real drift detection
  // will compare against the active /api/analyze response signature.
  const driftBadge = m.shape_fingerprint
    ? `<span class="drift-badge" data-action="dialect-drift-info" title="${escapeHtml(t('dialects.drift.warning'))}">⚠</span>`
    : '';
  return `
    <tr>
      <td><code>${escapeHtml(m.signal_path)}</code></td>
      <td><code>${escapeHtml(m.signal_value)}</code></td>
      <td>${escapeHtml(m.semantic_label)}</td>
      <td>${escapeHtml(m.notes || '')}</td>
      <td class="row-actions">
        ${driftBadge}
        <button class="btn btn-sm" data-action="mapping-edit" data-id="${escapeHtml(m.id)}">${escapeHtml(t('dialects.btn.rename'))}</button>
        <button class="btn btn-sm btn-danger" data-action="mapping-delete" data-id="${escapeHtml(m.id)}">${escapeHtml(t('dialects.btn.delete'))}</button>
      </td>
    </tr>
  `;
}

// ── data loaders ─────────────────────────────────────────────────────

async function loadDialects() {
  try {
    const data = await apiCall('/api/dialects');
    state.dialects = data.dialects || [];
    rerender();
  } catch (_e) {
    toast(t('dialects.toast.error'), 'error');
  }
}

async function loadMappings(dialectId) {
  try {
    const data = await apiCall(`/api/dialects/${encodeURIComponent(dialectId)}/mappings`);
    state.mappings = data.mappings || [];
    state.selectedDialectId = dialectId;
    rerender();
  } catch (_e) {
    toast(t('dialects.toast.error'), 'error');
  }
}

// ── event dispatch ──────────────────────────────────────────────────

function handleClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target || !state.rootEl.contains(target)) return;
  const action = target.dataset.action;
  const id = target.dataset.id || null;

  switch (action) {
    case 'dialect-create':
      return showCreateDialog();
    case 'dialect-import-pick':
      return triggerFilePicker();
    case 'dialect-open':
      return loadMappings(id);
    case 'dialect-rename': {
      const d = state.dialects.find((x) => x.id === id);
      return d ? showRenameDialog(d) : null;
    }
    case 'dialect-set-default':
      return setDefaultDialect(id);
    case 'dialect-export':
      // Direct nav — browser handles Content-Disposition.
      window.location = `/api/dialects/${encodeURIComponent(id)}/export`;
      return;
    case 'dialect-delete': {
      const d = state.dialects.find((x) => x.id === id);
      if (d && window.confirm(t('dialects.confirm.delete_dialect', { name: d.name }))) {
        deleteDialect(id);
      }
      return;
    }
    case 'dialect-back':
      state.selectedDialectId = null;
      state.mappings = [];
      rerender();
      return;
    case 'mapping-create':
      return showMappingDialog(null);
    case 'mapping-edit': {
      const m = state.mappings.find((x) => x.id === id);
      return m ? showMappingDialog(m) : null;
    }
    case 'mapping-delete':
      if (window.confirm(t('dialects.confirm.delete_mapping'))) {
        deleteMapping(id);
      }
      return;
    case 'dialect-drift-info':
      toast(t('dialects.drift.warning'), 'info');
      return;
    default:
      // unknown action — ignore (e.g. modal-close handled by host page)
      return;
  }
}

function handleChange(e) {
  if (e.target.dataset.action === 'dialect-import-file') {
    handleImportFile(e.target);
  }
}

function triggerFilePicker() {
  const input = state.rootEl.querySelector('#dialectsImportFile');
  if (input) input.click();
}

async function handleImportFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      toast(t('dialects.toast.error'), 'error');
      return;
    }
    await apiCall('/api/dialects/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    toast(t('dialects.toast.imported'), 'success');
    await loadDialects();
  } catch (_e) {
    toast(t('dialects.toast.error'), 'error');
  } finally {
    input.value = ''; // allow re-selecting the same file
  }
}

// ── mutations ───────────────────────────────────────────────────────

async function setDefaultDialect(id) {
  try {
    await apiCall(`/api/dialects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_default: true }),
    });
    toast(t('dialects.toast.updated'), 'success');
    await loadDialects();
  } catch (_e) {
    toast(t('dialects.toast.error'), 'error');
  }
}

async function deleteDialect(id) {
  try {
    await apiCall(`/api/dialects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (state.selectedDialectId === id) state.selectedDialectId = null;
    toast(t('dialects.toast.deleted'), 'success');
    await loadDialects();
  } catch (_e) {
    toast(t('dialects.toast.error'), 'error');
  }
}

async function deleteMapping(id) {
  try {
    await apiCall(
      `/api/dialects/${encodeURIComponent(state.selectedDialectId)}/mappings/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    toast(t('dialects.toast.deleted'), 'success');
    await loadMappings(state.selectedDialectId);
  } catch (_e) {
    toast(t('dialects.toast.error'), 'error');
  }
}

// ── modal dialogs (simple, native-form-driven) ──────────────────────

function showCreateDialog() {
  showFormDialog({
    title: t('dialects.dialog.create_title'),
    fields: [
      {
        name: 'name',
        label: t('dialects.field.name'),
        type: 'text',
        maxlength: 80,
        required: true,
      },
    ],
    onSubmit: async (data) => {
      await apiCall('/api/dialects', {
        method: 'POST',
        body: JSON.stringify({ name: data.name }),
      });
      toast(t('dialects.toast.created'), 'success');
      await loadDialects();
    },
  });
}

function showRenameDialog(dialect) {
  showFormDialog({
    title: t('dialects.dialog.rename_title'),
    fields: [
      {
        name: 'name',
        label: t('dialects.field.name'),
        type: 'text',
        value: dialect.name,
        maxlength: 80,
        required: true,
      },
    ],
    onSubmit: async (data) => {
      await apiCall(`/api/dialects/${encodeURIComponent(dialect.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: data.name }),
      });
      toast(t('dialects.toast.updated'), 'success');
      await loadDialects();
    },
  });
}

const SEMANTIC_LABELS = [
  'pop',
  'native',
  'banner',
  'video',
  'audio',
  'in-page-push',
  'push',
  'interstitial-banner',
  'ignore',
  'informational',
  'custom',
];

function showMappingDialog(existing) {
  const isEdit = !!existing;
  showFormDialog({
    title: t('dialects.dialog.mapping_title'),
    fields: [
      {
        name: 'signal_path',
        label: t('dialects.field.signal_path'),
        type: 'text',
        value: isEdit ? existing.signal_path : '',
        required: true,
      },
      {
        name: 'signal_value',
        label: t('dialects.field.signal_value'),
        type: 'text',
        value: isEdit ? existing.signal_value : '',
        required: true,
      },
      {
        name: 'semantic_label',
        label: t('dialects.field.semantic_label'),
        type: 'select',
        options: SEMANTIC_LABELS,
        value: isEdit ? existing.semantic_label : 'custom',
        required: true,
      },
      {
        name: 'notes',
        label: t('dialects.field.notes'),
        type: 'textarea',
        value: isEdit ? existing.notes || '' : '',
      },
    ],
    onSubmit: async (data) => {
      const path = isEdit
        ? `/api/dialects/${encodeURIComponent(state.selectedDialectId)}/mappings/${encodeURIComponent(existing.id)}`
        : `/api/dialects/${encodeURIComponent(state.selectedDialectId)}/mappings`;
      await apiCall(path, {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify(data),
      });
      toast(t(isEdit ? 'dialects.toast.updated' : 'dialects.toast.created'), 'success');
      await loadMappings(state.selectedDialectId);
    },
  });
}

function showFormDialog({ title, fields, onSubmit }) {
  const modalRoot = $('modalRoot');
  if (!modalRoot) {
    toast(t('dialects.toast.error'), 'error');
    return;
  }

  const fieldHtml = fields
    .map((f) => {
      const v = f.value || '';
      if (f.type === 'select') {
        const opts = f.options
          .map(
            (o) =>
              `<option value="${escapeHtml(o)}" ${o === v ? 'selected' : ''}>${escapeHtml(o)}</option>`,
          )
          .join('');
        return `<label>${escapeHtml(f.label)}<select name="${escapeHtml(f.name)}" ${f.required ? 'required' : ''}>${opts}</select></label>`;
      }
      if (f.type === 'textarea') {
        return `<label>${escapeHtml(f.label)}<textarea name="${escapeHtml(f.name)}">${escapeHtml(v)}</textarea></label>`;
      }
      const maxlen = f.maxlength ? ` maxlength="${f.maxlength}"` : '';
      return `<label>${escapeHtml(f.label)}<input type="text" name="${escapeHtml(f.name)}" value="${escapeHtml(v)}" ${f.required ? 'required' : ''}${maxlen}></label>`;
    })
    .join('');

  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="modal-backdrop-close">
      <div class="modal-card">
        <div class="modal-title">${escapeHtml(title)}</div>
        <form id="dialectForm" class="modal-form">
          ${fieldHtml}
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-action="modal-close">${escapeHtml(t('dialects.btn.cancel'))}</button>
            <button type="submit" class="btn btn-primary">${escapeHtml(t('dialects.btn.save'))}</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const form = modalRoot.querySelector('#dialectForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(form));
    try {
      await onSubmit(formData);
      modalRoot.innerHTML = '';
    } catch (_err) {
      toast(t('dialects.toast.error'), 'error');
    }
  });
}

// ── HTTP helper ─────────────────────────────────────────────────────

async function apiCall(path, options) {
  const o = options || {};
  const r = await fetch(path, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: o.body,
  });
  let data;
  try {
    data = await r.json();
  } catch (_) {
    throw new Error('bad_response');
  }
  if (!r.ok || !data.success) {
    const code = data && data.error ? data.error : `http_${r.status}`;
    const err = new Error(code);
    err.code = code;
    throw err;
  }
  return data;
}
