'use strict';

/**
 * Every row of the FR-001 precedence matrix (016 §Resolver precedence),
 * asserted through the real classify → lookup → combine chain wherever the
 * committed manifests can drive it, and through synthetic layer states for
 * the rows slice A's data cannot yet reach.
 */

const test = require('node:test');
const assert = require('node:assert');

const { classifySignal } = require('../packages/core/dialects/signal-lexicon');
const { lookupKeyRole } = require('../packages/core/dialects/key-role-alphabet');
const { combine: combineTyped } = require('../packages/core/dialects/resolve-precedence');
/** @param {any} input @returns {any} */
const combine = (input) => combineTyped(input);

/** Run the full deterministic chain the way the handler will.
 * @returns {any} */
function resolve(signalPath, signalValue, imp, savedMapping = null) {
  const legacyPath = signalPath.replace('imp[].', 'imp[0].');
  const legacy = classifySignal({ signalPath: legacyPath, signalValue, imp, locale: 'en' });
  const role = /** @type {any} */ (lookupKeyRole({ signalPath, signalValue, locale: 'en' }));
  return combine({ savedMapping, legacy, role });
}

// ── Row 1: saved mapping outranks everything ─────────────────────────────

test('an exact saved mapping wins over every layer state, without a numeric confidence', () => {
  const r = resolve(
    'imp[].ext.ad_type',
    30,
    { banner: { w: 300, h: 250 } },
    {
      semantic_label: 'ignore',
      notes: 'operator note',
    },
  );
  assert.equal(r.outcome, 'saved');
  assert.equal(r.answer.label, 'ignore');
  assert.equal(r.answer.source, 'saved-mapping');
  assert.equal(r.answer.notes, 'operator note');
  assert.ok(!('confidence' in r.answer), 'saved-mapping answers carry no score');
});

// ── Row 2: terminal flags stay terminal ──────────────────────────────────

test('popunder=1 stays a terminal pop verdict whatever the role layer says', () => {
  const r = resolve('imp[].ext.popunder', 1, null);
  assert.equal(r.outcome, 'legacy');
  assert.equal(r.route, 'exact-format');
  assert.equal(r.answer.label, 'pop');
  assert.equal(r.answer.source, 'lexicon');
});

test('sizeID=[0] and allowShock stay terminal shape verdicts', () => {
  for (const [key, value] of [
    ['sizeID', [0]],
    ['allowShock', 1],
  ]) {
    const r = resolve(`imp[].ext.${key}`, value, { banner: { w: 1, h: 1 } });
    assert.equal(r.outcome, 'legacy', String(key));
    assert.equal(r.answer.label, 'pop', String(key));
  }
});

// ── Rows 3–4: specific-format string verdicts ────────────────────────────

test('a corroborated format word is preserved on BOTH halves of the row', () => {
  // Half 1 — role layer resolves format-declaration: `adtype` is a named
  // format-declaration rule, the string verdict still wins.
  const viaFmt = resolve('imp[].ext.adtype', 'preroll_video', { video: { w: 640, h: 480 } });
  assert.equal(viaFmt.outcome, 'legacy');
  assert.equal(viaFmt.answer.label, 'video');
  // Half 2 — role layer abstains: `slottype` is format-declaring for the
  // legacy lexicon but has no named rule and no adjudicated role.
  const viaAbstain = resolve('imp[].ext.slottype', 'preroll_video', { video: { w: 640, h: 480 } });
  assert.equal(viaAbstain.outcome, 'legacy');
  assert.equal(viaAbstain.route, 'exact-format');
  assert.equal(viaAbstain.answer.label, 'video');
});

test('a corroborated format word meeting the now-ambiguous `type` becomes deterministic ambiguity', () => {
  // Post-adjudication, `type` is ambiguous [delivery-control,
  // format-declaration] — the matrix row for specific-format + ambiguous.
  const r = resolve('imp[].ext.type', 'preroll_video', { video: { w: 640, h: 480 } });
  assert.equal(r.outcome, 'ambiguous');
  assert.ok(!('label' in r.answer));
});

test('a specific-format verdict meeting a resolved NON-format role becomes deterministic ambiguity', () => {
  // Synthetic layer states: the committed slice-A data cannot produce this
  // pair yet, but the row must hold when adjudication lands.
  const r = combine({
    savedMapping: null,
    legacy: {
      kind: 'specific-format',
      suggestion: { label: 'video', confidence: 0.95, source: 'lexicon', evidence: [] },
    },
    role: {
      state: 'resolved',
      role: 'identifier',
      score: 0.8,
      reason: 'x',
      evidence: [],
    },
  });
  assert.equal(r.outcome, 'ambiguous');
  assert.ok(r.answer.roleCandidates.includes('format-declaration'));
  assert.ok(r.answer.roleCandidates.includes('identifier'));
  assert.ok(!('label' in r.answer), 'no preselected label on ambiguity');
  assert.ok(!('confidence' in r.answer), 'no singular confidence on ambiguity');
});

// ── Rows 5–7: guarded contradictions ─────────────────────────────────────

test('guarded contradiction + resolved format-declaration → role answer with the conflict surfaced', () => {
  const r = combine({
    savedMapping: null,
    legacy: { kind: 'guarded-contradiction', suggestion: null },
    role: {
      state: 'resolved',
      role: 'format-declaration',
      score: 0.9,
      reason: 'x',
      evidence: [],
    },
  });
  assert.equal(r.outcome, 'resolved');
  assert.equal(r.answer.label, 'custom');
  assert.equal(r.answer.valueStatus, 'unknown');
  assert.equal(r.answer.roleConfidence, 0.9, 'conflict never raises or lowers role confidence');
  assert.ok(r.answer.conflict, 'the conflict is surfaced');
});

test('guarded contradiction + role abstain → the current model fallback is preserved', () => {
  // Real chain: video_slider on a banner-only imp via `slottype`, which is
  // format-declaring for the lexicon but role-abstaining (no named rule, no
  // adjudicated role). `type` itself is now role-ambiguous and takes the
  // deterministic-ambiguity row instead — asserted separately below.
  const r = resolve('imp[].ext.slottype', 'video_slider', { banner: { w: 300, h: 250 } });
  assert.equal(r.outcome, 'model');
  assert.equal(r.answer, null);
});

test('guarded contradiction + role ambiguity → deterministic ambiguity, not the model', () => {
  const r = resolve('imp[].ext.type', 'video_slider', { banner: { w: 300, h: 250 } });
  assert.equal(r.outcome, 'ambiguous');
});

// ── Rows 8–10: broad heuristics ──────────────────────────────────────────

test('a resolved alphabet role supersedes a broad ignore/informational heuristic', () => {
  const r = combine({
    savedMapping: null,
    legacy: {
      kind: 'broad-heuristic',
      suggestion: { label: 'informational', confidence: 0.9, source: 'lexicon', evidence: [] },
    },
    role: { state: 'resolved', role: 'metadata', score: 0.7, reason: 'x', evidence: [] },
  });
  assert.equal(r.outcome, 'resolved');
  assert.equal(r.answer.label, 'metadata');
  assert.equal(r.answer.valueStatus, 'not-applicable');
});

test('NO DEMOTION: a role-layer abstain over a broad heuristic preserves the legacy answer', () => {
  // request_uuid resolves ignore today; the alphabet has no reviewed role
  // for it yet — the deterministic answer must survive, no model call.
  const r = resolve('imp[].ext.request_uuid', '7c1e-44a0', { banner: { w: 300, h: 250 } });
  assert.equal(r.outcome, 'legacy');
  assert.equal(r.route, 'preserved-legacy');
  assert.equal(r.answer.label, 'ignore');
});

// ── Rows 11–12: legacy abstains ──────────────────────────────────────────

test('legacy abstain + resolved role → the role layer answers; no model', () => {
  const r = resolve('imp[].ext.ad_type', 30, { banner: { w: 300, h: 250 } });
  assert.equal(r.outcome, 'resolved');
  assert.equal(r.route, 'role-resolved');
  assert.equal(r.answer.role, 'format-declaration');
  assert.equal(r.answer.label, 'custom');
  assert.equal(r.answer.roleConfidence, 0.9);
});

test('legacy abstain + role ambiguity → deterministic ambiguity; no model', () => {
  const r = resolve('imp[].ext.limit', 1, { video: { w: 640, h: 480 } });
  assert.equal(r.outcome, 'ambiguous');
  assert.ok(r.answer.roleCandidates.length >= 2);
});

test('everything abstains → the model is called, and only then', () => {
  const r = resolve('imp[].ext.publisher_account_ref', 42, { banner: { w: 300, h: 250 } });
  assert.equal(r.outcome, 'model');
  assert.equal(r.route, 'model');
});

// ── Exact-case identity at the layer boundary ────────────────────────────

test('an unlisted casing abstains and falls through to the model, never inheriting', () => {
  // `Ad_Type` is not a named rule and (verified in the corpus manifest) not
  // a corpus name; the exact-case layer must not inherit `ad_type`'s role.
  const r = resolve('imp[].ext.Ad_Type', 30, { banner: { w: 300, h: 250 } });
  assert.equal(r.outcome, 'model', 'no case-fold fallback in v1');
});
