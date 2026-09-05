# Feature Specification: Inspector desktop density

**Created**: 2026-09-05

**Status**: Complete

**Input**: The owner reports oversized type and stretched panels on a 2560×1440 desktop, both with the summary drawer open and closed.

## User Scenarios & Testing

### User Story 1 — Read a compact workbench (Priority: P1)

An operator compares a payload with findings without oversized text or excessively long rows.

**Independent test**: Analyze a synthetic invalid request at 1440, 1920, 2560 and 3840 pixels wide.

**Acceptance scenarios**:

1. Enlarging the desktop viewport preserves text size and creates useful editing space.
2. The results pane remains bounded, with clear hierarchy between finding sentences and metadata.
3. Opening the summary/history pane preserves separate visible editor and result columns.

### User Story 2 — Keep all controls usable (Priority: P1)

The operator can expand findings, jump to source, switch request/response and reset the layout in all three locales and both themes.

**Independent test**: Exercise controls with synthetic data on desktop and at 390 pixels wide.

### Edge Cases

Long finding sentences, rule identifiers and paths; all findings expanded; empty editor; hidden navigation; the 1100-pixel stacking boundary; large-screen browser zoom; locale changes and route remounts.

## Requirements

- **FR-001**: Desktop text MUST retain a stable scale across viewport widths. Finding text is 13 pixels, metadata 11–12 pixels, editor text 13 pixels, and verdict 17 pixels at normal browser zoom.
- **FR-002**: The desktop workbench MUST be no wider than 2200 pixels; results no wider than 800 pixels; the open context panel no wider than 240 pixels.
- **FR-003**: Finding summaries MUST use compact spacing while retaining readable wrapping, expanded details, visible focus and existing action controls.
- **FR-004**: English, Ukrainian and Russian, both themes, source highlighting and editor/gutter alignment MUST remain functional.
- **FR-005**: Phone/tablet stacking and native browser zoom MUST remain usable. No forced page zoom or transform scaling.
- **FR-006**: The repair MUST preserve analysis semantics, data handling, authentication and existing layout preference controls.

## Success Criteria

- **SC-001**: Text measurements remain equal from 1440 to 3840 pixels wide; desktop widths meet FR-002 with context open and closed.
- **SC-002**: Synthetic long findings and expanded detail bodies have no clipped content or document horizontal overflow at tested widths.
- **SC-003**: Before/after screenshots at 2560×1440 show smaller text, bounded result lines and narrower context; review also covers 1920, 3840 and phone layouts.
- **SC-004**: Required browser, lifecycle, version, repository and hosted release gates pass before production deployment.

## Assumptions

This is a correction of the existing technical workbench, retaining its palette, typography families, navigation and workflows. Supplied screenshots are visual evidence only; their private payload/account information is not copied into fixtures or project memory. Existing research remains archived and no experiments are resumed.
