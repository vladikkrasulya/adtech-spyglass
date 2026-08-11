# Feature Specification: Safe Blog Markdown

**Feature Branch**: `assess/browser-markdown-boundary`

**Created**: 2026-08-11

**Status**: Complete

**Input**: Approved assessment handoff from `.specify/assessments/browser-markdown-boundary/decision.md`: close the executable browser Markdown trust boundary for every Blog body while preserving ordinary Markdown, proving the promotion-to-render path with synthetic evidence, and avoiding production access or unrelated platform work.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Read Any Blog Post Safely (Priority: P1)

As a visitor, I can open any Blog post without content from a repository file, persistent promotion, feed, or publication pipeline becoming executable same-origin behavior in my browser.

**Why this priority**: Public reader safety is the core value of the feature. A content classification or human approval step must not grant script execution.

**Independent Test**: Render the fixed security corpus through every Blog body source and verify that the final user-visible result remains readable while none of the prohibited active-content capabilities survive.

**Acceptance Scenarios**:

1. **Given** a filesystem-backed post containing raw active markup, **When** a visitor opens the post with browser rendering enabled, **Then** the content is readable but cannot execute code or create an active embedded document.
2. **Given** a post containing event attributes, active vector markup, or an executable URL scheme, **When** the post is rendered, **Then** those capabilities are absent from the final interactive document.
3. **Given** an encoded external draft promoted through the supported flow, **When** a visitor opens the resulting persistent post, **Then** decoding and persistence do not grant the content executable or unsafe-navigation capability.
4. **Given** a normal published-news post, **When** it is rendered, **Then** its existing inert-content behavior remains intact.

---

### User Story 2 - Preserve Ordinary Editorial Markdown (Priority: P2)

As an editorial author or reader, I retain the ordinary formatting used by the Blog while executable raw HTML is no longer an implicit feature.

**Why this priority**: Security hardening is not successful if it needlessly destroys the readability of the tracked editorial corpus.

**Independent Test**: Render every tracked `content/posts/**/*.md` file plus fixed synthetic fixtures
for empty bodies, paragraphs, headings, emphasis, strong text, ordered and unordered lists,
blockquotes, inline and fenced code, tables, line and thematic breaks, strikethrough, inert task-list
markers, safe links, raw-HTML text, image alternative text, the fixed long-text body, and
lone-surrogate text. Verify supported browser semantics and readable server output against maintained
expectations.

**Acceptance Scenarios**:

1. **Given** a tracked localized welcome post, **When** it is rendered server-side and in the browser, **Then** the browser preserves supported semantic structure and both views retain their baseline readable text without a server-rendering regression.
2. **Given** a safe same-origin, fragment, HTTP, or HTTPS Markdown link, **When** the post is rendered, **Then** the reader can use it without weakening opener or scheme safety.
3. **Given** raw HTML that is not part of the supported Markdown contract, **When** it is rendered, **Then** its literal source is displayed as inert readable text and does not become an active element.
4. **Given** Markdown image syntax, **When** it is rendered, **Then** its alternative text remains readable without loading an image or another external resource.

### Cross-Cutting Verification

The focused offline suite MUST cover every Blog body source, the synthetic promotion chain, the final browser document, and safe failure behavior. Deterministic parser and final-document tests are mandatory. A structural response-policy test MUST preserve the current public security-header contract. A separate real-browser fixture is optional and is not an acceptance gate unless planning proves an existing local harness adds unique evidence without a new service, dependency, or network requirement.

### Edge Cases

- Entity-encoded tags become literal angle-bracket text only after feed normalization.
- Raw HTML appears inline, as a block, inside nested Markdown, or with mixed character case and whitespace.
- Active content uses raw active elements, event attributes, vector/math markup, embedded documents, forms, base or refresh elements, inline styles, resource-loading attributes, or executable URL schemes.
- A normal link is relative, same-origin absolute, fragment-only, HTTP, or HTTPS; malformed and control-character-obfuscated schemes remain unsafe.
- An active capability is hidden through entity encoding, repeated decoding, mixed character case, whitespace, control characters, nested syntax, or malformed markup.
- A post is empty, malformed, a fixed synthetic 128 KiB body, or contains lone-surrogate text without
  becoming active during an error path. The fixture is a deterministic regression, not a new product
  body-size limit.
- Rendering support is unavailable or throws after the safe server-rendered first paint.
- A pre-existing persistent post was not created by the current promotion path.
- Localized content mixes Markdown syntax with EN, UK, and RU text.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Every Blog body MUST be treated as untrusted content at the final user-visible rendering boundary, regardless of source classification, author, approval, storage location, or age.
- **FR-002**: Blog rendering MUST prevent content from creating executable script behavior, inline event behavior, active embedded documents, automatic navigation, document-policy changes, style-driven active behavior, resource loads, or other active same-origin markup.
- **FR-003**: Blog rendering MUST reject or neutralize executable and obfuscated URL schemes while preserving safe same-origin, fragment, HTTP, and HTTPS navigation.
- **FR-004**: Raw HTML MUST NOT be an editorial capability; its literal source MUST be represented as inert readable text rather than silently removed or interpreted as elements.
- **FR-005**: The supported editorial contract MUST preserve paragraphs, headings, emphasis, strong text, ordered and unordered lists, blockquotes, inline and fenced code, tables, line and thematic breaks, strikethrough, inert task-list text markers, and safe links.
- **FR-006**: Markdown image syntax MUST preserve readable alternative text without causing a resource request; embedded media and active resource loading are outside the supported editorial contract.
- **FR-007**: Server-rendered and browser-rendered Blog bodies MUST enforce the same content-safety outcome. The browser MUST preserve the supported semantic Markdown contract; the server MUST retain its baseline readable text and MUST NOT regress while remaining intentionally limited in presentation.
- **FR-008**: The invariant MUST cover repository files, existing persistent files, future promotions, and every safe fallback without requiring a content migration before protection applies.
- **FR-009**: An encoded external draft promoted through the supported flow MUST remain inert in the final rendered post.
- **FR-010**: A parsing, loading, or rendering failure MUST fail closed to inert readable content and MUST NOT restore the prior active-content exception.
- **FR-011**: The change MUST preserve Blog list and post response shapes, status behavior, source classification, listing, search, RSS, metadata, and the existing escape-first published-news path.
- **FR-012**: Verification MUST use only synthetic or tracked repository fixtures, MUST require no production endpoint or real credential, and MUST cover the final interactive result rather than parser strings alone.
- **FR-013**: The fixed security corpus MUST cover raw active elements; representative inline event
  variants plus a generic final-document prohibition on every attribute whose ASCII-lowercase name
  begins with `on`; SVG and MathML; iframe, object, and embed variants; forms, base elements, and
  refresh navigation; style elements and attributes; resource-loading attributes; executable or
  obfuscated URL schemes; entity and repeated-decoding variants; mixed case, whitespace, and control
  characters; malformed input; and safe failure paths.
- **FR-014**: The fixed compatibility corpus MUST include every tracked `content/posts/**/*.md` file plus synthetic fixtures for every Markdown construct listed in FR-005 and the image behavior in FR-006.
- **FR-015**: Canonical Content/SEO and security documentation MUST describe the resulting invariant, supported content, known exclusions, and separately deferred adjacent findings.
- **FR-016**: Any user-visible warning or formatting copy introduced by the feature MUST ship with equivalent EN, UK, and RU meaning.
- **FR-017**: Production content inspection, deployment, global CSP changes, unrelated DOM sinks, Blog/CMS redesign, and broad promotion-integrity work MUST remain outside this feature unless separately authorized.

### Key Entities

- **Blog Post**: Public localized content with source classification, metadata, body, and persistence origin; all origins receive the same final safety outcome.
- **Markdown Body**: Author-controlled or externally influenced text that may contain supported Markdown plus unsupported raw or obfuscated active content.
- **Rendered Blog Body**: The user-visible semantic result; it retains supported formatting while excluding executable and unsafe-navigation capabilities.
- **Promotion Boundary**: The authorized action that persists a draft as Markdown; it no longer grants executable trust to the body.
- **Security Corpus**: The fixed synthetic matrix in FR-013, with expected inert outcomes for each final rendered result.
- **Compatibility Corpus**: Every tracked localized Blog Markdown file plus the fixed synthetic constructs in FR-014.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of fixed security-corpus fixtures produce zero executable, event-bearing,
  vector/math, embedded-document, form, document-policy, automatic-navigation, `style` element or
  attribute, resource-loading, or unsafe-link capabilities in the final interactive Blog result.
- **SC-002**: 100% of Blog body source classes and fallback states have an independently verifiable inert-content outcome.
- **SC-003**: The synthetic encoded-feed-to-promotion scenario completes with readable output and zero active-content primitives.
- **SC-004**: 100% of the compatibility corpus retains expected readable text in server and browser views, and retains supported semantic Markdown structure in the browser without regressing the server's baseline output.
- **SC-005**: Focused security/content checks and the complete repository `npm run ci` quality gate
  pass without production access, external network dependency, or real credentials. Separately
  required clean-install and advisory-audit gates MAY use approved npm registry/advisory access but
  MUST remain incomplete when that service is unavailable.
- **SC-006**: Canonical project documentation contains no accepted unsanitized trusted-editorial exception and keeps adjacent URL/promotion-integrity findings explicitly deferred and traceable through the approved assessment.

## Assumptions

- Editorial authors require ordinary Markdown formatting but do not require interpreted raw HTML, event attributes, SVG/MathML, embedded documents, forms, styles, media loading, or executable URL schemes.
- Safe relative, fragment, HTTP, and HTTPS links resolved against the current document base URL are
  sufficient for the editorial Blog contract; expanding schemes is a future explicit compatibility
  decision.
- Protection must apply at read/render time so already-persistent files are covered without a mandatory migration or production inspection.
- The existing Blog routes, source classifications, authorization model, ClickHouse publication behavior, and locale set remain unchanged.
- Deterministic offline parser and final-document evidence is the required floor. A separate real-browser fixture is optional under the Cross-Cutting Verification rule and cannot block delivery merely because no existing local harness is available.
- Adjacent SSR/Admin source-URL parity and promotion status/locale/collision/frontmatter integrity are recorded follow-ups unless planning proves they are inseparable from FR-001 through FR-009.
- No commit, push, PR, deployment, production read, or data migration is authorized by this specification.
