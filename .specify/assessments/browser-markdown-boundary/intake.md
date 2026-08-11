# Idea Intake: Browser Markdown Trust Boundary

- **Slug**: browser-markdown-boundary
- **Created**: 2026-08-11
- **Source**: conversation context and repository paths: `specs/ROADMAP.md`, `specs/000-platform-baseline/contracts/content-seo.md`, `public/modules/blog/index.js`, `modules/admin/blog.js`
- **Type**: exploration

## Idea (as captured)

> “Давай, вперед)” and later “Так.”

The project maintainer confirmed the proposed Spec Kit assessment of the browser Markdown/XSS boundary and the explicit slug `browser-markdown-boundary`.

## Restated

Assess whether browser-side Markdown rendering and content-promotion paths create an unsafe trust boundary, then decide whether a bounded hardening feature is warranted.

## Origin & Context

- **Raised by**: project maintainer
- **Trigger**: A prior repository review surfaced a possible mismatch between browser Markdown rendering, persistent editorial content, and the documented content-safety boundary.

## First-Glance Unknowns

- [NEEDS CLARIFICATION: Which browser render paths accept Markdown or HTML?]
- [NEEDS CLARIFICATION: Which content sources can write, ingest, preview, or promote persistent Markdown?]
- [NEEDS CLARIFICATION: Is raw HTML an intentional editorial capability or an accidental behavior?]
- [NEEDS CLARIFICATION: Which browser, server, policy, and test controls currently constrain active content?]
- [NEEDS CLARIFICATION: What compatibility and security outcomes should bound any follow-up change?]
