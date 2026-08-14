# Decision: Silent Failure Detection

- **Slug**: silent-failure-detection
- **Decided**: 2026-08-13
- **Verdict**: go (recorded retroactively — see Process Note)
- **Artifacts reviewed**: intake.md, problem.md, concept.md, the four dated documents in `docs/`

## Process Note

Implementation preceded this gate. Thirty commits on `feat/url-search-feed` were written before
any assessment existed, against a roadmap that lists product features as "not scheduled". This
record is written after the fact and says so, because a Spec Kit backfilled with documents
pretending to be prospective is worth less than no Spec Kit: the value of the gate is that its
contents can be trusted, and a false date destroys exactly that.

What the gate would have caught, had it run first: the work is four bounded problems, not one, and
three of the four produced modules with no consumer. That was corrected before this was written —
every module now has one — but the correction cost a full cycle that an assessment would have
avoided.

## Scorecard

| Criterion              | Rating   | Justification                                                                                                                                                                      |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem validity       | strong   | Not inferred. Five defect classes measured across three URL engines and two languages; three further defects confirmed inside this codebase.                                       |
| Evidence strength      | strong   | Direct measurement, reproducible. The 56 unverified hypotheses from research are explicitly excluded from this decision and carry their own provenance.                            |
| Value vs. inaction     | strong   | Without it the tool reports a green status over damaged values — worse than reporting nothing, because it is believed.                                                             |
| Feasibility / appetite | adequate | Each detector is a rule over data already flowing through `validate`. The plumbing was the hard part: the browser parsed before posting, so the evidence never reached the server. |
| Strategic fit          | strong   | Offline, network-free, single-payload. Matches the constitution and the depth positioning.                                                                                         |
| Risk posture           | adequate | The live risk is false positives. A rule that warns about correct input gets disabled and then reports nothing, so silence on a clean payload is asserted first in every suite.    |

## Conditions

1. No module ships without a consumer. An unwired module is inventory, and inventory is the debt
   this project is trying not to accumulate.
2. Every rule asserts silence on a clean payload before it asserts anything else.
3. Severity follows consequence. Money and identity fields are errors; plausibility arguments are
   warnings, never errors, because the specifications they rest on will move.
4. The operator's input is never rewritten without a recoverable record of what changed.

## Follow-ups not in scope here

- `regs.ext.us_privacy` is missing from the migration advisor (found during triage, recorded in
  `docs/hypothesis-triage-2026-08-13.md`).
- 34 catalogue hypotheses are testable with what is installed; each needs its own measurement
  before it becomes work.
