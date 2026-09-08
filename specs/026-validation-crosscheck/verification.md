# Verification: Validation Semantics and Media Crosscheck

## Scope and baseline

Feature 026 starts at `340ffd3`, Core 0.42.0, 256 materialized corpus cases and 34 active defect groups. The delivery branch reserves Core 0.45.0; CLI remains 0.1.3 and app remains 1.19.4. Main integration belongs to the maintainer.

Wave A repairs DEF-113/194/111/192/130 across eleven cases. Wave B remains in an independent scratch checkout until the first wave is committed and pushed. DEF-151 retains a separate recognition and preview dependency in peer-owned files; semantic fixes alone do not authorize its retirement.

## Wave A evidence

Seven new public crosscheck regression groups failed before implementation and pass afterward. A separate seven-group VAST suite covers structural evidence, protocol identities, alternate renditions, pod siblings, NonLinear scope and adversarial bounded inputs. Core, CLI and actual HTTP boundaries are exercised, including en/uk/ru findings. An independent review compared 96 price/floor/currency control pairs against the starting revision without an economic finding change.

The eleven candidate cases pass their Core requirements. Three unbound assertion symbols are bound to production IDs: `expected.crosscheck.seat.not_allowed` → `crosscheck.seat.not_allowed`, `expected.crosscheck.bid.audio_video_mediafile_mismatch` → `crosscheck.bid.audio_media_mismatch`, and `expected.crosscheck.bid.banner_content_mismatch` → `crosscheck.bid.banner_not_banner`. Only those exact IDs and proven expected-failure metadata may change. The oracle, payloads, levels, paths and parameter requirements remain intact.

Full Core/HTTP corpus: 609 tests, 514 passes, 92 expected-failure markers and three declared Core non-applicable skips; no unexpected failures. All eleven scoped cases pass at Core, HTTP and browser layers. The full browser corpus records 196 normative passes, 59 preserved known deviations and one HTTP-only non-applicable case. All 245 unrelated Core/HTTP case signatures are byte-identical to the starting observations.

The isolated `npm run ci` passed all 166 ordinary test files and 25 serial browser files without a browser-file retry. The semantic runtime was settled for this gate. The permanent brief then amended the release reservation from 0.44.0 to 0.45.0 because PR #82 owns 0.44.0; the metadata-only correction receives the version/governance checks before delivery. Package smoke installs Core 0.45.0 with CLI 0.1.3 and validates its real exit policy. Docker smoke passes health, analysis, content-hashed assets and native module loading in a disposable container. Hosted verification remains pending.

## Evidence location and isolation

Durable local evidence: `~/.local/share/ortbtools-research/2026-09-08-026-validation-crosscheck/`. This includes the real-loader baseline snapshot, initial failures, focused test logs, exact ID binding map and independent wave B patch receipt. Browser runs use private profile prefixes and a private PID namespace, so cleanup cannot target peer browsers. This changes process ownership only, never assertions or product inputs.

## Delivery

Wave A was rebased before its first push onto `f1758bc`, which integrates peer features 024/025 (Core 0.44.0). Their eight retired groups and all contract/resolution entries are preserved. The rebased baseline has 26 groups; wave A leaves 21. A fresh real-loader baseline confirms all 245 unrelated Core signatures remain identical, and 649 focused/corpus checks yield 570 passes, 76 expected-failure markers, three declared skips and zero failures. Rebased lint, typecheck and version/governance gates pass. The initial full local coverage/browser gate and the subsequent rebase checks are recorded separately, without claiming that the initial gate ran on the rebased commit. Final completion requires both waves, accurate resolved-group accounting, unchanged unrelated corpus signatures, settled local gates and successful hosted CI for the pushed SHA.
