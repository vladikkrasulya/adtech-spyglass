# Quickstart Validation: Single-Object Push Response Recognition

Prerequisites: repo checkout, Node.js >= 22.13.0, `npm ci` already run (workspace installs).
All commands run from the repository root.

## 1. Reproduce the claim (before/after)

The synthetic replica of the reported payload (same ten keys and value shapes, synthetic
values — never the production record):

```json
{
  "tId": "00000000-0000-4000-8000-000000000001",
  "title": "Synthetic push headline",
  "description": "Synthetic push body text",
  "icon": "https://ads.example.com/icn.png",
  "image": "https://ads.example.com/img.jpg",
  "link": "https://ads.example.com/click",
  "linkTtl": 1900000000000,
  "cpc": 0.01,
  "crid": "SYNTHETICCRID000000000000000000",
  "cid": "SYNTHETICCID0000000000000000000"
}
```

Spot-check against the live module:

```bash
node -e "
const { validate } = require('./packages/core');
const payload = { tId:'00000000-0000-4000-8000-000000000001', title:'Synthetic push headline', description:'Synthetic push body text', icon:'https://ads.example.com/icn.png', image:'https://ads.example.com/img.jpg', link:'https://ads.example.com/click', linkTtl:1900000000000, cpc:0.01, crid:'SYNTHETICCRID000000000000000000', cid:'SYNTHETICCID0000000000000000000' };
const r = validate(payload);
console.log('type:', r.type);
console.log('unknown_type present:', r.findings.some(f => f.id === 'payload.unknown_type'));
console.log('findings:', r.findings.map(f => f.id));
"
```

Expected **before** the fix: `type: unknown`, `unknown_type present: true`.
Expected **after** the fix: `type: Push-Materials Feed Response (single)`,
`unknown_type present: false`, and no `feed.push.id_required` /
`feed.push.image_url_recommended` / `feed.push.nurl_recommended` in the finding list.

## 2. Narrow suites first (Constitution VII)

```bash
node --test tests/detection-mechanism.test.js
```

```bash
node --test tests/validator.test.js
```

```bash
node --test tests/i18n-audit.test.js
```

Expected: all pass; the new cases cover the detection matrix (claim, precedence non-claims,
generic-JSON non-claims), the alias matrix per pair, single-vs-array finding parity, and the
synthetic replica end-to-end. i18n audit proves no locale drift (no message keys changed).

## 3. Full gate before commit

```bash
npm run ci
```

Expected: green. Known limitation: the shared worktree currently carries peer-session
modifications; if a peer's in-progress file breaks an unrelated suite, report it and stop —
do not work around the gate (Constitution, Project Constraints).

## 4. What proves each requirement

| Requirement                     | Proof                                                     |
| ------------------------------- | --------------------------------------------------------- |
| FR-001/FR-007 (claim + replica) | step 1 after-output; end-to-end test in validator.test.js |
| FR-002 (precedence)             | detection-mechanism.test.js precedence non-claims         |
| FR-003 (aliases, both shapes)   | validator.test.js alias matrix                            |
| FR-004 (shape parity)           | validator.test.js single-vs-array parity case             |
| FR-005 (push tag)               | validator.test.js / format tag assertions                 |
| FR-006 (locales)                | i18n-audit.test.js (unchanged catalogs)                   |
| FR-008 (`linkTtl` quiet)        | validator.test.js asserts no finding references it        |
