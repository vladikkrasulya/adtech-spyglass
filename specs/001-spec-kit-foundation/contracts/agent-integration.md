# Contract: Agent Integration

## Supported Set

| Agent       | Managed path                        | Invocation family |
| ----------- | ----------------------------------- | ----------------- |
| Codex       | `.agents/skills/speckit-*/SKILL.md` | skills            |
| Claude Code | `.claude/skills/speckit-*/SKILL.md` | skills            |
| Cursor      | `.cursor/skills/speckit-*/SKILL.md` | skills            |
| Gemini CLI  | `.gemini/commands/speckit.*.toml`   | commands          |

Codex is the default integration. All four MUST appear in `.specify/integration.json`, declare safe
multi-install behavior, and pass `specify integration status` with no modified, missing, invalid, or
unchecked paths.

## Approved Capabilities

Every supported integration exposes the ten core lifecycle commands:

- analyze, checklist, clarify, constitution, converge
- implement, plan, specify, tasks, taskstoissues

Every supported integration also exposes the five bundled assessment commands:

- assess intake, research, define, shape, and decide

Generated adapters contain execution prompts but no project-specific policy. The constitution and
current feature artifacts remain the shared policy and intent sources.

The context-bearing core delivery stages—specify, clarify, plan, checklist, tasks, analyze, implement,
and converge—explicitly load the constitution; its first principle then requires the current roadmap,
relevant baseline contracts, and active feature. The assessment stages are a bounded pre-delivery
funnel and their bundled adapters do not automatically load that full context. Start assessment from
the project-memory index, and route every `go` decision through `speckit.specify` before delivery.

## Gold Path

1. Assess uncertain ideas.
2. Specify accepted work.
3. Clarify material ambiguity.
4. Plan and create relevant quality checklists.
5. Generate tasks and run cross-artifact analysis until clean.
6. Implement bounded phases and run proportional tests.
7. Run repository CI and convergence; repeat only if convergence appends work.
8. Review, commit, push, publish, or deploy only with separate authorization.

The bundled headless workflow is installed as an upstream artifact but is not the canonical path
because it omits several gates. No workflow is run automatically in CI or a production worktree.

## Exclusions

- `agent-context`: prohibited because it creates parallel context rulebooks.
- Generic and Copilot: not in this baseline because safe multi-install support is not established for
  the selected fleet.
- Git extension: prohibited because mandatory hooks alter repository/branch state.
- `constitution-sync`: prohibited because it materializes copies of policy.
- Community, URL, or mutable-catalog packages: prohibited until separately audited and accepted.
- Bundled bug extension: deferred until its URL/privacy boundary is hardened.

## Upgrade Contract

1. Run `specify self check` read-only.
2. Review the target release and dry-run the pinned tag.
3. Exercise initialization and every installed integration in a temporary Git fixture.
4. Reinitialize/upgrade managed files only after reviewing the diff and preserving authored memory.
5. Cycle each integration to materialize extension commands, return Codex as default, then run status
   and governance tests.
6. Update the recorded version, source commit, research decision, and manifests in one change.
