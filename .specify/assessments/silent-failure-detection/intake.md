# Idea Intake: Silent Failure Detection

- **Slug**: silent-failure-detection
- **Created**: 2026-08-13
- **Source**: Working session; originated from a measured defect report, not a feature request
- **Type**: improvement

## Idea (as captured)

> ortbtools is an OpenRTB inspector. People paste ad-feed URLs into it. Of fifteen ways to
> paste one working URL, one worked. Three were worse than a rejection: accepted, value
> silently damaged, nothing said.

The intake widened once measured. The pasted-URL problem turned out to be one instance of a
class: the tool computes an honest answer and then discards it before anyone sees it. The same
shape was then found in four other places, including two introduced by this work itself.

## Initial framing questions

- Where is the boundary between normalising an input and inventing one?
- Which defects are destroyed by the act of parsing, and therefore invisible to every rule that
  reads a parsed object?
- Is the product's advantage breadth across ad-tech surfaces, or depth on a single transaction?
