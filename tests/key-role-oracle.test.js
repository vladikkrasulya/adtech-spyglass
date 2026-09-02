'use strict';

/**
 * The frozen 14-scenario regression oracle and the claim-aware ceiling pair
 * (016 §Frozen 14-scenario regression oracle, §Claim-aware model-ceiling
 * oracle). Exact roles, labels, valueStatus, exact confidences, routes.
 *
 * Staged rows: `format=12` resolves at 0.40 only through the CORPUS
 * adjudication (its named rule is a cap, which establishes nothing) — until
 * the adjudication manifest lands (T008), that row's deterministic answer
 * is `model`, and this suite asserts the staged expectation explicitly
 * rather than skipping.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { classifySignal } = require('../packages/core/dialects/signal-lexicon');
const { lookupKeyRole } = require('../packages/core/dialects/key-role-alphabet');
const { combine } = require('../packages/core/dialects/resolve-precedence');

const replica = require('./fixtures/kadam-replica.json');

const ADJ_PRESENT = fs.existsSync(
  path.join(
    __dirname,
    '..',
    'packages',
    'core',
    'dialects',
    'data',
    'key-role-adjudication.v1.json',
  ),
);

/** @returns {any} */
function resolve(signalPath, signalValue, imp) {
  const legacy = classifySignal({
    signalPath: signalPath.replace('imp[].', 'imp[0].'),
    signalValue,
    imp,
    locale: 'en',
  });
  const role = /** @type {any} */ (lookupKeyRole({ signalPath, signalValue, locale: 'en' }));
  return combine({ savedMapping: null, legacy, role });
}

/** Assert one resolved oracle row exactly. */
function expectResolved(r, { role, label, valueStatus, confidence }) {
  assert.equal(r.outcome, 'resolved');
  assert.equal(r.route, 'role-resolved');
  assert.equal(r.answer.role, role);
  assert.equal(r.answer.label, label);
  assert.equal(r.answer.valueStatus, valueStatus);
  assert.equal(r.answer.roleConfidence, confidence);
  assert.equal(r.answer.confidence, confidence, 'compat field equals roleConfidence');
}

const BANNER = { banner: { w: 300, h: 250 } };
const VIDEO = { video: { w: 640, h: 480, mimes: ['video/mp4'] } };
const POPSHAPE = { banner: { w: 1, h: 1 }, bidfloor: 0.0002 };

test('oracle 1+4: adtype=8 resolves format-declaration @ 0.90 in banner AND pop-shape contexts', () => {
  for (const imp of [BANNER, POPSHAPE]) {
    const r = resolve('imp[].ext.adtype', 8, imp);
    expectResolved(r, {
      role: 'format-declaration',
      label: 'custom',
      valueStatus: 'unknown',
      confidence: 0.9,
    });
  }
});

test('oracle 2: ad_type=70 in video context → format-declaration @ 0.90, no model', () => {
  expectResolved(resolve('imp[].ext.ad_type', 70, VIDEO), {
    role: 'format-declaration',
    label: 'custom',
    valueStatus: 'unknown',
    confidence: 0.9,
  });
});

test('oracle 3: format=12 → resolved @ 0.40 via corpus adjudication; staged to model until T008', () => {
  const r = resolve('imp[].ext.format', 12, BANNER);
  if (ADJ_PRESENT) {
    expectResolved(r, {
      role: 'format-declaration',
      label: 'custom',
      valueStatus: 'unknown',
      confidence: 0.4,
    });
  } else {
    // The named rule is a cap and establishes nothing on its own — the
    // honest pre-adjudication behaviour is the model route.
    assert.equal(r.route, 'model');
  }
});

test('oracle 5+6: limit=1 and flag=1 → deterministic ambiguity, no confidence, no label, no model', () => {
  const limit = resolve('imp[].ext.limit', 1, VIDEO);
  assert.equal(limit.outcome, 'ambiguous');
  assert.deepEqual([...limit.answer.roleCandidates].sort(), [
    'delivery-control',
    'format-declaration',
    'pricing',
  ]);
  const flag = resolve('imp[].ext.flag', 1, BANNER);
  assert.equal(flag.outcome, 'ambiguous');
  assert.deepEqual([...flag.answer.roleCandidates].sort(), [
    'delivery-control',
    'format-declaration',
  ]);
  for (const r of [limit, flag]) {
    assert.ok(!('label' in r.answer));
    assert.ok(!('confidence' in r.answer));
  }
});

test('oracle 7+12: mode=2 and t=1 abstain by named rule and route to the model', () => {
  for (const [key, value] of [
    ['mode', 2],
    ['t', 1],
  ]) {
    const r = resolve(`imp[].ext.${key}`, value, BANNER);
    assert.equal(r.route, 'model', String(key));
  }
});

test('oracle 8: imp_count=3 → measurement @ 0.70, projected to itself', () => {
  expectResolved(resolve('imp[].ext.imp_count', 3, BANNER), {
    role: 'measurement',
    label: 'measurement',
    valueStatus: 'not-applicable',
    confidence: 0.7,
  });
});

test('oracle 9: creative_type=3 → format-declaration @ 0.70', () => {
  expectResolved(resolve('imp[].ext.creative_type', 3, { banner: { w: 300, h: 600 } }), {
    role: 'format-declaration',
    label: 'custom',
    valueStatus: 'unknown',
    confidence: 0.7,
  });
});

test('oracle 10: ttl=300 → delivery-control @ 0.70', () => {
  expectResolved(resolve('imp[].ext.ttl', 300, { banner: { w: 728, h: 90 } }), {
    role: 'delivery-control',
    label: 'delivery-control',
    valueStatus: 'not-applicable',
    confidence: 0.7,
  });
});

test('oracle 11: digit-only build="20260812" → metadata @ 0.70; a non-digit build abstains', () => {
  expectResolved(resolve('imp[].ext.build', '20260812', { banner: { w: 320, h: 50 } }), {
    role: 'metadata',
    label: 'metadata',
    valueStatus: 'not-applicable',
    confidence: 0.7,
  });
  // The condition is load-bearing: rc-style builds do not match digit-only.
  const rc = resolve('imp[].ext.build', '2026.8-rc1', { banner: { w: 320, h: 50 } });
  assert.notEqual(rc.route, 'role-resolved');
});

test('oracle 13+14: the live replicas resolve exactly as frozen', () => {
  for (const fx of [replica.adTypeReplica, replica.subageReplica]) {
    const r = resolve(fx.signalPath.replace('imp[0].', 'imp[].'), fx.signalValue, fx.imp);
    expectResolved(r, {
      role: fx.expected.role,
      label: fx.expected.label,
      valueStatus: fx.expected.valueStatus,
      confidence: fx.expected.roleConfidence,
    });
  }
});

// ── The claim-aware ceiling pair (FR-008) ────────────────────────────────

test('ceiling pair: publisher_account_ref is a verified negative control and routes to the model', () => {
  const corpus = require('../packages/core/dialects/data/key-role-corpus.v1.json');
  const named = require('../packages/core/dialects/data/key-role-named-rules.v1.json');
  assert.ok(!corpus.entries.some((e) => e.name === 'publisher_account_ref'));
  assert.ok(!named.rules.some((r) => r.key === 'publisher_account_ref'));
  for (const value of [42, 'acct-42']) {
    const r = resolve('imp[].ext.publisher_account_ref', value, BANNER);
    assert.equal(r.route, 'model', JSON.stringify(value));
  }
});

test('ceiling pair: no post-processing clamps a role-only model answer for a numeric value', () => {
  // FR-008: a blanket `numeric => confidence <= 0.30` rule anywhere in the
  // chain is non-conforming. The handler's model path must accept
  // `identifier @ 0.70` unchanged; assert no clamp exists in the sources
  // that post-process model output.
  const fs2 = require('node:fs');
  for (const file of ['modules/ai-label/handler.js', 'lib/ollama.js']) {
    const src = fs2.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(
      src,
      /isNumericCode[\s\S]{0,200}confidence\s*=\s*Math\.min|confidence\s*=\s*Math\.min\([^)]*0\.3/,
      `${file} must not clamp confidence for numeric values`,
    );
  }
});

// ── Determinism procedure (SC-002) ───────────────────────────────────────

test('equal inputs return identical exact scores across locales', () => {
  for (const locale of ['en', 'uk', 'ru']) {
    const role = /** @type {any} */ (
      lookupKeyRole({ signalPath: 'imp[].ext.ad_type', signalValue: 30, locale })
    );
    assert.equal(role.state, 'resolved');
    assert.equal(role.score, 0.9, locale);
    assert.equal(role.role, 'format-declaration', locale);
  }
});
