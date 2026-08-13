# Static VAST timeline extractor

Dependency-free, deterministic VAST XML parsing for Node and classic browser scripts. The module returns data only: it does not validate against IAB rules, emit findings, render markup, or resolve Wrapper URLs.

```js
const { parseVastTimeline } = require('./packages/core/vast-timeline');

const result = parseVastTimeline(xml);
```

Successful results contain `version`, an XML-ordered `ads` list, and a deterministic `timeline`. Each Ad distinguishes `inline`, `wrapper`, or structurally incomplete `unknown` content and includes:

- every `Impression` occurrence, including duplicates;
- tracking URLs grouped by `event` and `offset`, without URL deduplication;
- `ClickThrough`, `ClickTracking`, and `CustomClick` entries;
- `MediaFile` URLs and their sorted XML attributes;
- a Wrapper `VASTAdTagURI` marked `{ unresolved: true }`;
- the first Linear duration and its parsed seconds, when valid.

Timeline entries cover `start`, `firstQuartile`, `midpoint`, `thirdQuartile`, `complete`, and `progress`. When a valid duration is present, entries are ordered chronologically; named events precede progress events at the same position. Ordering remains stable when offsets cannot be normalized.

Malformed XML, non-VAST input, and resource-limit failures return:

```js
{ ok: false, error: { message, offset } }
```

The parser rejects input longer than 1,000,000 UTF-16 code units and XML nested beyond 128 elements. It supports CDATA and predefined/numeric XML entities but rejects DTD declarations rather than expanding entities.

The browser branch publishes `globalThis.OrtbtoolsVastTimeline` and expects the existing detection helpers as `globalThis.OrtbtoolsFormatDetect`. This repository deliberately leaves browser wiring and mirroring to the integration layer.
