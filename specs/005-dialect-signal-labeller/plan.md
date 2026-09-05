# Implementation Plan: Dialect Signal Labeller

**Branch**: `main` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-dialect-signal-labeller/spec.md`

**Note**: This plan documents wiring that already exists in production. It is written so `tasks.md`
can be an honest record of what was built and what still is not, rather than a forward plan for work
that has already happened. See the spec's Record Order section.

**Verification closed 2026-09-05**: [final evidence and the health decision](./closure-2026-09-05.md).
The execution notes below are historical; no verification task remains active.

## Summary

An unrecognised vendor `ext` key turns an Inspector finding into a question. Two stages answer it: a
deterministic lexicon resolves everything it can justify from a table, and a local model is asked
only about the residue the lexicon deliberately abstains on. The result is a suggestion carrying a
label, a calibrated confidence value, a reason, and a provenance marker — never a write. The whole
arrangement is bounded by [ADR-012](../decisions/ADR-012-bounded-model-assist-on-dialect-labelling.md),
which amends one clause of ADR-003 for this path only.

## Technical Context

**Language/Version**: Node.js >= 22.13.0, CommonJS backend, vanilla browser JavaScript

**Primary Dependencies**: none added. The feature composes existing surfaces — `lib/http`,
`auth.js`, the analyse rate limiter, the dialects module — plus the host's model server reached over
plain `fetch`. No client library was introduced for it.

**Storage**: none of its own. The feature writes nothing. Mappings an operator chooses to save are
owned by the existing dialects module and its SQLite tables.

**Testing**: `node:test`. Unit coverage for the lexicon and the redaction allowlist
(`tests/ai-label.test.js`), contract coverage for the model boundary and its wiring
(`tests/model-free-contract.test.js`). Answer quality is measured by
`scripts/label-calibration.js`, which needs a live model and is therefore a hand-run bench, never a
CI gate.

**Target Platform**: the single Linux host that runs the immutable app image and the shared model
server beside it.

**Project Type**: web service plus lazy SPA section, matching the existing runtime.

**Performance Goals**: a warm model answer in roughly two seconds. First-answer latency matters
more than throughput, because the operator is waiting on a single click.

**Constraints**: the model server holds one model resident and serves one request at a time. The
feature must not evict what other fleet services are using, and must tolerate queueing behind them.
Request ceiling is bounded so a slow answer ends in a stated timeout.

**Scale/Scope**: one endpoint, one browser affordance, a handful of proposals per operator session,
bounded by an explicit rate limit.

## Constitution Check

_GATE: evaluated against every MUST statement, as Governance requires._

| Principle                            | Verdict           | Evidence                                                                                                                                                                                                                                 |
| ------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Spec Kit is working memory        | **Violated**      | The feature shipped with no package. This package is the remedy; see Complexity Tracking.                                                                                                                                                |
| II. Truth is evidence-backed         | **Violated**      | A canonical artifact (ADR-003) conflicted with the implementation and work did not stop. Recorded in the spec and in Complexity Tracking.                                                                                                |
| III. Privacy boundaries              | Pass              | `docs/PRIVACY.md` gained a section naming field by field what may accompany a signal; `redactImp` is an allowlist; `tests/ai-label.test.js` asserts sibling values never travel and unknown vendor fields are dropped. Landed `650f071`. |
| IV. Public contracts deterministic   | Pass              | Core validation is untouched. The lexicon is a pure function with no network access. The endpoint adds a suggestion route; it changes no finding ID, order, or dedup semantics.                                                          |
| V. Architecture explicit and bounded | Pass, with an ADR | No new framework, store, or deployment path. The one new dependency direction — an interactive path reaching a model — is exactly what ADR-012 exists to record.                                                                         |
| VI. Locales move together            | Pass              | Every user-visible string ships in en/uk/ru (`public/modules/inspector/dialect-label.i18n.js`, `public/i18n.js`).                                                                                                                        |
| VII. Verification proportional       | Partial           | Regression tests exist and `npm run ci` gates each push. Answer quality cannot be a CI gate because it needs a live model; the bench covers it by hand. Expanded-card and light-theme layout remain unverified — carried into tasks.     |
| VIII. Releases traceable             | Partial           | Deploys used the immutable exact-SHA pipeline with readiness, smoke, and rollback. `CHANGELOG.md` has no entry for the three commits — carried into tasks.                                                                               |

**Gate result**: two violations, both recorded rather than waived, both structural rather than
ongoing. Proceeding is conditional on this package and ADR-012 landing, which is what closes them.

## Project Structure

### Documentation (this feature)

```text
specs/005-dialect-signal-labeller/
├── plan.md                    # This file
├── spec.md                    # What and why
├── tasks.md                   # Executable progress
└── checklists/
    └── requirements.md        # Specification quality gate
```

Phase 0/1 artifacts (`research.md`, `data-model.md`, `contracts/`, `quickstart.md`) are deliberately
absent, matching [004](../004-silent-failure-detection/): there is nothing left to research, the
feature owns no data model, and its contract is already stated in `docs/PRIVACY.md` and ADR-012.

### Source Code (repository root)

```text
modules/ai-label/handler.js                    # endpoint, auth + rate gates, redactImp allowlist
packages/core/dialects/signal-lexicon.js       # stage 1, deterministic, pure, abstains by design
lib/ollama.js                                  # model client; shared model, host-gateway URL
lib/label-persona.js                           # the persona, sent as `system` per request
public/modules/inspector/dialect-label.js      # browser entry; picker; degradation to manual
public/modules/inspector/dialect-label.i18n.js # en/uk/ru strings for the above
scripts/label-calibration.js                   # hand-run answer-quality bench
docker-compose.yml                             # extra_hosts + OLLAMA_URL: the reachability wiring
tests/ai-label.test.js                         # lexicon + redaction allowlist
tests/model-free-contract.test.js              # model boundary + labeller reachability
docs/PRIVACY.md                                # what travels to the model, field by field
```

**Structure Decision**: the feature follows the existing composition — a backend handler module
registered on the router, a Core package for the deterministic part, a lazy SPA module for the
browser affordance. No parallel structure was introduced, which is why Principle V passes.

## Plan-Level Constraints

These are not preferences. Each is a condition of [ADR-012](../decisions/ADR-012-bounded-model-assist-on-dialect-labelling.md);
removing one reopens the decision rather than adjusting the implementation.

1. **One path.** The model client is reachable only from this endpoint. No other interactive path
   may import it, and `tests/model-free-contract.test.js` asserts intel and news-relevance require
   no model.
2. **Deterministic first.** The lexicon runs before any model call. Extending the lexicon is the
   preferred way to improve answers; it moves signals out of the model's scope.
3. **Suggestion only.** No code path in this feature writes a dialect mapping.
4. **Provenance shown.** The response carries `source`, and the browser must render the distinction.
5. **Local only.** The model URL must resolve to the host. Pointing it at a remote service breaks
   the privacy contract, not merely a preference.
6. **Allowlisted context.** `redactImp` enumerates what may travel. Adding a field is a change to
   `docs/PRIVACY.md` and its tests in the same change.
7. **Unavailability is supported.** Model absence is a first-class outcome with its own copy and a
   manual fallback, not an error page.

Two operational constraints follow from the shared host model rather than from ADR-012:

- The model name is hardcoded, not configurable, because a per-deploy override is how the eviction
  problem returns silently.
- No runner-level option (notably `num_ctx`) may be sent with a request; changing one forces the
  shared model to reload and re-imposes the eviction cost on every other fleet caller.

## Complexity Tracking

> Filled because the Constitution Check has violations that must be justified.

| Violation                                                           | Why Needed                                                                                                                                                                                                                                | Simpler Alternative Rejected Because                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Principle I — feature shipped without a Spec Kit package            | Not needed and not defensible. The package should have preceded the code. It is recorded rather than waived so the record does not imply the process was followed.                                                                        | Writing no package at all was the status quo for two days and is what allowed a feature to ship dead, undocumented, and against an accepted ADR.                                                                                            |
| Principle II — work continued past a canonical/implementation clash | Not needed. The clash was visible: a regression test blocked the change. Stopping was the required action.                                                                                                                                | Relaxing the test was chosen instead, on the mistaken reading that it guarded a removed bridge. It guarded ADR-003.                                                                                                                         |
| ADR-003 — a model on an Inspector interactive path                  | The lexicon abstains by design on the ambiguous residue, and that residue is the operator's dead end. Closing it requires judgment the table cannot encode. Bounded by ADR-012's seven conditions so the rest of ADR-003 keeps its force. | Removing the feature was the de-facto state while it was unreachable, and it left the dead end open. A hosted model was rejected on the same privacy grounds ADR-003 used. Guessing in the lexicon was rejected by ADR-005's evidence rule. |
