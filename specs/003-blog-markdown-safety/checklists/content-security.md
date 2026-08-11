# Content-Security Requirements Checklist: Safe Blog Markdown

**Purpose**: Formal PR-review gate for completeness, clarity, consistency, and measurability of the
Blog Markdown safety requirements before implementation tasks are generated
**Created**: 2026-08-11
**Feature**: [spec.md](../spec.md)

**Note**: This checklist evaluates the written requirements and design contracts, not the eventual
implementation.

## Boundary Completeness

- [x] CHK001 Is the protected boundary defined at the final user-visible Blog body rather than at a
      source label, author role, storage path, or approval step? [Completeness, Spec FR-001/FR-008]
- [x] CHK002 Are repository posts, pre-existing persistent posts, future promotions, published-news
      bodies, unknown source values, and every failure state all included explicitly? [Coverage, Rendering
      contract §One Final Body Boundary]
- [x] CHK003 Is the exact security-capability denominator complete across executable elements,
      events, vector/math namespaces, embeds, forms, document-policy changes, navigation, styles,
      resources, obfuscated links, malformed input, and failure paths? [Completeness, Spec FR-013]
- [x] CHK004 Does the written outcome distinguish readable inert content from merely hidden or
      blocked content? [Clarity, Spec FR-002/FR-004/FR-006]

## Content-Policy Clarity

- [x] CHK005 Are the supported Markdown constructs and exact allowed element set enumerated rather
      than described as “safe Markdown”? [Clarity, Spec FR-005; Rendering contract §Supported Markdown]
- [x] CHK006 Are raw HTML, Markdown images, and task-list controls assigned explicit readable inert
      outcomes? [Coverage, Spec FR-004/FR-006; Rendering contract §Raw HTML, Images, and Controls]
- [x] CHK007 Are allowed attribute names, renderer-owned element placement, the sanitizer's global
      superset, and the final-DOM placement assertion distinguished unambiguously? [Consistency,
      Rendering contract §Supported Markdown]
- [x] CHK008 Are ARIA/data defaults explicitly disabled and are hooks, broad profiles, in-place
      mutation, and post-sanitize HTML reparsing explicitly excluded? [Completeness, Rendering contract
      §Supported Markdown]
- [x] CHK009 Is “style-free” scoped to `style` elements/attributes without contradicting the allowed
      inert table-cell `align` attribute? [Consistency, Spec SC-001; Rendering contract §Supported
      Markdown]

## Link-Policy Clarity

- [x] CHK010 Does the policy identify the normalized parser destination as the editorial-link input
      while requiring raw-input obfuscation coverage? [Clarity, Research Decision 3; Rendering contract
      §Link Policy]
- [x] CHK011 Are safe protocols, relative/fragment behavior, control/whitespace/backslash handling,
      label-preserving rejection, `rel`, and target behavior all specified? [Completeness, Spec FR-003;
      Rendering contract §Link Policy]
- [x] CHK012 Is editorial relative/fragment support kept distinct from the unchanged published-news
      renderer, which recognizes only absolute HTTP(S) links? [Consistency, Spec FR-011; Rendering
      contract §Link Policy]

## Failure and Lifecycle Coverage

- [x] CHK013 Is safe behavior defined separately for dependency-load, parser, sanitizer, policy,
      fragment, and insertion failures? [Coverage, Spec FR-010; Rendering contract §Failure Contract]
- [x] CHK014 Does the design require a safe body placeholder before dynamic dependency loading so an
      import failure cannot prevent readable fallback content? [Consistency, Research Decision 4]
- [x] CHK015 Are navigation abort and stale-root ownership checks required after every awaited
      render step before the document may be changed? [Edge Cases, Research Decision 4; Rendering
      contract §Failure Contract]
- [x] CHK016 Are body logging, unsanitized retry, template-string fallback, and resource-loading
      error behavior explicitly prohibited? [Completeness, Rendering contract §Failure Contract]

## Compatibility and Surface Consistency

- [x] CHK017 Does the compatibility denominator include every tracked localized post and each named
      ordinary Markdown construct with maintained readable/semantic expectations? [Measurability, Spec
      FR-014/SC-004]
- [x] CHK018 Are browser full-Markdown semantics and intentionally limited escape-first SSR
      requirements separated without weakening their shared inert-content outcome? [Consistency, Spec
      FR-007; Rendering contract §SSR and Other Surfaces]
- [x] CHK019 Are Blog routes, response shapes, source classification, listing, search, RSS, metadata,
      SEO, and Admin authorization named as unchanged contracts? [Completeness, Spec FR-011]
- [x] CHK020 Are performance and network expectations bounded to one local parse/sanitize pass with
      no body-driven request or new runtime service? [Non-Functional, Plan §Technical Context]

## Verification Measurability

- [x] CHK021 Is every security fixture required to have a stable unique class/fixture ID and an exact
      final-document assertion denominator? [Measurability, Data model §Security Fixture]
- [x] CHK022 Is the mandatory evidence the actual Blog mount and final `.blog-post__body`, not parser
      strings or a sanitizer helper alone? [Measurability, Spec FR-012; Rendering contract §Verification
      Contract]
- [x] CHK023 Is the browser-module harness defined reproducibly, repository-confined, and capable of
      proving module-load failure without a runtime-only injection seam? [Feasibility, Research Decision
      6]
- [x] CHK024 Is the encoded-feed → authorized promotion → temporary file → public handler → browser
      mount scenario fully bounded to synthetic data and mocked/local infrastructure? [Coverage, Spec
      FR-009/FR-012; Data model §Synthetic Promotion Scenario]
- [x] CHK025 Is a real-browser run explicitly optional while deterministic parser and final-jsdom
      evidence remains the acceptance floor? [Clarity, Spec §Cross-Cutting Verification]
- [x] CHK026 Are full CI, both npm audit modes, static gates, exact vendor checks, and a disposable
      production-image asset smoke all required without treating CSP as the body defense? [Completeness,
      Quickstart §§6–7]

## Vendor and Release Ownership

- [x] CHK027 Are Marked and DOMPurify pinned to exact versions with exact upstream source artifacts,
      byte-parity rules, copied licenses, checksums, and one deterministic update procedure? [Completeness,
      Vendor contract §§Owned Artifacts–Security Update Rule]
- [x] CHK028 Does the vendor contract prevent formatters, CDN/runtime fetches, install hooks,
      production `node_modules` serving, or write mode from silently blessing unreviewed bytes?
      [Security, Vendor contract §§Sync and Check Behavior–Prohibited Paths]
- [x] CHK029 Are plain-text notices/licenses and the Docker/context behavior specified so provenance
      ships with the reviewed browser assets? [Consistency, Vendor contract §License and Notice]
- [x] CHK030 Is the App PATCH classification explicit, with every current baseline/version surface
      in scope and Core/CLI versions held unchanged? [Traceability, Research Decision 7; Plan §Repository
      Changes]

## Scope, Privacy, and Follow-Up Ownership

- [x] CHK031 Are production content inspection, credentials, endpoints, migration, publish, deploy,
      cache purge, and other external mutations expressly unauthorized? [Security, Spec FR-012/FR-017]
- [x] CHK032 Are adjacent source-URL, promotion state/locale/collision/frontmatter, global CSP,
      Trusted Types, unrelated sinks, and CMS redesign recorded as deferred rather than silently lost?
      [Scope, Spec FR-017; Research Decision 8]
- [x] CHK033 Is localization parity addressed if and only if new user-visible wording is introduced,
      while the planned no-copy path avoids unnecessary locale churn? [Consistency, Spec FR-016; Plan
      §Technical Context]
- [x] CHK034 Do canonical Content/SEO, SECURITY, ADR, roadmap, changelog, and baseline-version owners
      receive updates without duplicating live policy into historical documents? [Traceability, Spec
      FR-015; Plan §Repository Changes]

## Analysis Remediation Addendum

- [x] CHK035 Is editorial relative-link resolution pinned to exact `document.baseURI` consistently
      across the spec, data model, research, and rendering contract? [Clarity, Rendering contract §Link
      Policy]
- [x] CHK036 Does the long-text edge case use a fixed deterministic fixture without inventing an
      unsupported production body-size limit? [Truthfulness, Spec §Edge Cases; Rendering contract
      §Failure Contract]
- [x] CHK037 Is zero resource loading measured with an explicit request-attempt observer rather than
      inferred only from final-node absence? [Measurability, Spec FR-002/FR-006]
- [x] CHK038 Are dependency-load, parser, sanitizer, policy, fragment-construction, and insertion
      failures individually named with reproducible test mechanisms? [Coverage, Rendering contract
      §Failure Contract]
- [x] CHK039 Are offline test/CI acceptance and separately networked npm install/advisory gates
      distinguished without allowing an unavailable audit service to count as success? [Consistency,
      Spec SC-005]
- [x] CHK040 Does vendor task ordering prove the intended old-asset failure and require removal of the
      superseded Marked build from both repository and image? [Traceability, Vendor contract §Sync and
      Check Behavior]
- [x] CHK041 Does every forced failure path require an explicit sentinel-body non-disclosure check
      across console and browser reporting seams? [Security, Rendering contract §Failure Contract]
- [x] CHK042 Is the same complete compatibility corpus required to retain readable text through SSR
      as well as supported semantics through the browser mount? [Consistency, Spec SC-004]
- [x] CHK043 Is unchanged Blog search indexing/navigation named alongside list/post/RSS preservation?
      [Completeness, Spec FR-011]

## Notes

- Review completed on 2026-08-11 after the plan was amended for exact two-package vendor byte parity,
  closed DOMPurify defaults, dynamic-import fallback/lifecycle behavior, an actual-mount ESM harness,
  source-specific link compatibility, Docker static-asset evidence, and complete version surfaces.
- All 43 requirement-quality questions are resolved by the current spec, plan, research, data model,
  quickstart, and contracts. Implementation evidence remains the responsibility of `tasks.md`.
