# Implementation Plan: Push Creative Preview

**Branch**: `main` (direct defect-repair workflow, per the 012/013 precedent) | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-push-creative-preview/spec.md`

## Summary

The preview source selection in the Inspector knows only OpenRTB shapes: it reads
`res.seatbid[0].bid[0]`, prefers structured `bid.native`, then walks for `adm`, then falls
back to `iurl` ([ortbtools.app.js:3911](../../public/ortbtools.app.js), `findAdm()` at
:1044). A push material has none of those keys, so `setAdPreview(null)` renders the
"preview.no_adm" empty state — reproduced in a real browser before this package was opened
(`{"hasIframe":false,"text":"No renderable creative (adm/iurl) in response"}`).

The fix mirrors the native precedent exactly: `renderNativeToHtml()` (:3120) already
synthesizes a self-contained HTML card from a structured creative and pipes it through the
probed sandboxed iframe like any banner markup. We add `findPushMaterial()` +
`renderPushToHtml()` and one seam in the adm-selection block; the synthetic card then
classifies as `markup` and travels the existing pipeline untouched — same sandbox attributes,
same probe, same static scan, same safe-demo blur. Images inside the card load in-frame the
same way banner markup and the `iurl` fallback already load third-party images; no server
fetching, no frame-policy change. The price chip additionally reads the material's
`cpc`/`price`.

## Technical Context

**Language/Version**: browser JavaScript (vanilla, IIFE app bundle `public/ortbtools.app.js`);
Node.js >= 22.13.0 only for the test harness

**Primary Dependencies**: none added; `puppeteer-core` + system Chrome already power the
browser suites

**Storage**: N/A

**Testing**: new `tests/push-preview-browser.test.js` patterned on
`tests/creative-preview-browser.test.js` (spawn `server.js`, drive `#bidRes` +
`window.runAnalysis()`); visual before/after screenshots via the same harness
(measure-then-look)

**Target Platform**: production browser app; live only after image rebuild + deploy

**Project Type**: single-app frontend module change

**Performance Goals**: negligible — one object scan and one string build per analysis

**Constraints**: frame policy byte-identical (Constitution project constraint: sandbox stays
`allow-scripts`-only, no `allow-same-origin`); no server asset path; all material strings
escaped (`escapeHtml`, as in `renderNativeToHtml`); no new i18n keys (in-frame label follows
the unlocalized native precedent); response-only analyses are supported by `runAnalysis`
(`req = {}`)

**Scale/Scope**: 1 file edited (`public/ortbtools.app.js`: two new functions + one seam +
price-chip line), 1 test file added

## Constitution Check

- **I — Spec Kit working memory**: PASS — this package; constitution/ROADMAP/baseline read;
  owner report quoted in spec Input. Entered via `speckit.specify` (reproduced defect with an
  owner ruling on priorities, not an uncertain idea).
- **II — Evidence-backed**: PASS — empty state reproduced in a real Chrome before planning;
  all seams cited by line; after-state must be screenshotted and looked at (spec FR-008).
- **III — Privacy/security**: PASS — no collection/retention/model/proxy change; the card is
  client-side string building from the payload the operator pasted; sandboxed frame policy
  byte-identical; escaping required by FR-004 and covered by a test. No payload bodies in
  tracked artifacts — tests use the 013 synthetic replica material.
- **IV — Deterministic public contracts**: PASS — no Core/API change at all; Core stays
  0.36.0. The app's preview behavior gains a branch for a shape that previously dead-ended;
  no finding IDs, no API shapes touched.
- **V — Bounded architecture**: PASS — two sibling functions beside `renderNativeToHtml` and
  one seam in the existing selection block; no new abstraction.
- **VI — Locales move together**: PASS — zero UI-string changes; the in-frame label follows
  the existing unlocalized "native · synthetic render" precedent (recorded in spec
  Assumptions); the empty-state wording is untouched.
- **VII — Proportional verification**: PASS — browser regression test (single, array,
  escaping, price chip) + existing creative-preview suites re-run + visual check; narrowest
  first, `npm run ci` before commit.
- **VIII — Traceable release**: PASS — app-version bump decided at release (this ships as the
  next app release through the standing path); commit authored-paths-only.

## Project Structure

```text
specs/014-push-creative-preview/
├── spec.md / plan.md / tasks.md
├── checklists/requirements.md
└── quickstart.md            # validation guide (browser harness + screenshots)

public/ortbtools.app.js      # findPushMaterial(), renderPushToHtml(), selection seam,
                             #   price-chip line — all inside the Inspector module
tests/push-preview-browser.test.js   # new browser regression suite
```

**Structure Decision**: single-file frontend change beside its precedent code; test follows
the existing browser-suite layout.

## Design decisions (research folded in — all seams verified in source this session)

1. **Material detection mirrors 013**: `findPushMaterial(res)` — a plain object with a price
   key (`cpc`|`price`), a click key (`click_url`|`link`), and ≥1 creative key
   (`title`|`description`|`image`|`image_url`|`icon`|`icon_url`) → the material; an array →
   its first element matching the same test (first-bid precedent). Checked AFTER
   `bid.native` and `findAdm()` so every OpenRTB shape keeps precedence (FR-007); `findAdm`
   returns null for push materials (no `adm`/`iurl`), so the seam is reached exactly when
   today's code dead-ends.
2. **Card enters as markup**: `renderPushToHtml()` returns a full `<!doctype html>` document
   (inline styles, `escapeHtml` on every material string) which the classifier treats as
   `markup` → the banner branch mounts it in the probed sandboxed iframe. We deliberately do
   NOT add a classifier kind: classification runs on `adm` bodies, and a push material never
   had one — synthesis happens at the source-selection seam, like `iurl` does.
3. **Visual hierarchy per the owner**: icon first (48px, top row, beside title+description),
   large image second (hero block below), then the click URL footer; label
   `push · synthetic render`. Layout adapted from the native card so the two synthetic
   renders read as one family.
4. **Dims**: when the push seam fires and no dims exist, `previewDims = {w:360,h:300}` — a
   typical push-notification aspect; the banner branch's scale-to-fit handles narrow panels.
5. **Price chip**: when the push seam fires, `mPrice` shows
   `formatMoney(Number(m.cpc ?? m.price), 'USD')` when that value is finite; otherwise the
   existing behavior stands. (Push feeds carry no currency field; USD default matches the
   response-side default already used.)
6. **Escaping test vector**: a material whose `title` is `<img src=x onerror=…>` must appear
   in the frame document only in entity-escaped form (`&lt;img`), and the card body must
   contain no element from the payload — asserted on the exact `srcdoc` string.

## Complexity Tracking

No constitution violations; table intentionally empty.
