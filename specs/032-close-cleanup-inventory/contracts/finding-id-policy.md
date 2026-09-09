# Finding ID naming and compatibility

**Owner**: Core finding producers and `tests/finding-id-policy.test.js`.

Finding IDs are public, locale-independent compatibility keys. Their exact spelling is used by
`disabledRules`, stored consumers, message catalogs, specification references and test fixtures.
Changing punctuation is a rename and requires an explicit breaking compatibility decision.

New IDs use lowercase dotted namespaces; underscore-separated words and numeric version segments
are allowed, for example `request.30.item.invalid_type`. The naming grammar is
`^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$`. A plugin's short registry slug is a separate identifier and
does not prescribe the spelling of its findings. Severity comes from the emitting rule and severity
registry, never from an ID prefix or suffix.

The 45 hyphen-containing finding IDs present at baseline `2bd93d6` remain unchanged, including
`err-bid-price-negative`, `warn-currency-conversion-needed` and the `inpage-push.*` family.
The regression test freezes the exact legacy allowlist; adding another hyphenated ID or removing an
existing one fails. It also checks dotted names, locale/spec-reference coverage and public exact and
prefix suppression behavior. Catalog metadata such as `_note` is excluded from finding identities.

CL-07 is closed by documenting and enforcing this compatibility policy. No existing ID is renamed,
no diagnostic is suppressed to normalize spelling, and no new public result field is introduced.
This policy implements Constitution IV and [ADR-018](../../decisions/ADR-018-maintenance-boundaries-and-degradation.md).
