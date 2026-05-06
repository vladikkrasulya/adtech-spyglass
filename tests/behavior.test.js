'use strict';

/**
 * Behavior engine tests. The probe (browser-side) does the runtime
 * geometry / opacity inspection; these tests treat the engine as a
 * pure function over its input shape — given a synthetic event stream,
 * does it produce the right finding set?
 *
 * Findings are asserted by stable `id` + structural params, not by msg
 * text — so future i18n edits don't break the suite.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { analyze } = require('@kyivtech/spyglass-core/behavior');

function probeReady() {
  return { type: 'spyglass-probe', v: 1, ts: Date.now(), kind: 'probe_ready' };
}

function invisibleOverlayClickEvent(opts) {
  const o = opts || {};
  return Object.assign(
    {
      type: 'spyglass-probe',
      v: 1,
      ts: Date.now(),
      kind: 'invisible_overlay_click',
      method: 'click',
      url: '',
      trigger: 'click',
      tagName: 'DIV',
      coverageRatio: 0.95,
      opacity: 0,
      bgAlpha: 0,
    },
    o,
  );
}

function centerSynthClickEvent(opts) {
  return Object.assign(
    {
      type: 'spyglass-probe',
      v: 1,
      ts: Date.now(),
      kind: 'center_synth_click',
      method: 'click',
      url: '',
      trigger: 'click',
      tagName: 'BUTTON',
      centerDistancePx: 0.12,
      isTrusted: false,
    },
    opts || {},
  );
}

function clickBurstEvent(opts) {
  return Object.assign(
    {
      type: 'spyglass-probe',
      v: 1,
      ts: Date.now(),
      kind: 'click_burst',
      method: 'click',
      url: '',
      trigger: 'click',
      clickCount: 4,
      windowMs: 200,
    },
    opts || {},
  );
}

function phantomClickEvent(opts) {
  return Object.assign(
    {
      type: 'spyglass-probe',
      v: 1,
      ts: Date.now(),
      kind: 'phantom_click',
      method: 'click',
      url: '',
      trigger: 'click',
      tagName: 'A',
      isTrusted: true,
    },
    opts || {},
  );
}

test('analyze() — empty event list yields clean status, no findings', () => {
  const r = analyze([]);
  assert.equal(r.status, 'clean');
  assert.deepEqual(r.findings, []);
  assert.equal(r.eventCount, 0);
});

test('analyze() — non-array input is treated as empty (defensive)', () => {
  // Stream-pivot replay code may pass undefined/null when archived
  // specimens predate the events column. Engine must not throw.
  assert.doesNotThrow(() => analyze(null));
  assert.doesNotThrow(() => analyze(undefined));
  assert.doesNotThrow(() => analyze({ not: 'an array' }));
  const r = analyze(null);
  assert.equal(r.status, 'clean');
  assert.equal(r.eventCount, 0);
});

test('analyze() — probe_ready alone is not user-visible', () => {
  const r = analyze([probeReady()]);
  assert.equal(r.eventCount, 0);
  assert.equal(r.findings.length, 0);
  assert.equal(r.status, 'clean');
});

test('analyze() — invisible_overlay_click → behavior.trap.invisible_overlay error', () => {
  const r = analyze([probeReady(), invisibleOverlayClickEvent()]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.trap.invisible_overlay');
  assert.equal(r.findings[0].level, 'error');
  assert.equal(r.status, 'errors');
  assert.equal(r.eventCount, 1, 'probe_ready excluded from user-visible count');
});

test('analyze() — finding params carry geometry for UI annotation', () => {
  const r = analyze([
    invisibleOverlayClickEvent({
      tagName: 'DIV',
      coverageRatio: 0.85,
      opacity: 0,
      bgAlpha: 0,
    }),
  ]);
  const f = r.findings[0];
  assert.equal(f.params.tagName, 'div', 'tagName lowercased for display');
  assert.equal(f.params.coverage, '85%', 'ratio rendered as percentage');
  assert.equal(typeof f.params.eventIndex, 'number');
});

test('analyze() — multiple traps produce one finding each, in event order', () => {
  const events = [
    probeReady(),
    invisibleOverlayClickEvent({ coverageRatio: 0.7 }),
    invisibleOverlayClickEvent({ coverageRatio: 0.95 }),
  ];
  const r = analyze(events);
  assert.equal(r.findings.length, 2);
  assert.equal(r.findings[0].params.coverage, '70%');
  assert.equal(r.findings[1].params.coverage, '95%');
});

test('analyze() — unrelated probe events are ignored by the rule', () => {
  // Other probe kinds (window.open, location_set, click_skim_suspect,
  // etc.) are valid events but shouldn't produce a trap finding — they
  // belong to other future rules.
  const events = [
    probeReady(),
    {
      type: 'spyglass-probe',
      kind: 'window_open',
      method: 'window.open',
      url: 'https://example.com',
      trigger: 'click',
    },
    {
      type: 'spyglass-probe',
      kind: 'click_skim_suspect',
      method: 'window.open',
      url: 'https://shady.example',
      trigger: 'mouseover',
    },
  ];
  const r = analyze(events);
  assert.equal(r.findings.length, 0);
  assert.equal(r.status, 'clean');
  assert.equal(r.eventCount, 2);
});

test('analyze() — findings carry decorated msg + specRef placeholders', () => {
  // Engine decorates findings the same way validate() does, so the
  // server route can pipe them straight through.
  const r = analyze([invisibleOverlayClickEvent()]);
  const f = r.findings[0];
  assert.equal(typeof f.msg, 'string');
  assert.notEqual(f.msg, '');
  assert.notEqual(f.msg, '[behavior.trap.invisible_overlay]');
  // specRef is null until we publish a public IVT taxonomy URL — present
  // as a key, just nullable.
  assert.ok('specRef' in f);
});

test('analyze() — locale resolution falls back gracefully', () => {
  const ru = analyze([invisibleOverlayClickEvent()], { locale: 'ru' });
  const uk = analyze([invisibleOverlayClickEvent()], { locale: 'uk' });
  const en = analyze([invisibleOverlayClickEvent()], { locale: 'en' });
  // Different locales produce different strings (or same fallback if a
  // translation is missing — but never the [id] placeholder).
  assert.notEqual(ru.findings[0].msg, '[behavior.trap.invisible_overlay]');
  assert.notEqual(uk.findings[0].msg, '[behavior.trap.invisible_overlay]');
  assert.notEqual(en.findings[0].msg, '[behavior.trap.invisible_overlay]');
});

// ── Phase 2 (bot-pattern) rules ─────────────────────────────────────────────

test('analyze() — center_synth_click → behavior.bot.center_synth error', () => {
  const r = analyze([centerSynthClickEvent({ centerDistancePx: 0.05 })]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.bot.center_synth');
  assert.equal(r.findings[0].level, 'error');
  assert.equal(r.status, 'errors');
  assert.equal(r.findings[0].params.tagName, 'button');
  assert.equal(r.findings[0].params.distancePx, '0.05');
});

test('analyze() — click_burst → behavior.bot.click_burst error', () => {
  const r = analyze([clickBurstEvent({ clickCount: 5, windowMs: 200 })]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.bot.click_burst');
  assert.equal(r.findings[0].level, 'error');
  assert.equal(r.findings[0].params.clickCount, 5);
  assert.equal(r.findings[0].params.windowMs, 200);
});

test('analyze() — phantom_click → behavior.bot.phantom_click warning', () => {
  // Phantom is a WARNING, not error — there's a rare legitimate case
  // (cursor was inside iframe at load time).
  const r = analyze([phantomClickEvent({ tagName: 'A', isTrusted: true })]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.bot.phantom_click');
  assert.equal(r.findings[0].level, 'warning');
  assert.equal(r.status, 'warnings');
  assert.equal(r.findings[0].params.tagName, 'a');
  assert.equal(r.findings[0].params.isTrusted, true);
});

test('analyze() — multiple bot patterns in one stream produce stacked findings', () => {
  // A real attacker often triggers more than one detector at once. The
  // engine should surface each, in event order.
  const r = analyze([
    probeReady(),
    centerSynthClickEvent(),
    clickBurstEvent(),
    phantomClickEvent(),
  ]);
  assert.equal(r.findings.length, 3);
  assert.equal(r.findings[0].id, 'behavior.bot.center_synth');
  assert.equal(r.findings[1].id, 'behavior.bot.click_burst');
  assert.equal(r.findings[2].id, 'behavior.bot.phantom_click');
  // Highest-severity wins the rollup.
  assert.equal(r.status, 'errors');
});

test('analyze() — bot patterns and overlay trap coexist in same analysis', () => {
  // Phase 1 + Phase 2 rules must compose without interference. A creative
  // could ship both an invisible trap AND a synthetic-click attack on it.
  const r = analyze([probeReady(), invisibleOverlayClickEvent(), centerSynthClickEvent()]);
  assert.equal(r.findings.length, 2);
  const ids = r.findings.map((f) => f.id).sort();
  assert.deepEqual(ids, ['behavior.bot.center_synth', 'behavior.trap.invisible_overlay']);
});

test('analyze() — bot findings carry decorated msg + nullable specRef', () => {
  const r = analyze([centerSynthClickEvent(), clickBurstEvent(), phantomClickEvent()]);
  for (const f of r.findings) {
    assert.equal(typeof f.msg, 'string');
    assert.notEqual(f.msg, '');
    assert.notEqual(f.msg, '[' + f.id + ']');
    assert.ok('specRef' in f);
  }
});

test('analyze() — center_synth event with missing distancePx defaults to "0.00"', () => {
  // Defensive: probe is the source of truth for centerDistancePx, but if
  // an archived event lacks it (e.g. from an older probe version) we
  // still want a finding rather than a crash.
  const ev = centerSynthClickEvent();
  delete ev.centerDistancePx;
  const r = analyze([ev]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].params.distancePx, '0.00');
});
