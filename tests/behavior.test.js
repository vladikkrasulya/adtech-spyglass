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

// Phase 3 — malicious-ad helpers. navContext metadata is what the probe
// attaches via the new navContext() helper; tests model the engine's
// reading of that metadata.
function frameBustAnchorEvent(opts) {
  return Object.assign(
    {
      type: 'spyglass-probe',
      v: 1,
      ts: Date.now(),
      kind: 'frame_bust_anchor',
      method: 'a[target=_top].click',
      url: 'https://attacker.example/landing',
      trigger: 'click',
      tagName: 'A',
      target: '_top',
      isTrusted: false,
      // navContext defaults — caller overrides as needed
      userActivationActive: false,
      userActivationEverActive: false,
      msSinceGesture: -1,
      withinGestureGrace: false,
    },
    opts || {},
  );
}

function frameBustFormEvent(opts) {
  return Object.assign(
    {
      type: 'spyglass-probe',
      v: 1,
      ts: Date.now(),
      kind: 'frame_bust_form',
      method: 'form.submit',
      url: 'https://attacker.example/landing',
      trigger: 'no-event',
      tagName: 'FORM',
      target: '_top',
      userActivationActive: false,
      userActivationEverActive: false,
      msSinceGesture: -1,
      withinGestureGrace: false,
    },
    opts || {},
  );
}

function autoNavigateEvent(opts) {
  // The probe emits this kind from reportNavigation when activeEventStack
  // is empty. Phase 3 refinement attaches navContext metadata.
  return Object.assign(
    {
      type: 'spyglass-probe',
      v: 1,
      ts: Date.now(),
      kind: 'auto_navigate',
      method: 'location.href=',
      url: 'https://attacker.example/landing',
      trigger: 'no-event',
      userActivationActive: false,
      userActivationEverActive: false,
      msSinceGesture: -1,
      withinGestureGrace: false,
    },
    opts || {},
  );
}

// Phase 4 — heavy-ad + frozen-thread helpers.
function heavyAdCpuEvent(opts) {
  return Object.assign(
    {
      type: 'spyglass-probe',
      v: 1,
      ts: Date.now(),
      kind: 'heavy_ad_cpu',
      method: 'longtask',
      url: '',
      trigger: 'no-event',
      cumulativeMs: 5200,
      windowMs: 4100,
      breachedThreshold: 'window',
    },
    opts || {},
  );
}

function heavyAdNetworkEvent(opts) {
  return Object.assign(
    {
      type: 'spyglass-probe',
      v: 1,
      ts: Date.now(),
      kind: 'heavy_ad_network',
      method: 'resource-timing',
      url: '',
      trigger: 'no-event',
      cumulativeBytes: 5 * 1024 * 1024,
      resourceCount: 42,
    },
    opts || {},
  );
}

function frozenThreadEvent(opts) {
  // The parent watchdog injects this synthetic event directly into
  // __spyglassBehavior.events when the heartbeat lag crosses the
  // FROZEN_THRESHOLD_MS bar. Same shape as a probe event, distinct
  // `type` tag (`spyglass-probe-watchdog`) for source attribution.
  return Object.assign(
    {
      type: 'spyglass-probe-watchdog',
      v: 1,
      ts: Date.now(),
      kind: 'frozen_thread',
      method: 'parent-watchdog',
      url: '',
      trigger: 'no-event',
      msSinceLastHeartbeat: 4200,
    },
    opts || {},
  );
}

// Phase 5 — permission-abuse helper. Probe wraps every system-permission
// API and emits this kind with navContext metadata; engine splits severity
// on withinGestureGrace.
function permissionAbuseEvent(opts) {
  return Object.assign(
    {
      type: 'spyglass-probe',
      v: 1,
      ts: Date.now(),
      kind: 'permission_abuse',
      apiKind: 'notification',
      method: 'Notification.requestPermission',
      url: '',
      trigger: 'no-event',
      mediaSubKind: '',
      userActivationActive: false,
      userActivationEverActive: false,
      msSinceGesture: -1,
      withinGestureGrace: false,
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

// ── Phase 3 (malicious-ad) rules ────────────────────────────────────────────

test('analyze() — frame_bust_anchor without gesture → ERROR', () => {
  const r = analyze([frameBustAnchorEvent({ withinGestureGrace: false, msSinceGesture: -1 })]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.malicious.frame_bust_anchor');
  assert.equal(r.findings[0].level, 'error');
  assert.equal(r.findings[0].params.withinGestureGrace, false);
  assert.equal(r.findings[0].params.target, '_top');
});

test('analyze() — frame_bust_anchor within gesture grace → WARNING', () => {
  // The "click banner → real anchor → target=_top" pattern (poor practice
  // but legitimate) — engine downgrades severity when gesture lineage exists.
  const r = analyze([frameBustAnchorEvent({ withinGestureGrace: true, msSinceGesture: 120 })]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.malicious.frame_bust_anchor');
  assert.equal(r.findings[0].level, 'warning');
  assert.equal(r.findings[0].params.msSinceGesture, 120);
});

test('analyze() — frame_bust_form is always ERROR regardless of gesture', () => {
  // No legitimate ad creative ships a form with target=_top — the rule
  // does not split severity on gesture grace.
  const inGrace = analyze([frameBustFormEvent({ withinGestureGrace: true, msSinceGesture: 50 })]);
  const noGrace = analyze([frameBustFormEvent({ withinGestureGrace: false, msSinceGesture: -1 })]);
  assert.equal(inGrace.findings[0].level, 'error');
  assert.equal(noGrace.findings[0].level, 'error');
  assert.equal(inGrace.findings[0].id, 'behavior.malicious.frame_bust_form');
});

test('analyze() — auto_navigate without gesture → behavior.malicious.auto_redirect ERROR', () => {
  const r = analyze([autoNavigateEvent({ withinGestureGrace: false, msSinceGesture: -1 })]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.malicious.auto_redirect');
  assert.equal(r.findings[0].level, 'error');
  assert.equal(r.status, 'errors');
});

test('analyze() — auto_navigate within gesture grace → behavior.malicious.late_redirect WARNING', () => {
  // Cloaking pattern: user clicked something visible, setTimeout fired
  // the real navigation outside the gesture lineage. Probe still emits
  // kind=auto_navigate (empty event-stack at nav time), but withinGestureGrace
  // is true because a recent gesture happened.
  const r = analyze([autoNavigateEvent({ withinGestureGrace: true, msSinceGesture: 350 })]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.malicious.late_redirect');
  assert.equal(r.findings[0].level, 'warning');
  assert.equal(r.findings[0].params.msSinceGesture, 350);
});

test('analyze() — auto_navigate produces exactly ONE of auto/late, not both', () => {
  // Mutual exclusion: a single nav event must classify into one rule.
  const noGrace = analyze([autoNavigateEvent({ withinGestureGrace: false })]);
  const inGrace = analyze([autoNavigateEvent({ withinGestureGrace: true, msSinceGesture: 100 })]);
  assert.equal(noGrace.findings.length, 1);
  assert.equal(inGrace.findings.length, 1);
  assert.notEqual(noGrace.findings[0].id, inGrace.findings[0].id);
});

test('analyze() — Phase 3 events without navContext metadata are treated as no-grace (defensive)', () => {
  // Older probes (pre-Phase-3) don't attach withinGestureGrace. The
  // engine must still classify — defaulting to ERROR for missing-grace
  // is safer than silent skip.
  const ev = autoNavigateEvent();
  delete ev.withinGestureGrace;
  delete ev.msSinceGesture;
  const r = analyze([ev]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.malicious.auto_redirect');
  assert.equal(r.findings[0].level, 'error');
});

test('analyze() — non-auto_navigate kinds (window_open with gesture) do NOT trigger auto/late rules', () => {
  // window_open with a real click in stack is a normal user-driven flow.
  // The auto/late rules only fire on kind === 'auto_navigate' (empty stack).
  const ev = {
    type: 'spyglass-probe',
    kind: 'window_open',
    method: 'window.open',
    url: 'https://example.com',
    trigger: 'click',
    withinGestureGrace: false, // even with no grace, this isn't auto_navigate
  };
  const r = analyze([ev]);
  assert.equal(r.findings.length, 0);
  assert.equal(r.status, 'clean');
});

test('analyze() — Phase 1+2+3 rules compose: trap + bot + frame-bust in one stream', () => {
  // The full stack: an invisible overlay creative also runs a pixelbot
  // synthetic click and tries to frame-bust on top. Every rule fires
  // independently and findings stack in event order.
  const r = analyze([
    probeReady(),
    invisibleOverlayClickEvent(),
    centerSynthClickEvent(),
    frameBustAnchorEvent({ withinGestureGrace: false }),
    frameBustFormEvent(),
    autoNavigateEvent({ withinGestureGrace: false }),
  ]);
  const ids = r.findings.map((f) => f.id);
  assert.ok(ids.includes('behavior.trap.invisible_overlay'));
  assert.ok(ids.includes('behavior.bot.center_synth'));
  assert.ok(ids.includes('behavior.malicious.frame_bust_anchor'));
  assert.ok(ids.includes('behavior.malicious.frame_bust_form'));
  assert.ok(ids.includes('behavior.malicious.auto_redirect'));
  assert.equal(r.status, 'errors');
});

test('analyze() — malicious findings carry decorated msg + nullable specRef', () => {
  const r = analyze([
    frameBustAnchorEvent({ withinGestureGrace: false }),
    frameBustFormEvent(),
    autoNavigateEvent({ withinGestureGrace: false }),
    autoNavigateEvent({ withinGestureGrace: true, msSinceGesture: 200 }),
  ]);
  assert.equal(r.findings.length, 4);
  for (const f of r.findings) {
    assert.equal(typeof f.msg, 'string');
    assert.notEqual(f.msg, '');
    assert.notEqual(f.msg, '[' + f.id + ']');
    assert.ok('specRef' in f);
  }
});

// ── Phase 4 (heavy-ad + frozen-thread) rules ────────────────────────────────

test('analyze() — heavy_ad_cpu (window threshold) → behavior.malicious.heavy_ad_cpu ERROR', () => {
  const r = analyze([heavyAdCpuEvent({ breachedThreshold: 'window', windowMs: 4100 })]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.malicious.heavy_ad_cpu');
  assert.equal(r.findings[0].level, 'error');
  assert.equal(r.findings[0].params.breachedThreshold, 'window');
  assert.equal(r.findings[0].params.windowSec, '4.1');
  assert.equal(r.status, 'errors');
});

test('analyze() — heavy_ad_cpu (total threshold) carries cumulative seconds', () => {
  const r = analyze([
    heavyAdCpuEvent({ breachedThreshold: 'total', cumulativeMs: 61500, windowMs: 1200 }),
  ]);
  assert.equal(r.findings[0].params.breachedThreshold, 'total');
  assert.equal(r.findings[0].params.cumulativeSec, '61.5');
});

test('analyze() — heavy_ad_network → ERROR with MB-formatted params', () => {
  const r = analyze([heavyAdNetworkEvent({ cumulativeBytes: 6 * 1024 * 1024, resourceCount: 73 })]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.malicious.heavy_ad_network');
  assert.equal(r.findings[0].level, 'error');
  assert.equal(r.findings[0].params.cumulativeMb, '6.00');
  assert.equal(r.findings[0].params.resourceCount, 73);
});

test('analyze() — frozen_thread (parent-watchdog injected) → ERROR', () => {
  // Engine doesn't care that this event came from the parent watchdog
  // rather than the probe — the kind tag is enough.
  const r = analyze([frozenThreadEvent({ msSinceLastHeartbeat: 5800 })]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.malicious.frozen_thread');
  assert.equal(r.findings[0].level, 'error');
  assert.equal(r.findings[0].params.msSinceLastHeartbeat, 5800);
  assert.equal(r.findings[0].params.secSinceLastHeartbeat, '5.8');
});

test('analyze() — heavy_ad_cpu fires at most once even if probe re-emits (defensive)', () => {
  // Probe dedup (_heavyCpuAlerted flag) should prevent duplicate emits,
  // but if it ever did, each event becomes a finding — engine shouldn't
  // collapse them silently. Test asserts the engine's 1-to-1 promotion.
  const r = analyze([heavyAdCpuEvent(), heavyAdCpuEvent({ cumulativeMs: 7200 })]);
  assert.equal(r.findings.length, 2);
  assert.equal(r.findings[0].id, 'behavior.malicious.heavy_ad_cpu');
  assert.equal(r.findings[1].id, 'behavior.malicious.heavy_ad_cpu');
});

test('analyze() — Phase 1+2+3+4 full stack composes without rule conflicts', () => {
  // Maximally hostile creative: invisible overlay + bot click on it +
  // frame-bust + auto-redirect + heavy CPU + heavy network + frozen
  // thread. Every rule fires independently, every finding stacks.
  const r = analyze([
    probeReady(),
    invisibleOverlayClickEvent(),
    centerSynthClickEvent(),
    frameBustAnchorEvent({ withinGestureGrace: false }),
    frameBustFormEvent(),
    autoNavigateEvent({ withinGestureGrace: false }),
    heavyAdCpuEvent(),
    heavyAdNetworkEvent(),
    frozenThreadEvent(),
  ]);
  const ids = r.findings.map((f) => f.id);
  assert.ok(ids.includes('behavior.trap.invisible_overlay'));
  assert.ok(ids.includes('behavior.bot.center_synth'));
  assert.ok(ids.includes('behavior.malicious.frame_bust_anchor'));
  assert.ok(ids.includes('behavior.malicious.frame_bust_form'));
  assert.ok(ids.includes('behavior.malicious.auto_redirect'));
  assert.ok(ids.includes('behavior.malicious.heavy_ad_cpu'));
  assert.ok(ids.includes('behavior.malicious.heavy_ad_network'));
  assert.ok(ids.includes('behavior.malicious.frozen_thread'));
  assert.equal(r.status, 'errors');
});

test('analyze() — Phase 4 findings carry decorated msg + nullable specRef', () => {
  const r = analyze([heavyAdCpuEvent(), heavyAdNetworkEvent(), frozenThreadEvent()]);
  for (const f of r.findings) {
    assert.equal(typeof f.msg, 'string');
    assert.notEqual(f.msg, '');
    assert.notEqual(f.msg, '[' + f.id + ']');
    assert.ok('specRef' in f);
  }
});

test('analyze() — heavy_ad_cpu with missing numeric params defaults gracefully', () => {
  // Older probes might emit the event without all metadata; engine must
  // produce a finding with sensible defaults rather than NaN/undefined.
  const ev = heavyAdCpuEvent();
  delete ev.cumulativeMs;
  delete ev.windowMs;
  const r = analyze([ev]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].params.cumulativeMs, 0);
  assert.equal(r.findings[0].params.cumulativeSec, '0.0');
  assert.equal(r.findings[0].params.windowSec, '0.0');
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

// ── Phase 5 (permission abuse) rules ────────────────────────────────────────

test('analyze() — permission_abuse without gesture → ERROR', () => {
  const r = analyze([
    permissionAbuseEvent({ withinGestureGrace: false, msSinceGesture: -1 }),
  ]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.malicious.permission_abuse');
  assert.equal(r.findings[0].level, 'error');
  assert.equal(r.findings[0].params.apiKind, 'notification');
  assert.equal(r.findings[0].params.withinGestureGrace, false);
});

test('analyze() — permission_abuse within gesture grace → WARNING', () => {
  const r = analyze([
    permissionAbuseEvent({ withinGestureGrace: true, msSinceGesture: 200 }),
  ]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.malicious.permission_abuse');
  assert.equal(r.findings[0].level, 'warning');
  assert.equal(r.findings[0].params.msSinceGesture, 200);
});

test('analyze() — permission_abuse without navContext defaults to ERROR (defensive)', () => {
  // Pre-Phase-5 archived events may lack the gesture metadata. Engine
  // must still classify them — defaulting to ERROR is the safe choice.
  const ev = permissionAbuseEvent();
  delete ev.withinGestureGrace;
  delete ev.msSinceGesture;
  const r = analyze([ev]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'behavior.malicious.permission_abuse');
  assert.equal(r.findings[0].level, 'error');
});

test('analyze() — multiple permission_abuse events produce one finding each', () => {
  // Same creative requesting push + geo + camera should surface the full
  // pattern, not collapse into a single finding. Severity tracks each
  // event's own gesture context independently.
  const r = analyze([
    permissionAbuseEvent({ apiKind: 'notification', withinGestureGrace: false }),
    permissionAbuseEvent({
      apiKind: 'geolocation',
      method: 'navigator.geolocation.getCurrentPosition',
      withinGestureGrace: true,
      msSinceGesture: 80,
    }),
    permissionAbuseEvent({
      apiKind: 'getUserMedia',
      method: 'navigator.mediaDevices.getUserMedia',
      mediaSubKind: 'camera+mic',
      withinGestureGrace: false,
    }),
  ]);
  assert.equal(r.findings.length, 3);
  const apiKinds = r.findings.map((f) => f.params.apiKind).sort();
  assert.deepEqual(apiKinds, ['geolocation', 'getUserMedia', 'notification']);
  // Severity per event: notification = error, geo = warning, gUM = error
  const byApi = Object.fromEntries(r.findings.map((f) => [f.params.apiKind, f.level]));
  assert.equal(byApi.notification, 'error');
  assert.equal(byApi.geolocation, 'warning');
  assert.equal(byApi.getUserMedia, 'error');
  assert.equal(
    r.findings.find((f) => f.params.apiKind === 'getUserMedia').params.mediaSubKind,
    'camera+mic',
  );
});

test('analyze() — Phase 5 finding carries decorated msg + nullable specRef', () => {
  const r = analyze([permissionAbuseEvent({ withinGestureGrace: false })]);
  const f = r.findings[0];
  assert.equal(typeof f.msg, 'string');
  assert.notEqual(f.msg, '');
  assert.notEqual(f.msg, '[' + f.id + ']');
  assert.ok('specRef' in f);
});
