# Implementation Plan: Spec Kit Foundation

**Branch**: `chore/spec-kit-foundation` | **Date**: 2026-08-11 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from `specs/001-spec-kit-foundation/spec.md`

## Summary

Replace overlapping agent guidance, roadmaps, and architecture maps with a pinned GitHub Spec Kit
0.16.2 working-memory system. Keep one constitution, one current roadmap, one indexed decision log,
one as-built platform baseline, and one feature package per change. Generate adapters for four
multi-install-safe agent integrations, retain only the bundled `assess` discovery extension, pin the
rendered extension adapters with offline integrity checks where upstream manifests do not, retire
stale rulebooks after migrating their valid content, and enforce the new ownership model with offline
repository tests.

The migration is documentation/tooling/test-only. It does not change application behavior, publish
packages, modify production data, or deploy an image.

## Technical Context

**Language/Version**: Markdown; JavaScript on Node.js `>=22.13.0`; bundled POSIX shell; generated
JSON, YAML, and Gemini TOML adapters

**Primary Dependencies**: GitHub Spec Kit `v0.16.2` at commit
`4871b485f97c7fa452ec58eba325d87536c55c34`; built-in `assess` extension; existing Prettier, ESLint,
TypeScript/JSDoc, and Node test runner

**Storage**: Version-controlled repository files; `.specify/feature.json` remains machine-local and
gitignored

**Testing**: `node:test` governance and truth guards, recursive Markdown link checks, Spec Kit
integration/extension status, shell syntax checks, Prettier on authored artifacts, and full
`npm run ci`

**Target Platform**: Git repository used from Linux; Codex, Claude Code, Cursor, and Gemini agent
integrations; immutable Linux container remains the application runtime

**Project Type**: Brownfield web application plus Core and CLI npm workspaces; this feature changes
repository governance only

**Performance Goals**: One index hop per knowledge concern; deterministic offline governance tests;
no measurable application runtime or image-size increase

**Constraints**: No root `AGENTS.md`/`CLAUDE.md`; no secrets or production identifiers in tracked
memory; no hand edits to generated adapters; no community/URL packages; the bundled upstream
workflow remains non-canonical and must not be invoked by CI, hooks, or a production worktree;
generated governance excluded from Prettier rewrites, npm packages, and Docker context

**Scale/Scope**: Four supported agent integrations, ten core Spec Kit lifecycle skills plus five
approved assessment skills per integration, one platform baseline, one migration feature, retained
public/operations contracts, and retirement of overlapping live project rulebooks

## Constitution Check

_GATE: Passed before Phase 0 research and re-checked after Phase 1 design._

| Principle                              | Gate                                                                                                       | Result |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| I. Spec Kit Is the Working Memory      | Migration has one active feature package and creates the required baseline/roadmap/decision memory         | PASS   |
| II. Truth Is Evidence-Backed           | Versions, integration behavior, document conflicts, and managed paths were verified against CLI/code/tests | PASS   |
| III. Privacy and Security Boundaries   | Only synthetic/redacted repository evidence is permitted; public privacy/security docs remain canonical    | PASS   |
| IV. Deterministic Public Contracts     | Application and package contracts are unchanged; tests will pin the governance contract                    | PASS   |
| V. Explicit and Bounded Architecture   | No runtime framework/service is introduced; generated tooling remains outside the image                    | PASS   |
| VI. Locale Meaning Moves Together      | No localized product copy changes; baseline records the three-locale rule                                  | PASS   |
| VII. Proportional Verification         | Targeted governance checks and full existing CI are required before handoff                                | PASS   |
| VIII. Traceable Releases and Mutations | Tool version is pinned; this plan authorizes no publish, deploy, or external mutation                      | PASS   |

## Project Structure

### Documentation (this feature)

```text
specs/001-spec-kit-foundation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/
│   └── requirements.md
├── contracts/
│   ├── agent-integration.md
│   ├── document-ownership.md
│   └── governance-validation.md
└── tasks.md
```

### Repository Changes

```text
.specify/
├── memory/constitution.md
├── extensions/assess/
├── integrations/
├── scripts/bash/
├── templates/
└── workflows/

.agents/skills/                    # generated Codex adapters
.claude/skills/                    # generated Claude adapters
.cursor/skills/                    # generated Cursor adapters
.gemini/commands/                  # generated Gemini adapters

specs/
├── README.md
├── ROADMAP.md
├── DECISIONS.md
├── decisions/
├── 000-platform-baseline/
└── 001-spec-kit-foundation/

tests/
├── spec-kit-contract.test.js
├── docs-truth.test.js
├── privacy-claims.test.js
├── model-free-contract.test.js
└── immutable-image.test.js

README.md
CONTRIBUTING.md
CHANGELOG.md
.dockerignore
.prettierignore
```

Retired after content migration: `CLAUDE.md`, `.claude/agents/`, `.Jules/palette.md`, root
`ROADMAP.md`, root `ARCHITECTURE.md`, `docs/ARCHMAP.md`, and `docs/TESTING.md`.

**Structure Decision**: Spec Kit owns normative rules, current program memory, and per-feature working
memory. Conventional human/public contracts stay at their established paths. Generated agent files
are checked in solely as adapters and never become independent sources of policy.

## Complexity Tracking

No constitution violations require justification. Four adapters are intentional because they are
the supported multi-install-safe agent set; they share generated content and one constitution rather
than four authored rulebooks. Retained public/runbook documents are separate contract surfaces, not
governance duplication.
