/* global window, document */
'use strict';

/**
 * tests/site-docs.test.js — the /docs section's own navigation.
 *
 * Two defects are pinned here, both about a reader you cannot get back into:
 *
 *   1. The finding catalog draws the reader's contents sidebar but used to
 *      leave every fragment link in it dead — the delegated handler lived in
 *      mountReader() and the catalog never installed one. Clicking a topic on
 *      /docs/findings changed nothing: not the article, not the URL, not even
 *      the active mark. The tests below click through the sidebar from the
 *      catalog and demand a real move to the reader.
 *
 *   2. The sticky contents column was capped at 100vh while starting one
 *      topbar BELOW the top of the window, so it always hung exactly one
 *      topbar past the bottom edge and the last entry ("Embedding a view")
 *      could not be scrolled to on a window shorter than ~780px. The browser
 *      test measures that entry against the visible area; the source test
 *      states the same rule where it is cheap to check.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { JSDOM } = require('jsdom');
const { createBrowserEsmLoader } = require('./browser-esm-loader');
const findingCatalog = require('../modules/findings/handler');

const ROOT = path.join(__dirname, '..');
const DOCS_CSS = path.join(ROOT, 'public', 'modules', 'docs', 'docs.css');

// ── The catalog payload the section fetches ──────────────────────
function servedCatalog(lang) {
  const route = findingCatalog.routes.find((r) => r.path === '/api/v1/finding-catalog');
  let body = '';
  const res = {
    setHeader() {},
    writeHead() {},
    end(chunk) {
      body = String(chunk == null ? '' : chunk);
    },
  };
  route.handler({ url: `/api/v1/finding-catalog?lang=${lang}` }, res);
  return JSON.parse(body);
}

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

/**
 * Mount the docs section into a jsdom realm at the given URL — the same shape
 * spec-refs.test.js uses for the catalog table, kept local so this file owns
 * its own harness.
 */
async function mountDocs({ url, lang, realmSalt }) {
  const payload = servedCatalog(lang);
  const dom = new JSDOM('<!doctype html><body><main id="app-root"></main></body>', {
    runScripts: 'outside-only',
    url,
  });
  const { window } = dom;
  const root = window.document.getElementById('app-root');

  const browserFetch = async (input) => {
    const href = String(input && input.url ? input.url : input);
    if (href.startsWith('/api/v1/finding-catalog')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return payload;
        },
      };
    }
    throw new Error(`unexpected fetch in the docs section test: ${href}`);
  };

  const restoreGlobals = installGlobals({
    AbortController: window.AbortController,
    AbortSignal: window.AbortSignal,
    CustomEvent: window.CustomEvent,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    URL: window.URL,
    document: window.document,
    fetch: browserFetch,
    history: window.history,
    location: window.location,
    window,
  });

  const controller = new window.AbortController();
  try {
    const loader = createBrowserEsmLoader({ realmSalt });
    const mod = await loader.import('/modules/docs/index.js');
    await mod.default.mount(root, { lang, signal: controller.signal });
  } catch (error) {
    controller.abort();
    restoreGlobals();
    window.close();
    throw error;
  }

  return {
    root,
    window,
    payload,
    click(el) {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    close() {
      controller.abort();
      restoreGlobals();
      window.close();
    },
  };
}

const topicLinks = (root) => [...root.querySelectorAll('.docs-toc__link[data-topic]')];
const heading = (root) => {
  const h = root.querySelector('.docs-h1');
  return h ? h.textContent.trim() : '';
};
const activeTopics = (root) =>
  [...root.querySelectorAll('.docs-toc__link.is-active')].map((a) => a.dataset.topic || 'catalog');

// ── 1. Every contents link works from the catalog ────────────────

test('docs catalog: every contents topic opens its article', async () => {
  const harness = await mountDocs({
    url: 'https://ortbtools.test/docs/findings',
    lang: 'en',
    realmSalt: 'site-docs-catalog-toc',
  });

  try {
    const { root, click, window } = harness;
    const ids = topicLinks(root).map((a) => a.dataset.topic);
    assert.ok(ids.length >= 10, `the catalog must draw the contents sidebar, saw ${ids.length}`);
    assert.equal(heading(root), 'Finding catalog', 'the catalog is what mounted');

    // One click, from the catalog, on the first topic in the list. This is the
    // exact gesture that used to do nothing at all.
    click(topicLinks(root)[0]);
    assert.notEqual(heading(root), 'Finding catalog', 'the article must change');
    assert.equal(window.location.pathname, '/docs', 'the reader is a different route');
    assert.equal(window.location.hash, '#' + ids[0], 'the fragment must name the topic');
    assert.deepEqual(activeTopics(root), [ids[0]], 'the active mark must move with it');
    assert.equal(root.querySelectorAll('.docs-table').length, 0, 'the table must be gone');
  } finally {
    harness.close();
  }
});

test('docs catalog: the sidebar still works after it has handed over', async () => {
  const harness = await mountDocs({
    url: 'https://ortbtools.test/docs/findings',
    lang: 'en',
    realmSalt: 'site-docs-catalog-handover',
  });

  try {
    const { root, click, window } = harness;
    const ids = topicLinks(root).map((a) => a.dataset.topic);

    // Walk the whole contents list from the catalog: the first click hands the
    // root to the reader, and every one after it is the reader's own. Both the
    // catalog's handler and the reader's are bound to the same root, so a
    // double-handled click would show here as a heading or URL that does not
    // match the link that was clicked.
    for (const id of ids) {
      const link = root.querySelector(`.docs-toc__link[data-topic="${id}"]`);
      assert.ok(link, `contents link ${id} must survive the re-render`);
      click(link);
      assert.equal(window.location.hash, '#' + id, `clicking ${id} must address ${id}`);
      assert.deepEqual(activeTopics(root), [id], `clicking ${id} must mark ${id}`);
      assert.ok(heading(root).length > 0, `clicking ${id} must render an article`);
    }

    // Back out of the reader: the fragment is a real history entry, so the
    // catalog is still reachable behind it.
    assert.ok(
      window.history.length > ids.length,
      'each topic must leave a history entry rather than replacing one',
    );
  } finally {
    harness.close();
  }
});

test('docs contents: a topic href addresses the reader from wherever it is drawn', async () => {
  const reader = await mountDocs({
    url: 'https://ortbtools.test/docs',
    lang: 'en',
    realmSalt: 'site-docs-href-reader',
  });
  let catalog = null;
  try {
    // On the reader the topic IS a fragment of the page you are on.
    for (const a of topicLinks(reader.root)) {
      assert.equal(
        a.getAttribute('href'),
        '#' + a.dataset.topic,
        'the reader addresses its own topics as bare fragments',
      );
    }
    reader.close();

    // On the catalog the same fragment would name a topic this page does not
    // render, so the href has to carry the reader's path — which is what a
    // middle-click or ⌘-click opens, bypassing every handler we install.
    catalog = await mountDocs({
      url: 'https://ortbtools.test/uk/docs/findings',
      lang: 'uk',
      realmSalt: 'site-docs-href-catalog',
    });
    for (const a of topicLinks(catalog.root)) {
      assert.equal(
        a.getAttribute('href'),
        '/uk/docs#' + a.dataset.topic,
        'the catalog addresses topics on the reader, under the active locale',
      );
    }
  } finally {
    if (catalog) catalog.close();
  }
});

// ── 2. The sticky contents column fits under the topbar ──────────

test('docs contents: the sticky column is capped below the topbar, not at 100vh', () => {
  const css = fs.readFileSync(DOCS_CSS, 'utf8');
  const rule = css.match(/\.docs-toc__inner\s*\{([^}]*)\}/u);
  assert.ok(rule, '.docs-toc__inner must exist in docs.css');
  const maxHeight = rule[1].match(/max-height:\s*([^;]+);/u);
  assert.ok(maxHeight, '.docs-toc__inner must cap its own height');
  const value = maxHeight[1].trim();
  assert.notEqual(
    value,
    '100vh',
    'the column starts under the topbar, so a full 100vh always hangs one topbar off-screen',
  );
  assert.match(
    value,
    /calc\(\s*100vh\s*-\s*var\(--kt-topbar-height/u,
    'the cap must subtract the topbar height from the same token the topbar uses',
  );
});

// ── The same rule, measured in a real browser ────────────────────

let puppeteer = null;
let puppeteerLoadError = '';
try {
  puppeteer = require('puppeteer-core');
} catch (err) {
  puppeteerLoadError = err instanceof Error ? err.message : String(err);
}

function findChromeExecutable() {
  return [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
    .filter(Boolean)
    .find((candidate) => {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch (_err) {
        return false;
      }
    });
}

const chromeExecutable = findChromeExecutable();
const browserSkipReason = !puppeteer
  ? `puppeteer-core unavailable: ${puppeteerLoadError}`
  : !chromeExecutable
    ? 'No executable Chrome/Chromium found; set CHROME_BIN'
    : false;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = /** @type {import('net').AddressInfo} */ (srv.address()).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function stopChild(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    }, 2000);
    proc.once('exit', finish);
    proc.kill('SIGTERM');
  });
}

function startServer(port, dataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        ORTBTOOLS_DATA_DIR: dataDir,
        ORTBTOOLS_ANALYTICS_DISABLED: '1',
      },
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error('Server did not start within 10s'));
      }
    }, 10000);
    const onData = (chunk) => {
      if (!started && chunk.toString().includes('listening')) {
        started = true;
        clearTimeout(timeout);
        resolve({ proc, url: `http://127.0.0.1:${port}` });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server exited ${code}`));
      }
    });
  });
}

test(
  'browser: the last contents entry can be scrolled to on a short window',
  { timeout: 120000, skip: browserSkipReason },
  async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-site-docs-'));
    const port = await getFreePort();
    let serverInfo = null;
    let browser = null;

    try {
      serverInfo = await startServer(port, dataDir);
      browser = await puppeteer.launch({
        executablePath: chromeExecutable,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
        headless: true,
      });

      // 600px of window is what a 1366x768 laptop has left after browser
      // chrome — the case the 100vh cap could not serve.
      for (const route of ['/docs', '/docs/findings']) {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 600 });
        await page.goto(serverInfo.url + route, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.docs-toc__link', { timeout: 15000 });
        await new Promise((r) => setTimeout(r, 400));

        const measured = await page.evaluate(() => {
          const inner = document.querySelector('.docs-toc__inner');
          inner.scrollTop = inner.scrollHeight; // scroll the list to its end
          const links = [...document.querySelectorAll('.docs-toc__link')];
          const last = links[links.length - 1];
          const rect = last.getBoundingClientRect();
          const topbar = document.querySelector('.kt-topbar').getBoundingClientRect();
          return {
            label: last.textContent.trim(),
            top: rect.top,
            bottom: rect.bottom,
            topbarBottom: topbar.bottom,
            windowHeight: window.innerHeight,
          };
        });

        assert.ok(
          measured.bottom <= measured.windowHeight,
          `${route}: "${measured.label}" ends at ${measured.bottom} in a ${measured.windowHeight}px window`,
        );
        assert.ok(
          measured.top >= measured.topbarBottom,
          `${route}: "${measured.label}" starts at ${measured.top}, under the topbar's ${measured.topbarBottom}`,
        );
        await page.close();
      }
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) await stopChild(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
