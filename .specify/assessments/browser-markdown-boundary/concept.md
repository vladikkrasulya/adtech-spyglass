# Concept: Close the Browser Markdown Trust Boundary

- **Slug**: browser-markdown-boundary
- **Created**: 2026-08-11
- **Recommended option**: Option A — Render-boundary invariant

## Options

### Option A — Render-boundary invariant

- **Sketch**: Treat every Blog body as untrusted at the final browser boundary, preserve ordinary Markdown presentation, and ensure active HTML, event behavior, embedded documents, and unsafe navigation cannot survive into the main document. Keep the existing publication choices, but make promotion incapable of granting executable trust. Add a bounded synthetic regression corpus spanning the parser, promoted content, and final DOM.
- **Appetite**: small, conditional on Markdown-only editorial semantics and a deterministic local test path
- **Trade-offs**: Closes the verified source-to-sink chain for existing and future persistent files without reading production or redesigning content operations. It may intentionally change rendering for raw HTML and requires careful compatibility checks for lists, code, links, and other ordinary Markdown; a new security component would also need provenance and maintenance ownership.
- **Rabbit holes**: Rebuilding a general sanitizer, attempting byte-identical SSR/client HTML, solving the whole site's CSP, or expanding from Blog bodies into every unrelated DOM sink.

### Option B — Defense-in-depth publication boundary

- **Sketch**: Establish the same final render-time invariant as Option A and also make promotion an explicit content-security gate with trustworthy preview, validation, state/locale checks, overwrite behavior, and a bounded review of existing persistent content. Align adjacent Blog link handling in the same initiative.
- **Appetite**: medium
- **Trade-offs**: Reduces both likelihood and impact, gives operators a clearer trust decision, and addresses adjacent integrity gaps. It touches more workflows and persistent-state assumptions, needs stronger compatibility/product decisions, and can delay closure of the already verified browser sink.
- **Rabbit holes**: Turning Blog Admin into a full CMS, migrating all historical content, defining production-wide editorial governance, redesigning ClickHouse schemas, or coupling the fix to a deploy and live-data audit.

### Option C — Procedural trust and monitoring

- **Sketch**: Keep the current renderer, document a strict no-raw-HTML rule, require manual inspection before promotion, and periodically audit persistent Markdown without changing runtime behavior.
- **Appetite**: small
- **Trade-offs**: Preserves all current rendering behavior and has little implementation cost. It leaves the verified stored-XSS-capable sink intact, relies on perfect operator behavior and feed interpretation, does not protect existing files automatically, and cannot satisfy the DOM or promotion success metrics.
- **Rabbit holes**: Building an operational review process that appears rigorous but remains unverifiable, or treating monitoring and indexability as security controls.

## Recommendation

Proceed with Option A. It targets the invariant closest to the impact, covers Git and already-persistent content as well as future promotions, preserves the safe DB/firehose model, and avoids coupling a security correction to production access or a Blog Admin redesign. Option B contains useful follow-ups, but its broader integrity and operator-experience work should not delay removal of the executable browser boundary. Option C does not clear the stated security metrics.

## Out of Scope (for the recommended option)

- Production `CONTENT_DIR` inspection, migration, deployment, or live exploit verification.
- Global CSP nonce work, Trusted Types adoption across the application, or a sweep of unrelated `innerHTML` uses.
- A new CMS, rich editor, approval workflow, ClickHouse schema, or translation/crawler redesign.
- Promotion status/locale/collision/frontmatter hardening beyond what is necessary to prove the Markdown-to-browser safety invariant.
- SSR/Admin source-URL scheme parity; record it as a separate bounded follow-up unless specification proves it is inseparable from the selected renderer boundary.
- Preservation of executable raw HTML, inline handlers, embedded documents, or unsafe URL schemes as editorial features.

## Assumptions to Validate

- Editorial authors need ordinary Markdown features but do not require executable raw HTML, SVG, iframe, style, or `javascript:` URLs.
- A single render-time policy can cover tracked files, runtime-promoted files, and future Markdown without inspecting production content.
- The selected policy can remain deterministic, offline, compatible with the vanilla/no-bundler runtime, and reviewable under the project's dependency rules.
- Synthetic parser/jsdom coverage plus the existing repository gates is sufficient for implementation; a real-browser CSP fixture is desirable only if it can remain local and bounded.
- Exact SSR/browser markup identity is unnecessary as long as both surfaces preserve intended content and enforce the same safety outcome.
- Adjacent URL and promotion-integrity observations can be tracked without silently expanding this feature.
