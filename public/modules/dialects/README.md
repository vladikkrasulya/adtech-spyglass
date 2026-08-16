# dialects module

The `/dialects` section: one page that holds every rule set the product
knows about. Registered lazily in `public/shell-boot.js` and mounted into
`#app-root` by `core/registry.js`; there is no other entry point.

## What the page shows

A fixed white page-header band (H1 + one-line subtitle) over a grey
scrolling region holding up to three blocks. Each block opens with an
uppercase eyebrow followed by a hairline rule that runs to the right
edge — the only uppercase level on the page.

1. **Shipped overlays** — the three built-in dialects (`iab`, `ext-rtb`,
   `inpage-push`) as cards: an `ACTIVE`/`AVAILABLE` mono eyebrow, a
   Geologica title, a two-line description, and a mono footer line
   (`iab · maintained`, `ext-rtb · 5 rules`). The active card is
   outlined in accent and carries four `+` corner marks.

   The card is a `<button>`. Clicking it makes that dialect active —
   same `ortbtools_dialect_v1` key, same side effects, as the
   inspector's footer picker (`setActiveDialect` in
   `public/ortbtools.app.js`). The rule count in each card comes from
   `GET /api/v1/finding-catalog` and is marked up as
   `.dlc-card__count`, which is what `tests/spec-refs.test.js` asserts
   against.

2. **Your overlays** — rendered only when the browser holds temporary
   dialects (`OrtbtoolsIntelStorage.listTempDialects()`). Same card
   language, so a dialect you built and one that shipped read alike.
   Not in the mockup; the mockup had no way to know the feature exists.

3. **Discovered in your traffic** — the co-occurrence clusters
   Discovery found locally, one row each: a derived title, the field
   paths, how many payloads carried the whole cluster, a confidence
   word, and a ghost **Build overlay** button. The block heading
   carries a `N new` badge (clusters with a field first seen in the
   last 24h) and a right-aligned reminder that only field paths are
   involved.

   "Build overlay" opens `window.OrtbtoolsIntelBuilder.open()` and then
   clicks that modal's own "use cluster" button for the matching field
   signature, so the reader lands in the builder with the row they were
   looking at already selected. Best-effort: the modal lists its top 5
   clusters, and a row outside that set simply opens the builder plain.

## Data sources

| what               | where                                                    |
| ------------------ | -------------------------------------------------------- |
| rule counts        | `GET /api/v1/finding-catalog`                            |
| discovery clusters | `window.OrtbtoolsIntelStorage` (IndexedDB, this browser) |
| custom overlays    | `OrtbtoolsIntelStorage.listTempDialects()`               |
| active dialect     | `?dialect=` then `localStorage.ortbtools_dialect_v1`     |

Nothing on this page is sent anywhere. The catalog request carries no
payload, and the cluster numbers are counts of what this browser has
seen.

## Duplicated code, and why

Two blocks are inlined copies rather than imports:

- `detectClusters()` — a trimmed copy of
  `packages/core/intel/cluster.js`, with the same thresholds and the
  same `fields.join('|')` signature `modules/intel/builder.js` uses.
  Same convention (and the same KEEP IN SYNC comment) as that file;
  `packages/` is not served to the browser.
- `activeDialect()` / `setActiveDialect()` — mirror of the block in
  `public/ortbtools.app.js`, which is a classic script with no exports.

If the resolution order or the cluster thresholds move, both copies
have to move with them.

## Strings

Localised copy lives in the `L` map at the top of `index.js` and is
resolved with `pick(map, lang)` from `ctx.lang` — this module does not
go through `window.t` / `public/i18n.js`, so there are no bracketed-id
failures to worry about, but every string must carry `en`, `uk` and `ru`.

`modules/dialects/i18n.js` is a leftover from an abandoned CRUD design
and is imported by nothing.
