# Feature Specification: Close audited project debt

**Feature Branch**: `main` (feature identity `019-close-project-debt`)

**Created**: 2026-09-07

**Status**: In Progress

**Input**: Owner: “Зможеш все закрити, і не лишити тех боргу?” following the 2026-09-07 project inventory.

## User Scenarios & Testing

### User Story 1 - Keep the Inspector coherent through releases (Priority: P1)

An analyst keeps a tab open across a release without silently combining incompatible interface resources or losing unsaved input.

**Why this priority**: Q1 is an established delivery defect outside the completed desktop repair.

**Independent Test**: Exercise an old client against a newer release, including invalid resource versions and unavailable resources.

**Acceptance Scenarios**:

1. Given an old client and a new release, when a section loads, its resources remain compatible or a recoverable update state preserves the analyst's work.
2. Given an obsolete, invented or duplicate resource version, when requested, the server does not advertise different bytes as the immutable requested resource.
3. Given a current client, navigating between sections and locales retains ordinary functionality and correct caching.

### User Story 2 - Finish interface and locale defects (Priority: P1)

An analyst can unlock without identity appearing in search, use consistent selection controls and read aligned result tabs in every supported language.

**Why this priority**: Q5-Q7 remain unresolved owner reports; registration and verification-resend email tests are missing.

**Independent Test**: Synthetic account and real-browser regressions across three locales, two themes and existing mobile/desktop widths.

**Acceptance Scenarios**:

1. The unlock dialog owns its username/password fields and submits once; unrelated search remains independent.
2. Selection controls have consistent visible treatment, preserve existing values and change behavior, and support keyboard, touch, focus, disabled states and dismissal.
3. Translated result tabs, overflow control and count badges align without clipping or inaccessible actions.
4. Registration, verification resend and recovery email follow supported account preference, then supported locale cookie, then English where those sources exist.

### User Story 3 - Finish maintenance with verifiable records (Priority: P2)

The operator can identify what shipped, which dependency proposals were integrated and how local drafts and future product proposals were resolved.

**Why this priority**: Checked tasks alone do not establish implementation or delivery.

**Independent Test**: Reconcile every inventory item against Git, hosted checks, release records, preserved artifacts and live readback.

**Acceptance Scenarios**:

1. Dependency PRs 78-80 receive reviewed dispositions with required checks and retained dependency security floors.
2. Shipped version records and current feature status agree with exact revisions and implementation evidence.
3. Unique local work is identified and preserved before cleanup; no unreviewed draft is applied to main.
4. Owner choices for repository identity, npm, monitoring and future product directions are recorded and followed when supplied. Without a reply, a stated conservative maintenance default retains the existing baseline and separates future proposals; no irreversible action is inferred.

5. Event-log regressions exercise the active ClickHouse HTTP contract without skipped retired SQLite checks.

### User Story 4 - Preserve editorial approval and content integrity (Priority: P1)

An editor can review source links and promote a permitted draft without executing an unsafe URL, leaving the content directory, replacing an existing article or granting search-index approval through draft metadata.

**Why this priority**: Fresh synthetic probes confirmed the exact adjacent findings previously recorded by feature 003.

**Independent Test**: Mocked ClickHouse and disposable content directories exercise rejected status, invalid stored locale, slug collision, metadata injection and legitimate promotion through both public readers; actual Admin DOM checks source-link schemes.

**Acceptance Scenarios**:

1. Unsupported source URLs remain readable without active navigation; HTTP(S) source links remain usable.
2. Invalid draft state, locale, category or route slug is rejected before content/status mutation.
3. A promotion creates one new article without replacing an existing one, and draft metadata cannot create additional frontmatter fields or indexability approval.
4. A valid draft remains readable in the same locale through both public content readers, with its title and body preserved.

### Edge Cases

- Empty, duplicate, malformed and stale version parameters; old cached CSS with a fresh template; relative imports and runtime-loaded styles.
- Aborted navigation, failed resource loads and offline clients with unsaved input.
- Account names containing markup characters; password managers ignoring autocomplete-off; double submission.
- Disabled and dynamically changed selection options, long translations, keyboard typeahead and navigation cleanup.
- Missing account locale and unsupported or malformed cookies.
- Private or untracked local drafts, duplicate historical work and cancelled research checkmarks.

## Requirements

### Functional Requirements

- **FR-001**: Correct Q1 resource identity and cross-release coherence, preserving unsaved input and normal current-client behavior.
- **FR-002**: Bound unlock autofill to an explicit account/password form without altering authentication semantics.
- **FR-003**: Resolve Q5 selection-control consistency with equivalent keyboard, touch, focus, selection and disabled-state behavior.
- **FR-004**: Resolve Q6 tabs/count alignment in English, Ukrainian and Russian, both themes and existing mobile/desktop layouts.
- **FR-005**: Add meaningful locale-priority regressions at all three transactional email entry points.
- **FR-006**: Review and finish PRs 78-80 with complete dependency, package, native-image and hosted gates; retain reviewed security floors without a brittle exact newest-version assertion.
- **FR-007**: Reconcile stale 005/009/010/015/017/018 and intake records; complete release records for 1.19.2 and 1.19.3.
- **FR-008**: Inventory four stashes, five local task branches and four linked worktrees; identify unique work and preserve recoverable evidence before cleanup, without tracked private content.
- **FR-009**: Follow any explicit owner choices for repository identity, npm, monitoring and deferred product directions. Otherwise retain the existing baseline under the stated maintenance default, keep proposals in a separate future plan and do not imply authorization for external changes. Preserve the existing cancellation of Local Model Maximum experiments.
- **FR-010**: Update affected baseline/privacy/operations contracts in the same change. No new raw payload persistence, creative network permission or implicit publication.
- **FR-011**: Ship accepted corrections through the existing complete verification, backup/deploy/rollback path; verify exact public build, database and container state.
- **FR-012**: Every inventory item has an evidence-backed implemented, verified-existing, owner-declined, preserved/archived or explicitly pending disposition. Do not claim universally defect-free software.

- **FR-013**: Close the confirmed adjacent Blog boundary defects: safe Admin source-link schemes; persisted promotion-state, locale/category/slug validation; exclusive content creation; metadata scalar roundtrip without injected fields; preserve legitimate publication and both content readers.

- **FR-014**: Replace the ten deliberately skipped SQLite-era event-log checks with meaningful, isolated regressions for the current ClickHouse transport, batching, query/filter/read mapping, degradation and TTL-owned retention; preserve auth-event privacy and avoid production data.

### Key Entities

- **Inventory item**: identifier, source, outcome, evidence, disposition and owner-choice dependency.
- **Release identity**: version, exact revision, immutable image, hosted checks and public record.
- **Preserved artifact**: source identity, private archive location, digest and restoration instructions; content stays outside tracked memory.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Q1 and Q5-Q7 have passing observable regressions or an explicit owner-approved disposition, preserving supported locale/theme/layout behavior.
- **SC-002**: All three email entry points demonstrate locale precedence and fallback behavior.
- **SC-003**: All three dependency proposals and both missing release records have verified final dispositions.
- **SC-004**: Every audited local artifact is accounted for and recoverable; no unreviewed draft reaches production.
- **SC-005**: Repository and deployed state agree, with required gates passing for the shipped revision.
- **SC-006**: The inventory distinguishes completed work from genuinely pending decisions without stale counts or revived cancelled work.

- **SC-007**: Every demonstrated Blog trigger is rejected without unauthorized side effects, while a legitimate promotion roundtrips through both content readers and keeps indexability opt-in false.

- **SC-008**: The full runner has no retired-backend skips, and current event-log behavior is covered without requiring production infrastructure.

## Assumptions

- Independent accepted scope is current defects, verification debt, dependencies and maintenance records. New product directions remain separate until the owner's scope answer arrives.
- Three owner-choice questions were sent before implementation. Elapsed time does not authorize publication, renaming, destructive cleanup or external alert delivery.
- Main initially equals deployed 1.19.3 at 2f9c3a9 and is clean. One separate historical worktree has author-owned changes.
- Current repairs need no storage-schema or Core/CLI contract change. Version only affected surfaces.
- Cross-release input preservation applies to repaired clients. Pre-019 tabs keep their already delivered lifecycle code until refreshed; this rollout rejects their stale resource requests but cannot remotely replace that cached code.

## Scope clarification during execution

No answer to optional scope questions was received during the independent repairs. The operator explicitly stated that this maintenance retains the existing repository name, local Core/CLI and Telegram channel while future capabilities remain separate. This records an assumption, not owner approval or permanent cancellation of a proposal. A later owner reply overrides it.
