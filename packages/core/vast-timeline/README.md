# Static VAST timeline extractor

Dependency-free, deterministic VAST XML parsing for Node and classic browser scripts. The module returns data only: it does not validate against IAB rules, emit findings, render markup, or resolve Wrapper URLs.

```js
const {
  parseVastTimeline,
  VAST_DIAGNOSTICS,
  MAX_DOCUMENT_LENGTH,
  MAX_XML_DEPTH,
} = require('./packages/core/vast-timeline');

const result = parseVastTimeline(xml);
```

Successful results contain `version`, an XML-ordered `ads` list, a deterministic `timeline`, and `notes`. Notes explain only why an extractor-owned field is empty or degenerate: missing version metadata, no supported timeline events, an unparseable duration, an unknown Ad branch, or a timeline without absolute times. They do not validate VAST conformance. Each Ad distinguishes `inline`, `wrapper`, or structurally incomplete `unknown` content and includes:

- every `Impression` occurrence, including duplicates;
- tracking URLs grouped by `event` and `offset`, without URL deduplication;
- `ClickThrough`, `ClickTracking`, and `CustomClick` entries;
- `MediaFile` URLs and their sorted XML attributes;
- a Wrapper `VASTAdTagURI` marked `{ unresolved: true }`;
- the first Linear duration and its parsed seconds, when valid.

Timeline entries cover `start`, `firstQuartile`, `midpoint`, `thirdQuartile`, `complete`, and `progress`. When a valid duration is present, entries are ordered chronologically; named events precede progress events at the same position. Ordering remains stable when offsets cannot be normalized.

Malformed XML, non-VAST input, and resource-limit failures return:

```js
{
  ok: false,
  error: {
    code,
    message,
    expected,
    spec,
    offset,
    line,
    column,
    excerpt,
  },
}
```

`message` and zero-based `offset` remain backward-compatible. `line` and `column` are one-based; `excerpt` is a bounded local fragment with a caret, never a copy of the document. `code` is stable and maps to the deeply frozen `VAST_DIAGNOSTICS` catalog, whose English explanation is the UI fallback and whose official `spec` URL supports further reading. Notes use the same catalog codes but expose only `{ code, message, spec }`.

The parser rejects input longer than `MAX_DOCUMENT_LENGTH` (1,000,000 UTF-16 code units) and XML nested beyond `MAX_XML_DEPTH` (128 elements). It supports CDATA and predefined/numeric XML entities but rejects DTD declarations rather than expanding entities. Bare ampersands, unterminated entity references, and unknown entity names have separate diagnostics so malformed tracking URLs are actionable.

The browser branch publishes `globalThis.OrtbtoolsVastTimeline` and expects the existing detection helpers as `globalThis.OrtbtoolsFormatDetect`. This repository deliberately leaves browser wiring and mirroring to the integration layer.
