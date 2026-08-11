# Contract: Document Ownership

## Purpose

Prevent two live files from answering the same project question differently.

## Routing Contract

| Question                                            | Canonical owner                        | Allowed secondary content                            |
| --------------------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| How must agents and contributors work?              | `.specify/memory/constitution.md`      | A short link from README/CONTRIBUTING                |
| What exists and how is it wired now?                | `specs/000-platform-baseline/`         | Component-local README details within that component |
| What is being changed?                              | Active feature `spec.md`               | Roadmap status/link only                             |
| How will it be changed?                             | Active feature `plan.md` and contracts | Task file execution detail                           |
| What remains and what evidence exists?              | Active feature `tasks.md`              | PR summary after completion                          |
| Why was a durable choice made?                      | Indexed ADR                            | Link and short consequence note elsewhere            |
| What is next?                                       | `specs/ROADMAP.md`                     | Feature/assessment details by link                   |
| What do users/operators/security reviewers rely on? | Retained public/runbook contract       | Baseline links; no governance duplication            |

## Retained Conventional Contracts

- `README.md`: product and repository entry point
- `CONTRIBUTING.md`: short contributor bootstrap and Spec Kit route
- `CHANGELOG.md`: release history
- `SECURITY.md`: vulnerability reporting and security promises
- `docs/PRIVACY.md`: collection, processing, retention, and encryption boundaries
- `docs/OPERATIONS.md`: deployment, recovery, monitoring, and rollback
- `docs/api-v1.md`: stable public HTTP API
- `docs/NPM_PUBLISH.md`: registry status and release procedure
- package and component READMEs: local public/component contracts

## Retired Competing Owners

After their valid content is migrated, the following paths MUST be absent:

- `CLAUDE.md` and any root/subtree `AGENTS.md`
- `.claude/agents/`
- `docs/sonnet-orchestration-plan.md`
- `.Jules/palette.md`
- root `ROADMAP.md`
- root `ARCHITECTURE.md`
- `docs/ARCHMAP.md`
- `docs/TESTING.md`

Git history is the archive. No new “legacy docs” mirror is created.

## Update Rule

A change updates the owning artifact in the same pull request. If two canonical owners appear to
conflict, implementation and external evidence are inspected, the conflict is resolved explicitly,
and an ADR is added when the resolution changes durable policy or architecture.
