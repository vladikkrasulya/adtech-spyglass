# Maintenance compatibility

- Preserve IDs, levels, sorting/dedup identity and caller-specific price predicates. No cross-ID diagnostic removal.
- Negative supplied impression/deal floors add warnings. An unusable effective floor earns neither above nor below verdict; a matched negative deal is not silently replaced.
- Normative 3.0 projections preserve original leaf/parameter paths; response-plugin paired request stays currency-only and existing classification precedence stays intact.
- Catch baseline and plugin applies/validate faults. Add `internal.rule_family_failed` and unfiltered `completeness:{complete:false,failedFamilies:[...]}`. Warning filtering is unchanged; incomplete analysis cannot report clean and remains visible in the UI. ADR-018 records the HTTP change.
- Analyze adds `sides:{request:ValidationResult|null,response:ValidationResult|null}` with located unprefixed findings. Keep flat validation/crosscheck, metadata and response prefixes. Never merge different document sides by ID/path.
- Every async completion and observable browser write checks run identity; first-flight edit/clear invalidates without a previous snapshot.
- Retain/document public VAST timeline exports separately from Inspector support. Freeze legacy IDs; new IDs use dotted lowercase names.
- No new retention, model call, creative network permission, security weakening, migration or registry publication.
