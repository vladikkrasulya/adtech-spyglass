# Maintenance research

Observed at `2bd93d6` on 2026-09-09 before implementation. Independent Core, UI and infrastructure reviews reproduce the named debt.

## Decisions

- Close the original 26 open records plus the extra floor defect; resolve CL-08/09 individually. Do not count old fixed/superseded or dropped records as new work.
- Share a source-aware auction view with explicit request-plugin, crosscheck and UI adapters. Preserve currency-only 3.0 paired-response context and classifier precedence. Reject blind item-to-imp copying.
- Normative source: [AdCOM 1.0](https://github.com/InteractiveAdvertisingBureau/AdCOM/blob/26c59ba1b235cd8d938c9877409e506f1b8d3f0c/AdCOM%20v1.0%20FINAL.md). Placement secure, display instl and media mindur/maxdur/mime/ctype need individual mappings, including finding parameter paths.
- Share price classification while preserving both legacy IDs and trigger sets. Negative impression/matched-deal floors warn and earn no floor verdict; a matched negative deal never falls back to an unrelated impression floor.
- Catch baseline and plugin applies/validate faults. Emit safe family-only warnings and unfiltered completeness metadata; filtering cannot erase incompleteness. ADR-018 owns the intentional failure-semantics change.
- Add per-side results without removing flat fields or legacy prefixes. Structured provenance owns rendered side.
- A mount-owned controller guards every asynchronous completion/write: current first-flight edits, post-Intel awaits and finally have races. Moving functions alone is insufficient.
- Onboarding needs an explicit grid slot shared with verification; notifications need a persistent live region; partner operations need explicit success envelopes.
- Surface logout persistence failure after local cleanup without claiming durable revocation; log catalog failures and do not cache them.
- Runner/attempt roots own detached browser profiles/PIDs. Retain failed attempts and describe retries without guessing cause. Re-enable both lint rules after fixing the 18 observed violations.
- CL-08 uses existing capability boundaries/assertions, not a new runtime API. CL-09 gets assertion-level coverage with explicit unit/browser/uncovered distinctions.
- Target app 1.22.0, Core 0.47.0, CLI 0.1.4. No dependency upgrades or registry publication.
