# ADR-013: Standing Release Authorization for the Agent Operator

**Status**: Accepted; expanded by constitution 2.1.0
**Date**: 2026-08-25
**Amends**: [ADR-006](./ADR-006-immutable-exact-sha-deployments.md) and
[ADR-010](./ADR-010-supported-agents-safe-automation.md)

## Context

Until now every external mutation needed a separate decision from the owner: commit, push, deploy,
rollback, publication, migration. The rule was written once and applied uniformly, and uniformity is
where it failed.

The cost showed up in a measurable way on 2026-08-25. Release `1.15.0` — a repair to the creative
preview, which had been showing payload text instead of creatives since 2026-08-12 — was finished,
gated green and committed, while production went on serving `1.14.6` from image `ortbtools:9fdabf2`,
because each remaining step needed a decision the owner had to make in person. The owner asked why
this keeps recurring, then directed that the agent operator carry these actions instead.

The uniform rule also obscured a real difference. `scripts/deploy.sh` already refuses a dirty tree,
refuses `HEAD != main == origin/main`, records intent before switching anything, waits for readiness,
runs a smoke test, and rolls back automatically on any failure. A deployment through it is a gated,
reversible action whose failure mode is a rollback. An npm publication is not: the registry has no
undo. Treating both as "production mutation" charged the same price for very different risks, and
the price was paid by the safe one far more often.

## Decision

Authorization splits into two classes.

**Standing authorization.** The agent operator may perform these bounded actions without another
conversation, subject to their action-specific conditions:

- stage only authored, in-scope changes from the current task, run the required repository gates
  against that settled scope, and then commit it;
- non-force push those reviewed commits to `main` from a clean worktree after the required local gates
  pass, then wait for the required hosted gates before deployment;
- immediately before deployment, run the documented `scripts/backup-db.sh` flow and verify fresh
  SQLite and persistent-content archives. This operator gate is part of the standing deployment
  authorization even though `deploy.sh` does not create or validate it;
- deploy only through `scripts/deploy.sh`, from a clean `HEAD == main == origin/main` with repository
  gates green; leave application/database/build readiness, smoke and automatic rollback armed; and
  activate only an image built in that run from that SHA;
- roll back through `deploy.sh`'s automatic path or the documented `scripts/rollback.sh` flow. Rollback
  is always authorized and never waits for a decision.

After deployment or rollback, report the version, image tag, Git SHA and gate outcomes, on success or
failure.

**Explicit authorization, per action.** npm publication, data migration or restore, destructive data
actions, issue creation, force-push, history rewriting, direct access to `/data` outside the documented
backup/deploy/rollback flows, and any release operation that would bypass a gate, disable automatic
rollback, or activate an image outside the documented exact-SHA flow.

Planning, task generation, installed tools, available credentials, and executable mechanism
availability never expand authorization or either class. An available command is not authorization
for an action outside the standing list.

An agent that cannot satisfy a condition stops and says which one. It does not proceed, and it does
not work around the condition — including a dirty tree caused by another session's uncommitted work,
which is cleared by its author.

## Alternatives Considered

**Keep the uniform rule and accept the friction.** Rejected because the friction is not neutral: a
release that is finished and gated but undeployed leaves the defect it repairs in production. The
creative preview showed payload text instead of creatives for thirteen days, and the last two of
those were spent waiting on permission rather than on work.

**Authorize everything, including publication and migration.** Rejected. The argument for standing
authorization is that `deploy.sh` can undo its own mistake; it does not extend to actions with no
undo. An npm publication cannot be unpublished after 72 hours, and a data migration has no rollback
script at all. Granting these together would have taken the reasoning that justifies one and applied
it where it does not hold — which is the same error the uniform rule made, pointed the other way.

**Ask once per release rather than per action.** Rejected as the primary mechanism, though it is
what the harness permission file does today. It still puts a human in the path of an action that is
already gated by five machine checks, and the human has less information than the checks do. It
survives as a belt: the project rule and the harness permission are independent, and the harness may
still prompt.

**Add a human-approval step inside `deploy.sh`.** Rejected: it would move the same wait into the
script, where it would also block the automated rollback path — the one action that must never wait.

## Consequences

- A finished, gated release reaches production without a second conversation. That is the point.
- The blast radius is bounded by the required repository and hosted gates, the separate pre-deploy
  backup gate, and what `deploy.sh` enforces. The backup prerequisite and reporting duty are operator
  gates outside the script, so their evidence is part of satisfying the authorization.
- The reporting duty replaces the approval step. The owner stops being the gate and becomes the
  reader, which requires the report to be honest about failures, not only successes.
- Irreversible mutations become more visible, not less. They were previously one item in a list of
  six that all required asking; now they are the only things that do.
- ADR-006's consequence that building, tagging, activating or rolling back production remains a
  separately authorized external mutation no longer holds. ADR-010's uniform requirement for separate
  authorization before every commit, push, or deploy is likewise superseded. Everything else in those
  decisions remains unchanged.
- The risk accepted: a bad release can now reach production without a human pause. It is bounded by
  the smoke gate and automatic rollback, and by the fact that a rollback needs no permission. The
  risk not accepted is an unreviewable one — anything the script cannot undo stays behind an
  explicit decision.
- The harness permission file is a separate control surface from this document. An agent cannot
  grant itself the right to run the deploy script; that remains the owner's to set, and the guard
  that blocks self-escalation is deliberate.

## Related Artifacts

- [Constitution, Principle VIII](../../.specify/memory/constitution.md)
- [ADR-006: Immutable exact-SHA deployments](./ADR-006-immutable-exact-sha-deployments.md)
- [ADR-010: Supported agents and safe automation](./ADR-010-supported-agents-safe-automation.md)
- [Release/deploy contract](../000-platform-baseline/contracts/release-deploy.md)
- [Deployment script](../../scripts/deploy.sh)
- [Operations runbook](../../docs/OPERATIONS.md)
