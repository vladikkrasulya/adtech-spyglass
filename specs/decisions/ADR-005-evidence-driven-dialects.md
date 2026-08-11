# ADR-005: Evidence-Driven Dialect Overlays

**Status**: Accepted
**Date**: 2026-05-12

## Context

OpenRTB vendors use extension fields and non-IAB formats whose meaning cannot be inferred safely from
a field name or numeric value alone. Treating an observed vendor shape as a global fact can suppress
real IAB findings or normalize malicious/invalid traffic. At the same time, an IAB-only validator
cannot explain recurring private dialects.

## Decision

The IAB rules remain the default baseline. A named built-in overlay requires public documentation or
representative synthetic/redacted evidence plus regression tests. Vendor-specific values are not
promoted into global Core semantics merely because they were observed.

Discovery may aggregate field paths, type fingerprints, and co-occurrence from learnable analyses to
surface candidates. It does not assign authoritative meaning. Unknown extension signals produce
non-blocking `question` findings; an authenticated user can explicitly map a signal/value pair in a
private dialect. The runtime applies that mapping only for the owning user's selected dialect, and
shape fingerprints can warn when the mapping context has drifted.

Automatic learning is gated away from invalid analyses and known malicious behavior when those
findings are available. Tracked examples and project memory must remain synthetic or redacted.

## Alternatives Considered

- Hardcode every observed vendor value in Core. Rejected because private meanings collide and cannot
  be verified globally.
- Let frequency automatically redefine validation. Rejected because repetition is not semantic
  proof and could normalize bad inputs.
- Support only strict IAB fields. Rejected because vendor dialects are a central product use case.
- Use a model to infer and apply semantics. Rejected because plausible language is not evidence and
  would make suppression nondeterministic.

## Consequences

- IAB findings remain predictable; dialect behavior is additive or explicitly scoped and tested.
- Users must confirm ambiguous meanings, so discovery may stop at a question instead of producing a
  convenient guess.
- Saved dialect mappings and their notes are server-readable account metadata, not encrypted bid
  bodies.
- Changes that suppress baseline findings require especially strong evidence, a compatibility review,
  and regression coverage.

## Related Artifacts

- [Core validator contract](../000-platform-baseline/contracts/core-validator.md)
- [Data-retention contract](../000-platform-baseline/contracts/data-retention.md)
- [User dialect runtime](../../packages/core/dialects/user-dialect-runtime.js)
- [Shape analysis](../../packages/core/dialects/shape-fingerprint.js)
- [Dialect-question contract](../../packages/core/rules/dialects-questions/README.md)
