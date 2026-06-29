'use strict';

/**
 * jsdom harness for the client navigation controller (public/modules/inspector/
 * source-nav.js) over the real browser source-map copy. Asserts behaviour, DOM
 * structure, XSS-safety, cross-pane navigation, stale lifecycle and prev/next —
 * NOT pixel layout (jsdom has no layout engine; alignment is verified manually).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const FL = require('../packages/core/finding-location');

const ROOT = path.join(__dirname, '..');
const SM_SRC = fs.readFileSync(path.join(ROOT, 'public/core/source-map.js'), 'utf8');
const NAV_SRC = fs.readFileSync(path.join(ROOT, 'public/modules/inspector/source-nav.js'), 'utf8');

function setup(reqText, resText) {
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <div class="input-card" id="cardReq"><textarea id="bidReq"></textarea></div>
      <div class="input-card" id="cardRes"><textarea id="bidRes"></textarea></div>
      <div id="srcNavBar"></div></body>`,
    { runScripts: 'outside-only' },
  );
  const w = dom.window;
  w.eval(SM_SRC);
  w.eval(NAV_SRC);
  w.document.getElementById('bidReq').value = reqText || '';
  w.document.getElementById('bidRes').value = resText || '';
  assert.ok(w.SpyglassSourceNav.init({}));
  return w;
}
const overlay = (w, side) => w.SpyglassSourceNav.__test.panes()[side].overlay;
const marks = (ov) => Array.from(ov.querySelectorAll('mark'));

const PRETTY = (o) => JSON.stringify(o, null, 2);

test('exact highlight: overlay <mark> covers the exact value range (text-node only)', () => {
  const req = { id: 'req-1', imp: [{ id: 'i1' }, { id: 'i2' }] };
  const w = setup(PRETTY(req), '');
  const loc = FL.buildNormalLocation(
    { id: 'x', path: 'imp[1].id' },
    { side: 'request', kind: 'ortb' },
  );
  w.SpyglassSourceNav.onAnalyzed([{ id: 'x', location: loc }]);
  assert.ok(w.SpyglassSourceNav.navigate(loc));
  const ov = overlay(w, 'request');
  const m = marks(ov);
  assert.equal(m.length, 1);
  assert.equal(m[0].textContent, '"i2"'); // the SECOND imp id (repeated key name → right path)
  assert.equal(m[0].className, 'src-hl src-hl--exact');
  // overlay is built from text nodes + the single mark — no injected elements other than <mark>
  assert.equal(ov.querySelectorAll('*').length, 1);
});

test('XSS: payload HTML in a value never creates DOM/script — only inert text in a <mark>', () => {
  const evil = '</textarea><script>window.__pwned=1</script><img src=x onerror=alert(1)>';
  const res = { seatbid: [{ bid: [{ adm: evil }] }] };
  const w = setup('', PRETTY(res));
  const loc = FL.buildNormalLocation(
    { id: 'vast.x', path: 'seatbid[0].bid[0].adm' },
    { side: 'response', kind: 'ortb' },
  );
  w.SpyglassSourceNav.onAnalyzed([{ id: 'vast.x', location: loc }]);
  w.SpyglassSourceNav.navigate(loc);
  const ov = overlay(w, 'response');
  assert.equal(ov.querySelector('script'), null, 'no <script> created');
  assert.equal(ov.querySelector('img'), null, 'no <img> created');
  assert.equal(w.__pwned, undefined, 'no script executed');
  // the mark holds the raw adm text verbatim as a text node
  const m = marks(ov)[0];
  assert.ok(m.textContent.includes(evil));
  assert.equal(m.children.length, 0, 'mark contains only a text node');
});

test('container precision (VAST adm) → kind container, spans the whole adm value', () => {
  const res = { seatbid: [{ bid: [{ adm: '<VAST version="4.0"></VAST>' }] }] };
  const w = setup('', PRETTY(res));
  const loc = FL.buildNormalLocation(
    { id: 'vast.version_missing', path: 'seatbid[0].bid[0].adm' },
    { side: 'response', kind: 'ortb' },
  );
  w.SpyglassSourceNav.navigate(loc);
  w.SpyglassSourceNav.onAnalyzed([{ id: 'vast', location: loc }]);
  w.SpyglassSourceNav.navigate(loc);
  const m = marks(overlay(w, 'response'))[0];
  assert.equal(m.className, 'src-hl src-hl--container');
  assert.ok(m.textContent.includes('<VAST'));
});

test('cross-pane currency: primary RESPONSE /cur highlighted, related REQUEST /cur highlighted', () => {
  const req = { id: 'r1', cur: ['EUR'], imp: [{ id: 'i1' }] };
  const res = { id: 'r1', cur: 'USD', seatbid: [{ bid: [{ impid: 'i1', price: 1 }] }] };
  const w = setup(PRETTY(req), PRETTY(res));
  const loc = FL.buildCrosscheckLocation(
    { id: 'crosscheck.cur_not_in_request', path: 'cur' },
    req,
    res,
  );
  w.SpyglassSourceNav.onAnalyzed([{ id: 'crosscheck.cur_not_in_request', location: loc }]);
  assert.ok(w.SpyglassSourceNav.navigate(loc));
  assert.equal(marks(overlay(w, 'response'))[0].textContent, '"USD"'); // primary
  // related = the request `cur` array node (pretty-printed → multi-line span)
  assert.ok(marks(overlay(w, 'request'))[0].textContent.includes('EUR'));
  assert.equal(marks(overlay(w, 'request'))[0].className, 'src-hl src-hl--related');
});

test('cross-pane size: response /w exact + /h related, request banner.format related (no /size)', () => {
  const req = { id: 'r1', imp: [{ id: 'i1', banner: { format: [{ w: 300, h: 250 }] } }] };
  const res = { id: 'r1', seatbid: [{ bid: [{ impid: 'i1', w: 728, h: 90 }] }] };
  const w = setup(PRETTY(req), PRETTY(res));
  const loc = FL.buildCrosscheckLocation(
    { id: 'crosscheck.bid.size_mismatch', path: 'seatbid[0].bid[0].size' },
    req,
    res,
  );
  w.SpyglassSourceNav.onAnalyzed([{ id: 'size', location: loc }]);
  assert.ok(w.SpyglassSourceNav.navigate(loc));
  const resMarks = marks(overlay(w, 'response')).map((m) => m.textContent);
  assert.deepEqual(resMarks, ['728', '90']); // w (exact) + h (related), in source order
  assert.ok(marks(overlay(w, 'request'))[0].textContent.includes('300')); // banner.format
});

test('cross-pane price↔floor: response price exact + request bidfloor related', () => {
  const req = { id: 'r1', imp: [{ id: 'i1', bidfloor: 0.9 }] };
  const res = { id: 'r1', seatbid: [{ bid: [{ impid: 'i1', price: 0.1 }] }] };
  const w = setup(PRETTY(req), PRETTY(res));
  const loc = FL.buildCrosscheckLocation(
    { id: 'crosscheck.bid.below_floor', path: 'seatbid[0].bid[0].price' },
    req,
    res,
  );
  w.SpyglassSourceNav.navigate(loc);
  w.SpyglassSourceNav.onAnalyzed([{ id: 'p', location: loc }]);
  assert.ok(w.SpyglassSourceNav.navigate(loc));
  assert.equal(marks(overlay(w, 'response'))[0].textContent, '0.1');
  assert.equal(marks(overlay(w, 'request'))[0].textContent, '0.9');
});

test('minified and pretty both resolve the same pointer', () => {
  const res = { seatbid: [{ bid: [{ price: 1.25 }] }] };
  const loc = FL.buildNormalLocation(
    { id: 'x', path: 'seatbid[0].bid[0].price' },
    { side: 'response', kind: 'ortb' },
  );
  for (const text of [PRETTY(res), JSON.stringify(res)]) {
    const w = setup('', text);
    w.SpyglassSourceNav.onAnalyzed([{ id: 'x', location: loc }]);
    assert.ok(w.SpyglassSourceNav.navigate(loc));
    assert.equal(marks(overlay(w, 'response'))[0].textContent, '1.25');
  }
});

test('stale: editing a pane tears down highlight + disables nav until re-analyze', () => {
  const res = { seatbid: [{ bid: [{ price: 1 }] }] };
  const w = setup('', PRETTY(res));
  const loc = FL.buildNormalLocation(
    { id: 'x', path: 'seatbid[0].bid[0].price' },
    { side: 'response', kind: 'ortb' },
  );
  w.SpyglassSourceNav.onAnalyzed([{ id: 'x', location: loc }]);
  w.SpyglassSourceNav.navigate(loc);
  assert.equal(marks(overlay(w, 'response')).length, 1);
  // user edits the response pane
  const el = w.document.getElementById('bidRes');
  el.value = PRETTY({ seatbid: [{ bid: [{ price: 999 }] }] });
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(marks(overlay(w, 'response')).length, 0, 'highlight torn down on edit');
  assert.equal(w.SpyglassSourceNav.navigate(loc), false, 'navigation disabled while stale');
  assert.equal(w.document.getElementById('srcNavBar').hidden, true);
});

test('prev/next cycles navigable findings across panes with wrap-around', () => {
  const req = { id: 'r1', imp: [{ id: 'i1' }] };
  const res = { id: 'r2', seatbid: [{ bid: [{ impid: 'i1', price: 1 }] }] };
  const w = setup(PRETTY(req), PRETTY(res));
  const items = [
    {
      id: 'a',
      location: FL.buildNormalLocation(
        { id: 'a', path: 'imp[0].id' },
        { side: 'request', kind: 'ortb' },
      ),
    },
    {
      id: 'b',
      location: FL.buildNormalLocation(
        { id: 'b', path: 'seatbid[0].bid[0].price' },
        { side: 'response', kind: 'ortb' },
      ),
    },
  ];
  w.SpyglassSourceNav.onAnalyzed(items);
  w.SpyglassSourceNav.next(); // → item 0 (request)
  assert.equal(marks(overlay(w, 'request')).length, 1);
  w.SpyglassSourceNav.next(); // → item 1 (response) — auto cross-pane
  assert.equal(marks(overlay(w, 'response')).length, 1);
  assert.equal(marks(overlay(w, 'request')).length, 0);
  w.SpyglassSourceNav.next(); // wrap → item 0 again
  assert.equal(marks(overlay(w, 'request')).length, 1);
});

test('URL provenance: present raw param resolves; unknown provenance does not jump', () => {
  const rawUrl = 'https://ssp.example/win?ch-model=Pixel&url=http%3A%2F%2Fx';
  const w = setup(rawUrl, '');
  const ok = FL.buildNormalLocation(
    { id: 'request.url.ch_field_empty', path: 'ch-model' },
    { side: 'request', kind: 'url', canonical: { _raw: { 'ch-model': 'Pixel', url: 'x' } } },
  );
  const bad = FL.buildNormalLocation(
    { id: 'request.url.user_ip_ipv6', path: 'device.ipv6' },
    { side: 'request', kind: 'url', canonical: { _raw: { 'ch-model': 'Pixel' } } },
  );
  w.SpyglassSourceNav.onAnalyzed([{ id: 'ok', location: ok }]);
  assert.ok(w.SpyglassSourceNav.navigate(ok));
  assert.equal(marks(overlay(w, 'request'))[0].textContent, 'Pixel');
  assert.equal(bad.precision, 'none');
  assert.equal(w.SpyglassSourceNav.navigate(bad), false, 'disabled url location does not jump');
});

test('>2MB pane is disabled (honest no-jump), not built', () => {
  const big = '{"a":"' + 'x'.repeat(2 * 1024 * 1024 + 10) + '"}';
  const w = setup('', big);
  const loc = FL.buildNormalLocation({ id: 'x', path: 'a' }, { side: 'response', kind: 'ortb' });
  w.SpyglassSourceNav.onAnalyzed([{ id: 'x', location: loc }]);
  const r = w.SpyglassSourceNav.__test.resolvePart(loc.primary, 'ortb-json');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too-large');
  assert.equal(w.SpyglassSourceNav.navigate(loc), false);
});

test('invalid JSON pane → no jump (honest fallback)', () => {
  const w = setup('', '{"seatbid": [ {bid: }]}'); // invalid
  const loc = FL.buildNormalLocation(
    { id: 'x', path: 'seatbid[0]' },
    { side: 'response', kind: 'ortb' },
  );
  w.SpyglassSourceNav.onAnalyzed([{ id: 'x', location: loc }]);
  assert.equal(w.SpyglassSourceNav.navigate(loc), false);
});

// ── CP3.1: lifecycle / idempotency / focused-Esc / stale-after-failed-analyze ──

const itemsFor = (paths, side) =>
  paths.map((p, i) => ({
    id: 'f' + i,
    location: FL.buildNormalLocation({ id: 'f' + i, path: p }, { side: side, kind: 'ortb' }),
  }));

test('remount: after repeated init/teardown, ONE keypress performs exactly ONE step', () => {
  const req = { id: 'r', imp: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] };
  const w = setup(PRETTY(req), '');
  // simulate several SPA remounts — each init() must fully clean the prior one
  w.SpyglassSourceNav.init({});
  w.SpyglassSourceNav.init({});
  w.SpyglassSourceNav.init({});
  w.SpyglassSourceNav.onAnalyzed(
    itemsFor(['imp[0].id', 'imp[1].id', 'imp[2].id', 'imp[3].id'], 'request'),
  );
  w.document.dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
  );
  // stacked listeners would advance the cursor N times; exactly one listener → cursor 0
  assert.equal(
    w.SpyglassSourceNav.__test.state().cursor,
    0,
    'exactly one step → no stacked listeners',
  );
  assert.equal(
    w.document.querySelectorAll('.src-hl-overlay').length,
    2,
    'exactly one overlay per pane',
  );
  assert.equal(w.document.querySelectorAll('[aria-live]').length, 1, 'exactly one live region');
});

test('teardown removes document keydown, overlays, live region + toolbar state', () => {
  const w = setup('{"a":1}', '');
  w.SpyglassSourceNav.onAnalyzed(itemsFor(['a'], 'request'));
  assert.ok(w.document.querySelector('.src-hl-overlay'));
  assert.ok(w.document.querySelector('[aria-live]'));
  w.SpyglassSourceNav.teardown();
  // listener gone → keypress is inert, no throw, no state
  w.document.dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
  );
  assert.equal(w.SpyglassSourceNav.__test.state(), null);
  assert.equal(w.SpyglassSourceNav.__test.panes(), null);
  assert.equal(w.document.querySelector('.src-hl-overlay'), null, 'overlays removed');
  assert.equal(w.document.querySelector('[aria-live]'), null, 'live region removed');
  assert.equal(w.document.getElementById('srcNavBar').children.length, 0, 'toolbar emptied');
  assert.equal(w.document.getElementById('srcNavBar').hidden, true, 'toolbar hidden');
});

test('Esc clears the active highlight even while the textarea HAS focus', () => {
  const res = { seatbid: [{ bid: [{ price: 1 }] }] };
  const w = setup('', PRETTY(res));
  const loc = FL.buildNormalLocation(
    { id: 'x', path: 'seatbid[0].bid[0].price' },
    { side: 'response', kind: 'ortb' },
  );
  w.SpyglassSourceNav.onAnalyzed([{ id: 'x', location: loc }]);
  assert.ok(w.SpyglassSourceNav.navigate(loc));
  const el = w.document.getElementById('bidRes');
  el.focus();
  assert.equal(w.SpyglassSourceNav.__test.isTyping(el), true, 'textarea IS a typing target');
  assert.equal(w.SpyglassSourceNav.__test.highlightActive(), true);
  // Esc dispatched FROM the focused textarea (e.target = textarea, bubbles to document)
  el.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(marks(overlay(w, 'response')).length, 0, 'highlight cleared despite focus');
  assert.equal(w.SpyglassSourceNav.__test.highlightActive(), false);
});

test('failed analyze: resetNavigation() at analyze start leaves no stale jump', () => {
  const res = { seatbid: [{ bid: [{ price: 1 }] }] };
  const w = setup('', PRETTY(res));
  const loc = FL.buildNormalLocation(
    { id: 'x', path: 'seatbid[0].bid[0].price' },
    { side: 'response', kind: 'ortb' },
  );
  w.SpyglassSourceNav.onAnalyzed([{ id: 'x', location: loc }]);
  w.SpyglassSourceNav.navigate(loc);
  assert.equal(marks(overlay(w, 'response')).length, 1);
  // a NEW runAnalysis() begins → resetNavigation(); then the analyze FAILS
  // (onAnalyzed is never called)
  w.SpyglassSourceNav.resetNavigation();
  assert.equal(marks(overlay(w, 'response')).length, 0, 'prior highlight dropped at analyze start');
  assert.equal(w.SpyglassSourceNav.__test.state(), null, 'navigation revision cleared');
  assert.equal(w.SpyglassSourceNav.navigate(loc), false, 'no stale jump without a fresh analysis');
  assert.equal(w.document.getElementById('srcNavBar').hidden, true);
});

// ── CP3.2: clickable crosscheck (data-loc), Esc-status, toolbar aria, geometry ──

test('CP3.2: Esc clears the highlight AND drops the stale active-location status', () => {
  const res = { seatbid: [{ bid: [{ price: 1 }] }] };
  const w = setup('', PRETTY(res));
  const loc = FL.buildNormalLocation(
    { id: 'x', path: 'seatbid[0].bid[0].price' },
    { side: 'response', kind: 'ortb' },
  );
  w.SpyglassSourceNav.onAnalyzed([{ id: 'x', location: loc }]);
  assert.ok(w.SpyglassSourceNav.navigate(loc));
  const active = w.SpyglassSourceNav.__test.status();
  assert.ok(active && /:\d+:\d+$/.test(active), 'status shows the active location (…:line:col)');
  // Esc dispatched FROM the focused textarea (bubbles to the document handler)
  const el = w.document.getElementById('bidRes');
  el.focus();
  el.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(marks(overlay(w, 'response')).length, 0, 'highlight cleared');
  const after = w.SpyglassSourceNav.__test.status();
  assert.notEqual(after, active, 'status no longer the stale active location');
  assert.match(after, /locatable/, 'status returned to the neutral list state');
});

test('CP3.2: buildControls localizes the toolbar aria-label on init', () => {
  const w = setup('{"a":1}', '');
  const bar = w.document.getElementById('srcNavBar');
  // window.t is absent in the harness → tr() resolves to the EN default; the key
  // exists in uk/en/ru per source-nav-i18n.test.js (locale parity).
  assert.equal(bar.getAttribute('aria-label'), 'Finding source navigation');
});

test('CP3.2: window resize refreshes overlay geometry while active; teardown stops it', () => {
  const res = { seatbid: [{ bid: [{ price: 1 }] }] };
  const w = setup('', PRETTY(res));
  const loc = FL.buildNormalLocation(
    { id: 'x', path: 'seatbid[0].bid[0].price' },
    { side: 'response', kind: 'ortb' },
  );
  w.SpyglassSourceNav.onAnalyzed([{ id: 'x', location: loc }]);
  assert.ok(w.SpyglassSourceNav.navigate(loc));
  const before = w.SpyglassSourceNav.__test.geometryRefreshes();
  w.dispatchEvent(new w.Event('resize'));
  const afterResize = w.SpyglassSourceNav.__test.geometryRefreshes();
  assert.equal(afterResize, before + 1, 'exactly one geometry refresh per resize');
  // teardown aborts the signal → the window listener is removed
  w.SpyglassSourceNav.teardown();
  w.dispatchEvent(new w.Event('resize'));
  assert.equal(
    w.SpyglassSourceNav.__test.geometryRefreshes(),
    afterResize,
    'no geometry refresh fires after teardown',
  );
});

test('CP3.2: crosscheck data-loc round-trips through HTML parsing and navigates (quote-safe)', () => {
  const req = { id: 'r1', cur: ['EUR'], imp: [{ id: 'i1' }] };
  const res = { id: 'r1', cur: 'USD', seatbid: [{ bid: [{ impid: 'i1', price: 1 }] }] };
  const w = setup(PRETTY(req), PRETTY(res));
  const loc = FL.buildCrosscheckLocation(
    { id: 'crosscheck.cur_not_in_request', path: 'cur' },
    req,
    res,
  );
  w.SpyglassSourceNav.onAnalyzed([{ id: 'crosscheck.cur_not_in_request', location: loc }]);
  // Replicate the app's exact serialization: escapeHtml (& < >) THEN &quot;-escape,
  // embedded in a DOUBLE-quoted data-loc, parsed back by the browser. Guards the
  // bug where unescaped quotes truncate the attribute at the first " so
  // JSON.parse(el.dataset.loc) fails and the click silently no-ops.
  const escapeHtml = (s) => {
    const d = w.document.createElement('div');
    d.appendChild(w.document.createTextNode(String(s)));
    return d.innerHTML;
  };
  const dataLoc = escapeHtml(JSON.stringify(loc)).replace(/"/g, '&quot;');
  const host = w.document.createElement('div');
  host.innerHTML =
    '<button type="button" class="cross-path cross-path-btn" data-action="goto-path"' +
    ' data-loc="' +
    dataLoc +
    '" title="t">cur</button>';
  const btn = host.querySelector('button[data-action="goto-path"]');
  assert.ok(btn, 'clickable goto-path button rendered');
  assert.equal(btn.getAttribute('data-jsonpath'), null, 'crosscheck nav carries no data-jsonpath');
  // the goto-path dispatcher does navigate(JSON.parse(el.dataset.loc)) — must succeed
  const parsed = JSON.parse(btn.dataset.loc);
  assert.ok(w.SpyglassSourceNav.navigate(parsed), 'data-loc round-trips and navigates');
  assert.equal(marks(overlay(w, 'response'))[0].textContent, '"USD"', 'primary: response cur');
  assert.ok(
    marks(overlay(w, 'request'))[0].textContent.includes('EUR'),
    'related: request cur highlighted cross-pane',
  );
});
