/* global document, getComputedStyle */
'use strict';

/**
 * tests/mobile-inspector-browser.test.js — the Inspector on a phone.
 *
 * WHY THIS EXISTS
 * ---------------
 * A second audit of v1.14.1 found the Inspector unusable below ~600px, and
 * measuring it confirmed worse than was reported. On a 390px screen the
 * topbar laid out 545px of content, so the language menu sat at x=496 —
 * entirely off the screen; the workbar laid out 499px, so of the primary
 * action, Analyze, 24 of its 133 pixels were visible; and the two-column
 * split never stacked, giving the editor and the results 195px each.
 *
 * Two separate causes, one shape. Both files had a correct responsive block
 * that had been overtaken:
 *
 *   - topbar.css swapped the inline search for a 🔎 button at ≤600px, then
 *     re-declared .kt-topbar__search and .kt-topbar__search-btn further down
 *     the file outside any media query. Equal specificity, later source
 *     position, so the phone rules lost and nothing said so.
 *   - inspector.css stacked the split with `flex-direction: column`, written
 *     when .workbench-split was a flex row. v2 rebuilt it as a grid and the
 *     rule quietly became a no-op.
 *
 * WHAT THIS ASSERTS, AND WHY IT IS SHAPED THIS WAY
 * -----------------------------------------------
 * Nothing here mentions a selector's position in a file, a media query, or
 * a property name. The defect WAS the rule order, so a test written in terms
 * of rules would have to be right about the same thing the code got wrong.
 * These assertions are about outcomes a person would notice: does anything
 * lie outside the screen, is every offered control whole, is the editor as
 * wide as the phone. A future refactor is free to reach them any way it
 * likes.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

let puppeteer = null;
let puppeteerLoadError = '';
try {
  puppeteer = require('puppeteer-core');
} catch (err) {
  puppeteerLoadError = err instanceof Error ? err.message : String(err);
}

const ROOT = path.join(__dirname, '..');

function findChromeExecutable() {
  return [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
    .filter(Boolean)
    .find((c) => {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return true;
      } catch (_e) {
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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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
        NEWS_CRAWLER_DISABLED: '1',
        FX_DISABLED: '1',
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
    proc.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    proc.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server exited ${code}`));
      }
    });
  });
}

/* The narrowest phones still in wide use, plus one large phone. 390 is the
   iPhone 12–15 class and the width the audit reported against. */
const PHONE_WIDTHS = [360, 390, 414];

/* Chrome that is offered on a phone must be offered whole. The rail and its
   contents are excluded on purpose: below 1024px the rail IS off-screen, as
   a closed drawer, which is the design rather than a defect. */
const MUST_BE_WHOLE = [
  { name: 'the language menu', selector: '.kt-topbar .kt-lang-menu' },
  { name: 'the search button', selector: '.kt-topbar__search-btn' },
  { name: 'the nav hamburger', selector: '.kt-topbar__nav-toggle' },
  { name: 'Analyze', selector: '#analyzeBtn' },
  { name: 'the sample menu', selector: '.workbar .kt-example-menu > summary' },
  { name: 'the tools menu', selector: '.workbar .kt-tools-menu > summary' },
];

/* Rows that lay their children out horizontally and clip whatever does not
   fit. If content is wider than the box, something is off the screen. */
const MUST_NOT_OVERFLOW = ['.kt-topbar', '.workbar', '.kt-shell'];

test(
  'browser: the Inspector fits a phone — nothing clipped, one column, primary action whole',
  { timeout: 240000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-mobile-'));
    const port = await getFreePort();
    let serverInfo = null;
    let browser = null;

    try {
      serverInfo = await startServer(port, dataDir);
      browser = await puppeteer.launch({
        headless: true,
        executablePath: chromeExecutable,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      for (const width of PHONE_WIDTHS) {
        const page = await browser.newPage();
        await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
        await page.goto(`${serverInfo.url}/uk/inspector`, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
        await delay(2400);

        const seen = await page.evaluate(
          (vw, whole, rows) => {
            const clipped = [];
            for (const { name, selector } of whole) {
              const el = document.querySelector(selector);
              if (!el) continue;
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') continue;
              if (/** @type {any} */ (el).hidden) continue;
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              const visible = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
              if (visible < r.width - 1) {
                clipped.push(
                  `${name}: ${Math.round(visible)} of ${Math.round(r.width)}px visible, at x=${Math.round(r.x)}`,
                );
              }
            }
            const overflowing = [];
            for (const selector of rows) {
              const el = document.querySelector(selector);
              if (!el) continue;
              if (el.scrollWidth > el.clientWidth + 1) {
                overflowing.push(
                  `${selector}: lays out ${el.scrollWidth}px inside ${el.clientWidth}px`,
                );
              }
            }
            /* Search is asked about by outcome rather than by mechanism.
               The page may offer a 🔎 button that expands an overlay, or an
               inline input, and either is fine — what is not fine is an
               input technically present with no room to type in. Measured
               with the phone rules disabled: the inline field survives at
               79px on a 360px screen, of which 74px is the icon and the ⌘K
               hint, leaving five pixels of text. */
            const searchBtn = document.querySelector('.kt-topbar__search-btn');
            const btnVisible =
              searchBtn &&
              getComputedStyle(searchBtn).display !== 'none' &&
              searchBtn.getBoundingClientRect().width > 0;
            const searchInput = document.querySelector('.kt-topbar__search-input');
            let typingRoom = null;
            if (searchInput) {
              const ics = getComputedStyle(searchInput);
              const wrap = document.querySelector('.kt-topbar__search');
              const wrapShown = wrap && getComputedStyle(wrap).display !== 'none';
              if (wrapShown) {
                typingRoom = Math.round(
                  searchInput.getBoundingClientRect().width -
                    parseFloat(ics.paddingLeft || '0') -
                    parseFloat(ics.paddingRight || '0'),
                );
              }
            }

            const split = document.querySelector('.workbench-split');
            const editor = document.querySelector('.workbench-payload');
            return {
              clipped,
              overflowing,
              search: { button: !!btnVisible, typingRoom },
              columns: split ? getComputedStyle(split).gridTemplateColumns : '(no split)',
              editorWidth: editor ? Math.round(editor.getBoundingClientRect().width) : 0,
              pageScrollWidth: document.documentElement.scrollWidth,
            };
          },
          width,
          MUST_BE_WHOLE,
          MUST_NOT_OVERFLOW,
        );

        assert.deepEqual(
          seen.clipped,
          [],
          `${width}px: controls run off the screen — ${seen.clipped.join('; ')}. ` +
            'A control the phone cannot show is a control the phone does not have.',
        );

        assert.ok(
          seen.search.button || (seen.search.typingRoom !== null && seen.search.typingRoom >= 80),
          `${width}px: search is offered but not usable — no 🔎 button, and the inline field ` +
            `leaves ${seen.search.typingRoom}px for text after its icon and ⌘K hint. ` +
            'Either give the phone the button, or leave the field enough room to read what ' +
            'is being typed.',
        );

        assert.deepEqual(
          seen.overflowing,
          [],
          `${width}px: ${seen.overflowing.join('; ')}. Content wider than its row is content ` +
            'past the right edge of the phone.',
        );

        // One column, stated as a count rather than as a CSS string: the
        // template may legitimately be `1fr`, `minmax(0, 1fr)` or a computed
        // pixel value, and all three mean the same thing to the reader.
        const columnCount = seen.columns.trim().split(/\s+/).filter(Boolean).length;
        assert.equal(
          columnCount,
          1,
          `${width}px: the workbench still has ${columnCount} columns (${seen.columns}). ` +
            'Side-by-side editor and results on a phone leave both too narrow to read.',
        );

        assert.ok(
          seen.editorWidth >= width * 0.9,
          `${width}px: the editor is only ${seen.editorWidth}px wide. Stacked, it should have ` +
            'very nearly the whole screen.',
        );

        assert.ok(
          seen.pageScrollWidth <= width + 1,
          `${width}px: the page itself scrolls sideways (${seen.pageScrollWidth}px).`,
        );

        await page.close();
      }

      // The desktop layout must survive the phone fix: this is the pair the
      // mockup specifies, and the ≤1100px block is one bad selector away
      // from applying everywhere.
      const desk = await browser.newPage();
      await desk.setViewport({ width: 1600, height: 1000 });
      await desk.goto(`${serverInfo.url}/uk/inspector`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      await delay(2400);
      const deskColumns = await desk.evaluate(() => {
        const split = document.querySelector('.workbench-split');
        return split ? getComputedStyle(split).gridTemplateColumns : '(no split)';
      });
      assert.equal(
        deskColumns.trim().split(/\s+/).filter(Boolean).length,
        2,
        `at 1600px the workbench should still be two columns, got "${deskColumns}"`,
      );
      await desk.close();
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) await stopChild(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
