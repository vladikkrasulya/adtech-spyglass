# Capability boundaries and assertion inventory

## CL-08 disposition: retain explicit boundaries

[ADR-018](../decisions/ADR-018-maintenance-boundaries-and-degradation.md) resolves the preliminary
proposal by retaining the existing boundary-specific contracts. This is a documented decision, not
an implemented universal capability API or a claim that every recognized format is validated.

| Question                                    | Current owner                                                                                              | Meaning and boundary                                                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What format/context/protocol is recognized? | `packages/core/format-detect.js`; HTTP `modules/analyze/handler.js`                                        | Independent evidence sets; tags do not certify a request/response pair or playback.                                                                                                                  |
| Which rules ran and what did they find?     | Core `validate`/`crosscheck`; [Core contract](../000-platform-baseline/contracts/core-validator.md)        | Findings and applicability remain separate from detection. Vendor request/response references do not imply OpenRTB auction pairing.                                                                  |
| What preview content exists?                | `tests/corpus/lib/browser.js`; [frontend contract](../000-platform-baseline/contracts/frontend-modules.md) | Body kind, observed render state, decoded assets and advancing media time are distinct observations. VAST/audio document recognition does not grant playback or wrapper fetching.                    |
| Why is content unavailable?                 | Preview limitation/refusal UI and corpus oracle                                                            | Inert text, empty content, blocked assets and policy restrictions require their own explanation; markup recognition does not imply loaded assets.                                                    |
| Which source/vendor convention applies?     | `tests/corpus/lib/schema.js` reference metadata; fixture contracts                                         | `wireProtocol`, `vendorDialect`, source IDs, validity and `pairApplicability` preserve provenance independently of IAB version. Provisional examples are not positive standard-conformance evidence. |

The assertion records below give CL-08 concrete evidence that the original proposal lacked.
`corpus-oracle.md` and the generated matrix remain the owners of measured corpus outcomes; this
document does not replace them or promote historical known-gap reports to current results.

## CL-09 disposition: bounded assertion-level inventory

The following records extend the earlier file-level [coverage inventory](../020-ad-format-verification-matrix/coverage-inventory.md)
with exact assertion names and explicit exclusions. `unit-only` includes pure Node and simulated DOM
tests; `browser-tested` identifies a real-browser assertion, not a claim that it ran during this
documentation update. Current execution outcomes belong in [verification.md](verification.md).
`uncovered` is an admitted boundary with no claimed assertion. Browser-defined checks still require
an available browser and successful execution to become release evidence.

One record represents a capability scenario. Locale, fixture, viewport and format variants do not
become additional capabilities merely by multiplying cases. Higher-order combinations remain
uncovered unless a named assertion establishes them. The reference guard parses real test calls,
so a matching comment or example string cannot masquerade as an assertion.

```json
[
  {
    "id": "vendor-pair-applicability",
    "capability": "Detection and validation boundaries",
    "scenario": "Vendor pairing does not claim OpenRTB crosscheck applicability",
    "coverage": "unit-only",
    "scope": "Synthetic URL and vendor request/response adapters",
    "evidence": [
      {
        "file": "tests/corpus-lib.test.js",
        "test": "Core adapter: raw JSON validates with rawText and vendor pairs do not crosscheck"
      }
    ],
    "limits": "Does not certify every proprietary vendor envelope."
  },
  {
    "id": "preview-independent-states",
    "capability": "Preview capability states",
    "scenario": "Kind, render state, playback, decoded assets and visible limitation are checked independently",
    "coverage": "unit-only",
    "scope": "Synthetic measured markup states and oracle rejection controls",
    "evidence": [
      {
        "file": "tests/corpus-lib.test.js",
        "test": "oracle: preview expectations compare kind/rendered/mediaPlays/assets and demand a visible limitation"
      }
    ],
    "limits": "Oracle unit coverage is not actual media playback."
  },
  {
    "id": "source-vendor-provenance",
    "capability": "Source provenance",
    "scenario": "Vendor references and negative mutations are not positive standards fixtures",
    "coverage": "unit-only",
    "scope": "Curated Native, AdCOM and vendor fixture conventions",
    "evidence": [
      {
        "file": "tests/corpus-fixture-contract.test.js",
        "test": "fixture contracts: negative mutations and vendor reference conventions are not positive standards fixtures"
      }
    ],
    "limits": "No independent certification of uncited proprietary schemas."
  },
  {
    "id": "capability-exclusions",
    "capability": "Unsupported versus unverified states",
    "scenario": "Product-policy exclusions stay distinct from missing cases and measured conformity",
    "coverage": "unit-only",
    "scope": "Curated format/protocol/context and preview projections",
    "evidence": [
      {
        "file": "tests/corpus-axes.test.js",
        "test": "axes: applicability rules follow the specifications and product contracts"
      },
      {
        "file": "tests/corpus-axes.test.js",
        "test": "axes: every format × column cell is classified and empty applicable cells read unverified"
      },
      {
        "file": "tests/corpus-report.test.js",
        "test": "matrix: explicitly missing execution cannot pass a populated report"
      }
    ],
    "limits": "Case presence alone is not a successful execution or conformance verdict."
  },
  {
    "id": "behavior-browser-journey",
    "capability": "Creative behavior and saved corpus",
    "scenario": "Behavior tab, corpus save and Insights form a working browser journey",
    "coverage": "browser-tested",
    "scope": "Representative synthetic creative with corpus/Insights flows",
    "evidence": [
      {
        "file": "tests/site-behavior.test.js",
        "test": "browser: behavior tab, corpus save and the insights dashboard"
      }
    ],
    "limits": "Not a Behavior-tab journey for every corpus creative or vendor format."
  },
  {
    "id": "saved-dialect-rule",
    "capability": "Custom dialects",
    "scenario": "A saved mapping suppresses its corresponding unknown-extension question",
    "coverage": "unit-only",
    "scope": "Injected saved mapping and request extension signal",
    "evidence": [
      {
        "file": "tests/rules-dialects-questions.test.js",
        "test": "userDialect mapping suppresses the finding"
      }
    ],
    "limits": "Does not exercise account persistence or the full format/version matrix."
  },
  {
    "id": "mirror-roundtrip",
    "capability": "Mirror generation",
    "scenario": "Representative banner roundtrip, video generation and Native generation remain explicit",
    "coverage": "unit-only",
    "scope": "Supported request/response generation examples",
    "evidence": [
      {
        "file": "tests/mirror.test.js",
        "test": "round-trip: request → mirror response → mirror back to request, both clean"
      },
      { "file": "tests/mirror.test.js", "test": "request → response: video imp produces VAST adm" },
      {
        "file": "tests/mirror.test.js",
        "test": "request → response: native imp produces matching native adm"
      }
    ],
    "limits": "No browser roundtrip or generation support for every format/version combination is claimed."
  },
  {
    "id": "migration-browser-journey",
    "capability": "Migration advice",
    "scenario": "The Migration tab completes its advisory browser smoke",
    "coverage": "browser-tested",
    "scope": "Representative supported request migration and tab interaction",
    "evidence": [
      {
        "file": "tests/migrate-tab-browser.test.js",
        "test": "browser smoke test: the Migration tab"
      }
    ],
    "limits": "Not every format, dialect, protocol revision or arbitrary extension."
  },
  {
    "id": "source-navigation",
    "capability": "Finding-to-source navigation",
    "scenario": "Cross-pane floor location and stale-input teardown are explicit",
    "coverage": "unit-only",
    "scope": "Simulated DOM with request/response ranges and edited input",
    "evidence": [
      {
        "file": "tests/source-nav.test.js",
        "test": "cross-pane price↔floor: response price exact + request bidfloor related"
      },
      {
        "file": "tests/source-nav.test.js",
        "test": "stale: editing a pane tears down highlight + disables nav until re-analyze"
      }
    ],
    "limits": "Does not establish every source path in every browser."
  },
  {
    "id": "history-representation",
    "capability": "History and drawer controls",
    "scenario": "URL and scalar input roundtrip plus independent saved/history row controls",
    "coverage": "unit-only",
    "scope": "Serialization and simulated DOM controls",
    "evidence": [
      {
        "file": "tests/inspector-request-input.test.js",
        "test": "Inspector request input preserves a raw legacy-feed URL across History"
      },
      {
        "file": "tests/inspector-request-input.test.js",
        "test": "History round-trips a JSON string scalar without corrupting it"
      },
      {
        "file": "tests/inspector-disclosure-contract.test.js",
        "test": "History and Saved rows render native sibling controls with independent keyboard targets"
      }
    ],
    "limits": "No full reload, multi-tab or quota lifecycle for all ad formats."
  },
  {
    "id": "sharing-browser-journey",
    "capability": "Encrypted sharing",
    "scenario": "Encrypted share links complete their browser smoke",
    "coverage": "browser-tested",
    "scope": "Synthetic share-link creation and consumption",
    "evidence": [
      { "file": "tests/gists-browser.test.js", "test": "browser smoke test: encrypted share links" }
    ],
    "limits": "Sharing is a separate journey from every Inspector format workflow."
  },
  {
    "id": "public-id-suppression",
    "capability": "Public Core options",
    "scenario": "Exact and prefix suppression preserve legacy and dotted finding identities",
    "coverage": "unit-only",
    "scope": "Public validate call with malformed synthetic bid price",
    "evidence": [
      {
        "file": "tests/finding-id-policy.test.js",
        "test": "public suppression accepts exact legacy IDs and either naming family as a prefix"
      }
    ],
    "limits": "Not every strictness, expectedVersion, dialect and format permutation."
  },
  {
    "id": "desktop-browser-density",
    "capability": "Desktop presentation",
    "scenario": "Inspector text and panels remain bounded across tested desktop widths",
    "coverage": "browser-tested",
    "scope": "Chromium, synthetic inspector payload, desktop widths and themes",
    "evidence": [
      {
        "file": "tests/inspector-density-browser.test.js",
        "test": "browser: desktop Inspector preserves readable density and bounded panels"
      }
    ],
    "limits": "CSS viewport coverage is not real-device or every-browser certification."
  },
  {
    "id": "history-persistence-cross-product",
    "capability": "History persistence matrix",
    "scenario": "Every format across reload, simultaneous tabs and storage quota exhaustion",
    "coverage": "uncovered",
    "scope": "Higher-order persistence combinations",
    "evidence": [],
    "limits": "No exact assertion establishes this full combination; representative History tests do not imply it."
  },
  {
    "id": "saved-dialect-cross-product",
    "capability": "Saved dialect browser matrix",
    "scenario": "Account-specific mappings across all corpus formats and protocol contexts",
    "coverage": "uncovered",
    "scope": "Higher-order account and format combinations",
    "evidence": [],
    "limits": "Rule and representative account journeys do not establish the complete matrix."
  },
  {
    "id": "external-browser-device-matrix",
    "capability": "External browser and device coverage",
    "scenario": "Safari, Firefox, real devices, native browser zoom and screen-reader journeys",
    "coverage": "uncovered",
    "scope": "Environments outside the offline Chromium suite",
    "evidence": [],
    "limits": "No such execution is claimed by the repository corpus; full WCAG conformance is not inferred."
  }
]
```

`tests/capability-coverage.test.js` checks schema, unique scenario identities, real assertion
references and truthful uncovered records. It checks the inventory's integrity, not the outcome of
the referenced suites. CL-09 is closed by this bounded, enforceable inventory; the uncovered
combinations remain explicit product/testing boundaries rather than silently reported as repaired.
