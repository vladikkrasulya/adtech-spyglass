# Concept: Silent Failure Detection

- **Slug**: silent-failure-detection
- **Created**: 2026-08-13
- **Recommended option**: Option B — depth on one transaction

## Options

### Option A — Breadth: cover the adjacent ad-tech surfaces

- **Sketch**: treat ads.txt / sellers.json / SupplyChain, consent frameworks and VAST as first-class
  product areas, each validated in its own right.
- **Appetite**: continuous. Crawlers, an app-store adapter, the Public Suffix List, GVL and GPP
  schema tracking, vendor profiles, and legal-change monitoring are all recurring costs.
- **Trade-offs**: every area is already covered in part by an IAB validator, a vendor portal or an
  open library. Duplicating them competes where the field is crowded.
- **Rabbit holes**: unbounded maintenance on data nobody owns; scraping where no API exists.

### Option B — Depth: explain one transaction from bytes to outcome

- **Sketch**: take one payload and account for everything that happened to it, including the
  transformations the tooling itself performs. Adjacent surfaces are read only insofar as they
  change the reading of this payload.
- **Appetite**: bounded. Each detector is a rule over data already flowing through `validate`.
- **Trade-offs**: does not answer inventory-wide questions. Accepts that a single-transaction tool
  cannot audit a whole supply graph.
- **Rabbit holes**: modules built without a consumer, which is inventory rather than product.

## Evidence for the recommendation

Two independent research passes were run blind and in parallel and reached the same conclusion
from different directions: syntax validation is commoditised, and the expensive failures occur
_between_ layers — debug→transport, version→transform, request→response, privacy→redaction.

The measurement supports it more directly than the reasoning does. Every defect measured in this
work is invisible to a validator that reads a parsed object, and every one of them is reachable
from a single payload. None required breadth.

## Consequence adopted as a constraint

Any parse is a lossy projection. Raw bytes are the source of truth, the parsed view is derived,
and every transformation is recorded. This is not a backlog item — without it, a whole class of
finding is unreachable in principle.

## What would overturn this

If most incidents were resolved by inventory-wide audits before an auction rather than by tracing
one transaction, breadth would be the better bet.
