'use strict';

/**
 * Dialect overlay tests. Covers:
 *   - listDialects() — public registry
 *   - Ext-RTB (existing) — bsection/btags shape, push detection,
 *     macro support warnings on response
 *   - In-Page Push (new) — claimsBid suppression of the IAB
 *     payload_missing rule + custom field validation
 *
 * The validation engine itself is tested separately via validator.test.js;
 * this file specifically asserts that:
 *   1. Switching dialect changes the finding set (not just the names)
 *   2. claimsBid correctly suppresses the IAB base check
 *   3. In-Page Push field aliases (image / image_url / picture, etc.) all
 *      satisfy the same requirement check
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validate, listDialects } = require('@kyivtech/spyglass-core');

// ── Registry ────────────────────────────────────────────────────────────

test('listDialects() — exposes iab + both vendor variants', () => {
  const list = listDialects();
  assert.ok(list.includes('iab'), 'iab dialect must be registered');
  assert.ok(list.includes('ext-rtb'), 'ext-rtb dialect must be registered');
  assert.ok(list.includes('inpage-push'), 'inpage-push must be registered');
});

// ── In-Page Push: claimsBid suppression ──────────────────────────────────

function inPagePushResponse(extOverrides) {
  return {
    id: 'req-001',
    seatbid: [
      {
        bid: [
          {
            id: 'b-1',
            impid: 'imp-1',
            price: 0.012,
            adomain: ['example.com'],
            ext: Object.assign(
              {
                title: 'Click here for the offer',
                image_url: 'https://cdn.example.com/hero.jpg',
                url: 'https://example.com/landing',
              },
              extOverrides || {},
            ),
          },
        ],
      },
    ],
  };
}

test('iab dialect — In-Page Push response triggers payload_missing (no adm/nurl)', () => {
  // Default IAB strict mode. Engine has no concept of bid.ext.title,
  // so it WARNs that adm/nurl are missing.
  const r = validate(inPagePushResponse(), { dialect: 'iab' });
  const ids = r.findings.map((f) => f.id);
  assert.ok(
    ids.includes('response.bid.payload_missing'),
    'IAB dialect should flag missing adm/nurl',
  );
});

test('inpage-push dialect — claimsBid suppresses payload_missing', () => {
  // Same payload, dialect switched → engine recognises the In-Page Push
  // shape via claimsBid() and skips the IAB payload check.
  const r = validate(inPagePushResponse(), { dialect: 'inpage-push' });
  const ids = r.findings.map((f) => f.id);
  assert.ok(
    !ids.includes('response.bid.payload_missing'),
    'In-Page Push dialect must suppress IAB payload_missing',
  );
});

test('inpage-push — well-formed bid produces no required-field findings', () => {
  const r = validate(inPagePushResponse(), { dialect: 'inpage-push' });
  const required = [
    'inpage-push.title_required',
    'inpage-push.image_required',
    'inpage-push.click_required',
  ];
  for (const id of required) {
    assert.ok(
      !r.findings.some((f) => f.id === id),
      `well-formed In-Page Push bid should not raise ${id}`,
    );
  }
});

// ── In-Page Push: required-field validation ──────────────────────────────

test('inpage-push — missing title → ERROR', () => {
  const payload = inPagePushResponse();
  delete payload.seatbid[0].bid[0].ext.title;
  const r = validate(payload, { dialect: 'inpage-push' });
  const f = r.findings.find((f) => f.id === 'inpage-push.title_required');
  assert.ok(f, 'title_required should fire');
  assert.equal(f.level, 'error');
});

test('inpage-push — missing image → ERROR', () => {
  const payload = inPagePushResponse();
  delete payload.seatbid[0].bid[0].ext.image_url;
  const r = validate(payload, { dialect: 'inpage-push' });
  const f = r.findings.find((f) => f.id === 'inpage-push.image_required');
  assert.ok(f, 'image_required should fire');
  assert.equal(f.level, 'error');
});

test('inpage-push — missing click URL → ERROR', () => {
  const payload = inPagePushResponse();
  delete payload.seatbid[0].bid[0].ext.url;
  const r = validate(payload, { dialect: 'inpage-push' });
  const f = r.findings.find((f) => f.id === 'inpage-push.click_required');
  assert.ok(f, 'click_required should fire');
  assert.equal(f.level, 'error');
});

test('inpage-push — non-http(s) image URL → image_invalid_url ERROR', () => {
  const r = validate(inPagePushResponse({ image_url: 'data:image/png;base64,iVBORw0KGgo' }), {
    dialect: 'inpage-push',
  });
  const f = r.findings.find((f) => f.id === 'inpage-push.image_invalid_url');
  assert.ok(f, 'image_invalid_url should fire on non-http(s) URL');
  assert.equal(f.level, 'error');
});

test('inpage-push — non-http(s) click URL → click_invalid_url ERROR', () => {
  const r = validate(inPagePushResponse({ url: 'javascript:alert(1)' }), {
    dialect: 'inpage-push',
  });
  const f = r.findings.find((f) => f.id === 'inpage-push.click_invalid_url');
  assert.ok(f, 'click_invalid_url should fire — javascript: scheme is a click-jacking primer');
  assert.equal(f.level, 'error');
});

// ── In-Page Push: field aliases ──────────────────────────────────────────

test('inpage-push — accepts `text` alias for title', () => {
  const payload = inPagePushResponse();
  delete payload.seatbid[0].bid[0].ext.title;
  payload.seatbid[0].bid[0].ext.text = 'Alternate title';
  const r = validate(payload, { dialect: 'inpage-push' });
  assert.ok(!r.findings.some((f) => f.id === 'inpage-push.title_required'));
});

test('inpage-push — accepts `picture` and `image` aliases', () => {
  for (const alias of ['picture', 'image']) {
    const payload = inPagePushResponse();
    delete payload.seatbid[0].bid[0].ext.image_url;
    payload.seatbid[0].bid[0].ext[alias] = 'https://cdn.example.com/hero.jpg';
    const r = validate(payload, { dialect: 'inpage-push' });
    assert.ok(
      !r.findings.some((f) => f.id === 'inpage-push.image_required'),
      `alias '${alias}' should satisfy image requirement`,
    );
  }
});

test('inpage-push — accepts click/click_url/href/link aliases', () => {
  for (const alias of ['click', 'click_url', 'href', 'link']) {
    const payload = inPagePushResponse();
    delete payload.seatbid[0].bid[0].ext.url;
    payload.seatbid[0].bid[0].ext[alias] = 'https://example.com/landing';
    const r = validate(payload, { dialect: 'inpage-push' });
    assert.ok(
      !r.findings.some((f) => f.id === 'inpage-push.click_required'),
      `alias '${alias}' should satisfy click-URL requirement`,
    );
  }
});

// ── Length-limit warnings ──────────────────────────────────────────────

test('inpage-push — over-length title → WARNING with len/max params', () => {
  const longTitle = 'x'.repeat(120);
  const r = validate(inPagePushResponse({ title: longTitle }), {
    dialect: 'inpage-push',
  });
  const f = r.findings.find((f) => f.id === 'inpage-push.title_too_long');
  assert.ok(f, 'title_too_long should fire above 90 chars');
  assert.equal(f.level, 'warning');
  assert.equal(f.params.len, 120);
  assert.equal(f.params.max, 90);
});

// ── Ext-RTB (existing dialect) — sanity baseline ─────────────────────────

test('ext-rtb dialect — push-traffic detection on imp.ext.subage', () => {
  const req = {
    id: 'req-x',
    imp: [
      {
        id: 'imp-1',
        banner: { w: 300, h: 250 },
        ext: { subage: 7 },
      },
    ],
    site: { domain: 'example.com' },
    at: 1,
    device: { ua: 'Mozilla/5.0', ip: '1.2.3.4' },
  };
  const r = validate(req, { dialect: 'ext-rtb' });
  assert.ok(
    r.findings.some((f) => f.id === 'extrtb.push_detected'),
    'ext-rtb dialect should detect push traffic via subage',
  );
});

test('ext-rtb dialect — In-Page Push payload still WARNs payload_missing', () => {
  // The plain 'ext-rtb' dialect doesn't know about In-Page Push —
  // only 'inpage-push' suppresses payload_missing. Asserting this
  // explicitly catches accidental cross-dialect leaking via a shared
  // claimsBid.
  const r = validate(inPagePushResponse(), { dialect: 'ext-rtb' });
  assert.ok(
    r.findings.some((f) => f.id === 'response.bid.payload_missing'),
    'plain ext-rtb dialect must NOT suppress payload_missing — that is In-Page Push only',
  );
});
