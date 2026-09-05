# Implementation Plan: Inspector desktop density

## Technical Context

Vanilla browser CSS, existing Onest interface face and monospace editor, owned inspector and shell styles. No new dependencies or application state. The old inspector stylesheet enlarges global type with viewport units, and a shell rule defeats its workbench width cap.

## Design

Keep the existing navy surface (#0a111f), light ground (#f2f5f8), body ink (#e9eef7 dark / #0d1726 light), sky accent (#38bdf8 dark / #0369a1 light) and semantic severity colors. Stable 13px body/editor, 11–12px metadata, 17px verdict; use weight for hierarchy. Preserve font families and contrast tokens.

Left-align the workbench contents. Center a maximum 2200px canvas in the shell column. Allocate at most 800px to results and 200–240px to optional context; remaining width belongs to the editor. Desktop structure:

```text
navigation | [context] | payload, flexible | results, bounded
           |             shared toolbar                  |
```

Plan review: a generic dashboard redesign would add new cards or decoration without fixing the cause. This repair removes viewport-driven enlargement at its owner, bounds the actual grid, and reduces repeated summary padding. Existing technical visual identity remains appropriate.

## Constitution Check

I: feature package and baseline context loaded before edits. II: synthetic browser geometry plus visual review, actual release evidence. III: no private screenshot content in artifacts and no data-boundary change. IV: no validation/API change. V: existing CSS owners, no framework or service. VI: shared styles verified in en/uk/ru. VII: focused browser regression and mandatory full CI. VIII: app patch only, clean exact-SHA push, hosted gates, fresh verified backup, canonical deploy with rollback armed. No exception required.

## Phases

1. Record requirements, validate their coverage and capture synthetic baseline.
2. Remove competing wide-screen font rules; compact summaries and bound grid at existing breakpoints.
3. Verify typography, widths, overflow, expanded findings, editor/source alignment, and mobile controls in real Chrome; visually inspect screenshots.
4. Update baseline and v1.19.3 surfaces; run complete required gates and convergence; commit and push reviewed scope.
5. Await hosted gates, verify fresh backup, deploy through scripts/deploy.sh and read back production version, image and health.
