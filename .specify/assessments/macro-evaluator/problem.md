# Problem Definition: Macro Evaluator

- **Slug**: macro-evaluator
- **Created**: 2026-08-12
- **Inputs used**: intake.md, implementation_plan.md, codebase audit

## Problem Statement

AdOps, QA engineers, and integration developers analyzing OpenRTB BidResponses currently have no way to verify how all OpenRTB tracking and notice URLs (`nurl`, `burl`, `lurl`, and trackers embedded in `adm`) across multiple bids expand their substitution macros without writing external scripts or manually substituting values. The current UI only substitutes 3 hardcoded macros into a single creative string, leaving multi-bid and standard IAB macros (`AUCTION_ID`, `AUCTION_BID_ID`, `AUCTION_IMP_ID`, `AUCTION_MBR`, etc.) uninspected.

## Affected Users & Stakeholders

- **Users**: AdOps & QA Engineers — need to audit win/billing/loss notice URLs and creative impression trackers for syntax errors, correct macro placement, and valid query structures across all bids in an auction response.
- **Users**: DSP/SSP Integration Developers — need to verify that their bidding engines emit standard IAB OpenRTB §4.4 substitution macros correctly formatted for downstream exchanges.
- **Stakeholders**: Platform Operator — requires that macro evaluation remains strictly inert and zero-network, guaranteeing zero accidental billing, zero third-party tracking pixel execution, and zero compliance/privacy leakage.

## Goals

- Enable users to inspect macro substitution for all bids in a `BidResponse` (`seatbid[].bid[]`).
- Support standard OpenRTB 2.x §4.4 substitution macros as well as custom/vendor macros.
- Allow users to simulate clearing prices, auction IDs, loss codes, and custom parameters across all extracted notice/tracker URLs.
- Provide a safe, copyable, visual table of all evaluated URLs without triggering any HTTP/network calls.

## Non-Goals

- Firing real network requests (`fetch`, `new Image()`, `sendBeacon`) to test if endpoints respond (prohibited by privacy and billing boundary).
- Proprietary or encrypted price macro decryption (unless explicitly provided as an inert client-side tool in a separate phase).
- Automatic modification of the original `BidResponse` JSON (evaluator is read-only inspection).

## Success Metrics

- 100% of standard OpenRTB 2.x §4.4 substitution macros recognized in inspection.
- Support for multi-bid responses with clear per-bid categorization.
- Zero network requests triggered during evaluation (100% inert).

## Cost of Inaction

Users will continue relying on manual copy-paste into text editors or home-grown scripts to check URL macro structures, risking missed syntax errors that lead to lost tracking/billing signals in live programmatic campaigns.

## Open Questions

- [NEEDS CLARIFICATION: Should custom/unknown macros have dynamic input fields auto-generated in the UI, or a simple key-value table?]
- [NEEDS CLARIFICATION: Where in the Inspector hierarchy should this evaluation panel live — as a dedicated tab alongside "Behavior" and "Preview", or embedded below each bid finding?]
