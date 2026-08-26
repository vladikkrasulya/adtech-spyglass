# Quickstart Validation: Push Creative Preview

All commands from the repository root. The synthetic material is the 013 replica (no
production records — Constitution III/VII).

## 1. Browser regression suite (the boundary)

```bash
node --test tests/push-preview-browser.test.js
```

Expected: the suite spawns `server.js` + system Chrome and proves — single object and
one-element array both mount a sandboxed iframe whose document carries the material's icon
and image URLs and the `push · synthetic render` label; the empty-state message is absent; a
markup-bearing `title` appears only entity-escaped; the price chip shows the material's cpc.

## 2. Existing preview suites stay green

```bash
node --test tests/creative-preview-browser.test.js tests/clear-resets-results-browser.test.js
```

## 3. Look at it (measure-then-look)

```bash
node /tmp/claude-1000/-srv-DATA-Stacks-ortbtools/1a50bc16-1ac1-4b14-8f97-1671229d76ac/scratchpad/push-preview-shot.js after.png
```

Before-state (captured 2026-08-26, pre-change):
`{"hasIframe": false, "text": "No renderable creative (adm/iurl) in response"}`.
Expected after: `hasIframe: true`, srcdoc carries the icon/image URLs; the screenshot shows
the notification card (icon top-left, headline, body text, hero image) and is actually
opened and looked at, not just saved.

## 4. Full gate

```bash
npm run ci
```

## Requirement → proof map

| Requirement   | Proof                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| FR-001/FR-005 | suite: card cases (full, icon-only, image-only) + screenshot                       |
| FR-002        | suite: array case                                                                  |
| FR-003        | suite asserts sandbox attribute unchanged + probed srcdoc; no server calls added   |
| FR-004        | suite: escaping vector on `srcdoc`                                                 |
| FR-006        | suite: price-chip text                                                             |
| FR-007        | existing creative-preview suites re-run green                                      |
| FR-008        | this file §1 + §3 (screenshots looked at, before/after recorded in tasks Evidence) |
