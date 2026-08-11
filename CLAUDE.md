# ortbtools — AI Agent Context

## What this project is

ortbtools is a public OpenRTB inspector: paste a `BidRequest` / `BidResponse` JSON
and get human-readable validation findings, semantic request↔response crosscheck,
IAB-category decoding, and a sandboxed creative preview. Authenticated users get a
zero-knowledge encrypted library of saved samples per partner. It ships in three
locales (EN / UK / RU) and runs on a single domain without any client-side framework.

## Where to start

- **`docs/ARCHMAP.md`** — authoritative dependency map. Read this before touching
  any subsystem. It shows callers, callees, deploy chain, and known gotchas for
  every component.
- **`CHANGELOG.md`** — recent history. The last 5 entries almost always explain
  the context behind the file you are about to edit.

---

## File-system layout

```
server.js                         Express-like node:http entry (~868 LOC shell)
auth.js                           bcrypt sessions + KEK lifecycle (crypto bootstrap)
db.js                             SQLite via better-sqlite3 (partners, samples, users)
tokens.js                         Stateless HMAC tokens (verify-email, password reset)
email.js                          Resend HTTPS API wrapper
lib/
  router.js                       Pattern-based dispatcher (exact / :id / trailing-*)
  http.js                         readJson, sendJson, sendError, makeError
  logger.js                       pino-based structured logger
  replay.js                       DI'd bulk-pipeline engine
  corpus-matrix.js                Confusion matrix runner
  intel-rules.js                  Deterministic intel + relevance rules
  openrouter.js                   Isolated news-translation client
modules/                          Backend handler folders (baked into image — needs rebuild)
  account/ admin/ analyze/        One folder per route group. Each exports {id, routes}
  auth/ corpus/ health/           or a createXxxModule(deps) factory. Registered in
  intel/ mirror/ partners/        server.js at boot via lib/router.js.
  proxy/ replay/ sample/
  samples/ stream/ dialects/

packages/core/                    Validator engine — pure JS, Node + browser compatible
  index.js                        Public API: validate(), crosscheck(), mirror(), detect*()
  detect.js                       Type + oRTB version autodetection
  format-detect.js                Format detection (banner/video/audio/native/push/pop); dialect- & shape-aware
  rules-request.js                oRTB BidRequest rules (IAB-spec baseline)
  rules-response.js               oRTB BidResponse rules
  rules-request-30.js             oRTB 3.0 BidRequest envelope checks
  rules-response-30.js            oRTB 3.0 BidResponse envelope checks
  rules-vast.js                   VAST 2.x / 3.x / 4.x validation
  rules-feed.js                   JsonFeed rules (vendor-specific shapes)
  rules/                          Plugin-style rules — see rules/README.md for contract
  crosscheck.js                   Request↔response semantic checks
  categories.js                   IAB Content Taxonomy decoder
  dialects/                       iab.js (default), ext-rtb.js, inpage-push.js
  intel/                          walker.js, cluster.js, temp-dialect.js
  knowledge_base/                 Curated oRTB / JsonFeed reference fixtures
  messages/{en,uk,ru}.json        Localised finding messages (en/uk/ru parity required)

public/                           Static assets baked into the immutable image
  index.{en,uk,ru}.html           Shell per locale (EN at /, others at /uk/, /ru/)
  about.{en,uk,ru}.html           Docs per locale
  account.{en,uk,ru}.html         Cabinet (logged-in workspace)
  ortbtools.app.js                 Inspector shell (~4467 LOC); owns OrtbtoolsSession facade
  ortbtools-crypto.js              Zero-knowledge crypto (browser-only, Web Crypto API)
  i18n.js                         ~140-key UK/EN/RU dictionary + window.t() helper
  lang-switch.js                  Seamless DOM-morph language switch
  version.js                      Browser-side VERSION constant (bump with package.json)
  design-system.css               Vendored design system, baked into the image
  modules/                        Frontend tool folders (folder-per-feature)
    README.md                     Module contract: layout, lifecycle, cross-module comms
    inspector/                    Workbench template + mount lifecycle
    auth/ unlock/ recovery/       Login, DEK unlock, recovery-key display
    password-reset/               Forgot/reset flow (rotate/recover/wipe modes)
    save-sample/ edit-sample/     Encrypted sample save + metadata edit
    partners/                     Partner CRUD modal
    mirror/ live/ simulate/       Mirror generator, SSE live stream, rules simulator
    share/ embed/ shortcuts/      Permalink, iframe embed, keyboard cheatsheet
    corpus-save/                  Labelled behavior corpus capture
    intel/ behavior/              Discovery + behavior analyzer (pre-modularization shape)

tests/                            node:test runner — run with `npm test`
samples/                          Synthetic specimens for rules + demos (baked)
docs/                             ARCHMAP.md, USER_GUIDE.md, historical audits
.claude/agents/                   Pre-built specialized sub-agents (see §8 below)
```

**Immutable image:** every source directory and the vendored design system are
baked. The only runtime mount is `/data` for SQLite and persisted blog content.
Any source edit requires a rebuild/redeploy; `compose restart` does not load it.

---

## Conventions cheat-sheet

### Code quality gate

```bash
npm run ci          # format:check + lint + typecheck + test — runs before every push
npm test            # 917 tests (as of v0.54.0)
npm run lint:fix    # auto-fix eslint issues
npm run format      # prettier --write .
```

`npm run ci` is enforced by the pre-push hook. Never bypass with `--no-verify`.

### 3 locales — en / uk / ru

Every user-facing string lives in all three locales:

- `public/i18n.js` — UI strings (UK / EN / RU objects in `I18N`)
- `packages/core/messages/{en,uk,ru}.json` — validator finding messages
- `public/index.{en,uk,ru}.html`, `public/about.{en,uk,ru}.html`, `public/account.{en,uk,ru}.html`

**UA tone is informal "ти"** (second person singular, not "Ви"). DS/GPT outputs often
drift to formal — always correct before committing.

When adding a new i18n key: edit all three locale objects in the same commit. There
is no automated enforcement yet — a missing key surfaces as a runtime `undefined`
in the UI.

### SemVer bump — version.js is the live source, fallbacks bump with it

`feat` → MINOR (`0.X.0`), `fix` / polish → PATCH (`0.42.X`). Bump in one commit.

**Canonical (the version logic reads these):**

1. `package.json` (root)
2. `packages/core/package.json` — the engine has its **own** SemVer number track
   (it was `0.26.0` when the app was `0.52.0`); bump it on its own MINOR/PATCH
   merits at the same tier as the app, not the same number.
3. `public/version.js` — `const VERSION`. **Live source of truth for the version
   shown in chrome**: on load it repaints every `[data-ortbtools-version]` span.

**Inline fallbacks — repainted by version.js at runtime, but bump them in the
same commit so view-source and the pre-JS render are correct.** They are easy to
forget: they had drifted (about `v0.41.4`, engineVer `v0.39.0`) for ~10 releases
before being re-synced in v0.52.0.

4–6. `public/about.{en,uk,ru}.html` — `docs · vX.Y.Z` eyebrow + footer
`[data-ortbtools-version]` span (`replace_all` the old version string covers both).
7–9. `public/modules/inspector/template.{en,uk,ru}.html` — `#engineVer` span.

See `docs/ARCHMAP.md §2.4` for the canonical list.

### Module assets — no manual version bumps

`__<MODULE>_BUNDLE_HASH__` tokens in HTML are replaced server-side by
`rewriteAssetVersions()` (server.js) with a content-hash of all files in
`public/modules/<module>/`. Touch any file in the module folder → the hash
changes → browser cache invalidates automatically. Never add `?v=N` by hand.

---

## Adding things

### New validator rule

See `packages/core/rules/README.md` for the plugin contract. Summary:

1. Create `packages/core/rules/<name>/index.js` exporting `{ id, validate }`.
2. Register in `packages/core/rules/index.js` `PLUGINS` array.
3. Add message keys to `packages/core/messages/{en,uk,ru}.json`.
4. Add spec reference to `packages/core/spec-refs.json` (enforced by
   `tests/spec-refs.test.js`).
5. Write tests in `tests/` following existing patterns.

### New frontend module

See `public/modules/README.md`. Summary:

- Create `public/modules/<name>/index.js` (IIFE, strict mode, no cross-module imports).
- Add `public/modules/<name>/i18n.js` (pushes keys to `window.kt_i18n_modules`).
- Wire in `public/ortbtools.app.js` dispatcher or a `<script>` tag in the shell.
- Module-local tests go in `tests/modules/<name>.test.js`.

### New translation key

Edit `public/i18n.js` — add the key to `I18N.uk`, `I18N.en`, `I18N.ru` in the same
logical position in each block. Then run `npx prettier --write public/i18n.js`.

---

## Two well-known traps

### Trap A — Restarting an old immutable image

**Symptom.** You edit a source file, run `docker compose restart`, and the change
isn't live inside the container.

**Root cause.** No source is bind-mounted. A restart starts the same image again.

**Fix.** Build and deploy a new image through `scripts/deploy.sh` (production) or
rebuild/recreate the local Compose service. Verify `/api/health` reports the expected
build SHA.

### Trap B — CSS source-order trap with mobile `@media`

**Symptom.** You add a mobile override like `@media (max-width: 720px) { .foo {
display: none } }` but it never fires. `window.matchMedia('(max-width: 720px)').matches`
returns `true` in DevTools. `getComputedStyle(el).display` still returns the desktop
value.

**Root cause.** CSS specificity for two rules at the same specificity level is decided
by source order — the later rule wins. If the unconditional desktop rule (e.g. `.foo
{ display: contents }`) is declared _after_ your mobile media-query block in the file,
the desktop rule overrides it on every viewport, including mobile.

**Two fixes.**
Option 1: wrap the desktop rule in `@media (min-width: 721px)` so it does not apply
on mobile at all.
Option 2: move the mobile rule to the _end_ of the file behind a clearly named
anchor comment so future edits do not re-introduce the ordering problem. This is the
pattern used in `public/modules/inspector/inspector.css` — see the "P2 #27
SOURCE-ORDER ANCHOR" block added in v0.42.9.

First seen: v0.42.9 sprint (footer-extras `display: none` + mobile letter-spacing).
Both fixes were applied in that release.

---

## External LLMs

Two models are available via OpenRouter for audit, code review, and copy:

| Model                           | Typical use                                         | `max_tokens`                          |
| ------------------------------- | --------------------------------------------------- | ------------------------------------- |
| `deepseek/deepseek-r1` (v4 Pro) | Code generation, audit, register-shift copy rewrite | 12 000 for code-gen, 8 000 for audits |
| `openai/gpt-5.5`                | Screenshot / UX vision audit, quick copy review     | 4 000                                 |

**Budget cap: $22 total on the OpenRouter account.** After every call, report tokens
and cost in the chat in this format:

```
DS/GPT-5.5 tokens: Input N | Output N | Total N | Cost $N | session cumulative $N/$22
```

DS is a reasoning model — internal chain-of-thought is billed as output tokens. Budget
`max_tokens: 12000` for code-gen tasks; excess just wastes quota without improving
output. Code written by DS must be reviewed by Claude before committing.

---

## The `.claude/agents/` sub-agents

Pre-built specialized agents live in `.claude/agents/`. Invoke them for their specific
scope rather than writing ad-hoc prompts:

| Agent file                           | Purpose                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ortbtools-css-cleaner.md`           | CSS deduplication, token alignment, `[hidden]` regressions. JS is off-limits.                                                                 |
| `ortbtools-deps-updater.md`          | Safe `npm update` (minor/patch only); verifies tests + lint; reverts on failure.                                                              |
| `ortbtools-doc-writer.md`            | Updates `/about` pages, README, ROADMAP, ARCHITECTURE in all 3 locales after a feature ships. Never touches code.                             |
| `ortbtools-i18n-translator.md`       | Adds / modifies keys in `public/i18n.js` and `packages/core/messages/`. Enforces UK/EN/RU parity. Never touches logic.                        |
| `ortbtools-prober.md`                | Read-only code investigator: "where is X?", "why is Y broken?". Produces a structured findings report. Never modifies files.                  |
| `ortbtools-security-reviewer.md`     | Read-only security audit (XSS, CSRF, injection, sandbox escape, timing, CSP). Rates findings CRITICAL/RED/YELLOW/GREEN. Never modifies files. |
| `ortbtools-tech-debt-resolver.md`    | Applies ONE specific tech-debt fix surgically. Single-issue scope; escalates if scope creeps.                                                 |
| `ortbtools-test-writer.md`           | Adds test fixtures + assertions to the node:test runner. Never modifies application code.                                                     |
| `ortbtools-uxqa-tester.md`           | Playwright smoke-tests on prod (or local). QA-mode: hard-stop on first functional failure; visual bugs out of scope.                          |
| `ortbtools-validator-rule-author.md` | Adds a new validation rule: logic + spec-ref + i18n messages + tests. Escalates on version-gating questions.                                  |

---

## Commit-message style

Format: `fix(scope): vX.Y.Z — title` (one line), then a WHY-first body, then a
`#### Verified` block listing what was confirmed.

Example (paraphrased from v0.42.8):

```
fix(css): v0.42.8 — dark theme parity + cabinet copy register

P1 #19: Cabinet cards used --bg-elev / --bg-elev-2 tokens that were
never declared — both themes fell back to transparent. Added token
declarations in the portal design-system.css (light + dark blocks).
P1 #16: Cabinet EN copy was pedagogical; DeepSeek v4 Pro rewrote 8/10
section descriptions to operational register. UA/RU unaffected.

#### Verified
- 658 tests pass; prettier + lint + typecheck clean.
- Dark cabinet: card bg rgb(42,38,34) vs page bg rgb(26,24,20) — clear elevation.
- GPT-5.5 external verify (openai/gpt-5.5, $0.075): parity issues resolved.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

Always add a `Co-Authored-By:` line when an AI collaborator did meaningful work.
Include the model name and generation (e.g. `Claude Sonnet 4.6`, `Claude Opus 4.7
(1M context)`) so the history is auditable.

---

## When you're confused

1. Read `docs/ARCHMAP.md` — it has the definitive callers/callees/deploy chain for
   every component.
2. Check the last 5 `CHANGELOG.md` entries — the change you're making probably has
   a predecessor that documents the same gotchas.
3. Browse `docs/` — historical audits (`audit-2026-05-12.md`,
   `tech-debt-2026-05-04.md`, `tech-debt-2026-05-12.md`) contain findings and
   root-cause analyses that are still relevant.
4. If the bug looks like "edit not working" — confirm the image was rebuilt and
   `/api/health` reports the expected build SHA (Trap A above).
5. If a CSS change isn't firing on mobile — check source order (Trap B above).
