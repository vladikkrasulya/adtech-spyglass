'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

test('browser source-map copy has sha256 parity with the canonical core', () => {
  const canonical = read('packages/core/source-map.js');
  const browser = read('public/modules/inspector/source-map.js');
  assert.equal(sha256(browser), sha256(canonical));
});

function harness() {
  const dom = new JSDOM(
    '<main id="root"><div class="input-card"><textarea id="bidReq"></textarea></div>' +
      '<div class="input-card"><textarea id="bidRes"></textarea></div>' +
      '<button id="finding"></button></main>',
    { runScripts: 'outside-only', url: 'https://ortbtools.com/inspector' },
  );
  const { window } = dom;
  window.requestAnimationFrame = (fn) => fn();
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.eval(read('public/modules/inspector/source-map.js'));
  const locatorSource = read('public/modules/inspector/source-locator.js').replace(
    'export function setupSourceLocator',
    'window.setupSourceLocator = function',
  );
  window.eval(locatorSource);
  const controller = new window.AbortController();
  window.setupSourceLocator(window.document.getElementById('root'), controller.signal, 'en');
  return { dom, window, controller };
}

test('exact source overlay is text-node safe and tears down on stale revision', () => {
  const { window } = harness();
  const req = window.document.getElementById('bidReq');
  req.value = '{"imp":[{"tagid":"<img src=x onerror=alert(1)>"}]}';
  const finding = window.document.getElementById('finding');
  finding.dataset.findingLocation = JSON.stringify({
    dialect: 'ortb-json',
    precision: 'exact',
    primary: {
      side: 'request',
      pointer: '/imp/0/tagid',
      display: 'imp[0].tagid',
      target: 'value',
      precision: 'exact',
    },
    related: [],
  });
  finding.click();

  const overlay = window.document.querySelector('.source-overlay');
  assert.ok(overlay);
  assert.equal(overlay.querySelectorAll('img').length, 0);
  assert.equal(overlay.querySelector('mark').textContent, '"<img src=x onerror=alert(1)>"');

  req.value += ' ';
  req.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(window.document.querySelector('.source-overlay'), null);
});

test('related-location navigation changes pane and Escape closes the overlay', () => {
  const { window } = harness();
  const req = window.document.getElementById('bidReq');
  const res = window.document.getElementById('bidRes');
  req.value = '{"cur":["USD"]}';
  res.value = '{"cur":"EUR"}';
  const finding = window.document.getElementById('finding');
  finding.dataset.findingLocation = JSON.stringify({
    dialect: 'ortb-json',
    precision: 'exact',
    primary: {
      side: 'response',
      pointer: '/cur',
      display: 'cur',
      target: 'value',
      precision: 'exact',
    },
    related: [
      {
        side: 'request',
        pointer: '/cur',
        display: 'cur',
        target: 'node',
        precision: 'container',
        role: 'allowed-list',
      },
    ],
  });
  finding.click();
  assert.equal(res.classList.contains('has-source-overlay'), true);
  window.document.querySelector('[data-source-action="next"]').click();
  assert.equal(req.classList.contains('has-source-overlay'), true);
  assert.equal(window.document.querySelector('.source-overlay__count').textContent, '2 / 2');

  req.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(window.document.querySelector('.source-overlay'), null);
});

test('URL dialect highlights the exact raw query-param value', () => {
  const { window } = harness();
  const req = window.document.getElementById('bidReq');
  req.value = 'https://ads.example/bid?zone=first&tag=second';
  const finding = window.document.getElementById('finding');
  finding.dataset.findingLocation = JSON.stringify({
    dialect: 'url',
    precision: 'exact',
    primary: {
      side: 'request',
      pointer: 'tag',
      display: 'tag',
      target: 'value',
      precision: 'exact',
    },
    related: [],
  });
  finding.click();
  assert.equal(window.document.querySelector('mark').textContent, 'second');
});
