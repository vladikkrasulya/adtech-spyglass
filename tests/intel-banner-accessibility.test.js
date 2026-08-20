'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const BANNER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'public/modules/intel/banner.js'),
  'utf8',
);

function setup() {
  const dom = new JSDOM('<!doctype html><html lang="en"><head></head><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://ortbtools.test/inspector',
  });
  let opened = 0;
  dom.window.OrtbtoolsIntelBuilder = { open: () => (opened += 1) };
  dom.window.eval(BANNER_SRC);
  dom.window.OrtbtoolsIntelBanner.refresh({ total: 2, byBucket: { display: 2 } });
  return { dom, w: dom.window, opened: () => opened };
}

test('discovery chip exposes a real keyboard-focusable open control', () => {
  const { dom, w, opened } = setup();
  const root = w.document.getElementById('ortbtoolsIntelChip');
  const open = root.querySelector('[data-intel-open]');

  assert.equal(open.tagName, 'BUTTON');
  assert.equal(open.type, 'button');
  open.focus();
  assert.equal(w.document.activeElement, open);
  open.click();
  assert.equal(opened(), 1);

  dom.window.close();
});

test('interactive chip is not nested inside a live-region status container', () => {
  const { dom, w } = setup();
  const root = w.document.getElementById('ortbtoolsIntelChip');
  const announcement = root.querySelector('[data-intel-announcement]');

  assert.equal(root.hasAttribute('role'), false);
  assert.equal(announcement.getAttribute('role'), 'status');
  assert.equal(announcement.getAttribute('aria-live'), 'polite');
  assert.match(announcement.textContent, /2 new field patterns detected/);
  assert.match(announcement.textContent, /2 display/);
  assert.equal(announcement.querySelector('button'), null);

  dom.window.close();
});
