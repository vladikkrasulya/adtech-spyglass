'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const BUILDER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'public/modules/intel/builder.js'),
  'utf8',
);

function setup() {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><button id="opener">Open builder</button></body></html>',
    {
      runScripts: 'outside-only',
      url: 'https://ortbtools.test/inspector',
    },
  );
  const { window } = dom;
  window.OrtbtoolsIntelStorage = {
    listObservations: async () => [
      {
        path: 'req.imp.ext.vendor_field',
        bucket: 'display',
        count: 8,
        decayedScore: 8,
        lastSeenAt: Date.now(),
        valueShape: { charClass: 'alnum-lower' },
      },
    ],
    listCoOccurrences: async () => [],
  };
  window.eval(BUILDER_SRC);
  return { dom, window };
}

test('builder labels its name field, moves focus in, traps it, and restores its opener', async () => {
  const { dom, window } = setup();
  const opener = window.document.getElementById('opener');
  opener.focus();

  const opening = window.OrtbtoolsIntelBuilder.open();
  const root = window.document.getElementById('ortbtoolsIntelBuilder');
  const dialog = root.querySelector('[role="dialog"]');
  const close = root.querySelector('[data-builder-close]');

  assert.equal(window.document.activeElement, close, 'focus enters before async storage resolves');
  await opening;

  const name = root.querySelector('[data-builder-name]');
  const cancel = root.querySelector('[data-builder-cancel]');

  assert.equal(root.hidden, false);
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(
    window.document.querySelector('label[for="ortbtoolsIntelBuilderName"]').control,
    name,
  );
  assert.equal(window.document.activeElement, name, 'the first useful field receives focus');

  cancel.focus();
  cancel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(window.document.activeElement, close, 'Tab wraps from the last enabled control');

  close.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
  );
  assert.equal(
    window.document.activeElement,
    cancel,
    'Shift+Tab wraps to the last enabled control',
  );

  cancel.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(root.hidden, true);
  assert.equal(
    window.document.activeElement,
    opener,
    'closing returns focus to the launch control',
  );

  dom.window.close();
});

test('builder styles expose focus cues and a wrapping 320px-safe layout', async () => {
  const { dom, window } = setup();
  await window.OrtbtoolsIntelBuilder.open();
  const css = window.document.querySelector('style').textContent;

  assert.match(css, /__name-input:focus-visible\{/u);
  assert.match(css, /__btn:focus-visible,/u);
  assert.match(css, /@media \(max-width:480px\)\{/u);
  assert.match(css, /__name-row\{flex-direction:column;align-items:stretch\}/u);
  assert.match(css, /__footer\{padding:12px;flex-wrap:wrap\}/u);
  assert.match(css, /__name-input\{width:100%;box-sizing:border-box\}/u);

  dom.window.close();
});
