# Spyglass — sub-agent orchestration setup plan (next session)

Goal: turn the main thread (Opus) into an **orchestrator**. Sonnet sub-agents do the work. Quality preserved by my review-gates on every returned diff.

## When session starts — read this whole file first, then proceed

### Step A — Create `.claude/agents/` fleet

Location: `/srv/DATA/Stacks/adtech-spyglass/.claude/agents/<name>.md`

Each agent is a markdown file with frontmatter + system prompt. Template:

```markdown
---
name: spyglass-<role>
description: <when to use, ~12 words>
tools: Read, Edit, Bash       # restrict per role
model: sonnet                  # default; bump to opus only when role demands
---

You are a Spyglass <role>. Repo root: /srv/DATA/Stacks/adtech-spyglass.

## Strict constraints
- Vanilla JS only, no frameworks (working rule)
- 3 locales (uk/en/ru) stay in sync where applicable
- Never push without my explicit approval
- Stop on doubt — don't guess; report and ask

## What you do
- <one or two specific responsibilities>

## Escalate to Opus (parent) if
- <conditions where Sonnet's reasoning is insufficient>

## Verify before reporting done
- npm test passes 141/141 (or current baseline)
- npm run lint exits 0 errors (warnings ok)
- git diff is sane and minimal
- For UI changes: console-error count = 0 on prod
```

The 10 agents to create, in order (easiest → hardest):

| # | name | tools | one-line role |
|---|---|---|---|
| 1 | spyglass-prober | Read, Grep, Bash | Read-only investigator: "where is X defined / used?" |
| 2 | spyglass-deps-updater | Read, Bash | npm update minor/patch + verify tests; revert on fail |
| 3 | spyglass-i18n-translator | Read, Edit, Bash | Add/translate i18n keys × 3 locales; never touch logic |
| 4 | spyglass-doc-writer | Read, Edit, Write | Update /about + ROADMAP + README in 3 locales |
| 5 | spyglass-css-cleaner | Read, Edit | CSS dedup + format fixes; JS off-limits |
| 6 | spyglass-tech-debt-resolver | Read, Edit, Write, Bash | Pick ONE item from tech-debt audit; surgical fix |
| 7 | spyglass-security-reviewer | Read, Grep, Bash | READ-ONLY audit: XSS/CSRF/injection sniffing |
| 8 | spyglass-test-writer | Read, Edit, Write, Bash | Add test fixtures + assertions following existing patterns |
| 9 | spyglass-validator-rule-author | Read, Edit, Write, Bash | New rules in packages/core/rules-*.js |
| 10 | spyglass-uxqa-tester | Bash, mcp__playwright__* | Functional smoke-tests on prod via Playwright |

### Step B — Validate fleet with one read-only smoke task

Spawn `spyglass-prober` with: *"Find every place where the i18n.js key 'btn.close' is referenced. Report file:line for each. Don't change anything."*

Expected: 5-10 lines of references. Tests our agent wiring without risk.

### Step C — First real parallel batch (single message, 3 Agent calls)

1. **spyglass-tech-debt-resolver** → migrate the 18× `onclick=` in `public/spyglass.app.js` to `addEventListener`. Behavior identical. Tests pass.
2. **spyglass-css-cleaner** → identify duplicated `<style>` blocks across the 6 HTML files in `public/`. Extract common parts to `public/app-styles.css`. Link from each HTML.
3. **spyglass-deps-updater** → `npm outdated` survey. List packages where Wanted < Latest with major-gap (don't update those — flag for human). Update the safe rest.

I (Opus) review the 3 returned diffs in parallel, commit each separately. **ONE round = three features done.**

## Quality gates I enforce on every returned diff

- `git diff` fits in my head before commit
- `npm test` green (agent reports + I re-verify if anything is suspicious)
- `npm run lint` 0 errors
- For UI: Playwright screenshot at 1470×956, console errors == 0

## Cost estimate

- Step A: ~5-7 turns of Opus (writing 10 .md files thoughtfully)
- Step B: 1 turn (single smoke test)
- Step C: ~3 turns (parallel orchestration + 3 commits)
- Future feature sessions: ~2-4 Opus turns each (vs 15-25 today)

Break-even: setup cost amortized after 2-3 features delegated.

## Locally pending (push first thing next session)

After ~2hr limit refresh, before anything else:

```bash
cd /srv/DATA/Stacks/adtech-spyglass && git push origin main
```

Pushes `629dbb6` (node-abi 3.89→3.90, sub-agent demo from prev session).
