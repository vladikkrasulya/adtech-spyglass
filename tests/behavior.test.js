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
