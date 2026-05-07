'use strict';

/**
 * Discovery / Intelligence pure-helper tests.
 *
 * Storage (IndexedDB) and banner (DOM) pieces are browser-only and tested
 * manually for Phase 7a. The four pure modules below are covered here:
 *   - walker.extractFields   — path extraction, PII filter, depth cap
 *   - walker.bucketize       — display/inapp/push classification
 *   - fingerprint.fingerprintValue — shape descriptors
 *   - decay.applyDecay       — half-life math
 *   - gate.isLearnable       — security predicate
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractFields,
  bucketize,
  fingerprintValue,
  classifyString,
  applyDecay,
  isLearnable,
} = require('@kyivtech/spyglass-core/intel');

// ── walker.extractFields ──────────────────────────────────────────────

test('extractFields — empty payload yields empty list', () => {
  assert.deepEqual(extractFields(null), []);
  assert.deepEqual(extractFields(undefined), []);
  assert.deepEqual(extractFields({}), []);
});

test('extractFields — picks up req.imp[*].ext fields, collapses array index', () => {
  const payload = {
    imp: [
      { id: '1', ext: { subage: 7, kadam_macro: 'foo' } },
      { id: '2', ext: { subage: 14, kadam_macro: 'bar' } },
    ],
  };
  const fields = extractFields(payload);
  const paths = fields.map((f) => f.path).sort();
  // Path collapses imp[0].ext.* and imp[1].ext.* to imp.ext.* — duplicates
  // are expected because the walker emits per-occurrence; the observer
  // upserts on (bucket, path) key so they aggregate downstream.
  assert.ok(paths.includes('req.imp.ext.subage'));
  assert.ok(paths.includes('req.imp.ext.kadam_macro'));
  assert.equal(paths.filter((p) => p === 'req.imp.ext.subage').length, 2);
});

test('extractFields — never walks user.id, bid.id, ip — only ext subtrees', () => {
  const payload = {
    user: { id: 'pii-user-id-12345' },
    device: { ip: '1.2.3.4' },
    imp: [{ id: 'imp-1' }],
  };
  const fields = extractFields(payload);
  assert.equal(fields.length, 0, 'no ext objects → no fields');
});

test('extractFields — skips PII path components inside ext (consent/buyeruid/etc.)', () => {
  const payload = {
    user: {
      ext: {
        consent: 'CO00abc.def', // PII denylist
        buyeruid: 'pii-buyer-uid', // PII denylist
        gpp: 'GPP_SID_xyz', // PII denylist
        // legitimate ext field that should pass through
        kadam_segment: 'gaming',
      },
    },
  };
  const fields = extractFields(payload);
  const paths = fields.map((f) => f.path);
  assert.ok(!paths.some((p) => p.endsWith('.consent')), 'consent must be skipped');
  assert.ok(!paths.some((p) => p.endsWith('.buyeruid')), 'buyeruid must be skipped');
  assert.ok(!paths.some((p) => p.endsWith('.gpp')), 'gpp must be skipped');
  assert.ok(paths.includes('req.user.ext.kadam_segment'));
});

test('extractFields — skips fuzzy PII patterns (*_id, *_uid, *consent*)', () => {
  const payload = {
    ext: {
      click_id: 'pii',
      user_uid: 'pii',
      gdpr_consent_string: 'pii',
      legitimate_field: 'ok',
    },
  };
  const fields = extractFields(payload);
  const paths = fields.map((f) => f.path);
  assert.ok(!paths.some((p) => p.endsWith('.click_id')));
  assert.ok(!paths.some((p) => p.endsWith('.user_uid')));
  assert.ok(!paths.some((p) => p.endsWith('.gdpr_consent_string')));
  assert.ok(paths.includes('req.ext.legitimate_field'));
});

test('extractFields — long string values record only metadata, not content', () => {
  const longUrl = 'https://example.com/' + 'x'.repeat(500);
  const payload = { ext: { tracker: longUrl } };
  const fields = extractFields(payload);
  const f = fields.find((x) => x.path === 'req.ext.tracker');
  assert.ok(f, 'field captured');
  assert.equal(f.valueShape.oversize, true);
  assert.equal(f.valueShape.len, longUrl.length);
  // Critically — the actual URL must NOT be in the shape. Stringify the
  // shape and look for content fragments.
  const serialized = JSON.stringify(f.valueShape);
  assert.ok(!serialized.includes('example.com'), 'URL value must not leak into shape');
});

test('extractFields — depth cap prevents infinite descent', () => {
  // Build a 10-deep nested ext object. The walker should stop at MAX_DEPTH=4.
  /** @type {any} */
  let nested = { leaf: 'x' };
  for (let i = 0; i < 10; i++) nested = { lvl: nested };
  const payload = { ext: nested };
  const fields = extractFields(payload);
  // Find max nesting in observed paths. With cap=4, the deepest leaf path
  // segment count below req.ext is 4 (req.ext.lvl.lvl.lvl.lvl…).
  const maxSegments = Math.max(0, ...fields.map((f) => f.path.split('.').length));
  assert.ok(maxSegments <= 6, `expected ≤6 segments (req.ext + 4 levels), got ${maxSegments}`);
});

test('extractFields — handles cyclic structures defensively', () => {
  const root = { ext: { a: 1 } };
  root.ext.self = root.ext;
  // Should not throw, should not loop forever.
  assert.doesNotThrow(() => extractFields(root));
});

test('extractFields — response-side bid.ext fields surface as res.bid.ext.*', () => {
  const payload = {
    seatbid: [
      {
        bid: [
          { id: '1', ext: { title: 'Click here', image_url: 'https://cdn.example.com/x.jpg' } },
        ],
      },
    ],
  };
  const fields = extractFields(payload);
  const paths = fields.map((f) => f.path);
  assert.ok(paths.includes('res.bid.ext.title'));
  assert.ok(paths.includes('res.bid.ext.image_url'));
});

// ── walker.bucketize ──────────────────────────────────────────────────

test('bucketize — push detected via imp.ext.subage', () => {
  const r = bucketize({ imp: [{ ext: { subage: 7 } }] });
  assert.equal(r, 'push');
});

test('bucketize — push detected via site.ext.idzone matching push pattern', () => {
  const r = bucketize({ site: { ext: { idzone: 'push-12345' } } });
  assert.equal(r, 'push');
});

test('bucketize — inapp detected via app.bundle', () => {
  const r = bucketize({ app: { bundle: 'com.example.app' } });
  assert.equal(r, 'inapp');
});

test('bucketize — display fallback for plain web traffic', () => {
  const r = bucketize({ site: { domain: 'example.com' }, imp: [{ id: '1' }] });
  assert.equal(r, 'display');
});

test('bucketize — unknown for non-object input', () => {
  assert.equal(bucketize(null), 'unknown');
  assert.equal(bucketize(42), 'unknown');
});

// ── fingerprint ───────────────────────────────────────────────────────

test('fingerprintValue — string captures len + charClass, not content', () => {
  const s = fingerprintValue('abc123XYZ');
  assert.equal(s.len, 9);
  assert.equal(s.charClass, 'alnum-mixed');
  // No way the actual chars appear in the shape.
  assert.ok(!Object.values(s).some((v) => typeof v === 'string' && v.includes('abc')));
});

test('classifyString — recognises canonical shapes', () => {
  assert.equal(classifyString('123'), 'digits');
  assert.equal(classifyString('https://example.com'), 'url');
  // Use chars OUTSIDE [a-fA-F] to test alnum classes — hex check is
  // intentionally tried first because it's the more informative cluster.
  assert.equal(classifyString('XYZ12345'), 'alnum-upper');
  assert.equal(classifyString('xyz12345'), 'alnum-lower');
  assert.equal(classifyString('0a1b2c3d'), 'hex'); // even-length hex
  assert.equal(classifyString('Hello, World!'), 'mixed');
  // Base64 requires at least one +/= to disambiguate from plain alnum.
  assert.equal(classifyString('SGVsbG8gV29ybGQ='), 'base64');
});

test('fingerprintValue — number captures integer/sign/magnitude bucket', () => {
  const a = fingerprintValue(42);
  assert.equal(a.integer, true);
  assert.equal(a.sign, 1);
  assert.equal(a.magnitude, 1); // log10(42) ≈ 1.6 → floor = 1

  const b = fingerprintValue(-0.005);
  assert.equal(b.integer, false);
  assert.equal(b.sign, -1);
  assert.equal(b.magnitude, -3); // log10(0.005) ≈ -2.3 → floor = -3
});

test('fingerprintValue — array captures length + unique elem types', () => {
  const a = fingerprintValue([1, 2, 'x', null]);
  assert.equal(a.length, 4);
  assert.deepEqual(a.elemTypes, ['null', 'number', 'string'].sort());
});

test('fingerprintValue — object caps key list at 10', () => {
  const big = {};
  for (let i = 0; i < 30; i++) big['k' + i] = 1;
  const f = fingerprintValue(big);
  assert.equal(f.keyCount, 30);
  assert.equal(f.keys.length, 10);
});

test('fingerprintValue — null returns null marker', () => {
  assert.equal(fingerprintValue(null), null);
  assert.equal(fingerprintValue(undefined), null);
});

// ── decay ─────────────────────────────────────────────────────────────

test('applyDecay — half-life 24h means 50% after 1 day', () => {
  const now = 1_700_000_000_000;
  const lastSeen = now - 24 * 3600 * 1000; // 24h ago
  const out = applyDecay(100, lastSeen, now);
  assert.ok(Math.abs(out - 50) < 0.001, `expected ~50, got ${out}`);
});

test('applyDecay — 7 days at 24h half-life → ~0.78', () => {
  const now = 1_700_000_000_000;
  const lastSeen = now - 7 * 24 * 3600 * 1000;
  const out = applyDecay(100, lastSeen, now);
  // 100 * 0.5^7 = 100 / 128 = 0.78125
  assert.ok(Math.abs(out - 0.78125) < 0.001);
});

test('applyDecay — no time elapsed → unchanged', () => {
  const now = 1_700_000_000_000;
  assert.equal(applyDecay(100, now, now), 100);
});

test('applyDecay — clock-skew (lastSeen in future) leaves score unchanged', () => {
  const now = 1_700_000_000_000;
  const future = now + 60 * 1000;
  assert.equal(applyDecay(100, future, now), 100);
});

test('applyDecay — never-seen (lastSeen=0) returns prev unchanged', () => {
  assert.equal(applyDecay(50, 0, Date.now()), 50);
});

test('applyDecay — non-finite / negative scores collapse to 0', () => {
  assert.equal(applyDecay(0, Date.now() - 3600000, Date.now()), 0);
  assert.equal(applyDecay(-5, Date.now() - 3600000, Date.now()), 0);
  assert.equal(applyDecay(NaN, Date.now() - 3600000, Date.now()), 0);
});

test('applyDecay — beyond max half-lives collapses to 0', () => {
  const now = 1_700_000_000_000;
  // 100 days at 24h half-life = 100 half-lives → way past floor.
  const lastSeen = now - 100 * 24 * 3600 * 1000;
  assert.equal(applyDecay(100, lastSeen, now), 0);
});

// ── gate ──────────────────────────────────────────────────────────────

test('isLearnable — clean validation passes', () => {
  const r = isLearnable({ status: 'clean' });
  assert.equal(r.allow, true);
});

test('isLearnable — warnings status passes (warnings are not malware)', () => {
  const r = isLearnable({ status: 'warnings' });
  assert.equal(r.allow, true);
});

test('isLearnable — errors status blocks', () => {
  const r = isLearnable({ status: 'errors' });
  assert.equal(r.allow, false);
  assert.match(r.reason, /errors/);
});

test('isLearnable — invalid status blocks', () => {
  const r = isLearnable({ status: 'invalid' });
  assert.equal(r.allow, false);
});

test('isLearnable — null validation blocks', () => {
  const r = isLearnable(null);
  assert.equal(r.allow, false);
});

test('isLearnable — behavior.malicious.* finding blocks even with clean validation', () => {
  const r = isLearnable({ status: 'clean' }, [
    { id: 'behavior.malicious.frame_bust_anchor', level: 'error' },
  ]);
  assert.equal(r.allow, false);
  assert.match(r.reason, /behavior-malicious/);
});

test('isLearnable — behavior.static.* WARNING does NOT block (only ERRORs do)', () => {
  // High-entropy WARNING is informational, not categorical malware.
  const r = isLearnable({ status: 'clean' }, [
    { id: 'behavior.static.high_entropy_blob', level: 'warning' },
  ]);
  assert.equal(r.allow, true);
});

test('isLearnable — behavior.static.* ERROR blocks (obfuscation/miner/XSS)', () => {
  const r = isLearnable({ status: 'clean' }, [
    { id: 'behavior.static.miner_signature', level: 'error' },
  ]);
  assert.equal(r.allow, false);
  assert.match(r.reason, /static-error/);
});
