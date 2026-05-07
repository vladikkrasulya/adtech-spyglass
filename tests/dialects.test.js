'use strict';

/**
 * Dialect overlay tests. Covers:
 *   - listDialects() — public registry
 *   - Kadam RTB (existing) — bsection/btags shape, push detection,
 *     macro support warnings on response
 *   - Kadam In-Page Push (new) — claimsBid suppression of the IAB
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

test('listDialects() — exposes iab + both Kadam variants', () => {
  const list = listDialects();
  assert.ok(list.includes('iab'), 'iab dialect must be registered');
  assert.ok(list.includes('kadam'), 'kadam dialect must be registered');
  assert.ok(list.includes('kadam-inpage-push'), 'kadam-inpage-push must be registered');
});

// ── Kadam In-Page Push: claimsBid suppression ──────────────────────────

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

test('kadam-inpage-push dialect — claimsBid suppresses payload_missing', () => {
  // Same payload, dialect switched → engine recognises the In-Page Push
  // shape via claimsBid() and skips the IAB payload check.
  const r = validate(inPagePushResponse(), { dialect: 'kadam-inpage-push' });
  const ids = r.findings.map((f) => f.id);
  assert.ok(
    !ids.includes('response.bid.payload_missing'),
    'In-Page Push dialect must suppress IAB payload_missing',
  );
});

test('kadam-inpage-push — well-formed bid produces no required-field findings', () => {
  const r = validate(inPagePushResponse(), { dialect: 'kadam-inpage-push' });
  const required = [
    'kadam.inpage.title_required',
    'kadam.inpage.image_required',
    'kadam.inpage.click_required',
  ];
  for (const id of required) {
    assert.ok(
      !r.findings.some((f) => f.id === id),
      `well-formed In-Page Push bid should not raise ${id}`,
    );
  }
});

// ── Kadam In-Page Push: required-field validation ──────────────────────

test('kadam-inpage-push — missing title → ERROR', () => {
  const payload = inPagePushResponse();
  delete payload.seatbid[0].bid[0].ext.title;
  const r = validate(payload, { dialect: 'kadam-inpage-push' });
  const f = r.findings.find((f) => f.id === 'kadam.inpage.title_required');
  assert.ok(f, 'title_required should fire');
  assert.equal(f.level, 'error');
});

test('kadam-inpage-push — missing image → ERROR', () => {
  const payload = inPagePushResponse();
  delete payload.seatbid[0].bid[0].ext.image_url;
  const r = validate(payload, { dialect: 'kadam-inpage-push' });
  const f = r.findings.find((f) => f.id === 'kadam.inpage.image_required');
  assert.ok(f, 'image_required should fire');
  assert.equal(f.level, 'error');
});

test('kadam-inpage-push — missing click URL → ERROR', () => {
  const payload = inPagePushResponse();
  delete payload.seatbid[0].bid[0].ext.url;
  const r = validate(payload, { dialect: 'kadam-inpage-push' });
  const f = r.findings.find((f) => f.id === 'kadam.inpage.click_required');
  assert.ok(f, 'click_required should fire');
  assert.equal(f.level, 'error');
});

test('kadam-inpage-push — non-http(s) image URL → image_invalid_url ERROR', () => {
  const r = validate(inPagePushResponse({ image_url: 'data:image/png;base64,iVBORw0KGgo' }), {
    dialect: 'kadam-inpage-push',
  });
  const f = r.findings.find((f) => f.id === 'kadam.inpage.image_invalid_url');
  assert.ok(f, 'image_invalid_url should fire on non-http(s) URL');
  assert.equal(f.level, 'error');
});

test('kadam-inpage-push — non-http(s) click URL → click_invalid_url ERROR', () => {
  const r = validate(inPagePushResponse({ url: 'javascript:alert(1)' }), {
    dialect: 'kadam-inpage-push',
  });
  const f = r.findings.find((f) => f.id === 'kadam.inpage.click_invalid_url');
  assert.ok(f, 'click_invalid_url should fire — javascript: scheme is a click-jacking primer');
  assert.equal(f.level, 'error');
});

// ── Kadam In-Page Push: field aliases ──────────────────────────────────

test('kadam-inpage-push — accepts `text` alias for title', () => {
  const payload = inPagePushResponse();
  delete payload.seatbid[0].bid[0].ext.title;
  payload.seatbid[0].bid[0].ext.text = 'Alternate title';
  const r = validate(payload, { dialect: 'kadam-inpage-push' });
  assert.ok(!r.findings.some((f) => f.id === 'kadam.inpage.title_required'));
});

test('kadam-inpage-push — accepts `picture` and `image` aliases', () => {
  for (const alias of ['picture', 'image']) {
    const payload = inPagePushResponse();
    delete payload.seatbid[0].bid[0].ext.image_url;
    payload.seatbid[0].bid[0].ext[alias] = 'https://cdn.example.com/hero.jpg';
    const r = validate(payload, { dialect: 'kadam-inpage-push' });
    assert.ok(
      !r.findings.some((f) => f.id === 'kadam.inpage.image_required'),
      `alias '${alias}' should satisfy image requirement`,
    );
  }
});

test('kadam-inpage-push — accepts click/click_url/href/link aliases', () => {
  for (const alias of ['click', 'click_url', 'href', 'link']) {
    const payload = inPagePushResponse();
    delete payload.seatbid[0].bid[0].ext.url;
    payload.seatbid[0].bid[0].ext[alias] = 'https://example.com/landing';
    const r = validate(payload, { dialect: 'kadam-inpage-push' });
    assert.ok(
      !r.findings.some((f) => f.id === 'kadam.inpage.click_required'),
      `alias '${alias}' should satisfy click-URL requirement`,
    );
  }
});

// ── Length-limit warnings ──────────────────────────────────────────────

test('kadam-inpage-push — over-length title → WARNING with len/max params', () => {
  const longTitle = 'x'.repeat(120);
  const r = validate(inPagePushResponse({ title: longTitle }), {
    dialect: 'kadam-inpage-push',
  });
  const f = r.findings.find((f) => f.id === 'kadam.inpage.title_too_long');
  assert.ok(f, 'title_too_long should fire above 90 chars');
  assert.equal(f.level, 'warning');
  assert.equal(f.params.len, 120);
  assert.equal(f.params.max, 90);
});

// ── Kadam RTB (existing dialect) — sanity baseline ─────────────────────

test('kadam dialect — push-traffic detection on imp.ext.subage', () => {
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
  const r = validate(req, { dialect: 'kadam' });
  assert.ok(
    r.findings.some((f) => f.id === 'kadam.push_detected'),
    'kadam dialect should detect push traffic via subage',
  );
});

test('kadam dialect — In-Page Push payload still WARNs payload_missing', () => {
  // The plain 'kadam' (RTB) dialect doesn't know about In-Page Push —
  // only 'kadam-inpage-push' suppresses payload_missing. Asserting this
  // explicitly catches accidental cross-dialect leaking via a shared
  // claimsBid.
  const r = validate(inPagePushResponse(), { dialect: 'kadam' });
  assert.ok(
    r.findings.some((f) => f.id === 'response.bid.payload_missing'),
    'plain kadam dialect must NOT suppress payload_missing — that is In-Page Push only',
  );
});
