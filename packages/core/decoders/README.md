# Feed-response decoders

DSP feed responses come in many shapes — XML and JSON, snake_case and
CamelCase, `<link>` and `<listing>` and `{Response:[…]}` — but they all
carry the same conceptual payload: a list of ad items, each with a bid,
a click URL, and assorted optional fields (title, image, pixel, icon).

This folder houses **decoders** — one per variant — that normalize
each specific shape into the canonical form defined in `_canonical.js`.
Validators (`packages/core/rules/`) then operate on the canonical form,
so one validator covers every variant.

## Pipeline

```
USER PASTES response (text)
        │
        ▼
detect.js   →  type = JSON_FEED_RESPONSE (or future variants)
        │
        ▼
decoders/index.js .decode(payload)
        │
        ├─→ sniff XML vs JSON
        ├─→ parse once (provided to every decoder)
        ├─→ walk DECODERS, first .detect() that claims wins
        └─→ that decoder's .decode() → canonical
        │
        ▼
rules/adkernel-feed-response/  →  findings on canonical
        │
        ▼
existing finalize() (dedup, sort, decorate)
```

## Decoder contract

Drop a folder under `decoders/<variant>/`, write `index.js`:

```js
'use strict';

const { makeCanonical, makeItem, decoderError } = require('../_canonical');

module.exports = {
  id: 'adkernel-pop-xml',
  description: 'Adkernel-family pop response: <result><link bid url pixel/></result>.',
  rawFormat: 'xml',

  /**
   * Quick structural check. Must be cheap and side-effect free.
   * Returns true if this decoder claims the payload.
   *
   * @param {string} payload   Raw text.
   * @param {Object} parsed    Pre-parsed shape (XML walker output or JSON).
   */
  detect(payload, parsed) {
    return (
      parsed &&
      parsed.root === 'result' &&
      Array.isArray(parsed.children) &&
      parsed.children.some((c) => c.tag === 'link')
    );
  },

  /**
   * Full normalize. Returns either a canonical response or
   * decoderError() on structural problems.
   */
  decode(payload, parsed) {
    const out = makeCanonical('adkernel-pop-xml', 'xml');
    for (const c of parsed.children) {
      if (c.tag !== 'link') continue;
      try {
        out.items.push(
          makeItem({
            bid: c.attrs.bid,
            clickUrl: c.attrs.url,
            impressionUrl: c.attrs.pixel,
            _raw: c.attrs,
          }),
        );
      } catch (e) {
        return decoderError('item_malformed', e.message);
      }
    }
    return out;
  },
};
```

Then register in `decoders/index.js` by adding to the `DECODERS` array.
Order matters: first `detect()` that returns true wins, so put more
specific decoders before more permissive ones.

## Canonical shape

See `_canonical.js` for the full JSDoc. Summary:

```js
{
  variant: 'adkernel-pop-xml',
  items: [
    {
      bid: 0.0123,           // float, parsed (required)
      clickUrl: '…',         // required
      impressionUrl: '…',    // optional
      title?, description?, site?,
      image?, icon?, badge?,
      _raw: { … },           // original variant-specific fields
    }
  ],
  generationTimeMs?: 180,
  error?: '',
  meta: {
    rawFormat: 'xml' | 'json',
    detectedVariant: '…',
  }
}
```

The validator plugin in `rules/adkernel-feed-response/` produces
findings against this shape (missing bid, non-https clickUrl, etc.).
Findings use stable IDs prefixed with `feed.*` — variant detail is
in the finding's `params` if needed for UX.

## Adding a new decoder — checklist

1. Create `decoders/<variant>/index.js` matching the contract.
2. Create `decoders/<variant>/README.md` documenting:
   - Where the shape comes from (link to public spec if available).
   - What's required vs optional in the wire shape.
   - Any non-trivial coercions in `decode()`.
3. Register in `decoders/index.js` (one line in DECODERS).
4. Add fixtures under `tests/fixtures/decoders/<variant>/` —
   **SYNTHETIC ONLY**. Never paste partner-supplied feed IDs, auth
   tokens, login credentials, or account-specific endpoints into
   fixtures. Use `feed=DEMO_FEED_ID`, `auth=DEMO_AUTH`, hostname
   `example.test` etc. See `feedback_never_expose_partner_names.md`
   in memory.
5. Write tests: detect-positive, detect-negative, decode-happy-path,
   decode-malformed-item, decode-empty-list.

## Privacy ground rules for decoders

Decoder code must NOT contain:

- Account-specific feed IDs (`feed=973435`, etc.).
- Auth tokens / API keys.
- Login credentials.
- Account-specific endpoint hostnames if those endpoints aren't on
  the partner's public docs.

Decoder code MAY contain:

- The structural shape (XML element names, JSON keys) — this is what
  makes the decoder work.
- Partner names IF the specific shape is documented on their public
  site. When unsure, use neutral terms (`adkernel-pop-xml` rather
  than naming the DSP).

Test fixtures must be synthetic. CI runs against fixtures, not real
partner data.
