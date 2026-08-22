# Idea Intake: Inspector UI Consistency

- **Slug**: inspector-ui-consistency
- **Created**: 2026-08-22
- **Source**: owner, testing production `v1.14.4` after the 1.14.4 release; findings arriving
  incrementally with screenshots
- **Type**: defect cluster + cohesion work

## How this list is kept

The owner reports findings as they are found and asked that they be worked **in arrival order**.
This file is the queue, so nothing depends on a conversation staying open. Each entry keeps its
report verbatim enough to act on, plus whatever has already been established about it.

Status vocabulary: `reported` → `diagnosed` → `queued for fix` → `done` / `won't fix (reason)`.

---

## Q1 — Validation-settings gear renders broken · `diagnosed` · **not a UI defect**

**Reported**: the gear in the inspector workbar shows a stray `▶` above and `▼` below it, and in a
second screenshot the same area renders as several enormous white rounded shapes across the toolbar,
with the native tooltip "Настройки валидации" visible. Reported at what looks like desktop width,
with the inline text selects ("авто", "Standard IAB (oRTB 2.5)") visible at the same time.

**DIAGNOSED AND ADVERSARIALLY VERIFIED.** The workbar CSS is correct; it simply was not the CSS the
browser had. A tab left open across a module-asset deploy pairs **new markup with old stylesheet**:
the template is served `no-cache` and refetched, while `inspector.css` is served
`public, max-age=31536000, immutable` under a `?v=ASSET_VERSION` the open tab snapshotted before the
deploy. Without the `.workbar-settings-*` rules, `<details>` falls back to `display:block`, `<summary>`
to `display:list-item` — which is the stray `▶`/`▼` — and the gear `<svg>`, carrying `viewBox` and no
width/height, is sized by its container: 16×16 closed, **438×438 open**. That is the enormous white
shape. Reproduced twice, once against live production with the pre-gear CSS substituted, once
end-to-end on a local server across a simulated deploy.

Underneath sits a real server defect worth fixing on its own merits: `server.js:778-780` labels any
`?v=` URL immutable for a year **while ignoring the `?v=` value entirely** — production returns the
current bytes for `inspector.css?v=deadbeef`, still labelled immutable. A URL that promises
immutability and serves changing content is the mechanism, not the symptom.

**This also explains the `v1.14.2` version string** the owner saw while the markup was current: same
open tab, same snapshot.

**Established before delegating**: markup is `<details class="workbar-settings-menu">` /
`<summary class="workbar-settings-toggle">` in `public/modules/inspector/template.*.html` ~line 48;
the gear `<svg>` carries `viewBox` but **no width/height**. In `inspector.css` the base rule is
`.workbar-settings-menu { display: none }` (~763) and only `@media (max-width: 720px)` (~5508) both
reveals it and sizes the svg 17×17 (~5532). Measured on production at 1440/1024/860/760/721/720/700/
640/390 px: correct at every width — hidden ≥721, 17×17 ≤720. **The reported state was not
reproduced**, so the cause is a state, not a width. The summary computes `display: list-item` on
desktop, which is a candidate for the stray marker.

## Q2 — Fix action does not switch payload tab · `diagnosed` · **confirmed on every point**

**DIAGNOSED.** `OrtbtoolsSourceNav.navigate()` reveals a target pane only through `expand(side)`
(`source-nav.js:503-506`), which removes `is-collapsed` — the fold mechanism of the **old two-pane
layout**, where both textareas were visible and either could collapse. The one-editor tab layout that
replaced it hides the inactive payload with a **different** class, so `expand()` removes a class that
is not what hides the pane. The jump then paints highlight ranges into a pane nobody can see. Fix is
one insertion in `navigate()`: activate the owning tab before painting.

**Reported**: with the Request tab open and the finding belonging to the Response, pressing the
finding's fix action leaves the view on Request, which has no errors, so nothing is highlighted.
Expected: switch to the tab that owns the finding, then highlight.

## Q3 — Line-number gutter has a fixed width · `diagnosed` · **confirmed, two CSS lines**

**Reported**: with fewer lines than the indent allows for, the gutter should shrink; the width should
follow the line count.

**DIAGNOSED.** `.line-gutter` is `flex: 0 0 auto` with a hard-coded `min-width: 44px`
(`inspector.css:4950-4951`). The `auto` basis already content-sizes the column; the 44px floor simply
sits above every realistic digit count — at 13px monospace a digit advances 7.80px, so even four
digits plus padding is 39.2px, under the floor. Verified: the width is 44px flat from 1 to 5000 lines
and only moves at 12000. Fix is two CSS declarations, no JS: lower the floor to a `ch`-based value and
correct a padding tie in the later block.

**Established**: `#gutterReq` computes to exactly **44px** whether the document has 1 line or many.
Not a large-ish default — a constant.

## Q4 — Verdict block, "Ещё", and the black rectangle · `diagnosed` · **confirmed, one CSS line**

**Reported**: the block could be tidier; the "Ещё" overflow list might deserve to be partly expanded
(the owner explicitly flagged this as possibly wrong and wants options, not a verdict); and there is
a black rectangle to the right of the context chip ("web · Apple · ES") whose purpose is unclear.

**DIAGNOSED — and it is not an empty chip.** The black rectangle is `.analysis-strip`'s **own
background**. A theme-scoped band-era rule, `[data-theme='dark'] .analysis-strip` at
`inspector.css:3309`, has specificity 0,2,0 and outranks the later "V2 right panel" rule at
`inspector.css:4196-4202` that zeroes the strip's chrome with `background: transparent` at 0,1,0 —
later source order cannot beat higher specificity. So the container paints a dark band, and wherever
the chips do not cover it, the band shows through. That is why it appears only after the context chip,
and why it never appeared in my repro: fewer chips, different leftover width. One line fixes it.

**Established**: the strip is assembled in `public/ortbtools.app.js` ~1950–2105 as `.analysis-strip`
children — bid, pricing, size, intent, context, quality — each guarded to `''` when its data is
absent. Reproduced with a video impression and a winning bid: **four blocks, none empty**. The black
rectangle did not appear, so it depends on a data shape not yet identified.

## Q5 — Dropdown menus are inconsistent across the product · `reported`

**Reported**: five screenshots show at least two unrelated popup families — "Загрузить пример" and
"поделиться" render as styled dark panels, while the dialect selector ("Standard IAB (oRTB 2.5)") and
the version selector ("авто") render as **native OS select popups** with the platform's blue
selection. The owner wants one appearance.

**Noted, not yet diagnosed**: the inspector template carries **5 native `<select>` elements and 6
`<details>` menus**, which is the split the screenshots show. This is not only a styling gap: a native
`<select>` popup is drawn by the operating system and cannot be styled at all, so "make them look the
same" necessarily means replacing native selects with custom listboxes — which trades unstylable-but-
free accessibility for styled-and-hand-built ARIA. Feature 006 deliberately kept native controls
where it could, and its contract states disclosure panels must not claim unimplemented ARIA menu
behaviour. So this entry is a design decision with a real cost on both sides, not a defect to be
quietly fixed.

## Q6 — Result-tab bar alignment, and the count badge · `reported`

**Reported**: the text in the result-tab bar does not line up, and it must line up **in all three
locales**, not only where the words happen to be short. Separately, the score/count field could be
rethought — it is not pretty, though the bar reads well overall.

Screenshot shows: `Находки [7]` with the count in a red-outlined box, `Импрессии [1]` in a plain grey
box, `Сверка ✓`, `Креатив`, then `Ещё ⌄` sitting inside a visibly taller bordered box whose top and
bottom edges extend past the other tabs' text.

**Noted, not yet diagnosed**: `.tab-btn` is a bare button — `border: none; background: none;` with
`padding: var(--space-3) var(--space-4)` (`inspector.css` ~2354–2365) — while `.tab-more` is a
`<details>`/`<summary>` disclosure carrying its own border and background from the shared control
layer. Two different box models sharing one row is the shape of the reported misalignment: the tabs
have no box, the overflow control has one, so nothing forces a common height or baseline.

The locale requirement matters more than it looks. The bar mixes a monospace font at 11px with
variable-width Cyrillic labels and numeric badges, so any alignment that is achieved by tuning
padding for Russian will drift in Ukrainian and English. Whatever is proposed has to hold a shared
baseline grid rather than a set of hand-fitted paddings — and the existing browser suites already
pin locale geometry at 320–414 px, so a fix has a place to prove itself.

## Q7 — The account email appears in the topbar search field · `reported` · **privacy-adjacent, highest severity in this queue**

**Reported**: pressing "разблокировать" puts the owner's account email into the topbar search input.
It is still there after the unlock dialog is gone.

**Established, and it points away from our code**: the unlock modal contains **no email input at
all** — only `<input id="unlockPwInput" type="password" autocomplete="current-password">`
(`public/modules/unlock/index.js:90`). The email appears in that dialog purely as display text in the
subtitle. The topbar search input already carries `autocomplete="off"` and `type="text"`
(`public/modules/topbar/index.js:132-140`).

**Leading hypothesis, not yet reproduced**: Chrome's password manager pairs a `current-password`
field with a username field. This dialog offers none inside a form, so the browser heuristically
picks the nearest text input in the document — the topbar search — and fills the saved username
there. Chrome's password manager ignores `autocomplete="off"` on such fields, which is why the
existing attribute does not prevent it. If that is the mechanism, the standard remedy is to give the
unlock form its own username field carrying `autocomplete="username"` (readonly, or visually hidden)
inside a real `<form>`, so the browser fills the field intended for it.

**Severity note**: this is the owner's own address on the owner's own machine, so it is not a
cross-user disclosure. It is still PII surfacing where nobody asked for it, it survives the dialog,
and it lands in a field that gets screenshotted — as it just did. It should be worked before the
cosmetic entries regardless of arrival order, if the owner agrees.

## Q8 — Toast text overlaps itself on copy and on format · `reported`

**Reported**: pressing copy-request/copy-response, and separately the format action, produces a
confirmation whose text is overlaid by other content. Screenshots show "скопирован…" and
"отформатировано" each with a rounded-square outline and a second glyph layer struck through the
middle of the word.

**Not yet diagnosed**. The shape suggests two elements sharing one position rather than a font
problem — a toast whose icon and label are absolutely positioned in the same box, or an old toast
that has not been removed before the new one paints. Both actions producing the same artifact points
at the toast component, not at either action.

---

## Cross-cutting: the reporting session may not be running the deployed build

The status bar in one screenshot reads `готов engine v1.14.2`, and the verdict block reads
`движок v1.14.2`, while production serves **v1.14.4** and the template's own static fallback says
`v1.14.4`.

It is not a wholesale stale page: the validation-settings gear exists **only from v1.14.3 onward**
(`workbar-settings-menu` appears 0 times in `84cc6ea` = v1.14.2 and once in HEAD), and the owner can
see it. So the markup is current while the version string is not — a partial cache. `/version.js` is
requested as `?v=1`, a query that has never changed across releases, and production serves it with
`cache-control: max-age=14400`.

Two consequences worth separating:

1. **For this queue**: some reported artifacts may already differ on a freshly loaded build. Each
   entry should be re-checked against a hard-reloaded page before a fix is designed, or effort may go
   into repairing something already repaired.
2. **On its own merits**: an interface that states a version it is not running is a truthfulness
   defect independent of these findings. The cache-buster on `version.js` never changes, so the file
   that exists to report the version is the one most able to report a stale one.

---

## Not yet assessed

This file is an intake, not a decision. Nothing here is authorized for implementation; the cluster
needs `speckit.assess` and a feature package before any repository change, exactly as the
constitution requires. Diagnosis is read-only work and is proceeding now.
