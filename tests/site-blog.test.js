'use strict';

/**
 * tests/site-blog.test.js — /blog section module (public/modules/blog/).
 *
 * Guards the four client-side defects fixed in this pass:
 *   1. the listing stopped at a hardcoded limit=50 and never sent an offset,
 *      so post 51+ was unreachable from the UI;
 *   2. a superseded filter response repainted the grid after a newer click,
 *      so the active chip and the cards disagreed;
 *   3. failures rendered a raw English "Error: HTTP 503", and on the post view
 *      they wiped the "← Back to blog" link, leaving no way out;
 *   4. an unbroken token in a post body ran off the right edge of the card
 *      (no overflow-wrap anywhere in blog.css).
 * Plus: the RSS feed at /blog/rss.xml had no link anywhere in the blog UI.
 *
 * The DOM half runs the real browser module through the shared
 * browser-esm-loader (same root-absolute import rewriting the blog markdown
 * tests use), with a scripted fetch — no network, no ClickHouse.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { createBrowserEsmLoader } = require('./browser-esm-loader');

const BLOG_CSS = path.resolve(__dirname, '..', 'public', 'modules', 'blog', 'blog.css');

// ── helpers ────────────────────────────────────────────────────────────────

function installGlobals(values) {
  const originals = new Map();
  for (const [name, value] of Object.entries(values)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeout = 3000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(5);
  }
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

/**
 * Mounts the real /blog module in jsdom.
 *
 * `respond(url, init, callIndex)` returns a Response-like object (or throws /
 * rejects to simulate a network failure). It deliberately IGNORES init.signal:
 * a stub that honoured abort would only ever exercise the abort path, and the
 * point of the ordering guard is that a response which arrives anyway — already
 * buffered when the newer click landed — must still not repaint the grid.
 */
async function mountBlog({ lang = 'en', url = 'https://ortbtools.test/blog', respond, salt }) {
  const dom = new JSDOM('<!doctype html><body><main id="app-root"></main></body>', {
    runScripts: 'outside-only',
    url,
  });
  const { window } = dom;
  const root = window.document.getElementById('app-root');
  const calls = [];

  const fetchImpl = async (input, init) => {
    const requestUrl = String(input && input.url ? input.url : input);
    calls.push(requestUrl);
    return respond(requestUrl, init, calls.length);
  };
  window.fetch = fetchImpl;

  const restore = installGlobals({
    AbortController: window.AbortController,
    AbortSignal: window.AbortSignal,
    CustomEvent: window.CustomEvent,
    DocumentFragment: window.DocumentFragment,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    URL: window.URL,
    URLSearchParams: window.URLSearchParams,
    document: window.document,
    fetch: fetchImpl,
    location: window.location,
    navigator: window.navigator,
    window,
  });

  let blogModule;
  try {
    blogModule = await createBrowserEsmLoader({ realmSalt: salt }).import('/modules/blog/index.js');
  } catch (error) {
    restore();
    window.close();
    throw error;
  }

  const controller = new window.AbortController();
  const ctx = { addCleanup() {}, lang, signal: controller.signal };

  return {
    calls,
    ctx,
    root,
    window,
    async mount() {
      await blogModule.default.mount(root, ctx);
    },
    click(selector) {
      const el = root.querySelector(selector);
      assert.ok(el, `expected ${selector} to exist`);
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    text(selector) {
      const el = root.querySelector(selector);
      return el ? el.textContent.trim() : null;
    },
    close() {
      controller.abort();
      restore();
      window.close();
    },
  };
}

function fakePosts(total, postLang = 'en') {
  return Array.from({ length: total }, (_, i) => ({
    slug: `post-${String(i + 1).padStart(3, '0')}`,
    lang: postLang,
    title: `Post ${i + 1}`,
    category: 'guide',
    summary: `Summary ${i + 1}`,
    published_at: '2026-08-01T10:00:00Z',
    source: 'markdown',
  }));
}

function paramsOf(url) {
  return new URL(url, 'https://ortbtools.test').searchParams;
}

// ── 1. pagination ──────────────────────────────────────────────────────────

test('listing pages through the whole corpus instead of stopping at the first slab', async () => {
  const corpus = fakePosts(66);
  const harness = await mountBlog({
    salt: 'site-blog-pagination',
    respond(url) {
      const q = paramsOf(url);
      const offset = Number(q.get('offset') || 0);
      const limit = Number(q.get('limit') || 20);
      return jsonResponse({
        ok: true,
        count: corpus.length,
        items: corpus.slice(offset, offset + limit),
      });
    },
  });

  try {
    await harness.mount();
    await waitFor(() => harness.root.querySelectorAll('.blog-card').length === 50, {
      label: 'first page of cards',
    });

    assert.equal(harness.text('.blog-pager__count'), 'Showing 50 of 66');
    assert.ok(harness.root.querySelector('[data-more]'), 'expected a "show more" control');

    harness.click('[data-more]');
    await waitFor(() => harness.root.querySelectorAll('.blog-card').length === 66, {
      label: 'second page appended',
    });

    // The second request must ask for the NEXT window, not repeat the first.
    assert.equal(harness.calls.length, 2);
    assert.equal(paramsOf(harness.calls[1]).get('offset'), '50');
    assert.equal(harness.text('.blog-pager__count'), 'Showing 66 of 66');
    assert.equal(harness.root.querySelector('[data-more]'), null, 'no more pages to ask for');

    // Every post is reachable exactly once — no duplicates, nothing dropped.
    const hrefs = [...harness.root.querySelectorAll('.blog-card')].map((c) => c.dataset.href);
    assert.equal(new Set(hrefs).size, 66);
    assert.ok(
      hrefs.some((h) => h.endsWith('/post-066')),
      'the 66th post is reachable',
    );
  } finally {
    harness.close();
  }
});

test('a corpus that fits on one page shows no pager at all', async () => {
  const corpus = fakePosts(3);
  const harness = await mountBlog({
    salt: 'site-blog-single-page',
    respond: () => jsonResponse({ ok: true, count: corpus.length, items: corpus }),
  });

  try {
    await harness.mount();
    await waitFor(() => harness.root.querySelectorAll('.blog-card').length === 3, {
      label: 'cards',
    });
    assert.equal(harness.root.querySelector('#blogPager').hidden, true);
    assert.equal(harness.root.querySelector('[data-more]'), null);
  } finally {
    harness.close();
  }
});

// ── 2. request ordering ────────────────────────────────────────────────────

test('a superseded filter response never repaints the grid', async () => {
  const harness = await mountBlog({
    salt: 'site-blog-race',
    async respond(url) {
      const lang = paramsOf(url).get('lang');
      if (lang === 'uk') {
        await sleep(80); // the slow one — clicked FIRST
        return jsonResponse({ ok: true, count: 1, items: fakePosts(1, 'uk') });
      }
      if (lang === 'ru') {
        await sleep(5); // the fast one — clicked LAST, and it must win
        return jsonResponse({ ok: true, count: 1, items: fakePosts(1, 'ru') });
      }
      return jsonResponse({ ok: true, count: 1, items: fakePosts(1, 'en') });
    },
  });

  try {
    await harness.mount();
    await waitFor(() => harness.root.querySelector('.blog-card'), { label: 'initial load' });

    harness.click('#langChips [data-lang="uk"]');
    await sleep(10);
    harness.click('#langChips [data-lang="ru"]');

    // Long enough for the stale UK response to land after the RU one.
    await sleep(200);

    const activeChip = harness.root.querySelector('#langChips .blog-chip.is-active');
    assert.equal(activeChip.dataset.lang, 'ru', 'the chip records the last click');
    const badges = [...harness.root.querySelectorAll('.blog-card__lang')].map((n) =>
      n.textContent.trim(),
    );
    assert.deepEqual(
      [...new Set(badges)],
      ['RU'],
      'the grid must show what the active chip claims',
    );
  } finally {
    harness.close();
  }
});

// ── 3. failure states ──────────────────────────────────────────────────────

test('a failed listing speaks the page language and offers a retry that works', async () => {
  let healthy = false;
  const harness = await mountBlog({
    lang: 'uk',
    url: 'https://ortbtools.test/uk/blog',
    salt: 'site-blog-list-error',
    respond() {
      if (!healthy) return jsonResponse({ ok: false }, { ok: false, status: 503 });
      return jsonResponse({ ok: true, count: 2, items: fakePosts(2, 'uk') });
    },
  });

  try {
    await harness.mount();
    await waitFor(() => harness.root.querySelector('.blog-error'), { label: 'error block' });

    assert.equal(harness.text('.blog-error__msg'), 'Не вдалося завантажити пости.');
    assert.equal(harness.text('.blog-error__detail'), 'HTTP 503', 'the technical detail survives');
    assert.equal(harness.text('[data-retry]'), 'Спробувати ще раз');
    assert.doesNotMatch(
      harness.root.textContent,
      /Error: HTTP/u,
      'no raw English error string anywhere',
    );

    healthy = true;
    harness.click('[data-retry]');
    await waitFor(() => harness.root.querySelectorAll('.blog-card').length === 2, {
      label: 'retry recovers',
    });
    assert.equal(harness.root.querySelector('.blog-error'), null);
  } finally {
    harness.close();
  }
});

test('a failed post keeps the way back to the listing', async () => {
  let healthy = false;
  const harness = await mountBlog({
    lang: 'uk',
    url: 'https://ortbtools.test/uk/blog/uk/welcome',
    salt: 'site-blog-post-error',
    respond() {
      if (!healthy) throw new TypeError('Failed to fetch');
      return jsonResponse({
        ok: true,
        post: {
          slug: 'welcome',
          lang: 'uk',
          title: 'Вітаємо',
          category: 'guide',
          published_at: '2026-08-01T10:00:00Z',
          body: 'Тіло поста.',
          source: 'markdown',
        },
      });
    },
  });

  try {
    await harness.mount();
    await waitFor(() => harness.root.querySelector('.blog-error'), { label: 'error block' });

    const back = harness.root.querySelector('.blog-back');
    assert.ok(back, 'the "back to blog" link must survive a failed load');
    assert.equal(back.getAttribute('href'), '/uk/blog');
    assert.equal(back.textContent.trim(), '← До блогу');
    assert.equal(harness.text('.blog-error__msg'), 'Не вдалося завантажити пост.');
    assert.equal(harness.text('[data-retry]'), 'Спробувати ще раз');

    healthy = true;
    harness.click('[data-retry]');
    await waitFor(() => harness.root.querySelector('.blog-post__title'), {
      label: 'retry renders',
    });
    assert.equal(harness.text('.blog-post__title'), 'Вітаємо');
    assert.ok(harness.root.querySelector('.blog-back'), 'and the way back is still there');
  } finally {
    harness.close();
  }
});

test('a missing post still renders the localized not-found screen', async () => {
  const harness = await mountBlog({
    lang: 'uk',
    url: 'https://ortbtools.test/uk/blog/uk/no-such-post',
    salt: 'site-blog-404',
    respond: () => jsonResponse({ ok: false }, { ok: false, status: 404 }),
  });

  try {
    await harness.mount();
    await waitFor(() => harness.root.querySelector('.blog-empty'), { label: 'not-found screen' });
    assert.equal(harness.text('.blog-empty'), 'Пост не знайдено.');
    assert.equal(harness.root.querySelector('.blog-back').getAttribute('href'), '/uk/blog');
  } finally {
    harness.close();
  }
});

// ── 4. RSS discoverability from the UI ─────────────────────────────────────

test('the listing links the RSS feed', async () => {
  const harness = await mountBlog({
    lang: 'uk',
    url: 'https://ortbtools.test/uk/blog',
    salt: 'site-blog-rss',
    respond: () => jsonResponse({ ok: true, count: 1, items: fakePosts(1, 'uk') }),
  });

  try {
    await harness.mount();
    const link = harness.root.querySelector('a.blog-rss');
    assert.ok(link, 'the blog header must point at the feed');
    assert.equal(link.getAttribute('href'), '/blog/rss.xml');
    assert.equal(link.getAttribute('title'), 'RSS-стрічка');
    // shell-boot's click interceptor skips paths containing a dot AND anything
    // marked data-external — the feed must reach the server, not the SPA router.
    assert.ok(link.getAttribute('href').includes('.'));
    assert.ok(link.hasAttribute('data-external'));
  } finally {
    harness.close();
  }
});

// ── 5. long-token overflow (stylesheet contract) ───────────────────────────

function ruleBody(css, selector) {
  const index = css.indexOf(`\n${selector} {`);
  assert.notEqual(index, -1, `expected a rule for ${selector}`);
  const start = css.indexOf('{', index);
  const end = css.indexOf('}', start);
  return css.slice(start + 1, end);
}

test('post bodies break unbreakable tokens instead of running off the card', () => {
  const css = fs.readFileSync(BLOG_CSS, 'utf8');

  assert.match(
    ruleBody(css, '.blog-post__body'),
    /overflow-wrap:\s*anywhere/u,
    'a 200-char token must wrap inside the article column',
  );
  // Code blocks scroll on their own; wrapping them would mangle source lines.
  assert.match(ruleBody(css, '.blog-post__body pre'), /overflow-wrap:\s*normal/u);
  assert.match(ruleBody(css, '.blog-post__body pre'), /overflow-x:\s*auto/u);
  // Cards live in a grid track: an unbroken title would set the min-content
  // width and blow the whole column out.
  assert.match(ruleBody(css, '.blog-card__title'), /overflow-wrap:\s*anywhere/u);
  assert.match(ruleBody(css, '.blog-card__summary'), /overflow-wrap:\s*anywhere/u);
  assert.match(ruleBody(css, '.blog-post__title'), /overflow-wrap:\s*anywhere/u);
});
