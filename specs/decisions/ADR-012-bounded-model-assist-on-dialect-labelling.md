# ADR-012: Bounded Model Assist on Dialect Labelling

**Status**: Accepted
**Date**: 2026-08-20
**Amends**: [ADR-003](./ADR-003-deterministic-interactive-intel.md) — narrows one clause; the rest
of that decision stands unchanged.

## Context

ADR-003 removed model use from interactive paths and named the reason: a model bridge made identical
inputs depend on model availability and sampling, and coupled product behaviour to host
infrastructure. It listed "Keep local Ollama on interactive paths" among the rejected alternatives.
That decision holds for `/api/intel/*`, behavior analysis, Core, and the CLI, and nothing here
reopens it.

One question inside the Inspector was not solved by removing the model, and is not solvable by the
deterministic route alone. When a payload carries a vendor `ext` key the engine does not recognise,
the finding is a question rather than an answer. A lookup table resolves the recognisable majority —
format words corroborated by the impression, pop allow-flags, bookkeeping keys — but a residue
remains that the table is deliberately built to abstain on rather than guess at: unfamiliar
abbreviations, keys whose meaning depends on vendor context, values that hint without naming.
Before this decision the operator's only route for that residue was manual vendor archaeology
outside the tool.

A labelling assistant shipped on 2026-08-18 (`cd609b3`) that consulted a local model for exactly
that residue. It shipped without a specification, without this record, without a privacy-contract
update, and — because its container could not reach the host model — without ever answering a single
user request. The failure it shipped with is precisely the coupling ADR-003 predicted. The
regression test enforcing ADR-003 blocked the repair, was relaxed on 2026-08-20 in the mistaken
belief that it guarded a removed bridge, and the change was deployed. This ADR records the decision
that should have preceded all of that.

## Decision

A local model may assist dialect signal labelling, and only that. The exception is bounded by seven
conditions, all of which must hold:

1. **One path.** The assist is reachable only from the dialect labelling endpoint. It is not
   available to Inspector validation, interactive Intel, behavior analysis, Core, or the CLI — the
   remainder of ADR-003 is unchanged, and its regression test continues to assert it.
2. **Deterministic first.** The lookup table runs before any model call, and the model is consulted
   only for signals the table abstains on. Growing the table moves signals out of the model's scope,
   never into it.
3. **Suggestion only.** The assist proposes. It never writes a dialect mapping; persistence remains
   a separate, explicit operator action, because a saved mapping silently re-applies to every future
   payload the operator analyses.
4. **Provenance is shown.** Every answer states whether it came from the table or from the model.
   A lookup and a model's guess do not earn the same trust and must not share a badge.
5. **Local only.** The model runs on the host. The input is a fragment of a payload the operator
   pasted — real bidstream — and `docs/PRIVACY.md` states field by field what may accompany it. A
   remote provider is not an accepted configuration of this decision.
6. **Allowlisted context.** What may travel is enumerated, not filtered: the signal's path and
   value, a structural sketch of the impression, and sibling extension key names without their
   values. A denylist would fail open the first time a vendor invented a field.
7. **Unavailability is a supported state.** The coupling ADR-003 warned about is real and is
   accepted rather than denied. When the model is unreachable or slow the feature says so and the
   operator continues by hand; it does not degrade validation, and it does not pretend to think.

Calibration is part of the contract, not a quality nicety. The confidence value beside a label is
what an operator reads to decide whether to check the claim, so an answer's number must track its
evidence: capped where there is no ground, and never absolute.

## Alternatives Considered

- **Leave ADR-003 intact and remove the feature.** Rejected: the residue the table abstains on is a
  real dead end for the operator, and the deterministic route cannot close it by construction. This
  was the alternative that the two days of silent 503s had de facto selected, and it was not chosen
  deliberately.
- **Reverse ADR-003 and allow models on interactive paths generally.** Rejected: the reasoning that
  produced ADR-003 is sound, and it applies unchanged to validation, Intel, behavior, Core, and the
  CLI. A narrow amendment keeps the argument's force where it belongs.
- **Use a hosted model.** Rejected on the same grounds ADR-003 rejected it: external disclosure of
  payload-derived data, cost, and another availability dependency. The privacy promise in
  `docs/PRIVACY.md` is the binding constraint, and the redaction allowlist does not make a remote
  call acceptable.
- **Keep the assist but let it write mappings when confident.** Rejected: confidence is a model's
  self-report. Writing on it would let a wrong label change which rules fire on every later payload
  in a direction the operator can no longer see.
- **Run a model derived per feature rather than the shared host model.** Rejected on measurement:
  the host loads one model at a time, so a dedicated model evicted the shared one — 6.25s to load
  ours and 6.4s for the next caller to reload theirs. Sending the persona with each request against
  the resident shared model produced identical answers with no eviction.

## Consequences

- The operator gets an answer for signals the table cannot resolve, marked as a suggestion and never
  applied on their behalf.
- Availability of one Inspector affordance now depends on host model infrastructure. This is the
  cost ADR-003 named. It is bounded to a single non-blocking affordance and is visible when it
  fails rather than silent.
- The feature shares a model with other work on the same host. Its latency may include waiting
  behind another caller, and a rename or rebuild of that shared model breaks this feature — loudly,
  through the operator-facing unavailable state and a 5xx alert.
- The confidence scale becomes a maintained artifact with a measurement bench, not prose. Editing it
  without running the bench is a regression risk, and the bench needs a live model so it cannot be a
  continuous-integration gate.
- `tests/model-free-contract.test.js` no longer forbids the string `OLLAMA_URL`; it asserts the
  narrower contract this ADR defines — that intel and news relevance require no model — plus that
  the labelling path is wired to a reachable host rather than to the container itself.
- Any further expansion of model scope requires its own specification and ADR. This record is an
  amendment to one clause, not a precedent for the next path.

## Related Artifacts

- [ADR-003 Deterministic interactive intelligence](./ADR-003-deterministic-interactive-intel.md)
- [ADR-005 Evidence-driven dialects](./ADR-005-evidence-driven-dialects.md)
- [005 Dialect signal labeller](../005-dialect-signal-labeller/spec.md)
- [Privacy contract](../../docs/PRIVACY.md) — the dialect labeller section enumerates what travels
- [Model client](../../lib/ollama.js) and [labelling persona](../../lib/label-persona.js)
- [Deterministic lexicon](../../packages/core/dialects/signal-lexicon.js)
- [Calibration bench](../../scripts/label-calibration.js)
- [Model-free contract test](../../tests/model-free-contract.test.js)
