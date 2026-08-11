# Contract: Governance Validation

## Offline Merge Gates

Repository tests MUST validate:

1. the constitution, memory index, roadmap, decisions index, platform baseline, and every active
   feature's required artifacts exist;
2. retired rulebooks and competing live roadmap/architecture paths are absent;
3. ready/in-progress/complete specs contain no unresolved template placeholders or clarification
   markers;
4. requirement, success-criterion, ADR, and task identifiers are unique within their scope;
5. tasks follow the checkbox/ID/story/path contract and completed migration work maps to requirements;
6. all local Markdown links resolve across canonical memory and retained active documentation;
7. integration configuration lists the supported set with Codex default, only approved extensions,
   and no agent-context/Git/community package;
8. each supported agent exposes the exact approved core and assessment command set;
9. generated Spec Kit/agent paths are excluded from Prettier rewrites, package manifests, and Docker
   context while generated shell scripts retain executable mode and pass syntax checks;
10. privacy/model-free documentation guards scan the new baseline contracts after retired architecture
    files are removed.

## Verification Evidence

Before merge, the feature records exact outcomes for:

- `specify --version`
- `specify integration status`
- `specify extension list`
- shell syntax checks for managed scripts
- targeted governance, documentation, privacy, and immutable-image tests
- `npm run ci`
- `git diff --check`

Network-dependent catalog search, production deployment, npm publication, and package/repository
renames are outside this feature and MUST NOT be reported as performed.

## Failure Semantics

A validation failure blocks completion. Sandbox-specific process-spawn or network failures are
reported separately and rerun in an approved normal environment when the check itself is required.
No failed or unrun gate is converted into a warning merely to close the feature.
