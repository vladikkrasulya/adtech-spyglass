# Walkthrough — Priority #4: OpenRTB 2.6 Migration Advisor (UI)

> Earlier priorities' walkthroughs are in git history, not in this file: #0
> (privacy-safe product telemetry) is at `ad4ef27`, its predecessor at
> `8032c55`. This file always documents the priority just closed.

The advisor rules themselves landed earlier as `bc07e5a` + `1e12257`, built in a
separate worktree and verified here against 17 adversarial probes. They were
merged to `main` but wired to nothing — no export, no browser copy, no UI. This
priority is the other half: making the advice reachable, and making it safe to
act on.

---

## 1. What was built

**A Migration tab that proposes, and only applies when told to.**

The chain is deliberately identical to the Diff tab's, because the property that
matters is the same: the browser must apply _exactly_ the rules the tests pin,
so there is one canonical source and no second implementation.

```
packages/core/migrate/{rules,index}.js     ← canonical, isomorphic (UMD-lite)
        │  scripts/gen-browser-core.js (byte-parity guard in CI)
        ▼
public/core/migrate-rules.js, migrate.js   ← verbatim copies, loaded by <script>
        │
        ▼
public/modules/migrate/index.js            ← presentation + the applier
```

### The two decisions worth reading

**Proposals are atomic; operations are not.** The advisor emits a promotion as
_two_ operations — an `add` at the 2.6 path and a `remove` at the legacy path.
Rendering those as two checkboxes would let a user tick the `remove` alone and
silently delete a consent string. The tab pairs them back into one proposal and
applies them together.

Pairing is not a guess. An `add` pairs with a `remove` when they share a rule id
**and the removal sits underneath the add's parent** — which is exactly how the
advisor constructs a promotion (`/imp/1/rwdd` ← `/imp/1/video/ext/rewarded`,
`/regs/gdpr` ← `/regs/ext/gdpr`). That containment test is what stops imp 1's
`add` being paired with imp 0's `remove` when only one of two impressions needs
the promotion — the failure a "first free add" pairing would produce, and the
case `tests/migrate-tab.test.js` → _"pairing never crosses an imp boundary"_
exists to catch.

An unpaired `remove` is a real and safe case: it means the 2.6 field already
holds the same value, so only the legacy copy goes. It is labelled `Drop legacy
copy` with that reason spelled out, rather than hidden or silently merged.

**`review` is never pre-ticked.** `certain` and `likely` arrive selected;
`review` arrives unselected, on a warning-coloured row. That confidence level
exists precisely for advice the advisor cannot justify on its own — the
ambiguous-taxonomy case `1e12257` introduced — so pre-ticking it would undo the
point of having the level at all.

### Undo

Apply stores the previous editor text **verbatim** and restores it on one click.
Not a recomputed inverse patch — the literal string. That matters because Apply
re-serializes with `JSON.stringify(…, null, 2)` and therefore reformats the
whole document; an inverse-patch undo would leave the user's original formatting
gone forever. The reformatting is stated in the UI _before_ the click, not
discovered after it.

If nothing actually applied, the editor is not rewritten and no undo point is
created — an Undo button that restores identical text would be a lie.

---

## 2. Files changed

### New

| File                                | What it is                                                |
| ----------------------------------- | --------------------------------------------------------- |
| `public/modules/migrate/index.js`   | the tab: grouping, rendering, the applier, Undo           |
| `public/modules/migrate/i18n.js`    | `migrate.*` keys in uk / en / ru                          |
| `public/modules/migrate/styles.css` | scoped styles, design-system tokens only                  |
| `public/core/migrate-rules.js`      | generated verbatim copy (parity-guarded)                  |
| `public/core/migrate.js`            | generated verbatim copy (parity-guarded)                  |
| `tests/migrate-tab.test.js`         | 14 tests — pairing, the applier, real samples; no browser |
| `tests/migrate-tab-browser.test.js` | 1 end-to-end smoke test in real headless Chrome           |

### Modified

| File                                                | Change                                                        |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `packages/core/migrate/{index,rules}.js`            | wrapped in the UMD-lite shape so one source runs in both envs |
| `packages/core/migrate/README.md`                   | names the caller that does apply, and how                     |
| `packages/core/index.js`                            | exports `adviseMigration25To26`, `MIGRATION_RULES`            |
| `scripts/gen-browser-core.js`                       | two new mirror pairs                                          |
| `public/index.{en,uk,ru}.html`                      | stylesheet + four script tags, rules before index             |
| `public/modules/inspector/template.{en,uk,ru}.html` | `tMigrate` tab button, badge, content container               |
| `lib/product-telemetry.js`                          | `migrate_use` / `migrate_apply` in the event vocabulary       |
| `public/telemetry.js`                               | same two names in the browser copy of the vocabulary          |
| `docs/PRIVACY.md`                                   | event table corrected and extended                            |
| `tests/migration-rules.test.js`                     | purity guard now strips comments before scanning              |
| `tests/gists-browser.test.js`                       | fixed a tamper assertion that tampered with nothing (§5)      |

The migration-rules one: the guard asserted the module never mentions `window`,
and the UMD header _documents_ that its browser global is
`window.OrtbtoolsMigrate`. The guard was reading prose. It now scans executable
text only — the same fix `tests/gists.test.js` already carries, for the same
reason.

---

## 3. Acceptance criteria vs evidence

### "Вкладка зі списком запропонованих операцій, spec-лінк, before/after, confidence"

Live run against a 2.5 request exercising all eight rules — 7 proposals, each
with its confidence chip, rule id, `from → to = value` line, rationale, and a
spec link:

```
mig-certain  ortb26.video.protocols  Move  /imp/0/video/protocol → /imp/0/video/protocols = [3]
mig-certain  ortb26.regs.gdpr        Move  /regs/ext/gdpr        → /regs/gdpr             = 1
mig-certain  ortb26.user.consent     Move  /user/ext/consent     → /user/consent          = CONSENT-STRING
mig-certain  ortb26.content.prodq    Move  /site/content/videoquality → /site/content/prodq = 1
mig-likely   ortb26.imp.rwdd         Move  /imp/0/video/ext/rewarded  → /imp/0/rwdd         = 1
mig-likely   ortb26.source.schain    Move  /source/ext/schain    → /source/schain          = {…}
mig-review   ortb26.category.cattax  Add   /site/cattax = 1
```

Spec hrefs verified to be `https://github.com/InteractiveAdvertisingBureau/…`
links, opened with `rel="noopener noreferrer"`.

### "`review` візуально відрізняється від `certain`"

Distinct CSS class, distinct left border, warning colour, and — the part that
actually protects the user — **unticked**. The Apply button read
`Apply selected (6)` against 7 listed proposals.

`tests/migrate-tab.test.js` pins the default table; the browser test asserts the
rendered checkbox state. Both were confirmed non-vacuous by mutation: flipping
`review: false → true` produces `not ok — a `review` proposal must never be
pre-ticked`.

### "Apply лише за явним кліком"

Asserted directly: after loading the payload and opening the tab, the editor
still equals the original string byte-for-byte. Rendering, badge updates and
re-analysis never write.

### "Обов'язковий Undo"

```
UNDO → byte-exact restore: true | proposals back: 7
```

Also mutation-checked: removing the `undoText = previous` line produces
`not ok — Undo did not restore the original text exactly`.

### "Нічого не втрачається"

After applying the 6 ticked proposals:

```
regs.gdpr=1   regs.ext={}   user.consent=CONSENT-STRING   user.ext={vendorThing:"keep-me"}
imp[0].video.protocols=[3]  imp[0].rwdd=1  imp[0].video.ext={vendor:"keep"}
site.content.prodq=1  source.schain present  imp[1] untouched  id/bidfloor untouched
```

The unticked `review` proposal was **not** applied (`site.cattax` absent) and is
still the one row on offer. Emptied `ext` containers are left in place, matching
the advisor's own contract.

### Wiring is real, not just present

`node scripts/gen-browser-core.js --check` reports both new copies byte-identical
to their canonical sources; `tests/browser-core-parity.test.js` fails the build
on drift. `require('@ortbtools/core').adviseMigration25To26` resolves.

---

## 4. Test results

Targeted:

```
node --test tests/migrate-tab.test.js          → 14 pass, 0 fail
node --test tests/migrate-tab-browser.test.js  →  1 pass, 0 fail
node --test tests/migration-rules.test.js      → 11 pass, 0 fail
node --test tests/browser-core-parity.test.js  →  1 pass, 0 fail
```

Full `npm run ci` (format:check → lint → typecheck → test:coverage):

```
# tests 1928
# pass  1918
# fail  0
# skipped 10
```

Baseline before this priority was 1913; the 15 added are the 14 unit tests plus
the browser smoke test.

Both browser assertions were verified to fail under deliberate mutation before
being accepted — see §3.

---

## 5. A latent defect in Priority #2's test, found by running CI repeatedly

`tests/gists-browser.test.js` → _"a tampered key must not decrypt to anything"_
failed once in a full run and then passed three runs in a row. Run in isolation
it failed 2 times in 5, so it was not load-related.

The cause is arithmetic. A 256-bit key is 43 base64url characters, and
43 × 6 = 258 bits — the final character carries four significant bits and two
that decode to nothing. The test "tampered" with the key by flipping that last
character, so roughly one time in sixteen the tampered key decoded to **exactly
the original 32 bytes**, decryption succeeded, and the assertion reported a
zero-knowledge failure that had not happened.

```
measured over 20 000 random keys: collision rate 5.92%
distinct final characters observed: 0 4 8 A E I M Q U Y c g k o s w   (16 — as expected)
```

The product is fine: `importContentKey` rejects wrong keys correctly, and no
entropy is lost — two spellings of the same key are still one 256-bit key. What
was broken was the test, and its failure mode was the expensive kind: a false
alarm on an encryption claim.

Fixed by editing the **first** character, where all six bits are significant,
and by asserting the premise before relying on it — the tampered key is now
decoded in-page and compared against the original, so if it ever stops being a
different key the test says so instead of passing quietly. 8 consecutive solo
runs and 2 consecutive full CI runs green afterwards.

---

## 6. Known limitations

- **Apply reformats the document.** 2-space indent, key order preserved,
  comments impossible (it is JSON). Stated in the UI before the click; Undo is
  the exact way back, but only one level deep — a second Apply overwrites the
  undo point rather than stacking.
- **The rule set is bounded, and the tab says so.** Flexible banner bounds,
  `device.sua`, pod metadata and anything else without an unambiguous 2.6
  counterpart are out of scope. "No proposals" therefore means "nothing this
  rule set recognises", not "fully migrated" — the footer states that in all
  three locales so the empty state cannot be misread.
- **Request side only.** The advisor requires `imp[]`, so a BidResponse is
  reported as _not examined_ rather than as clean. Verified in the browser test.
- **The badge recomputes on a 400 ms debounce** after editor input, and the list
  itself re-derives only on tab open, explicit Refresh, Apply or Undo — a list
  that redrew mid-review would fight the user.
- **Selection is per-session, not persisted.** Re-opening the tab restores the
  confidence defaults. Deliberate: a remembered tick on a `review` proposal is
  exactly the state that should not survive.

---

## 7. State to resume from

- Landed on `feat/migration-advisor-ui` as three commits, kept separate because
  they are three different things: the gists test fix (§5), this priority, and
  the `vast-shape` extraction that belongs to #5's integration rather than to
  #4. Merged to `main` and deployed from there. Production had been sitting at
  `0e5b6da` while `main` was `1e12257` — core-only, no behaviour difference —
  and this closes that gap too.
- Codex is on `feat/vast-timeline` in `/srv/DATA/Work/ortbtools-diff`, building
  Priority #5's VAST extractor under `packages/core/vast-timeline/`. Its brief
  forbids `packages/core/index.js`, `spec-refs.json`, `rules-vast.js`,
  `tests/vast.test.js`, `public/**`, `scripts/gen-browser-core.js`, `server.js`,
  `db.js`, `modules/**` — export wiring and browser mirroring stay the
  integration step here, exactly as they were for #3 and #4.
- `packages/core/vast-shape.js` is that integration already started: the two
  VAST sniffing helpers moved out of `format-detect.js` (which re-exports them
  unchanged) so the browser can have them without dragging
  `non-iab-formats.js` along. Codex's module still reads them from
  `../format-detect`; repointing it at `../vast-shape` is a two-line change
  once its branch merges.
- `migrate_use` / `migrate_apply` are in the vocabulary and emitting, but no row
  exists in ClickHouse yet — the table accepts them by name, no DDL needed.

---

## 8. Not done in this priority

- **No `confirm()` before Apply.** An explicit button plus an exact, always-
  present Undo covers it, and a modal on an operation designed to be run
  iteratively would be friction without safety. Reconsider if a second undo
  level ever lands.
- **No multi-level undo history.** One level, exact.
- **#3 cosmetics still open**: diff-count badge on the Diff tab, loading side B
  from local history.
- **#5 and #6 untouched** on this side.
