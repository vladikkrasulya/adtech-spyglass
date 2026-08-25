# ortbtools Project Memory

This directory is the canonical entry point for project intent, current system knowledge, durable
rationale, and active delivery work. It routes each question to one owner; it does not mirror the
owner's content.

## Find the Owner

| Question                                            | Canonical owner                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| What rules govern every change?                     | [Project constitution](../.specify/memory/constitution.md)                                              |
| What product exists now?                            | [Platform baseline specification](./000-platform-baseline/spec.md)                                      |
| How is the current system wired?                    | [Platform baseline plan](./000-platform-baseline/plan.md)                                               |
| What are the current public and runtime boundaries? | [Platform baseline contracts](./000-platform-baseline/contracts/)                                       |
| What data exists and where can it persist?          | [Baseline data model](./000-platform-baseline/data-model.md) and [privacy contract](../docs/PRIVACY.md) |
| Why was a durable choice made?                      | [Decision index](./DECISIONS.md)                                                                        |
| What is active or next?                             | [Current roadmap](./ROADMAP.md)                                                                         |
| What is the current governed change?                | [Spec Kit foundation feature](./001-spec-kit-foundation/spec.md)                                        |
| How will that change be delivered?                  | [Foundation plan](./001-spec-kit-foundation/plan.md) and [tasks](./001-spec-kit-foundation/tasks.md)    |
| How is production operated?                         | [Operations runbook](../docs/OPERATIONS.md)                                                             |
| How is a security concern reported?                 | [Security policy](../SECURITY.md)                                                                       |
| What is the public HTTP contract?                   | [HTTP API documentation](../docs/api-v1.md)                                                             |
| What is the npm release state?                      | [npm publication runbook](../docs/NPM_PUBLISH.md)                                                       |
| What has shipped?                                   | [Release history](../CHANGELOG.md)                                                                      |

The conventional privacy, security, operations, API, package, and release documents remain at their
public paths. The [document-ownership contract](./001-spec-kit-foundation/contracts/document-ownership.md)
defines when they own an answer and when they should link back here.

## Manual Gold Path

Spec Kit is the working-memory lifecycle, not merely a documentation layout:

1. For an uncertain idea, run assessment from intake through research, problem definition, shaping,
   and a go/clarify/park/kill decision.
2. For accepted work, create or update `spec.md`; use clarification for material ambiguity.
3. Produce `plan.md` and the relevant requirement, privacy, security, or UX checklist.
4. Generate dependency-ordered `tasks.md`, then run cross-artifact analysis until critical and high
   conflicts are resolved.
5. Implement bounded task phases, updating task state and evidence at material checkpoints. Run the
   narrowest relevant tests first.
6. Run the repository gates required by the changed surface, including `npm run ci` before merge.
7. Run convergence. If it appends missing work, implement and verify those tasks, then converge
   again.
8. Under the standing authorization in
   [Principle VIII](../.specify/memory/constitution.md), stage only authored in-scope changes, run the
   required gates against that settled scope, then commit and non-force push the reviewed commit to
   `main`. Complete the canonical pre-deploy backup and use only the documented deploy and rollback
   flows. Mechanism availability never expands that scope. npm publication, data migration or restore,
   destructive data actions, direct `/data` access outside those flows, and issue creation require
   explicit authorization at the time.

Supported agents expose this route through generated Spec Kit skills or commands. Invocation syntax
differs by agent, but the constitution, baseline, feature artifacts, and gates do not.

## Pinned Bootstrap and Upgrade Route

This foundation is generated from GitHub Spec Kit `0.16.2` at source commit
`4871b485f97c7fa452ec58eba325d87536c55c34`. For a clean bootstrap or upgrade, follow the
[validation quickstart](./001-spec-kit-foundation/quickstart.md), the
[agent-integration upgrade contract](./001-spec-kit-foundation/contracts/agent-integration.md), and
the recorded [version decision](./001-spec-kit-foundation/research.md). Review the target release and
fixture diff before regenerating managed files; do not hand-edit adapters or track a mutable upstream
branch.

## Passive Context Limitation

The current foundation guarantees a constitution load when accepted work enters through a
context-bearing core delivery command: specify, clarify, plan, checklist, tasks, analyze, implement,
or converge. The constitution then requires the roadmap, relevant baseline contracts, and active
feature package to be read. The bundled `assess` commands are a separately reviewed, bounded
pre-delivery funnel; their upstream adapters do not automatically load full project memory, so start
them from this index and return every `go` decision through `speckit.specify`.

The foundation does **not** silently inject project memory into every arbitrary prompt or new agent
session. Generated adapters are entry points, not passive policy loaders, and there is no `AGENTS.md`,
`CLAUDE.md`, or equivalent parallel rulebook.

A first-party passive-context extension is future assessed work, not a capability claimed by this
baseline. Until it is designed and verified, start non-trivial work from this index through the
appropriate Spec Kit lifecycle entry point. See the [roadmap](./ROADMAP.md) and
[ADR-010](./decisions/ADR-010-supported-agents-safe-automation.md).

## Memory Maintenance

- Current system behavior belongs in `000-platform-baseline/` or the retained public contract that
  owns it.
- A scoped change belongs in one numbered feature package.
- Durable rationale belongs in an ADR; reversing an accepted decision creates a superseding ADR.
- Only current order, status, dependencies, and next gates belong in `ROADMAP.md`.
- Code, tests, schema, and runtime telemetry are implementation evidence, not substitutes for intent.
- Tracked memory contains only synthetic or redacted evidence—never secrets, payload bodies, personal
  identifiers, or private production records.
