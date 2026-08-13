# Idea Intake: Macro Evaluator

- **Slug**: macro-evaluator
- **Created**: 2026-08-12
- **Source**: Discussion in AI chat assistant session (pasted text)
- **Type**: improvement

## Idea (as captured)

> **Macro Evaluator — найшвидший безпечний результат.**
> Розширити наявну логіку як inert evaluator без HTTP-викликів.
> Потрібно:
>
> - підтримувати per-bid context, а не лише перший bid;
> - розділити IAB та vendor/dialect macros;
> - за замовчуванням лише показувати результат і дозволяти копіювання;
> - не викликати nurl, burl, lurl автоматично.

## Restated

Enhance the existing macro preview logic into a full-featured "Macro Evaluator" panel. It will remain inert (no actual HTTP requests fired) but will simulate the substitution of all standard IAB macros (e.g. `AUCTION_ID`, `AUCTION_PRICE`) and vendor-specific macros across all bids in a response, allowing users to view and copy the final URLs.

## Origin & Context

- **Raised by**: AI Assistant (initial idea) / User (refined scope and prioritized as #1).
- **Trigger**: Product evolution planning; identified as a high-value, low-risk extension of existing functionality that fits perfectly within the Inspector's domain.

## First-Glance Unknowns

- [NEEDS CLARIFICATION: How exactly should we present the per-bid context in the UI (e.g. accordion per bid, or a single table with a "Bid ID" column)?]
- [NEEDS CLARIFICATION: Do we need an input form to let users define custom values for dialect/vendor macros, or do we just highlight them as "unsubstituted"?]
