/* global window, document */
'use strict';

/**
 * tests/diff-tab-browser.test.js — the Diff tab in a real browser.
 *
 * The engine has its own unit tests; this covers the wiring around it, which is
 * where a diff tool actually goes wrong:
 *
 *   1. The mirrored engine loads from /core/ and registers both globals.
 *   2. Semantic mode collapses reordering to the one real change; raw mode
 *      reports the reordering. The contrast between the modes IS the feature.
 *   3. Clicking a path moves the caret to that value in the editor.
 *   4. The tab never writes to the editor panes.
 *   5. "Equal" with a degraded comparison says so instead of reading as a
 *      clean pass — the failure mode the engine can produce silently.
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

/** Same auction as A, but reordered in three places with ONE real change. */
const SIDE_A = JSON.stringify(
  {
    id: 'auction-1',
    cur: ['USD', 'EUR'],
    imp: [
      { id: 'i1', bidfloor: 0.5, banner: { w: 300, h: 250, mimes: ['image/png', 'image/gif'] } },
      { id: 'i2', video: { mimes: ['video/mp4'] } },
    ],
  },
  null,
  2,
);
const SIDE_B = JSON.stringify(
  {
    id: 'auction-1',
    cur: ['EUR', 'USD'],
    imp: [
      { id: 'i2', video: { mimes: ['video/mp4'] } },
      { id: 'i1', bidfloor: 0.9, banner: { w: 300, h: 250, mimes: ['image/gif', 'image/png'] } },
    ],
  },
  null,
  2,
);

test('browser smoke test: the Diff tab', { timeout: 120000, skip: browserSkipReason }, async () => {
  assert.ok(puppeteer);
  assert.ok(chromeExecutable);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-difftab-'));
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

    browser = await puppeteer.launch({
      headless: true,
      // Explicit, because the default is what the flaky runs hit: a single
      // CDP call missing its deadline aborts the whole file with
      // 'Runtime.callFunctionOn timed out'. Serial execution removed the
      // contention that caused it; this is the belt to that pair of braces.
      protocolTimeout: 120_000,
      executablePath: chromeExecutable,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto(serverInfo.url + '/en', { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForSelector('#bidReq', { timeout: 10000 });

    // ── 1. The mirrored engine is present ────────────────────────────────
    const globals = await page.evaluate(() => ({
      engine: !!(/** @type {any} */ (window).OrtbtoolsDiff),
      registry: !!(/** @type {any} */ (window).OrtbtoolsDiffRegistry),
      tab: !!document.querySelector('[data-target="tDiff"]'),
    }));
    assert.deepEqual(globals, { engine: true, registry: true, tab: true });

    const setB = (value) =>
      page.evaluate((v) => {
        const el = /** @type {any} */ (document.getElementById('diffPaneB'));
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    const setMode = (value) =>
      page.evaluate((v) => {
        const r = /** @type {any} */ (
          document.querySelector(`input[name="diffMode"][value="${v}"]`)
        );
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    const run = async () => {
      await page.click('#diffRun');
      await delay(400);
    };

    await page.evaluate((a) => {
      /** @type {any} */ (document.getElementById('bidReq')).value = a;
    }, SIDE_A);
    // v2 keeps four named tabs and puts the rest behind "more ▾" — the diff
    // tab now opens from that menu, so the test walks the same path the user
    // does. switchTab() closes the menu after the switch.
    await page.evaluate(() => {
      const m = /** @type {any} */ (document.querySelector('details.tab-more'));
      if (m) m.open = true;
    });
    await page.click('[data-target="tDiff"]');
    await page.waitForSelector('#diffPaneB', { timeout: 5000 });

    // ── 2. Semantic mode ignores reordering ──────────────────────────────
    await setB(SIDE_B);
    await run();
    const semantic = await page.evaluate(() => ({
      summary: (document.querySelector('.diff-summary') || {}).textContent || '',
      paths: [...document.querySelectorAll('.diff-path, .diff-path-btn')].map((n) =>
        n.textContent.trim(),
      ),
      warnings: document.querySelectorAll('.diff-warning').length,
    }));
    assert.equal(
      semantic.paths.length,
      1,
      `reordering must collapse to the one real change, got ${JSON.stringify(semantic.paths)}`,
    );
    assert.match(semantic.paths[0], /^\/imp\/@id=.*\/bidfloor$/, semantic.paths[0]);
    assert.match(semantic.summary, /1 changed/, semantic.summary);
    assert.equal(semantic.warnings, 0, 'clean identity matching must not warn');

    // ── 3. Raw mode reports the reordering ───────────────────────────────
    await setMode('raw');
    await setB(SIDE_B);
    await run();
    const rawRows = await page.evaluate(() => document.querySelectorAll('.diff-table tr').length);
    assert.ok(rawRows > 1, `raw mode must report positional differences, got ${rawRows} rows`);

    // ── 4. A path click moves the caret in the editor ─────────────────────
    await setMode('semantic');
    await setB(SIDE_B);
    await run();
    const jumped = await page.evaluate(() => {
      const btn = /** @type {any} */ (document.querySelector('.diff-path-btn'));
      if (!btn) return { ok: false, why: 'no navigable path' };
      btn.click();
      const el = /** @type {any} */ (document.getElementById('bidReq'));
      return {
        ok: el.selectionEnd > el.selectionStart,
        selected: el.value.slice(el.selectionStart, el.selectionEnd),
      };
    });
    assert.ok(jumped.ok, `path click did not select anything: ${JSON.stringify(jumped)}`);
    assert.match(jumped.selected, /bidfloor/, jumped.selected);

    // ── 5. The tab never edits the pane ──────────────────────────────────
    const paneAfter = await page.evaluate(
      () => /** @type {any} */ (document.getElementById('bidReq')).value,
    );
    assert.equal(paneAfter, SIDE_A, 'the Diff tab modified the editor pane');

    // ── 6. Degraded comparison is visible even when "equal" ──────────────
    const dupes = JSON.stringify({ imp: [{ id: 'x' }, { id: 'x' }] });
    await page.evaluate((v) => {
      /** @type {any} */ (document.getElementById('bidReq')).value = v;
    }, dupes);
    await setB(dupes);
    await run();
    const degraded = await page.evaluate(() => ({
      summary: (document.querySelector('.diff-summary') || {}).textContent || '',
      warned: !!document.querySelector('.diff-warning'),
      warnText: (document.querySelector('.diff-warning') || {}).textContent || '',
    }));
    assert.ok(degraded.warned, 'a degraded comparison must raise a visible warning');
    assert.doesNotMatch(
      degraded.summary,
      /^No differences —/,
      'equal-with-warnings must not read as an unqualified clean pass',
    );
    assert.match(degraded.warnText, /duplicate/i, degraded.warnText);

    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverInfo) await stopChild(serverInfo.proc);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
