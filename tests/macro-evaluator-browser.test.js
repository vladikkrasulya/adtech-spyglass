/* global window, document */
'use strict';

/**
 * tests/macro-evaluator-browser.test.js — Headless Chrome smoke test
 * for the Macro Evaluator integration.
 *
 * Starts the ortbtools server on a random port, launches headless Chrome
 * via puppeteer-core, and verifies the critical acceptance scenarios that
 * can only be caught in a real browser environment:
 *
 *   1. External <img> in adm does NOT fire a network request (CSP enforcement)
 *   2. Macro toolbar input preserves focus and caret during typing
 *   3. Both price inputs synchronize (#simPrice ↔ #macroSimPrice)
 *   4. Clear bidRes produces 0 macro rows and empty badge
 *   5. Preview iframe does NOT substitute bid.price or bidfloor
 *   6. Inspector → Live → Inspector does not carry overrides
 *
 * The test terminates the server and Chrome in the `finally` block regardless
 * of pass/fail to avoid leaked processes.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

// Use puppeteer-core with system Chrome to avoid downloading Chromium.
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

// ── Helpers ─────────────────────────────────────────────────────

/** Find a free port by binding to 0 and releasing. */
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

function closeServer(server) {
  if (!server || !server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
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

// (Removed unused startServer and killProc)

// ── Test data ───────────────────────────────────────────────────

const SAMPLE_REQ = JSON.stringify({
  id: 'test-auction-id',
  imp: [
    {
      id: 'imp-1',
      bidfloor: 0.5,
      banner: { w: 300, h: 250 },
    },
  ],
  site: { domain: 'example.com' },
});

// ── Main browser smoke test ─────────────────────────────────────

test(
  'browser smoke test: macro evaluator integration',
  { timeout: 60000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const ortbtoolsDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-'));

    // Start local HTTP trap for zero-network validation
    const trapPort = await getFreePort();
    let trapRequests = 0;
    const trapServer = http.createServer((_req, res) => {
      trapRequests++;
      res.writeHead(204);
      res.end();
    });
    await new Promise((r) => trapServer.listen(trapPort, '127.0.0.1', () => r(undefined)));

    const SAMPLE_RES = JSON.stringify({
      id: 'response-id-should-not-leak',
      cur: 'EUR',
      seatbid: [
        {
          seat: 'test-dsp',
          bid: [
            {
              id: 'bid-1',
              impid: 'imp-1',
              price: 1.11,
              adm: `<div>Creative<img src="http://127.0.0.1:${trapPort}/image.png?p=\${AUCTION_PRICE}&c=\${AUCTION_CURRENCY}&a=\${AUCTION_ID}"></div>`,
              nurl: 'https://dsp.example/win?p=${AUCTION_PRICE}&c=${AUCTION_CURRENCY}&a=${AUCTION_ID}',
            },
          ],
        },
      ],
    });

    const port = await getFreePort();
    let serverInfo = null;
    let browser = null;

    try {
      serverInfo = await new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
          env: {
            ...process.env,
            PORT: String(port),
            NODE_ENV: 'test',
            LOG_LEVEL: 'info',
            ORTBTOOLS_DATA_DIR: ortbtoolsDataDir,
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

      const page = await browser.newPage();
      await page.goto(serverInfo.url + '/en', { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('#bidReq', { timeout: 5000 });

      await page.evaluate(
        (req, res) => {
          /** @type {any} */ (document.getElementById('bidReq')).value = req;
          /** @type {any} */ (document.getElementById('bidRes')).value = res;
        },
        SAMPLE_REQ,
        SAMPLE_RES,
      );

      await page.evaluate(() => /** @type {any} */ (window).runAnalysis());
      await page.waitForFunction(
        () => {
          const badge = document.getElementById('macrosBadge');
          return badge && badge.textContent.trim() !== '';
        },
        { timeout: 10000 },
      );

      // Ensure zero-network (trapServer hit count is 0)
      await new Promise((r) => setTimeout(r, 1000));
      assert.equal(trapRequests, 0, 'Zero-network violated: Creative made external HTTP request');

      // Macros assertions
      const macroTableHtml = await page.evaluate(
        () => document.getElementById('macroTableBody')?.innerHTML || '',
      );
      assert.match(macroTableHtml, /\$\{AUCTION_PRICE\}/, 'AUCTION_PRICE must stay literal');
      assert.doesNotMatch(macroTableHtml, /p=1\.11/);
      assert.match(macroTableHtml, /EUR/);
      assert.match(macroTableHtml, /test-auction-id/);

      const previewSrcdoc = await page.evaluate(
        () => /** @type {any} */ (document.querySelector('#creativePreview iframe'))?.srcdoc || '',
      );
      assert.doesNotMatch(previewSrcdoc, /p=1\.11/);
      assert.match(previewSrcdoc, /\$\{AUCTION_PRICE\}/);

      // Focus and Caret preservation using Puppeteer page.type
      // v2 puts the macros tab behind the strip's "more ▾" menu — open it
      // first, the way the user reaches the tab.
      await page.evaluate(() => {
        const m = /** @type {any} */ (document.querySelector('details.tab-more'));
        if (m) m.open = true;
      });
      await page.click('[data-target="tMacros"]');
      await page.waitForSelector('#macroSimPrice', { visible: true });
      await page.click('#macroSimPrice');
      await page.type('#macroSimPrice', '1.23');
      await new Promise((r) => setTimeout(r, 300));

      const activeElementId = await page.evaluate(() => document.activeElement.id);
      assert.equal(activeElementId, 'macroSimPrice', 'Input lost focus during typing');

      const selectionInfo = await page.evaluate(() => {
        const el = /** @type {any} */ (document.getElementById('macroSimPrice'));
        return { val: el.value, start: el.selectionStart, end: el.selectionEnd };
      });
      assert.equal(selectionInfo.val, '1.23');
      assert.equal(selectionInfo.start, 4, 'Caret position lost');

      // Check sync
      const simPriceVal = await page.evaluate(
        () => /** @type {any} */ (document.getElementById('simPrice'))?.value || '',
      );
      assert.equal(simPriceVal, '1.23', '#simPrice synced');

      // Check preview iframe updated
      const previewSrcdocAfter = await page.evaluate(
        () => /** @type {any} */ (document.querySelector('#creativePreview iframe'))?.srcdoc || '',
      );
      assert.match(previewSrcdocAfter, /p=1\.23/, 'Preview iframe did not update with new price');
      assert.doesNotMatch(previewSrcdocAfter, /\$\{AUCTION_PRICE\}/);

      // The auction-price field is the second entry point into the same
      // override state. It must update the toolbar, table, and preview in one
      // input event.
      //
      // v2 moved it out of the header row and into the Tools menu — it
      // configures how a macro resolves, which is not something you reach for
      // once per payload. So the path now starts by opening that menu, the
      // same as the user's does. Asserted rather than assumed: a silently
      // absent menu would leave the click landing on nothing and the failure
      // would read as a timeout somewhere further down.
      const toolsMenu = await page.$('.kt-tools-menu');
      assert.ok(toolsMenu, 'the Tools menu must exist — it holds the auction-price field');
      await page.evaluate(() => {
        /** @type {any} */ (document.querySelector('.kt-tools-menu')).open = true;
      });
      await page.waitForSelector('#simPrice', { visible: true, timeout: 5000 });
      await page.click('#simPrice');
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.type('#simPrice', '8.88');
      await page.waitForFunction(
        () => {
          const toolbar = /** @type {any} */ (document.getElementById('macroSimPrice'));
          const table = document.getElementById('macroTableBody');
          const iframe = /** @type {any} */ (document.querySelector('#creativePreview iframe'));
          return (
            toolbar?.value === '8.88' &&
            table?.textContent.includes('p=8.88') &&
            iframe?.srcdoc.includes('p=8.88')
          );
        },
        { timeout: 5000 },
      );

      // Clear bidRes
      await page.evaluate(() => {
        const btn = document.querySelector('[data-action="clear-bidRes"]');
        if (btn) /** @type {any} */ (btn).click();
        else if (typeof (/** @type {any} */ (window).clearInput) === 'function')
          /** @type {any} */ (window).clearInput('bidRes');
      });
      await new Promise((r) => setTimeout(r, 500));
      const badgeAfterClear = await page.evaluate(
        () => document.getElementById('macrosBadge')?.textContent.trim() || '',
      );
      assert.equal(badgeAfterClear, '', 'Badge must be empty');
      const rowsAfterClear = await page.evaluate(
        () => document.querySelectorAll('#macroTableBody tr').length,
      );
      assert.equal(rowsAfterClear, 0, 'Macro rows must be removed after clearing bidRes');

      // Inspector -> Live -> Inspector via SPA routing
      await page.evaluate(
        (req, res) => {
          /** @type {any} */ (document.getElementById('bidReq')).value = req;
          /** @type {any} */ (document.getElementById('bidRes')).value = res;
        },
        SAMPLE_REQ,
        SAMPLE_RES,
      );
      await page.evaluate(() => /** @type {any} */ (window).runAnalysis());
      await page.waitForSelector('#macroSimAuctionId', { visible: true });

      await page.type('#macroSimAuctionId', 'OLD-OVERRIDE');
      await new Promise((r) => setTimeout(r, 200));

      // Navigate through the real SPA shell. Calling its public router avoids
      // coupling this lifecycle assertion to whether the responsive nav link
      // is visibly clickable at the current headless viewport width.
      await page.evaluate(() => /** @type {any} */ (window).OrtbtoolsShell.navigateTo('/live'));
      await page.waitForFunction(
        () => window.location.pathname === '/live' && !document.getElementById('bidReq'),
        { timeout: 10000 },
      );
      await page.evaluate(() =>
        /** @type {any} */ (window).OrtbtoolsShell.navigateTo('/inspector'),
      );
      await page.waitForFunction(() => window.location.pathname === '/inspector', {
        timeout: 10000,
      });
      await page.waitForSelector('#bidReq', { visible: true });

      // Setup new Req and re-analyze
      await page.evaluate(
        (req, res) => {
          /** @type {any} */ (document.getElementById('bidReq')).value = req;
          /** @type {any} */ (document.getElementById('bidRes')).value = res;
        },
        JSON.stringify({ id: 'NEW-AUCTION-ID', imp: [{ id: 'imp-1' }] }),
        SAMPLE_RES,
      );
      await page.evaluate(() => /** @type {any} */ (window).runAnalysis());
      await new Promise((r) => setTimeout(r, 500));

      const overrideVal = await page.evaluate(
        () => /** @type {any} */ (document.getElementById('macroSimAuctionId'))?.value || '',
      );
      assert.doesNotMatch(overrideVal, /OLD-OVERRIDE/);

      const tableAfterRemount = await page.evaluate(
        () => document.getElementById('macroTableBody')?.innerHTML || '',
      );
      assert.match(tableAfterRemount, /NEW-AUCTION-ID/);
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) await stopChild(serverInfo.proc);
      await closeServer(trapServer).catch(() => {});
      fs.rmSync(ortbtoolsDataDir, { recursive: true, force: true });
    }
  },
);
