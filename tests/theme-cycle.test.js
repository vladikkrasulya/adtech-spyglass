'use strict';

/**
 * tests/theme-cycle.test.js — the shell theme cycle, under both system preferences.
 *
 * WHY THIS EXISTS
 * ---------------
 * The control has three states (auto, light, dark) and two appearances. At
 * least one adjacent pair in the cycle therefore shares an appearance — that
 * is arithmetic, not a defect. Ordering cannot remove the silent press; it can
 * only decide which press it is.
 *
 * It used to be the FIRST press from auto, which is the press every new
 * visitor makes: on a light-preferring machine, auto already resolved to
 * light, so moving to explicit light repainted nothing and the control read as
 * broken. This file pins the corrected order and, more importantly, pins it
 * under BOTH system preferences. The previous coverage inherited whichever
 * preference the developer machine had, which is exactly how the defect
 * survived — and how the browser check that guarded this control spent
 * eighteen CI runs red while passing locally.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const SHELLS = [
  'public/index.en.html',
  'public/index.uk.html',
  'public/index.ru.html',
  'public/about.en.html',
  'public/about.uk.html',
  'public/about.ru.html',
];

/** Pull the head IIFE that owns `kt-theme` out of a localized shell. */
function themeScript(file) {
  const html = read(file);
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)].map((m) => m[1]);
  const found = blocks.filter((b) => b.includes("var K = 'kt-theme'"));
  assert.equal(found.length, 1, `${file} must carry exactly one kt-theme owner`);
  return found[0];
}

/** Boot a shell with the system preference pinned, not inherited. */
function boot(file, prefersDark) {
  const dom = new JSDOM(read(file), {
    runScripts: 'outside-only',
    url: 'https://ortbtools.test/inspector',
  });
  const { window } = dom;
  window.matchMedia = (query) => ({
    media: query,
    matches: /prefers-color-scheme:\s*dark/u.test(query) ? prefersDark : false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  window.localStorage.clear();
  window.eval(themeScript(file));
  // The IIFE defers its wiring to DOMContentLoaded when the document is still
  // parsing, and jsdom is still in 'loading' at the moment we eval. Fire it, or
  // the control is never created and every assertion below fails for a reason
  // that has nothing to do with the cycle.
  if (window.document.readyState === 'loading') {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  }
  return dom;
}

function state(window) {
  const button = window.document.querySelector('.kt-theme-toggle');
  assert.ok(button, 'the shell exposes a theme control');
  return {
    stored: window.localStorage.getItem('kt-theme'),
    resolved: window.document.documentElement.getAttribute('data-theme'),
    title: button.getAttribute('title'),
    glyph: button.textContent,
  };
}

function press(window) {
  window.document
    .querySelector('.kt-theme-toggle')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
}

for (const prefersDark of [false, true]) {
  const sys = prefersDark ? 'dark' : 'light';
  const opp = prefersDark ? 'light' : 'dark';
  const label = prefersDark ? 'dark-preferring' : 'light-preferring';

  test(`theme cycle on a ${label} machine: the first press repaints`, () => {
    const dom = boot('public/index.en.html', prefersDark);
    const { window } = dom;

    const start = state(window);
    assert.equal(start.stored, null, 'a fresh session starts on auto');
    assert.equal(start.resolved, sys, 'auto resolves to the system preference');

    press(window);
    const first = state(window);
    assert.equal(first.stored, opp, `auto moves to ${opp}, the value opposite what is on screen`);
    assert.notEqual(
      first.resolved,
      start.resolved,
      'the first press a visitor ever makes must change the page',
    );

    dom.window.close();
  });

  test(`theme cycle on a ${label} machine: one cycle returns to auto through both appearances`, () => {
    const dom = boot('public/index.en.html', prefersDark);
    const { window } = dom;

    const walk = [state(window)];
    for (let i = 0; i < 3; i += 1) {
      press(window);
      walk.push(state(window));
    }

    assert.deepEqual(
      walk.map((s) => s.stored),
      [null, opp, sys, null],
      'the cycle is auto → opposite → system-matching → auto',
    );

    const appearances = new Set(walk.map((s) => s.resolved));
    assert.deepEqual([...appearances].sort(), ['dark', 'light'], 'both appearances are reachable');

    const silent = walk
      .slice(1)
      .map((s, i) => (s.resolved === walk[i].resolved ? i + 1 : null))
      .filter((i) => i !== null);
    assert.deepEqual(
      silent,
      [3],
      'exactly one press is silent, and it is the third — the return into auto, ' +
        'where an unchanged appearance is the correct answer',
    );

    dom.window.close();
  });

  test(`theme cycle on a ${label} machine: every press says something`, () => {
    const dom = boot('public/index.en.html', prefersDark);
    const { window } = dom;

    let previous = state(window);
    for (let i = 1; i <= 3; i += 1) {
      press(window);
      const now = state(window);
      assert.notEqual(now.title, previous.title, `press ${i} changes the title`);
      assert.notEqual(now.glyph, previous.glyph, `press ${i} changes the glyph`);
      previous = now;
    }

    dom.window.close();
  });
}

test('the title names the state the next press will produce', () => {
  const dom = boot('public/index.en.html', false);
  const { window } = dom;

  for (const expected of ['dark', 'light', 'auto']) {
    const before = state(window);
    assert.match(
      before.title,
      new RegExp(`click → ${expected}$`, 'u'),
      `the control promises ${expected} next`,
    );
    press(window);
    const after = state(window);
    const actual = after.stored === null ? 'auto' : after.stored;
    assert.equal(actual, expected, 'the control keeps the promise its title made');
  }

  dom.window.close();
});

/** The cycle itself, with the localized copy left out of the comparison. */
function cycleLogic(file) {
  const source = themeScript(file);
  const start = source.indexOf('          function sys() {');
  const end = source.indexOf('          var NAME =', start);
  assert.ok(start >= 0 && end > start, `${file} must keep the cycle extractable`);
  return source.slice(start, end);
}

test('all six localized shells carry an identical cycle', () => {
  const reference = cycleLogic(SHELLS[0]);
  for (const file of SHELLS.slice(1)) {
    assert.equal(
      cycleLogic(file),
      reference,
      `${file} must carry the same successor as ${SHELLS[0]} — a locale that ` +
        'drifts here gives its users a different control',
    );
  }
});

test('every locale names the control in its own language', () => {
  // public/index.ru.html shipped the English strings — both the titles and the
  // fallback aria-label — while public/index.uk.html was translated. Nothing
  // compared the two, so the gap sat in production. This is that comparison.
  const foreign = { uk: /[а-щьюяєіїґ]/iu, ru: /[а-яё]/iu };
  for (const locale of ['uk', 'ru']) {
    for (const base of ['index', 'about']) {
      const source = themeScript(`public/${base}.${locale}.html`);
      const names = source.match(/var NAME = \{[^}]*\}/u);
      assert.ok(names, `${base}.${locale}: the state names are extractable`);
      assert.match(
        names[0],
        foreign[locale],
        `${base}.${locale}: theme state names must be translated, not left in English`,
      );
      assert.doesNotMatch(
        names[0],
        /'(auto|light|dark)'/u,
        `${base}.${locale}: an English state name survives in a localized shell`,
      );
    }
  }
});
