# Decision: Close the Browser Markdown Trust Boundary

- **Slug**: browser-markdown-boundary
- **Decided**: 2026-08-11
- **Verdict**: go
- **Artifacts reviewed**: `intake.md`, `research.md`, `problem.md`, `concept.md`

## Scorecard

| Criterion            | Rating   | Justification                                                                                                                                                                                |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem validity     | strong   | Repository code and a harmless local probe establish a public, persistent Marked-to-main-document execution boundary after an authorized promotion.                                          |
| Evidence strength    | strong   | Three independent read-only maps, exact source citations, Git history, parser output, and a synthetic final-DOM event probe agree on the same bounded chain.                                 |
| Value vs. inaction   | strong   | A small number of human-gated steps can create high-impact same-origin behavior that persists across releases, while the tracked corpus and lack of incidents lower urgency but not impact.  |
| Feasibility/appetite | adequate | One narrow browser branch owns the unsafe exception and safe render precedents already exist; Markdown compatibility and policy ownership still require specification.                       |
| Strategic fit        | strong   | The work is an explicit P1, reinforces the constitution's truthful security and regression rules, and does not require a framework, deploy, or production-data change.                       |
| Risk posture         | adequate | The main execution path and containment limits are understood; compatibility, sanitizer provenance, and adjacent URL/integrity gaps are identified and can be bounded before implementation. |

## Verdict & Rationale

Proceed to specification. The problem and evidence clear the `go` threshold, and Option A offers a credible small appetite that removes executable trust at the point shared by reviewed, promoted, and already-persistent Markdown. The unknowns affect compatibility details and follow-up ownership, not whether the verified boundary should remain open. A specification must resolve those details before implementation and must keep production inspection, deployment, global CSP work, and unrelated DOM sinks outside the authorization implied by this decision.

## If go — Handoff to `$speckit-specify`

- **Problem**: Filesystem-backed Blog bodies are treated as trusted solely by source classification, so externally influenced text promoted to persistent Markdown can become script-capable same-origin HTML after client rendering.
- **Chosen approach**: Option A — establish a deterministic render-boundary invariant for every Blog body while preserving ordinary Markdown and proving the complete synthetic promotion/render chain locally.
- **In scope**: final Blog-body content safety for all sources; ordinary Markdown compatibility; deterministic parser/DOM/promotion regression coverage; canonical Content/SEO and security truth updates.
- **Out of scope**: production content access or migration; deploy; global CSP/Trusted Types work; unrelated `innerHTML` sinks; Blog/CMS redesign; broad promotion-integrity changes; adjacent SSR/Admin source-URL scheme parity unless analysis proves it inseparable.
- **Success metrics**: zero executable/event/embed/unsafe-link primitives in the maintained synthetic final-DOM corpus; every Blog source crosses a tested safety boundary; encoded RSS-to-promotion input remains inert; tracked EN/UK/RU Markdown stays readable and semantically intact; focused and full CI gates pass offline.
- **Carried-forward open questions**:
  - Define the supported ordinary Markdown fixture set; default to no executable raw HTML because no product promise or tracked use supports it.
  - Select a deterministic, pinned, vanilla/no-bundler-compatible policy and record provenance/maintenance ownership.
  - Decide during clarification whether a local real-browser CSP fixture adds material evidence beyond parser/jsdom coverage.
  - Record adjacent source-URL and promotion-integrity findings as explicit follow-ups unless they are required to satisfy the selected Blog-body invariant.
