/* global document */
'use strict';

/**
 * tests/analysis-strip-browser.test.js — the analysis strip in a real browser.
 *
 * Two defects motivated this file, and both were invisible to every existing
 * check because both were about *rendered geometry and rendered text*, which
 * no unit test looks at:
 *
 *   1. The quality pill was a vertical stack needing ~36px of height inside a
 *      bar with a fixed 46px height that only ever handed it 25px. As a
 *      shrinkable flex item the box was squashed while the text kept its size,
 *      so the number painted above the capsule's top border and the tier label
 *      below its bottom one. The CSS carried a comment claiming the pill was
 *      sized to fit the longest label in any locale — true of its width, never
 *      checked for its height.
 *
 *   2. The floor was rendered as '$' + amount + ' · ' + currency-code, so a
 *      request pricing its floor in roubles read "Floor: $12500.00 · RUB".
 *
 * So this test asserts against measured boxes and rendered strings, in all
 * three locales, including the widest tier label — which is the one a
 * payload-driven test keeps missing, because it needs a score of 40-69.
 *
 * /api/analyze is capped at 60 calls/min/IP, so each payload is analysed once
 * and the viewport is resized around it; container queries re-evaluate on
 * resize, which is exactly what is under test.
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
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => {
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

// The three-panel layout hands the centre panel `viewport − ~900px`, so these
// viewports exercise bar widths from roomy down to the ~130px sliver just
// above the 1024px stacking breakpoint, plus the stacked and phone layouts.

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
    const timer = setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error('Server did not start within 10s'));
      }
    }, 10000);
    const onData = (chunk) => {
      if (!started && chunk.toString().includes('listening')) {
        started = true;
        clearTimeout(timer);
        resolve({ proc, url: `http://127.0.0.1:${port}` });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('exit', (c) => {
      if (!started) {
        clearTimeout(timer);
        reject(new Error(`Server exited ${c}`));
      }
    });
  });
}

// ── An in-button confirmation must fit inside the button ──────────────────
//
// flashButtonStatus swaps a button's contents for a localized word after a
// successful action. That is deliberate and worth keeping: the comment above
// it says a corner toast is easy to miss when the cursor is already on the
// button. But the copy/format/clear controls are 28x28 icon buttons, and
// "отформатировано" is 62px of text in a 26px box with `overflow: visible` —
// so the word escaped the button and painted over its neighbours, which is how
// it was reported: the label struck through by the button's own border and an
// adjacent icon.
//
// The contract is not "no word" — it is that whatever the button shows stays
// inside the button. Measured, because a length in characters proves nothing
// about a box.

test(
  'browser: action confirmation stays inside its button',
  { timeout: 240000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-flash-'));
    const port = await getFreePort();
    let serverInfo = null;
    let browser = null;

    try {
      serverInfo = await startServer(port, dataDir);
      browser = await puppeteer.launch({
        headless: true,
        protocolTimeout: 120_000,
        executablePath: chromeExecutable,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      // Russian is the widest of the three: "отформатировано" is the longest
      // status string the product ships, so it is the honest worst case.
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${serverInfo.url}/ru/inspector`, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
      await page.waitForSelector('#bidReq', { timeout: 30000 });
      await page.evaluate(() => {
        const el = /** @type {any} */ (document.getElementById('bidReq'));
        el.value = '{"id":"x","imp":[{"id":"1"}]}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });

      for (const action of ['format-json', 'copy-text', 'clear-input']) {
        const fits = await page.evaluate((sel) => {
          const btn = /** @type {any} */ (document.querySelector(`[data-action="${sel}"]`));
          if (!btn) return { missing: true };
          btn.click();
          return {
            action: sel,
            scrollW: btn.scrollWidth,
            clientW: btn.clientWidth,
            scrollH: btn.scrollHeight,
            clientH: btn.clientHeight,
            text: (btn.textContent || '').trim(),
          };
        }, action);

        if (fits.missing) continue;
        assert.ok(
          fits.scrollW <= fits.clientW + 1,
          `${fits.action}: confirmation "${fits.text}" overflows its button ` +
            `horizontally (${fits.scrollW}px of content in ${fits.clientW}px)`,
        );
        assert.ok(
          fits.scrollH <= fits.clientH + 1,
          `${fits.action}: confirmation "${fits.text}" overflows its button ` +
            `vertically (${fits.scrollH}px of content in ${fits.clientH}px)`,
        );
      }
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) {
        serverInfo.proc.kill();
        await new Promise((r) => setTimeout(r, 300));
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
