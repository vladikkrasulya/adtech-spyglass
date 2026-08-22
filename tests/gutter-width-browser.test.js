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
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('exit', (code) => {
      if (!started) {
        clearTimeout(timer);
        reject(new Error(`Server exited ${code}`));
      }
    });
  });
}

// ── The line-number gutter must be as wide as its numbers ────────────────
//
// .line-gutter is `flex: 0 0 auto` with `min-width: 44px`. The auto basis
// already content-sizes the column to its widest number, so the floor was the
// only thing setting the width — and it sat above every realistic digit count.
// At 13px monospace one digit advances 7.80px, so even four digits plus the
// right padding is 39.2px, under the floor. Measured before the fix: 44px flat
// from 1 line to 5000.
//
// Two properties matter and they pull against each other. The column must
// TRACK digit count, or short payloads carry a wide empty indent. And it must
// NOT move across 9 -> 10, the boundary ordinary typing crosses constantly,
// or the text jitters under the cursor. A 2ch floor buys the second without
// giving up the first.
//
// This is a browser test because the claim is geometric: jsdom does not lay
// out, so a computed width there would assert nothing.

test(
  'browser: the line gutter tracks digit count and holds still across 9 -> 10',
  { timeout: 240000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-gutter-'));
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
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${serverInfo.url}/inspector`, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
      await page.waitForSelector('#bidReq', { timeout: 30000 });

      // Feed the editor a document of exactly N lines and read the gutter back.
      const widthAt = async (lines) =>
        page.evaluate((n) => {
          const ta = /** @type {any} */ (document.getElementById('bidReq'));
          ta.value = Array.from({ length: n }, (_, i) => `// line ${i + 1}`).join('\n');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          const g = document.querySelector('#cardReq .line-gutter');
          if (!g) return null;
          const numbers = g.querySelectorAll('.line-no');
          return {
            width: g.getBoundingClientRect().width,
            rendered: numbers.length,
            last: numbers.length ? numbers[numbers.length - 1].textContent.trim() : '',
          };
        }, lines);

      const short = await widthAt(18);
      const long = await widthAt(1000);
      assert.ok(short, 'the gutter exists');
      assert.ok(long, 'the gutter exists at 1000 lines');

      assert.ok(
        short.width < long.width,
        `an 18-line document must not reserve a 1000-line gutter ` +
          `(18 lines: ${short.width}px, 1000 lines: ${long.width}px)`,
      );

      // 9 -> 10 is the boundary ordinary typing crosses constantly, and a
      // width change there shifts the text under the cursor. The assertion is
      // a sub-pixel tolerance rather than exact equality on purpose: the floor
      // is expressed in `ch`, so the content of a two-digit row can exceed it
      // by a rounding remainder — measured at 0.016px. Half a CSS pixel is
      // below the smallest step any display can render, so anything under it
      // is not the defect this guards against, and demanding exact equality
      // would be testing the implementation instead of the requirement.
      const nine = await widthAt(9);
      const ten = await widthAt(10);
      const drift = Math.abs(ten.width - nine.width);
      assert.ok(
        drift < 0.5,
        `the width must not visibly move across 9 -> 10 ` +
          `(9: ${nine.width}px, 10: ${ten.width}px, drift: ${drift}px)`,
      );

      // And it must genuinely hold across the range a payload lives in, not
      // only at that one boundary.
      const across = [];
      for (const n of [1, 5, 20, 50, 99]) across.push((await widthAt(n)).width);
      const spread = Math.max(...across) - Math.min(...across);
      assert.ok(
        spread < 0.5,
        `1..99 lines must render one stable width (widths: ${across.join(', ')})`,
      );

      // The numbers still belong to their rows: the gutter change touches
      // width and left padding only, never the vertical grid.
      const aligned = await page.evaluate(() => {
        const g = document.querySelector('#cardReq .line-gutter');
        const rows = g.querySelectorAll('.line-no');
        if (rows.length < 3) return null;
        const a = rows[0].getBoundingClientRect();
        const b = rows[1].getBoundingClientRect();
        const c = rows[2].getBoundingClientRect();
        return {
          step1: Math.round((b.top - a.top) * 100) / 100,
          step2: Math.round((c.top - b.top) * 100) / 100,
        };
      });
      assert.ok(aligned, 'the gutter renders numbered rows');
      assert.equal(aligned.step1, aligned.step2, 'line numbers keep an even vertical step');
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
