# Concept: Macro Evaluator

- **Slug**: macro-evaluator
- **Created**: 2026-08-12
- **Recommended option**: Option A — Inspector Macro Panel

## Options

### Option A — Inspector Macro Panel (Integrated Inert Tab)

- **Sketch**: Add a dedicated "Macros" tab/card inside the existing Inspector workbench (alongside Findings, Creative Preview, and Behavior). It parses all `seatbid[].bid[]` objects in the active `BidResponse`, extracts all URLs (`nurl`, `burl`, `lurl`, and embedded `adm` trackers), and displays a clear table showing original URLs vs evaluated URLs with simulated macro substitutions. The user can adjust values (`AUCTION_PRICE`, `AUCTION_ID`, `AUCTION_LOSS`, etc.) in a simulation control form to immediately update the table. All operations are 100% inert with a "Copy URL" button and zero network requests.
- **Appetite**: small (2-3 days)
- **Trade-offs**: Keeps the feature directly inside the primary user workflow (Inspector) without adding routing or standalone state management. Sacrifices standalone batch processing across historical samples.
- **Rabbit holes**: Over-complicating macro regex parsing inside complex encoded JavaScript/HTML within `adm`.

### Option B — Standalone Macro Testing Section (New SPA Route)

- **Sketch**: Create a dedicated `/macros` SPA route with dual input panes: a `BidResponse` JSON editor and a customizable macro dictionary configuration. Allows loading saved samples from the user's personal cabinet and comparing how different DSP responses expand macros under identical auction conditions.
- **Appetite**: medium (1-2 weeks)
- **Trade-offs**: Provides more screen real estate for complex multi-bid configurations, but fragments the primary workflow and requires new navigation, route lifecycle, and i18n shells.
- **Rabbit holes**: Scope creep into building a full mock DSP bidding simulator.

### Option C — Static Validation Rules Only (Headless Core Findings)

- **Sketch**: Extend `@ortbtools/core` to emit informational and warning findings for unsupported or malformed OpenRTB §4.4 macros across all dialects, without adding any interactive evaluation UI.
- **Appetite**: small (1-2 days)
- **Trade-offs**: Very simple and purely deterministic, but does not provide visual URL simulation or copy affordances for QA/AdOps workflows.
- **Rabbit holes**: False positive warnings on proprietary exchange macros that are not recognized in open standards.

## Recommendation

**Option A (Inspector Macro Panel)** is recommended. It delivers the maximum practical value to AdOps and QA engineers directly in their active inspection flow while keeping scope tight, architecture modular, and adhering strictly to the zero-network policy.

## Out of Scope (for the recommended option)

- Firing any network requests (`fetch`, `Image`, `sendBeacon`).
- Modifying the original JSON in the editor panes.
- Client-side decryption of proprietary encrypted price macros.

## Assumptions to Validate

- The extracted URLs can be safely rendered in a sandboxed/escaped table without risk of browser URL pre-fetching or automated pre-loading.
- The standard IAB OpenRTB 2.x §4.4 macro list (`AUCTION_PRICE`, `AUCTION_ID`, `AUCTION_BID_ID`, `AUCTION_IMP_ID`, `AUCTION_SEAT_ID`, `AUCTION_CURRENCY`, `AUCTION_MBR`, `AUCTION_LOSS`, `AUCTION_MIN_TO_WIN`) covers >95% of typical QA validation needs.
