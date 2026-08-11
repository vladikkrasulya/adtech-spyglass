# Problem Definition: Browser Markdown Trust Boundary

- **Slug**: browser-markdown-boundary
- **Created**: 2026-08-11
- **Inputs used**: `intake.md`, `research.md`, and maintainer confirmation

## Problem Statement

Public blog visitors can receive script-capable HTML when an authorized operator promotes externally influenced draft text into persistent Markdown, because the browser treats every filesystem post as trusted and inserts unsanitized Marked output into the main same-origin document. The manual bearer-token gate lowers likelihood but does not make promoted content safe, and the resulting same-origin execution could affect public visitors as well as signed-in users or administrators carrying browser-resident data.

## Affected Users & Stakeholders

- **Users**: public Blog readers — a promoted post can become active content after the safe SSR body is replaced by the browser renderer.
- **Users**: signed-in Inspector and Library users — same-origin execution can reach authenticated APIs and browser-retained request history or active encryption state.
- **Users**: Blog Admin operators — a visually escaped, truncated draft preview does not reliably show what the promoted body will do when rendered.
- **Stakeholders**: project maintainer — owns the public security promise, product compatibility, and prioritization decision.
- **Stakeholders**: content and deployment operators — control `ADMIN_STATS_TOKEN`, persistent `CONTENT_DIR`, promotion, backup, and release procedures.
- **Stakeholders**: security reporters and reviewers — rely on the repository security policy and regression evidence to distinguish a closed boundary from a documented assumption.

## Goals

- Make every public Blog body inert with respect to script execution and unsafe navigation, regardless of whether it came from Git, RSS, admin ingest, or persistent promotion.
- Preserve the ordinary Markdown semantics actually used by editorial content across server and browser rendering.
- Prevent a human promotion action from silently converting externally influenced text into active same-origin content.
- Give maintainers deterministic, local regression evidence for the complete ingest/promotion/render boundary and its security policy.
- Keep the canonical Content/SEO and security documentation truthful about the resulting trust model.

## Non-Goals

- Redesign the Blog, news crawler, translation pipeline, Blog Admin interface, or editorial workflow as a product feature.
- Replace the project's global CSP with a nonce-based policy or remove every unrelated `innerHTML` use.
- Inspect, mutate, migrate, deploy, or exploit production content during assessment or implementation without separate authorization.
- Change account encryption, authentication, analytics, or the safe DB/firehose publication model.
- Treat indexability, a bearer token, or human review as a substitute for a render-time content-safety invariant.
- Preserve executable raw HTML as an implicit compatibility promise when no such promise or tracked use has been established.

## Success Metrics

- A maintained synthetic corpus covering event attributes, raw active elements, SVG/iframe variants, encoded markup, and unsafe URL schemes produces zero executable or unsafe-navigation primitives in the final Blog DOM. (baseline: the verified Marked-to-`innerHTML` path preserves and executes a harmless synthetic event marker)
- Every public Blog body source reaches an explicitly tested content-safety boundary before main-document insertion. (baseline: the filesystem-Markdown branch has no sanitizer or escape-first invariant)
- A synthetic encoded RSS summary promoted through the supported boundary cannot become active markup when the resulting post is rendered. (baseline: `parseRss()` currently reconstructs raw markup and promotion writes it verbatim)
- The tracked EN/UK/RU editorial fixtures retain their expected headings, emphasis, lists, inline code, links, and readable text in both SSR and browser views. (baseline: server and browser currently use different Markdown grammars)
- Focused browser/content/security tests and the full repository CI gate pass with no production endpoint or real credential. (baseline: SSR escaping is tested; browser Markdown, promotion, and CSP interaction are not)
- Canonical contracts no longer describe an accepted unsanitized trusted-editorial exception. (baseline: `content-seo.md` accurately documents that exception today)

## Cost of Inaction

The current human-gated path remains a latent stored-XSS boundary: a compromised or malformed allowlisted feed item, an unsafe admin-ingested summary, or a mistaken promotion can persist script-capable markup on a public same-origin route. The tracked corpus is currently benign and no incident is evidenced, but persistence across deploys/backups and access to same-origin browser state make the impact disproportionate to the small number of actions required to cross the boundary.

## Open Questions

- [NEEDS CLARIFICATION: Which full-Markdown constructs beyond the tracked corpus are intentionally supported, and is any non-executable raw HTML required?]
- [NEEDS CLARIFICATION: Should source-URL scheme parity and promotion integrity checks be included in the same bounded feature or routed into follow-up assessments?]
- [NEEDS CLARIFICATION: Should a separately authorized release procedure audit existing production `CONTENT_DIR` files, or should the runtime invariant be sufficient without reading them?]
- [NEEDS CLARIFICATION: Which real-browser fixture is proportionate for proving CSP and DOM behavior in addition to deterministic jsdom/parser tests?]
