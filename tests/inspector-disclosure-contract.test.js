'use strict';

/**
 * Structural contracts for Inspector disclosures that do not need a browser
 * layout engine. Pixel geometry stays in the browser suites; this file guards
 * the DOM/semantics and the responsive fallbacks those suites exercise.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const TEMPLATE = (locale) => read(`public/modules/inspector/template.${locale}.html`);
const CSS = read('public/modules/inspector/inspector.css');
const MODAL_CSS = read('public/core/modal-host.css');
const APP = read('public/ortbtools.app.js');

function sliceInspectorDeclaration(header) {
  const start = APP.indexOf(`\n  ${header}`);
  assert.notEqual(start, -1, `missing Inspector declaration: ${header}`);
  const end = APP.indexOf('\n  }\n', start);
  assert.notEqual(end, -1, `could not find declaration end: ${header}`);
  return APP.slice(start + 1, end + 4);
}

for (const locale of ['uk', 'en', 'ru']) {
  test(`${locale}: phone settings preserve version and dialect as labelled native controls`, () => {
    const document = new JSDOM(`<body>${TEMPLATE(locale)}</body>`).window.document;
    const details = document.querySelector('.workbar-settings-menu');
    assert.ok(details, 'compact settings disclosure exists');
    assert.ok(details.querySelector(':scope > summary'), 'disclosure has a native summary trigger');

    for (const action of ['change-version-pin', 'change-dialect']) {
      const selects = Array.from(document.querySelectorAll(`select[data-action="${action}"]`));
      assert.equal(selects.length, 2, `${action} has desktop and phone copies`);
      assert.equal(new Set(selects.map((select) => select.id)).size, 2, 'IDs stay unique');
      assert.deepEqual(
        selects.map((select) => Array.from(select.options, (option) => option.value)),
        [
          Array.from(selects[0].options, (option) => option.value),
          Array.from(selects[0].options, (option) => option.value),
        ],
        `${action} exposes the same choices in both layouts`,
      );
      selects.forEach((select) => {
        const label = document.querySelector(`label[for="${select.id}"]`);
        assert.ok(
          label || select.getAttribute('aria-label'),
          `${select.id} has an accessible name`,
        );
      });
    }
  });

  test(`${locale}: popovers are disclosures and More stays outside the tab scroller`, () => {
    const document = new JSDOM(`<body>${TEMPLATE(locale)}</body>`).window.document;
    assert.equal(
      document.querySelector('[role="menu"], [role="menuitem"]'),
      null,
      'form controls and ordinary actions are not exposed as application-menu widgets',
    );

    const strip = document.querySelector('.tab-list-scroll');
    const more = document.querySelector('.tab-more');
    assert.ok(strip && more, 'tab scroller and More disclosure both exist');
    assert.equal(strip.parentElement, more.parentElement, 'More is a sibling of the clipping box');
    assert.equal(strip.querySelectorAll(':scope > .tab-btn').length, 4, 'four named tabs scroll');
    assert.equal(strip.contains(more), false, 'More menu cannot be clipped by tab overflow');

    const creativeOverlay = document.querySelector('.preview-safe-overlay');
    const creativeButton = creativeOverlay && creativeOverlay.querySelector(':scope > button');
    assert.ok(creativeOverlay && creativeButton, 'creative reveal has one native button');
    assert.equal(creativeOverlay.hasAttribute('role'), false, 'overlay is not a synthetic button');
    assert.equal(
      creativeOverlay.hasAttribute('tabindex'),
      false,
      'overlay is not a second tab stop',
    );
    assert.equal(creativeOverlay.hasAttribute('data-action'), false, 'overlay is presentational');
    assert.equal(creativeButton.dataset.action, 'reveal-creative', 'native button owns the action');
  });

  test(`${locale}: the history drawer exposes and controls one labelled region`, () => {
    const document = new JSDOM(`<body>${TEMPLATE(locale)}</body>`).window.document;
    const opener = document.querySelector('#toggleSidebarLeft');
    const panel = document.querySelector('#inspectorSidebarLeft');
    const close = panel && panel.querySelector('.drawer-close');

    assert.ok(opener && panel && close, 'opener, controlled region and close control exist');
    assert.equal(opener.tagName, 'BUTTON');
    assert.equal(opener.type, 'button');
    assert.equal(opener.getAttribute('aria-controls'), panel.id);
    assert.equal(opener.getAttribute('aria-expanded'), 'false');
    assert.equal(panel.getAttribute('aria-hidden'), 'true');
    assert.equal(close.tagName, 'BUTTON');
    assert.equal(close.type, 'button');
    assert.equal(close.getAttribute('aria-controls'), panel.id);
  });
}

test('responsive and contrast CSS keeps controls operable without changing desktop density', () => {
  assert.match(CSS, /\.tab-list-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(
    CSS,
    /@media \(max-width:\s*720px\)[\s\S]*?\.workbar-settings-menu\s*\{[^}]*display:\s*inline-flex/s,
  );
  assert.match(CSS, /\.saved-item:focus-within\s+\.saved-item-actions/);
  assert.match(CSS, /\.preview-safe-overlay__btn:focus-visible\s*\{/);
  assert.match(
    CSS,
    /@media \(hover:\s*none\),\s*\(pointer:\s*coarse\)[\s\S]*?\.saved-item-actions/s,
  );
  assert.match(CSS, /\.workbar-settings-field \.format-pill-select\s*\{[^}]*border-radius:\s*6px/s);
  assert.match(CSS, /\.sim-price-wrap input:focus\s*\{[^}]*outline:\s*2px/s);
  assert.match(
    CSS,
    /@media \(hover:\s*none\),\s*\(pointer:\s*coarse\)[\s\S]*?\.history-act-btn,[\s\S]*?min-height:\s*28px/s,
  );
  assert.match(CSS, /@media \(max-width:\s*1100px\)[\s\S]*?\.tab-more-menu\s*\{[^}]*max-height:/s);
  assert.match(
    CSS,
    /@media \(max-width:\s*600px\)[\s\S]*?\.tab-more-menu\s*\{[^}]*top:\s*auto;[^}]*bottom:\s*calc\(100% \+ 4px\)/s,
  );
  assert.match(
    CSS,
    /@media \(max-width:\s*720px\)[\s\S]*?\.kt-tools-menu > \.tools-menu-list\s*\{[^}]*calc\(100vw - 16px\)/s,
  );
  assert.match(CSS, /@media \(max-width:\s*360px\)[\s\S]*?\.workbar\s*\{[^}]*gap:\s*4px/s);
  assert.match(CSS, /body:has\(#app-root\.workbench\) \.kt-topbar__crumbs\s*\{/);
  assert.match(MODAL_CSS, /\.modal-actions\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(
    CSS,
    /\.tab-btn\.active \.tab-badge\s*\{[^}]*--control-primary-background[^}]*--control-primary-foreground/s,
  );
  assert.match(
    CSS,
    /\.severity-chip\.active\s*\{[^}]*--control-primary-background[^}]*--control-primary-foreground/s,
  );
});

test('History and Saved rows render native sibling controls with independent keyboard targets', async () => {
  const historyDom = new JSDOM('<body><div id="hList"></div></body>');
  const historyDocument = historyDom.window.document;
  const renderHistory = new Function(
    '$',
    'historyStore',
    't',
    'maskDomain',
    'historyTime',
    'humanStatus',
    'escapeHtml',
    '_currentHistoryIdx',
    `'use strict';\n${sliceInspectorDeclaration('function renderHistory() {')}\nreturn renderHistory;`,
  )(
    (id) => historyDocument.getElementById(id),
    [{ title: 'example.com', status: 'healthy' }],
    (key) => key,
    (value) => value,
    () => '12:34',
    (value) => value,
    (value) => String(value),
    -1,
  );
  renderHistory();

  const historyLoad = historyDocument.querySelector('.history-item-load');
  const historyPeek = historyDocument.querySelector('[data-action="history-peek"]');
  assert.ok(historyLoad && historyPeek);
  assert.equal(historyLoad.tagName, 'BUTTON');
  assert.equal(historyLoad.type, 'button');
  assert.equal(historyPeek.closest('[data-action="history-load"]'), null);
  historyLoad.focus();
  assert.equal(historyDocument.activeElement, historyLoad, 'load target retains native focus');

  const savedDom = new JSDOM(
    '<body><div id="libraryWrap" hidden><select id="partnerFilter"><option value=""></option></select><div id="savedList"></div></div></body>',
  );
  const savedDocument = savedDom.window.document;
  const refreshSamples = new Function(
    '$',
    'session',
    'ctx',
    't',
    'escapeHtml',
    'humanStatus',
    '_partnerCache',
    'toast',
    'renderAuthWidget',
    `'use strict';\n${sliceInspectorDeclaration('async function refreshSamples() {')}\nreturn refreshSamples;`,
  )(
    (id) => savedDocument.getElementById(id),
    {
      user: { id: 1 },
      pendingUnlock: false,
      hasSession: () => true,
      api: async () => ({
        samples: [{ id: 7, title: 'Saved request', partner_id: 3, req_len: 120 }],
      }),
    },
    { signal: { aborted: false } },
    (key, vars) => (vars && vars.id ? `${key}:${vars.id}` : key),
    (value) => String(value),
    (value) => value,
    [{ id: 3, name: 'Partner' }],
    () => {},
    () => {},
  );
  await refreshSamples();

  const savedLoad = savedDocument.querySelector('.saved-item-load');
  const savedEdit = savedDocument.querySelector('[data-action="sample-edit"]');
  assert.ok(savedLoad && savedEdit);
  assert.equal(savedLoad.tagName, 'BUTTON');
  assert.equal(savedLoad.type, 'button');
  assert.equal(savedEdit.closest('[data-action="sample-load"]'), null);
  assert.ok(savedEdit.getAttribute('aria-label'));
  savedLoad.focus();
  assert.equal(savedDocument.activeElement, savedLoad, 'saved load target retains native focus');

  assert.doesNotMatch(
    APP,
    /closest\('\[data-action="history-load"\]'\)[\s\S]{0,160}ev\.preventDefault\(\)/,
    'Inspector must not replace native button Enter/Space behavior with a row key handler',
  );
});

test('drawer state synchronization updates ARIA and returns focus to its opener', () => {
  const dom = new JSDOM(`
    <body class="sb-left-hidden">
      <main id="app-root">
        <button id="toggleSidebarLeft" data-static-icon="1" data-action="toggle-sidebar" data-side="left"></button>
        <aside id="inspectorSidebarLeft" aria-hidden="true">
          <button class="drawer-close" data-action="toggle-sidebar" data-side="left"></button>
        </aside>
      </main>
    </body>`);
  const { document } = dom.window;
  const root = document.getElementById('app-root');
  const declarations = [
    'function syncSidebarState(side) {',
    'function focusWithoutScroll(el) {',
    'function toggleSidebar(side, trigger) {',
  ]
    .map(sliceInspectorDeclaration)
    .join('\n');
  const toggleSidebar = new Function(
    'document',
    'window',
    'root',
    'localStorage',
    'SB_HIDDEN_KEYS',
    'SB_HIDDEN_TS_KEYS',
    'arrowFor',
    `'use strict';\n${declarations}\nreturn toggleSidebar;`,
  )(
    document,
    dom.window,
    root,
    { setItem: () => {} },
    { left: 'left', right: 'right' },
    { left: 'left-ts', right: 'right-ts' },
    () => '',
  );

  const opener = document.getElementById('toggleSidebarLeft');
  const panel = document.getElementById('inspectorSidebarLeft');
  const close = panel.querySelector('.drawer-close');
  toggleSidebar('left', opener);
  assert.equal(opener.getAttribute('aria-expanded'), 'true');
  assert.equal(close.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.getAttribute('aria-hidden'), 'false');
  assert.equal(document.activeElement, close, 'overlay opening moves focus into the drawer');

  toggleSidebar('left', close);
  assert.equal(opener.getAttribute('aria-expanded'), 'false');
  assert.equal(close.getAttribute('aria-expanded'), 'false');
  assert.equal(panel.getAttribute('aria-hidden'), 'true');
  assert.equal(document.activeElement, opener, 'closing returns focus to the opener');
});

test('finding path icon closes before its readable path text', () => {
  assert.match(
    APP,
    /aria-hidden="true">' \+\s*'<path d="[^"]+"><\/path><\/svg>' \+\s*'<span class="finding-path-text">'/s,
  );
});

test('duplicated settings stay one logical value and Escape restores disclosure focus', () => {
  assert.match(APP, /function syncActionSelects\(action, value\)/);
  assert.match(APP, /syncActionSelects\(action, el\.value\);[\s\S]*?setActiveDialect\(el\.value\)/);
  assert.match(
    APP,
    /change-version-pin[\s\S]*?syncActionSelects\(action, el\.value\);[\s\S]*?runAnalysis\(\)/,
  );
  assert.match(APP, /\.workbar-settings-menu\[open\]/);
  assert.match(
    APP,
    /if \(ev\.key !== 'Escape'\) return;[\s\S]*?opened\.forEach\(\(d\) => d\.removeAttribute\('open'\)\)[\s\S]*?summary\.focus/s,
  );
});
