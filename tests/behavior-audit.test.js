'use strict';

/**
 * tests/behavior-audit.test.js — regression suite for the 2026-08-18 audit
 * of the behavioural rules (packages/core/behavior/rules/static.js) and the
 * in-iframe probe (public/creative-probe.js).
 *
 * Every finding in that audit was of one family: a detector that was RIGHT
 * about the attack it was written for and WRONG about the ordinary traffic
 * around it. Two of them (P0) fired ERROR on creatives that make up most of
 * the open web — a webpack bundle and an <a><img></a> banner — and an
 * ERROR here is not cosmetic: packages/core/intel/gate.js drops any bid
 * whose static scan errored out of intel training, so a false positive
 * silently poisons the model as well as the report.
 *
 * The suite is therefore written in pairs: for each fixed heuristic, one
 * test that the innocent creative is clean and one that the attack it was
 * built for still fires. A fix that simply deletes a detector passes the
 * first half and fails the second.
 *
 * Two layers:
 *   A. ENGINE — scanCreative() / analyze() as pure functions over a string.
 *   B. PROBE  — public/creative-probe.js executed for real inside a jsdom
 *      window, with stubbed geometry (jsdom returns an all-zero rect for
 *      everything, so layout has to be dictated rather than measured). This
 *      is the only way to test the probe: its detection logic lives in a
 *      closure inside an IIFE and is not importable.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const { analyze } = require('@ortbtools/core/behavior');
const {
  scanCreative,
  normalizeTransportEscapes,
} = require('@ortbtools/core/behavior/rules/static');

const ROOT = path.join(__dirname, '..');

/** Compact "kind/method" view of a scan, so assertions read like the repro. */
function scanIds(adm) {
  return scanCreative(adm).map((e) => e.kind + '/' + e.method);
}

function base64Blob(n) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  // i*37 + i*i keeps the character distribution near-uniform, so the blob
  // clears the 4.5 bits/char entropy threshold the way a real PNG does —
  // a repeating pattern would not.
  for (let i = 0; i < n; i++) s += alphabet[(i * 37 + i * i) % 64];
  return s;
}

// ── A1. Function("return this") — the webpack/UMD global-object idiom ──────
//
// `new Function("return this")()` is how a bundle reaches globalThis on an
// engine that lacks it. It is in the webpack runtime, core-js,
// regenerator-runtime, lodash and every UMD-wrapped ad tag on the market.

test('static/function_constructor — the global-object idiom is not obfuscation', () => {
  const adm =
    '<script>var g=(typeof globalThis==="object")?globalThis:new Function("return this")();</script>' +
    '<a href="https://adv.example/c"><img src="//cdn/300x250.jpg"></a>';
  assert.deepEqual(scanIds(adm), []);
  const r = analyze([], { adm });
  assert.deepEqual(r.findings, []);
  assert.equal(r.status, 'clean');
});

test('static/function_constructor — every spelling of the idiom is exempt', () => {
  const spellings = [
    'Function("return this")()',
    "Function('return this')()",
    'new Function("return this;")()',
    'new Function( "return  this" )()',
    'Function("return globalThis")()',
    'Function("return window")()',
    'Function("return self")()',
    'Function("return global")()',
  ];
  for (const s of spellings) {
    assert.deepEqual(scanIds(s), [], 'expected clean: ' + s);
  }
});

test('static/function_constructor — a body that does anything else still fires', () => {
  const payloads = [
    'new Function("return window.location=\'https://evil\'")()',
    'Function("return " + decoded)()',
    'Function("return atob(p)")()',
    'Function("return")',
  ];
  for (const p of payloads) {
    assert.deepEqual(
      scanIds(p),
      ['static_obfuscation/function_constructor'],
      'expected a hit: ' + p,
    );
  }
});

// ── A2. aaencode — kaomoji are not a signature ────────────────────────────
//
// Glyphs are built from code points, never pasted: the pattern in static.js
// is written with the same characters as literals, and a fixture that was
// pasted from the same source as the pattern would agree with it even if
// both were mangled. Building the fixture independently is what makes this
// test able to fail.

const KANA = {
  DOT: 'ﾟ', // ﾟ  halfwidth katakana semi-voiced sound mark
  OMEGA: 'ω', // ω  Greek small omega
  NO: 'ﾉ', // ﾉ  halfwidth katakana NO
  DE: 'Д', // Д  Cyrillic capital DE
  THETA: 'Θ', // Θ  Greek capital theta
  BAR: 'ｰ', // ｰ  halfwidth katakana prolonged sound mark
};
const face = (mid) => '(' + KANA.DOT + mid + KANA.DOT + ')';

// The head of real aaencode output. The decorative part of the bootstrap
// (`/｀ｍ´）ﾉ ~┻━┻`) is replaced by ASCII here on purpose — the pattern must
// key on the variable glyphs, which every aaencode payload carries, not on
// the ASCII art, which a trivially modified encoder could drop.
const AAENCODE_BOOTSTRAP =
  KANA.DOT +
  KANA.OMEGA +
  KANA.DOT +
  KANA.NO +
  "= /`m`)/ ~ ['_']; o=" +
  face(KANA.BAR) +
  ' =_=3; c=' +
  face(KANA.THETA) +
  ' =' +
  face(KANA.BAR) +
  '-' +
  face(KANA.BAR) +
  '; ' +
  face(KANA.DE) +
  ' =' +
  face(KANA.THETA) +
  '= (o^_^o)/ (o^_^o);';

test('static/aaencode — a kaomoji in Japanese ad copy is not obfuscation', () => {
  // えっ(ﾟДﾟ) 今なら70%OFF — surprise face, the single most common kaomoji.
  const shock = '<div style="font:14px sans-serif">えっ' + face(KANA.DE) + ' 70%OFF</div>';
  const smile = '<p>びっくり' + KANA.DOT + KANA.OMEGA + KANA.DOT + '</p>';
  for (const adm of [shock, smile]) {
    assert.deepEqual(scanIds(adm), []);
    assert.equal(analyze([], { adm }).status, 'clean');
  }
});

test('static/aaencode — the real encoder bootstrap still fires', () => {
  assert.deepEqual(scanIds(AAENCODE_BOOTSTRAP), ['static_obfuscation/aaencode']);
  const r = analyze([], { adm: AAENCODE_BOOTSTRAP });
  assert.equal(r.status, 'errors');
  assert.equal(r.findings[0].id, 'behavior.static.obfuscation');
  assert.equal(r.findings[0].params.pattern, 'aaencode');
});

test('static/aaencode — the ^ anchor does not mean "must start the creative"', () => {
  // The pattern is anchored for cost reasons (three whole-string lookaheads
  // that must not be retried at every offset); it must still find a payload
  // buried past a wall of markup.
  const adm = '<div>' + 'x'.repeat(5000) + '</div><script>' + AAENCODE_BOOTSTRAP + '</script>';
  assert.deepEqual(scanIds(adm), ['static_obfuscation/aaencode']);
});

// ── A3. A sprite at the head must not hide the script behind it ───────────

test('static/scan-window — a 109 KB leading data: URI no longer blinds the scanner', () => {
  const adm =
    '<div id=ad><img src="data:image/png;base64,' +
    base64Blob(109000) +
    '"></div><script>eval(atob("YWxlcnQoMSk="));document.write(unescape("%3Cscript%3E"));</script>';
  assert.ok(adm.length > 100 * 1024, 'fixture must exceed the old head-only cap');

  const ids = scanIds(adm);
  assert.ok(ids.includes('static_obfuscation/eval_atob'), 'eval(atob) behind the sprite');
  assert.ok(ids.includes('static_xss_marker/docwrite_decode'), 'document.write behind the sprite');
  // The sprite is still reported — eliding it from the pattern window does
  // not mean forgetting about it.
  assert.ok(ids.includes('static_high_entropy/base64-blob'));

  const r = analyze([], { adm });
  const found = r.findings.map((f) => f.id);
  assert.ok(found.includes('behavior.static.obfuscation'));
  assert.ok(found.includes('behavior.static.xss_marker'));
  assert.ok(found.includes('behavior.static.high_entropy_blob'));
});

test('static/scan-window — the same payload scans identically with and without padding', () => {
  const payload = '<script>eval(atob("YWxlcnQoMSk="));document.write(unescape("%3C"));</script>';
  const padded = '<img src="data:image/png;base64,' + base64Blob(200000) + '">' + payload;
  const bare = scanIds(payload);
  const withPadding = scanIds(padded).filter((id) => id !== 'static_high_entropy/base64-blob');
  assert.deepEqual(withPadding, bare);
});

test('static/scan-window — blob findings are capped, not unbounded', () => {
  // 100 separate sprites used to mean 100 identical WARNING findings; a
  // findings list that long is the same as no findings list at all.
  let adm = '';
  for (let i = 0; i < 100; i++) adm += '<img src="data:image/png;base64,' + base64Blob(600) + '">';
  const blobs = scanCreative(adm).filter((e) => e.kind === 'static_high_entropy');
  assert.ok(blobs.length > 0, 'still reports that the creative hides binary payloads');
  assert.ok(blobs.length <= 32, 'capped at MAX_ENTROPY_BLOBS, got ' + blobs.length);
});

test('static/scan-window — a base64-shaped DoS input scans in linear time', () => {
  // Regression guard for the /[A-Za-z0-9+/=]{500,}/g sweep this replaced.
  // That regex is quadratic on runs one character short of the quantifier:
  // it scanned 499 chars, failed, restarted one char later, scanned 498…
  // Measured before the rewrite: 211 ms for 150 KB, 1.56 s for 1 MB — a
  // free CPU burn on every /analyze call. The linear sweep does 1 MB in
  // single-digit milliseconds; the bound below is ~30× that, wide enough
  // for a loaded CI box but far under any regex-shaped reimplementation.
  const chunk = 'A'.repeat(499) + ' ';
  let adm = '';
  while (adm.length < 1024 * 1024) adm += chunk;
  const started = Date.now();
  const events = scanCreative(adm);
  const elapsed = Date.now() - started;
  assert.deepEqual(events, [], 'sub-threshold runs are not blobs');
  assert.ok(elapsed < 300, 'expected linear-time scan, took ' + elapsed + 'ms');
});

// ── A4. Detection must not depend on the transport's escaping level ───────

test('static/escaping — banner, native and VAST forms of one payload agree', () => {
  const js =
    '<script>var w=new Function("return "+p)();' +
    'document.body.setAttribute("onclick","x()");' +
    'w.eval(atob("YWxlcnQoMSk="));</script>';

  // 1) banner: adm is the HTML itself.
  const banner = scanIds(js);
  assert.deepEqual(banner.sort(), [
    'static_obfuscation/eval_atob',
    'static_obfuscation/function_constructor',
    'static_xss_marker/set_event_attr',
  ]);

  // 2) native: public/ortbtools.app.js hands us JSON.stringify({native}),
  //    so every quote inside jstracker arrives as \".
  const nativeAdm = JSON.stringify({ native: { link: { url: 'https://x' }, jstracker: js } });
  assert.deepEqual(scanIds(nativeAdm).sort(), banner.sort());

  // 3) VAST: an HTMLResource carries the same script XML-escaped.
  const vast =
    '<HTMLResource>&lt;script&gt;var w=new Function(&quot;return &quot;+p)();' +
    'document.body.setAttribute(&quot;onclick&quot;,&quot;x()&quot;);' +
    'w.eval(atob(&quot;YWxlcnQoMSk=&quot;));&lt;/script&gt;</HTMLResource>';
  assert.deepEqual(scanIds(vast).sort(), banner.sort());
});

test('static/escaping — unescaping decodes exactly one level', () => {
  // &amp;quot; is how a document DISPLAYS the text &quot;. Decoding it into
  // a quote would let ad copy about HTML escaping read as executable code.
  assert.equal(normalizeTransportEscapes('&amp;quot;onclick&amp;quot;'), '&quot;onclick&quot;');
  assert.deepEqual(scanIds('el.setAttribute(&amp;quot;onclick&amp;quot;, h)'), []);
  // …while one level of escaping does decode.
  assert.deepEqual(scanIds('el.setAttribute(&quot;onclick&quot;, h)'), [
    'static_xss_marker/set_event_attr',
  ]);
});

test('static/escaping — normalization does not invent findings in plain copy', () => {
  const adm =
    '<div>Save 50&#37; today &amp; tomorrow — &quot;best deal&quot;</div>' +
    '<a href="https://adv.example/c?u=a%2Fb&amp;t=1"><img src="//cdn/300x250.jpg"></a>';
  assert.deepEqual(scanIds(adm), []);
  assert.equal(analyze([], { adm }).status, 'clean');
});

// ── B. The probe, executed inside jsdom ──────────────────────────────────

const PROBE_SRC = fs.readFileSync(path.join(ROOT, 'public/creative-probe.js'), 'utf8');

/** Rect literal shaped like a DOMRect (jsdom never computes one for us). */
function rect(x, y, w, h) {
  return {
    x,
    y,
    left: x,
    top: y,
    width: w,
    height: h,
    right: x + w,
    bottom: y + h,
    toJSON() {
      return this;
    },
  };
}

/**
 * Boot a jsdom window, install the real probe, and return handles for
 * driving it. `layout` maps element id → rect; anything not listed keeps
 * jsdom's all-zero rect and is therefore invisible to the geometry code.
 */
function mountProbe(html, layout) {
  // jsdom logs "Not implemented: navigation to another Document" whenever a
  // test clicks a real <a href>. Swallow it: the probe exists precisely to
  // observe navigation attempts that never complete.
  const dom = new JSDOM('<!doctype html><html><body>' + html + '</body></html>', {
    url: 'https://ortbtools.com/preview',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    virtualConsole: new VirtualConsole(),
  });
  const win = dom.window;
  const events = [];
  // The probe posts to `parent`; inside jsdom that is this same window.
  win.addEventListener('message', (e) => events.push(e.data));
  win.eval(PROBE_SRC);
  for (const id of Object.keys(layout || {})) {
    const el = win.document.getElementById(id);
    assert.ok(el, 'fixture is missing #' + id);
    const r = layout[id];
    el.getBoundingClientRect = () => r;
  }
  return { dom, win, doc: win.document, events };
}

async function clickAndCollect(h, id) {
  h.doc.getElementById(id).dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  // postMessage delivery is a queued task; a few turns of the loop is enough.
  for (let i = 0; i < 3; i++) await new Promise((r) => h.win.setTimeout(r, 0));
  return h.events.filter((e) => e && String(e.kind).indexOf('invisible_overlay') === 0);
}

test('probe/bot — an untrusted geometric-center click emits center_synth_click', async () => {
  const h = mountProbe('<button id="target">open</button>');
  try {
    h.doc.getElementById('target').getBoundingClientRect = () => rect(0, 0, 300, 250);
    h.doc
      .getElementById('target')
      .dispatchEvent(new h.win.MouseEvent('click', { bubbles: true, clientX: 150, clientY: 125 }));
    for (let i = 0; i < 3; i++) await new Promise((resolve) => h.win.setTimeout(resolve, 0));
    const hit = h.events.find((event) => event && event.kind === 'center_synth_click');
    assert.ok(hit, 'the probe must emit its center-click signal');
    assert.equal(hit.centerDistancePx, 0);
    assert.equal(hit.isTrusted, false);
  } finally {
    h.dom.window.close();
  }
});

/** Full-viewport rect for the mounted window. */
function viewport(win, scale) {
  const s = scale == null ? 1 : scale;
  return rect(0, 0, win.innerWidth * s, win.innerHeight * s);
}

test('probe/overlay — a plain <a><img></a> banner is not a click trap', async () => {
  // The finding, verbatim: an <img> has no background of its own, filled
  // ~94% of the ad iframe, and every click on it was reported as
  // invisible_overlay_click → behavior.trap.invisible_overlay at ERROR.
  const h = mountProbe(
    '<a id="lnk" href="https://adv.example/c" target="_blank">' +
      '<img id="pic" src="https://cdn.example/300x250.jpg" width="300" height="250"></a>',
  );
  try {
    const full = viewport(h.win, 0.97);
    h.doc.getElementById('lnk').getBoundingClientRect = () => full;
    h.doc.getElementById('pic').getBoundingClientRect = () => full;
    assert.deepEqual(await clickAndCollect(h, 'pic'), []);
  } finally {
    h.dom.window.close();
  }
});

test('probe/overlay — clicking the anchor around the image is not a trap either', async () => {
  // Same banner, click landing on the wrapper: the <a> is transparent and
  // full-bleed, so it only escapes the heuristic because of what it holds.
  const h = mountProbe(
    '<a id="lnk" href="https://adv.example/c"><img id="pic" src="https://cdn/c.jpg"></a>',
  );
  try {
    const full = viewport(h.win);
    h.doc.getElementById('lnk').getBoundingClientRect = () => full;
    h.doc.getElementById('pic').getBoundingClientRect = () => full;
    assert.deepEqual(await clickAndCollect(h, 'lnk'), []);
  } finally {
    h.dom.window.close();
  }
});

test('probe/overlay — nested wrappers around one image do not aggregate', async () => {
  // The aggregate rule needs ≥2 contributors; a layout div, a positioning
  // div and an anchor stacked over the same image used to supply four.
  const h = mountProbe(
    '<div id="w1"><div id="w2"><a id="lnk" href="https://x">' +
      '<img id="pic" src="c.jpg"></a></div></div>',
  );
  try {
    const full = viewport(h.win);
    for (const id of ['w1', 'w2', 'lnk', 'pic']) {
      h.doc.getElementById(id).getBoundingClientRect = () => full;
    }
    assert.deepEqual(await clickAndCollect(h, 'pic'), []);
  } finally {
    h.dom.window.close();
  }
});

test('probe/overlay — a text creative on a coloured background is not a trap', async () => {
  const h = mountProbe(
    '<div id="ad" style="background:#7B61FF;color:#fff">CLICK HERE FOR FREE PRIZES</div>',
  );
  try {
    h.doc.getElementById('ad').getBoundingClientRect = () => viewport(h.win);
    assert.deepEqual(await clickAndCollect(h, 'ad'), []);
  } finally {
    h.dom.window.close();
  }
});

test('probe/overlay — the real trap still fires (samples/synthetic-trap shape)', async () => {
  // Empty transparent full-screen div laid over a visible banner — the
  // truth-ground creative in samples/synthetic-trap-invisible-overlay.json.
  const h = mountProbe(
    '<div id="banner" style="background:#7B61FF;color:#fff">FREE PRIZES</div>' +
      '<div id="trap" style="position:fixed;top:0;left:0;background:rgba(0,0,0,0);z-index:99999"></div>',
  );
  try {
    h.doc.getElementById('banner').getBoundingClientRect = () => rect(0, 0, 300, 250);
    h.doc.getElementById('trap').getBoundingClientRect = () => viewport(h.win);
    const hits = await clickAndCollect(h, 'trap');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'invisible_overlay_click');
    assert.equal(hits[0].tagName, 'DIV');
    assert.ok(hits[0].coverageRatio >= 0.5);

    // …and the engine still promotes it to the ERROR finding.
    const r = analyze(hits);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].id, 'behavior.trap.invisible_overlay');
    assert.equal(r.findings[0].level, 'error');
  } finally {
    h.dom.window.close();
  }
});

test('probe/overlay — hiding a 1×1 pixel inside the trap does not launder it', async () => {
  // The obvious evasion against a "does it show anything?" test: put a
  // tracking gif in the overlay. CONTENT_COVER_MIN is what refuses it.
  const h = mountProbe(
    '<div id="trap" style="background:rgba(0,0,0,0)"><img id="px" src="p.gif"></div>',
  );
  try {
    h.doc.getElementById('trap').getBoundingClientRect = () => viewport(h.win);
    h.doc.getElementById('px').getBoundingClientRect = () => rect(0, 0, 1, 1);
    const hits = await clickAndCollect(h, 'trap');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'invisible_overlay_click');
  } finally {
    h.dom.window.close();
  }
});

test('probe/overlay — an image at opacity 0 is still a trap', async () => {
  // The opacity branch is deliberately unconditional: an element at zero
  // opacity paints nothing no matter what content it carries, so the
  // painted-content test must not rescue it.
  const h = mountProbe('<img id="ghost" src="c.jpg" style="opacity:0">');
  try {
    h.doc.getElementById('ghost').getBoundingClientRect = () => viewport(h.win);
    const hits = await clickAndCollect(h, 'ghost');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'invisible_overlay_click');
    assert.equal(hits[0].tagName, 'IMG');
    assert.equal(hits[0].opacity, 0);
  } finally {
    h.dom.window.close();
  }
});

test('probe/overlay — the split-overlay aggregate still fires', async () => {
  // Four empty transparent 30%-viewport divs: none trips the per-element
  // rule, their sum is a full-screen click trap.
  let html = '';
  for (let i = 0; i < 4; i++) html += '<div id="o' + i + '"></div>';
  const h = mountProbe(html);
  try {
    for (let i = 0; i < 4; i++) {
      h.doc.getElementById('o' + i).getBoundingClientRect = () =>
        rect(0, 0, h.win.innerWidth, h.win.innerHeight * 0.3);
    }
    const hits = await clickAndCollect(h, 'o0');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'invisible_overlay_aggregate_click');
    assert.equal(hits[0].contributorCount, 4);
    assert.ok(hits[0].aggregateCoverage > 0.5);

    const r = analyze(hits);
    assert.equal(r.findings[0].id, 'behavior.trap.invisible_overlay_aggregate');
    assert.equal(r.findings[0].level, 'error');
  } finally {
    h.dom.window.close();
  }
});
