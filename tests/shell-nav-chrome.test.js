'use strict';

/**
 * tests/shell-nav-chrome.test.js — jsdom harness for the persistent shell
 * sidebar (public/modules/nav/index.js).
 *
 * Covers F-10, a two-part defect reproduced in real headless Chrome against
 * both the shipped image and the working tree:
 *
 *   1. RE-BIND. mountNav() rebuilds the whole sidebar (root.innerHTML =
 *      renderNav()) on every kt:lang-change. The collapse tab's click handler
 *      used to be bound to a node captured at mount time, so after the first
 *      language switch the live .kt-nav__collapse-tab carried NO listener:
 *      real trusted clicks landed on the button (verified with
 *      elementFromPoint) and .kt-shell never changed class. A full reload was
 *      the only way to get the sidebar moving again.
 *
 *   2. LABEL. The tab's aria-label/title were computed once, always as
 *      "collapse", so in the collapsed state the control announced the
 *      opposite of what it does — and contradicted the ‹ / › arrow that
 *      nav.css swaps on .is-nav-collapsed.
 *
 * SCOPE NOTE. This file asserts wiring and attributes only — "is a listener
 * bound to the node that is in the DOM right now", which jsdom models
 * faithfully. It does NOT assert geometry: the sidebar's width/transform
 * animation and the arrow swap are CSS, and jsdom has no layout engine or
 * cascade. Those were measured in real Chrome (nav width 220px ↔ 1px at
 * ≥1024px; aside x 0 ↔ -220 for the ≤1023px drawer).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const NAV_SRC = fs.readFileSync(path.join(__dirname, '..', 'public/modules/nav/index.js'), 'utf8');

/** Mount the real nav module inside a jsdom shell.
 *  nav/index.js has no imports, so it runs as a plain script once the ESM
 *  `export` keywords are dropped and the public API is bridged onto window —
 *  same approach as tests/source-nav.test.js. The module body is otherwise
 *  untouched. */
function setup({ lang = 'uk', collapsed = false } = {}) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html lang="${lang}"><body>
       <div class="kt-shell">
         <aside id="kt-nav-root" class="kt-nav"></aside>
         <header id="kt-topbar-root"></header>
         <main id="app-root"></main>
       </div>
     </body></html>`,
    { runScripts: 'outside-only', url: `https://ortbtools.test/${lang}/inspector` },
  );
  const w = dom.window;
  if (collapsed) w.localStorage.setItem('kt-nav-collapsed', '1');
  w.eval(NAV_SRC.replace(/^export /gmu, '') + '\nwindow.__nav = { mountNav, canonicalize };');
  const root = w.document.getElementById('kt-nav-root');
  const unmount = w.__nav.mountNav(root);
  return { w, root, unmount, shell: w.document.querySelector('.kt-shell') };
}

const tab = (w) => w.document.querySelector('.kt-nav__collapse-tab');

/** Mirror what lang-switch.js does in its SPA branch: flip the document lang,
 *  then dispatch kt:lang-change. */
function switchLang(w, next) {
  w.document.documentElement.setAttribute('lang', next);
  w.dispatchEvent(new w.CustomEvent('kt:lang-change', { detail: { lang: next } }));
}

// ── 1. The re-bind defect ────────────────────────────────────────────────

test('F-10: the collapse tab still toggles after a language switch', () => {
  const { w, shell, unmount } = setup({ lang: 'uk' });

  tab(w).click();
  assert.equal(shell.classList.contains('is-nav-collapsed'), true, 'collapses before lang switch');

  const before = tab(w);
  switchLang(w, 'ru');
  const after = tab(w);

  // Guard the premise: if renderNav() ever stops replacing the node, this
  // test would pass for the wrong reason.
  assert.notEqual(before, after, 'kt:lang-change must rebuild the collapse tab node');
  assert.equal(shell.classList.contains('is-nav-collapsed'), true, 'state survives the re-render');

  after.click();
  assert.equal(
    shell.classList.contains('is-nav-collapsed'),
    false,
    'the rebuilt tab must expand the sidebar (pre-fix: no listener, class stuck)',
  );

  tab(w).click();
  assert.equal(shell.classList.contains('is-nav-collapsed'), true, 'and collapse again');

  unmount();
  w.close();
});

test('F-10: the toggle survives repeated language switches and persists its state', () => {
  const { w, shell, unmount } = setup({ lang: 'uk' });

  for (const next of ['ru', 'en', 'uk', 'ru']) {
    switchLang(w, next);
    tab(w).click();
    assert.equal(shell.classList.contains('is-nav-collapsed'), true, `collapse works in ${next}`);
    assert.equal(w.localStorage.getItem('kt-nav-collapsed'), '1', `persisted in ${next}`);
    tab(w).click();
    assert.equal(shell.classList.contains('is-nav-collapsed'), false, `expand works in ${next}`);
    assert.equal(w.localStorage.getItem('kt-nav-collapsed'), '0', `persist cleared in ${next}`);
  }

  unmount();
  w.close();
});

test('F-10: unmount detaches the listener from the CURRENT tab, not the mount-time one', () => {
  const { w, shell, unmount } = setup({ lang: 'uk' });
  switchLang(w, 'ru');
  unmount();

  // unmount() clears root, so re-inject a bare button with the same hook and
  // confirm nothing is still listening on behalf of the unmounted nav.
  const root = w.document.getElementById('kt-nav-root');
  root.innerHTML = '<button data-action="collapse-nav"></button>';
  root.querySelector('[data-action="collapse-nav"]').click();
  assert.equal(shell.classList.contains('is-nav-collapsed'), false, 'no leaked handler');

  switchLang(w, 'en');
  assert.equal(root.querySelector('.kt-nav__collapse-tab'), null, 'kt:lang-change is unsubscribed');

  w.close();
});

// ── 2. The label defect ──────────────────────────────────────────────────

const EXPANDED = { uk: 'Згорнути меню', ru: 'Свернуть меню', en: 'Collapse sidebar' };
const COLLAPSED = { uk: 'Розгорнути меню', ru: 'Развернуть меню', en: 'Expand sidebar' };

test('F-10: collapse tab announces the action it will perform, in every locale', () => {
  for (const l of ['uk', 'ru', 'en']) {
    const { w, unmount } = setup({ lang: l });

    assert.equal(tab(w).getAttribute('aria-label'), EXPANDED[l], `${l}: expanded aria-label`);
    assert.equal(tab(w).getAttribute('title'), EXPANDED[l], `${l}: expanded title`);

    tab(w).click();
    assert.equal(
      tab(w).getAttribute('aria-label'),
      COLLAPSED[l],
      `${l}: collapsed aria-label must say "expand", not "collapse"`,
    );
    assert.equal(tab(w).getAttribute('title'), COLLAPSED[l], `${l}: collapsed title`);

    tab(w).click();
    assert.equal(tab(w).getAttribute('aria-label'), EXPANDED[l], `${l}: back to expanded`);

    unmount();
    w.close();
  }
});

test('F-10: a restored collapsed state renders the expand label, not the collapse label', () => {
  const { w, shell, unmount } = setup({ lang: 'ru', collapsed: true });
  assert.equal(shell.classList.contains('is-nav-collapsed'), true, 'localStorage state restored');
  assert.equal(tab(w).getAttribute('aria-label'), COLLAPSED.ru);
  assert.equal(tab(w).getAttribute('title'), COLLAPSED.ru);
  unmount();
  w.close();
});

test('F-10: the label re-localises AND keeps the collapsed sense across a lang switch', () => {
  const { w, unmount } = setup({ lang: 'uk' });
  tab(w).click(); // collapse
  assert.equal(tab(w).getAttribute('aria-label'), COLLAPSED.uk);

  switchLang(w, 'ru');
  assert.equal(
    tab(w).getAttribute('aria-label'),
    COLLAPSED.ru,
    'collapsed + RU must read "Развернуть меню" (pre-fix: "Свернуть меню")',
  );
  assert.equal(tab(w).getAttribute('title'), COLLAPSED.ru);

  tab(w).click(); // expand
  assert.equal(tab(w).getAttribute('aria-label'), EXPANDED.ru);
  unmount();
  w.close();
});

// ── 3. Sanity: the re-render that caused all this still does its job ─────

test('nav re-renders its item labels and locale-prefixed hrefs on kt:lang-change', () => {
  const { w, root, unmount } = setup({ lang: 'uk' });
  const item = () => root.querySelector('.kt-nav__item[data-route="/library"]');
  assert.equal(item().querySelector('.kt-nav__label').textContent, 'Зразки');
  assert.equal(item().getAttribute('href'), '/uk/library');

  switchLang(w, 'ru');
  assert.equal(item().querySelector('.kt-nav__label').textContent, 'Образцы');
  assert.equal(item().getAttribute('href'), '/ru/library');

  switchLang(w, 'en');
  // v2 renames the rail label Library -> Samples. The ROUTE deliberately
  // stays /library, asserted on every locale above: a label is free to
  // change, a live URL is not.
  assert.equal(item().querySelector('.kt-nav__label').textContent, 'Samples');
  assert.equal(item().getAttribute('href'), '/library');

  unmount();
  w.close();
});

// ── 4. What the v2 rail must not lose ───────────────────────────────────

test('Streams keeps its "preview" qualifier after the rename', () => {
  // /live is a preview over synthetic traffic (ROADMAP Decision A), and
  // contracts/locales-versioning.md forbids dropping a stated limitation.
  // v2 shortened the label from "Live (preview)" to "Streams", so the
  // qualifier has to survive somewhere the user actually reads — the
  // badge, the tooltip and the accessible name — in all three locales.
  for (const [lang, badge] of [
    ['en', 'preview'],
    ['uk', 'прев’ю'],
    ['ru', 'превью'],
  ]) {
    const { w, root, unmount } = setup({ lang });
    const item = root.querySelector('.kt-nav__item[data-route="/live"]');
    assert.ok(item, `${lang}: /live must still be in the rail`);
    assert.equal(
      item.querySelector('.kt-nav__badge').textContent,
      badge,
      `${lang}: the preview qualifier must survive the shorter label`,
    );
    assert.match(
      item.getAttribute('aria-label'),
      new RegExp(badge.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${lang}: a screen reader must hear the qualifier too`,
    );
    unmount();
    w.close();
  }
});

test('Behavior leaves the rail without taking its route with it', () => {
  // v2 demotes Behavior to a tab inside the Inspector. Dropping the nav
  // entry is intended; dropping the route would 404 every existing link.
  const { w, root, unmount } = setup({ lang: 'en' });
  assert.equal(
    root.querySelector('.kt-nav__item[data-route="/behavior"]'),
    null,
    'Behavior must not be a rail destination in v2',
  );
  unmount();
  w.close();

  const routes = fs.readFileSync(path.join(__dirname, '..', 'lib/locale-routes.js'), 'utf8');
  assert.match(routes, /['"]behavior['"]/, '/behavior must still resolve as a route');
  const boot = fs.readFileSync(path.join(__dirname, '..', 'public/shell-boot.js'), 'utf8');
  assert.match(boot, /registerLazy\(\s*['"]behavior['"]/, '/behavior must still be registered');
});

test('the rail renders line icons, not emoji', () => {
  // Emoji resolve to a different font per OS, carry their own colour, and
  // sat off the text baseline — which is what made the rail look ragged.
  //
  // This asserts the RENDERED rail, not the module source: the first cut
  // grepped the file and failed on the comment that lists the emoji being
  // replaced. A source grep answers "does this string appear", which is not
  // the question — the question is what reaches the user.
  const { w, root, unmount } = setup({ lang: 'en' });

  const rendered = root.innerHTML;
  // U+FE0F (variation selector) is matched as its own alternative rather than
  // as a class member: inside a character class it combines with the
  // preceding range and the class stops meaning what it reads as.
  const emoji = rendered.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/gu);
  assert.equal(
    emoji,
    null,
    `the rail still paints emoji: ${emoji ? [...new Set(emoji)].join(' ') : ''}`,
  );

  const items = root.querySelectorAll('.kt-nav__item');
  assert.ok(items.length >= 7, 'every section is still in the rail');
  for (const item of items) {
    const svg = item.querySelector('.kt-nav__icon svg');
    assert.ok(svg, `${item.getAttribute('data-route')} must carry an svg icon`);
    assert.equal(
      svg.getAttribute('stroke'),
      'currentColor',
      `${item.getAttribute('data-route')}: the icon must inherit the item's colour`,
    );
    assert.ok(
      svg.innerHTML.trim().length > 0,
      `${item.getAttribute('data-route')}: icon must have geometry, not be an empty svg`,
    );
  }

  unmount();
  w.close();
});
