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

## "After" runs — 2026-09-02 (T022 + T031)

The persona edit took three iterations, each run against the live model and recorded here — the
calibration loop the persona's own header prescribes.

| Iteration | Change                                                                                                                                        | TUNE            | HOLDOUT        | What it showed                                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | claim-aware ceiling, nine roles in the enum, language-echo ban in CLOSING                                                                     | 15/19 dev 0.032 | 6/10 dev 0.045 | four real regressions: `audio_ad`→custom (lost an obvious format), `sticky_bottom`→interstitial (wrong format), empty-value ceiling leaking to 0.4, short-name ceiling to 0.6 |
| 2         | roles must not compete with textual format words; positional words are not interstitial; ceilings apply to roles too                          | 18/19 dev 0.021 | 6/10 dev 0.045 | `audio_ad` and `limit` recovered; `sticky` still wrong; identifier over-used on technical keys                                                                                |
| 3         | positional-word rule moved into the evidence section; identifier narrowed to entity references; empty-value ceiling given an explicit example | 17/19 dev 0.005 | 8/10 dev 0.010 | every remaining miss was an OLD band that did not know the new policy                                                                                                         |

## Deliberate band revisions (FR-011) — 18 cases

Recorded case by case in `scripts/label-calibration.js` (each `why:` names 016). The three classes:

1. **Numeric codes under format-declaring keys** (`adtype-8`, `ad_type-70`, `format-12`,
   `ho-code-3`): bands `[0,0.3]` → `[0.3,0.85]` (or `[0.3,0.5]` for the generic `format`). The old
   band encoded the conflation this feature removes — `custom` rates the KEY role, and the old
   floor-above-ceiling `counter` contradiction (SC-006) is gone. In production every one of these
   resolves deterministically and never reaches the model.
2. **Role labels became correct answers** (`counter`→measurement, `limit`/`flag`+delivery-control,
   `dsp_trace`/`request_uuid`+identifier, `sdk_ver`/`partner-name`/`ho-seller`+metadata,
   `ho-buildno`→metadata, `ho-ttl`+roles, `ho-code-str`+identifier): `want` widened to the role the
   016 vocabulary names; bands unchanged or minimally widened.
3. **Short/generic-name cap governs where the numeric ceiling used to** (`mode-2`, `ho-t`):
   `[0,0.3/0.35]` → `[0,0.5]` per the name-transparency scale.

Unrevised and still binding: the empty-value ceiling (`empty-string`, `null-value`, `ho-empty-arr`
at `[0,0.3/0.35]`) and the specific-format prohibition on numeric values.

## Final state — 2026-09-02

| Set                              | Labels | Mean deviation | At exactly 1.0 |
| -------------------------------- | ------ | -------------- | -------------- |
| TUNE                             | 19/19  | 0.000          | 0              |
| HOLDOUT (10 old + 5 post-change) | 15/15  | 0.000          | 0              |

Five HOLDOUT cases were authored AFTER the change (T039/FR-012): `ho2-price`, `ho2-consent`,
`ho2-target`, `ho2-retry`, and `ho2-format-alive` — the last one guarding that textual format
words survive the role vocabulary. The persona body digest is pinned in tests/ai-label.test.js
(`35a7428f…`), updated in the same change as this record.

## T038 — live three-locale check, 2026-09-02

Two low-evidence signals (`publisher_account_ref=42`, `zx_mode='qq7'`) × three locales against the
resident model: **six of six answers in the requested language, zero cross-alphabet leaks**. The
`ad_type=30`-class leak this story was opened for is gone. Bonus confirmation of FR-008 on the live
path: the model answered `identifier @ 0.6` for the numeric control — the claim-aware behaviour the
old blanket ceiling used to clamp to 0.3.

## Release — 2026-09-02

`v1.19.0` live at `b729505` (app 1.19.0 / core 0.38.0 / cli 0.1.3). First deploy of `41e05a6`
failed readiness and auto-rolled back to `adde7f5` — the alphabet's own loud-failure rule caught an
image missing `data/README.md` (staging marker) and `ATTRIBUTION.md`, both stripped by
`.dockerignore`'s `**/*.md`; proven by `ls` and a require-throw on the failed image itself. One
ignore-exception line fixed it. Redeploy: readiness 6s, smoke 19/19, rollback armed throughout.
T044 live verification: the suggest route is 401-gated; `/api/analyze` in en/uk/ru carries
`role_state`/`role`/`role_confidence` on the question findings exactly per the oracle
(`ad_type` → `format-declaration@0.9`, `subage` → `measurement@0.9`, `limit` → ambiguous over
delivery-control/pricing/format-declaration); no cross-alphabet leaks in finding prose.
