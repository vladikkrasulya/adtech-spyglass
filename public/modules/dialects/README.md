# dialects module

Full-page CRUD UI for the user's saved dialects + their mappings.
Lazy-loaded — only fetched when the user navigates to `/app/dialects`
or any host route that calls `openDialectsPage(rootEl)`.

## Entry point

```js
import { openDialectsPage } from '/public/modules/dialects/index.js';
await openDialectsPage(document.getElementById('appRoot'));
```

The function takes ownership of the provided element (sets innerHTML
on re-renders, attaches a single delegated click+change listener).
Idempotent — calling twice is safe; the listener is bound once via
`dataset.dialectsBound`.

## Dependencies

- `/core/utils.js` — `$, escapeHtml, toast, t`
- Backend endpoints under `/api/dialects` (see
  `modules/dialects/handler.js`)
- A `#modalRoot` element somewhere in the host page (existing convention
  per `modules/simulate/index.js` etc.) — used by form dialogs.

## Data flow

1. `openDialectsPage(rootEl)` → captures `rootEl`, attaches listeners,
   renders, fires `loadDialects()`.
2. `loadDialects()` → `GET /api/dialects` → updates `state.dialects` →
   `rerender()`.
3. User clicks **Open** on a dialect → `loadMappings(id)` →
   `GET /api/dialects/:id/mappings` → switches `state.selectedDialectId`
   → `rerender()` renders the detail view.
4. Mutations (`POST`/`PATCH`/`DELETE`) go through `apiCall()` which
   throws on `!response.ok || !data.success`. The catch shows
   `t('dialects.toast.error')`; success cases show specific toast keys.
5. Export uses direct nav: `window.location = '/api/dialects/:id/export'`
   — server sets `Content-Disposition`, browser downloads.
6. Import is a hidden `<input type=file>` triggered by the toolbar
   Import button. The file is read with `file.text()`, parsed, posted.

## Drift detection

Skeleton-level: each mapping row carries a ⚠ badge if it has a stored
`shape_fingerprint`. Clicking the badge shows the warning toast. Real
drift will compare the stored fingerprint against the *current* payload
fingerprint at validation time — that integration lives in the analyze
pipeline, not here.

## Why no nicer modal/confirm UI

Skeleton uses native `window.confirm()` for destructive ops. Acceptable
for first cut; the existing share/recovery modules in `/public/modules/`
have nicer modal patterns that this can adopt later. The `showFormDialog`
helper already does forms via the standard `#modalRoot` pattern, so
upgrading delete-confirm later is a small change.

## State

```js
state = {
  rootEl: HTMLElement,
  dialects: [...],
  selectedDialectId: string | null,
  mappings: [...],
}
```

Module-level. Re-rendered on every state change via `rerender()` which
sets `state.rootEl.innerHTML`.
