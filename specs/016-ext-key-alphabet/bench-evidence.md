# Calibration bench evidence — feature 016

Maintainer operation against the live host model (`gemma4-prod`, resident, ADR-012). The bench is
never a CI gate. Recorded per FR-011: both runs, and every band revised deliberately.

## "Before" run — 2026-09-02, pre-change baseline (T010)

Command: `node scripts/label-calibration.js` at commit `1a2519e` (persona and resolver untouched).

| Set     | Labels | Mean deviation | Answers at exactly 1.0 |
| ------- | ------ | -------------- | ---------------------- |
| TUNE    | 19/19  | 0.011          | 0                      |
| HOLDOUT | 9/10   | 0.005          | 0                      |

Matches the persona header's recorded state exactly (tune 19/19 dev 0.011, holdout 9/10 dev 0.005) —
the baseline is stable across the 015 → 016 gap.

Full TAP output: captured in the session scratchpad; the numbers above are the durable record.

## "After" run — pending (T031)

To be recorded after T022's single persona edit (claim-aware ceiling + locale repair), with the
deliberate band revisions listed here, case by case, per FR-011. Expected revisions include
`counter` (band [0.4, 0.9] whose floor sits above the old ceiling — the contradiction this feature
removes) and the numeric cases that now resolve deterministically and leave the bench population.
