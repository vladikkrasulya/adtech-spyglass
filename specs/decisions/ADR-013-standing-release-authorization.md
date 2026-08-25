# ADR-013: Standing Release Authorization for the Agent Operator

**Status**: Accepted
**Date**: 2026-08-25
**Amends**: [ADR-006](./ADR-006-immutable-exact-sha-deployments.md)

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

**Standing authorization.** Push to `main`, deploy the app image, and roll it back are pre-authorized
for the agent operator, subject to conditions:

- deploy only through `scripts/deploy.sh`, from a clean `HEAD == main == origin/main` with repository
  gates green;
- leave readiness, smoke and automatic rollback armed;
- activate only an image built in that run from that SHA;
- report the version, image tag, Git SHA and gate outcomes afterwards, on success or failure;
- rollback is always authorized and never waits for a decision.

**Explicit authorization, per action.** npm publication, data migration, destructive data actions,
issue creation, force-push, history rewriting, anything targeting `/data` rather than mounting it,
and any deploy that would bypass a gate, disable automatic rollback, or activate an image not built
in that run.

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
- The blast radius is bounded by what `deploy.sh` already enforces, not by a promise: the conditions
  above are the script's existing gates plus a reporting duty, so the authorization cannot be
  satisfied while a gate is off.
- The reporting duty replaces the approval step. The owner stops being the gate and becomes the
  reader, which requires the report to be honest about failures, not only successes.
- Irreversible mutations become more visible, not less. They were previously one item in a list of
  six that all required asking; now they are the only things that do.
- ADR-006's consequence that building, tagging, activating or rolling back production remains a
  separately authorized external mutation no longer holds. Everything else in ADR-006 — immutable
  images, exact-SHA tags, `/data` as the only mount, the retained rollback target — is unchanged and
  is what makes this decision safe.
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
- [Release/deploy contract](../000-platform-baseline/contracts/release-deploy.md)
- [Deployment script](../../scripts/deploy.sh)
- [Operations runbook](../../docs/OPERATIONS.md)
