# OpenRTB 2.5 → 2.6 migration advisor

Pure CommonJS rules that inspect a BidRequest and return a deterministic patch proposal. This module never applies operations, rewrites input JSON, accesses the DOM or network, or reads files.

## API

```js
const { adviseMigration25To26, MIGRATION_RULES } = require('./packages/core/migrate');

const operations = adviseMigration25To26(bidRequest);
```

There is intentionally no `apply` API. Applying all, some, or none of the proposed operations remains an explicit caller decision.

## Operation contract

Every operation is JSON-serializable and self-contained:

```js
{
  path: '/imp/0/rwdd',
  op: 'add',
  before: null,
  after: 1,
  rule: 'ortb26.imp.rwdd',
  spec: 'https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.6.md#324---object-imp',
  confidence: 'likely',
  rationale: 'Promote the legacy rewarded-video extension to the standardized 2.6 rwdd field.'
}
```

`path` uses RFC 6901 JSON Pointer syntax. `before: null` denotes absence for an `add`; `after: null` denotes absence for a `remove`. The advisor currently emits only `add` and `remove` operations.

Operations are sorted by pointer, then rule identifier and operation. Identical input therefore produces byte-identical JSON output. Running the advisor on a payload after its complete proposal has been applied returns an empty list.

## Rules

The bounded 2.5 → 2.6 rules cover:

- legacy `imp[].video.ext.rewarded` → `imp[].rwdd`
- `regs.ext.gdpr` → `regs.gdpr`
- `user.ext.consent` → `user.consent`
- legacy `source.ext.schain` → `source.schain`
- legacy `user.ext.eids` → `user.eids`
- removed `imp[].video.protocol` → `imp[].video.protocols`
- removed `site.content.videoquality` / `app.content.videoquality` → `prodq`
- an explicit `cattax` suggestion where 2.5 category arrays relied on the default: `cattax: 1` is `certain` only when every code matches the taxonomy 1.0 form (`IAB1`, `IAB2-3`); other or empty code sets are marked `review` and require manual confirmation

Rules are conservative. A legacy value is removed only when the standardized target is absent or already equal. Conflicting modern and legacy values produce no operation. Unknown extension keys, vendor fields, and even empty `ext` containers are never removed. Fields without an unambiguous 2.6 representation—such as flexible banner bounds, structured user-agent data, and pod metadata—are outside this rule set.
