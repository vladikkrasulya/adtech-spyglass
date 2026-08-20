/* global document, getComputedStyle, window */
'use strict';

/**
 * tests/clear-resets-results-browser.test.js — Clear must clear.
 *
 * WHY THIS EXISTS
 * ---------------
 * Clear emptied the editor and nothing else. The verdict stayed ("no
 * problems found"), the quality score stayed ("EXCELLENT"), the impression
 * list stayed, the tab badges kept their counts, the browser tab kept its
 * "✓ clean" title, and the gutter kept numbering lines 1..31 beside an empty
 * editor. Every one of those described a payload that was no longer anywhere
 * on screen.
 *
 * The machinery to do this right already existed — clearResultsForError(),
 * written for a failed analyse, carrying the comment "A result that is not
 * current must not look current." Clear was simply never wired to it. The
 * fix split that function into a shared core plus two callers, so the two
 * paths cannot drift apart again: anything a future panel adds to the reset
 * is inherited by both.
 *
 * WHAT IS ASSERTED
 * ----------------
 * Not a list of panels — a comparison. The page is photographed before any
 * analysis, photographed again after Clear, and the two must match. That
 * phrasing survives new panels being added: a panel introduced tomorrow and
 * forgotten in the reset changes the second photograph and fails here,
 * without anybody having to remember to extend a list.
 *
 * The icon check at the end is a separate defect found while verifying this
 * one: flashButtonStatus() saved and restored textContent, which for a
 * button whose only child is an <svg> reads back as the empty string. One
 * press of Clear replaced the ✕ with the word "cleared", and 1500ms later
 * restored "" — leaving a blank square for the rest of the session. All
 * three editor buttons (clear, format, copy) shared it.
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

/**
 * Everything on the page that makes a claim about a payload. Run in the
 * browser; compared as a whole rather than field by field.
 */
function photograph() {
  const text = (el) => (el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '(absent)');
  const shown = (el) => {
    if (!el) return false;
    if (el.hidden) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const byId = (id) => document.getElementById(id);
  return {
    verdictShown: shown(byId('verdict')),
    verdict: shown(byId('verdict')) ? text(byId('verdict')) : '',
    stripShown: shown(document.querySelector('.analysis-strip')),
    formatBarShown: shown(byId('formatBar')),
    slots: text(byId('slotGrid')),
    findings: text(byId('tValidation')),
    crosscheck: text(byId('tCross')),
    statusEntity: text(byId('stEntity')),
    badges: ['validationBadge', 'crossBadge', 'inspectorBadge', 'categoriesBadge', 'macrosBadge']
      .map((id) => id + '=' + ((byId(id) || {}).textContent || '').trim())
      .join(' '),
    gutterLines: ['gutterReq', 'gutterRes']
      .map((id) => id + '=' + ((byId(id) || {}).childElementCount || 0))
      .join(' '),
    tabTitle: document.title,
    lastAnalysis: /** @type {any} */ (window).__ortbtoolsLast ? 'present' : 'none',
  };
}

test(
  'browser: clearing a payload clears everything said about it',
  { timeout: 240000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-clear-'));
    const port = await getFreePort();
    let serverInfo = null;
    let browser = null;

    try {
      serverInfo = await startServer(port, dataDir);
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
      await page.setViewport({ width: 1440, height: 900 });
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
      await page.goto(`${serverInfo.url}/uk/inspector`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      await delay(2400);

      const before = await page.evaluate(photograph);
      assert.equal(before.verdictShown, false, 'a freshly loaded page should state no verdict');

      // Load the built-in demo and analyse it.
      await page.evaluate(() => {
        const menu = document.querySelector('.kt-example-menu');
        if (menu) /** @type {any} */ (menu).open = true;
        const demo = document.querySelector('[data-action="load-demo"]');
        if (demo) /** @type {any} */ (demo).click();
      });
      await delay(1200);
      await page.evaluate(() => {
        /** @type {any} */ (document.getElementById('analyzeBtn')).click();
      });
      await delay(4500);

      const analysed = await page.evaluate(photograph);
      assert.equal(
        analysed.verdictShown,
        true,
        'the demo payload should produce a verdict — without one this test proves nothing',
      );
      assert.notEqual(analysed.gutterLines, before.gutterLines, 'the gutter should have numbers');

      const clearPane = (target) =>
        page.evaluate((t) => {
          const btn = [...document.querySelectorAll('[data-action="clear-input"]')].find(
            (e) => /** @type {any} */ (e).dataset.target === t,
          );
          if (!btn) return false;
          /** @type {any} */ (btn).click();
          return true;
        }, target);

      // The demo loads BOTH sides, so clear them one at a time — the two
      // steps make different claims.
      //
      // Step one: clearing the request retires the verdict, because the
      // analysis was computed from bytes that no longer exist. The response
      // pane keeps its own text and therefore its own line numbers; those
      // are a property of the text in front of the reader, not of the
      // analysis, and wiping them would be its own kind of wrong.
      assert.ok(await clearPane('bidReq'), 'no clear button found for the request pane');
      await delay(1400);
      const afterRequest = await page.evaluate(photograph);
      assert.equal(
        await page.evaluate(() => /** @type {any} */ (document.getElementById('bidReq')).value),
        '',
        'the request editor should be empty',
      );
      assert.equal(
        afterRequest.verdictShown,
        false,
        'the verdict survived Clear. It describes a payload that is no longer on screen.',
      );
      assert.equal(
        afterRequest.lastAnalysis,
        'none',
        'the export/share handle still holds the cleared analysis',
      );
      assert.equal(
        afterRequest.badges,
        before.badges,
        `tab badges still carry the cleared payload's counts: ${afterRequest.badges}`,
      );
      assert.ok(
        afterRequest.gutterLines.startsWith('gutterReq=0'),
        `the request gutter still numbers lines of deleted text: ${afterRequest.gutterLines}`,
      );
      assert.ok(
        !afterRequest.gutterLines.endsWith('gutterRes=0'),
        'the response pane still has text, so it should still have line numbers — ' +
          `got ${afterRequest.gutterLines}`,
      );

      // Step two: with both payloads gone the page must be indistinguishable
      // from one that was just opened.
      assert.ok(await clearPane('bidRes'), 'no clear button found for the response pane');
      await delay(1400);
      const after = await page.evaluate(photograph);
      assert.deepEqual(
        after,
        before,
        'with both payloads cleared the page still differs from a freshly loaded one. ' +
          'Whatever differs is a claim about a payload the user just deleted.',
      );

      // ── The other way a result stops being current: the next analysis fails.
      //
      // Same principle, different door, and the door this reset was originally
      // built for. tests/inspector-reentrant.test.js can see that the analyze
      // catch calls clearResultsForError; only a browser can see whether the
      // panels actually came down. Analyse something good, then analyse
      // something broken, and require nothing of the first to survive.
      await page.evaluate(() => {
        const menu = document.querySelector('.kt-example-menu');
        if (menu) /** @type {any} */ (menu).open = true;
        const demo = document.querySelector('[data-action="load-demo"]');
        if (demo) /** @type {any} */ (demo).click();
      });
      await delay(1200);
      await page.evaluate(() => {
        /** @type {any} */ (document.getElementById('analyzeBtn')).click();
      });
      await delay(4500);
      const good = await page.evaluate(photograph);
      assert.equal(good.verdictShown, true, 'the second analysis should also produce a verdict');

      await page.evaluate(() => {
        const ta = /** @type {any} */ (document.getElementById('bidReq'));
        ta.value = '{ this is not json';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        /** @type {any} */ (document.getElementById('analyzeBtn')).click();
      });
      await delay(3500);
      const failed = await page.evaluate(photograph);
      assert.equal(
        failed.verdictShown,
        false,
        "a failed analysis left the previous payload's verdict on screen, where it reads as " +
          "this payload's verdict",
      );
      assert.equal(
        failed.lastAnalysis,
        'none',
        'the export/share handle still holds the analysis that has just been superseded',
      );
      assert.notEqual(
        failed.slots,
        good.slots,
        'the impression list still shows the previous payload’s slots after a failed analysis',
      );
      assert.notEqual(
        failed.statusEntity,
        good.statusEntity,
        'the status bar still names the previous payload’s entity after a failed analysis',
      );

      // Put the page back to a known state for the button checks below. The
      // wait outlasts the 1500ms status flash on purpose: the loop underneath
      // reads each button's "original" contents before pressing it, and
      // reading during a flash would record the word, not the icon.
      assert.ok(await clearPane('bidReq'), 'no clear button found for the request pane');
      await delay(2000);

      // The flash must not eat the icon it borrows. Press each editor button
      // once, wait past the 1500ms flash, and require its contents back.
      await page.evaluate(() => {
        const ta = /** @type {any} */ (document.getElementById('bidReq'));
        ta.value = '{"id":"x","imp":[{"id":"1"}]}';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      });
      for (const action of ['clear-input', 'format-json', 'copy-text']) {
        const outcome = await page.evaluate(async (act) => {
          const pick = () =>
            [...document.querySelectorAll(`[data-action="${act}"]`)].find(
              (e) =>
                !(/** @type {any} */ (e).dataset.target) ||
                /** @type {any} */ (e).dataset.target === 'bidReq',
            );
          const btn = pick();
          if (!btn) return { found: false };
          const originalHtml = btn.innerHTML;
          /** @type {any} */ (btn).click();
          await new Promise((r) => setTimeout(r, 2200));
          return { found: true, originalHtml, nowHtml: pick().innerHTML };
        }, action);
        if (!outcome.found) continue;
        assert.equal(
          outcome.nowHtml.trim(),
          outcome.originalHtml.trim(),
          `"${action}" did not get its contents back after the status flash — it now reads ` +
            `"${outcome.nowHtml.trim().slice(0, 40)}". A button that empties itself when pressed ` +
            'is gone for the rest of the session.',
        );
        // Restore text for the next button in the loop.
        await page.evaluate(() => {
          const ta = /** @type {any} */ (document.getElementById('bidReq'));
          ta.value = '{"id":"x","imp":[{"id":"1"}]}';
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }

      assert.deepEqual(pageErrors, [], `the page threw: ${pageErrors.join(' | ')}`);
      await page.close();
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) await stopChild(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);

/**
 * The same rule, one step wider: a result must not outlive the payload it
 * describes, whether that payload was cleared, edited, or replaced.
 *
 * Clear was only the narrow end. Analyse A, then type a character or load
 * anything from Demo / Saved / Live / Mirror, and the verdict, quality score,
 * findings and impression list from A stayed on screen describing bytes that
 * were no longer there — and Download assembled payload B with analysis A
 * into a single file.
 *
 * Programmatic loads are the reason this needed more than an input listener:
 * `el.value = …` fires no input event, so every loader slipped past. They now
 * route through setEditorValue(), and this test drives the app's own
 * `load-demo` action rather than assigning the textarea directly — assigning
 * it here would test the test, not the wiring.
 */
test(
  'browser: a result does not outlive the payload it describes',
  { timeout: 240000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-stale-'));
    const port = await getFreePort();
    let serverInfo = null;
    let browser = null;

    const PAYLOAD_A = JSON.stringify(
      {
        id: 'AAA-stale-probe',
        at: 1,
        imp: [{ id: '1', banner: { w: 300, h: 250 }, bidfloor: 0.5 }],
        site: { domain: 'a.example' },
        device: { ip: '1.2.3.4', ua: 'Mozilla/5.0' },
      },
      null,
      2,
    );

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
      const page = await browser.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
      // Loading over unsaved edits asks for confirmation; accept it, or the
      // native dialog blocks every later evaluate() until the test times out.
      page.on('dialog', (d) => d.accept().catch(() => {}));

      await page.goto(`http://127.0.0.1:${port}/inspector`, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
      await page.waitForSelector('#bidReq', { timeout: 30000 });

      const typeIn = (text) =>
        page.evaluate((v) => {
          const ta = /** @type {any} */ (document.getElementById('bidReq'));
          ta.value = v;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }, text);
      const findingCount = () =>
        page.evaluate(() => document.querySelectorAll('.validation-item').length);
      const analyse = async () => {
        await page.evaluate(() => {
          const btn = document.querySelector('[data-action="analyze"]');
          if (btn) /** @type {any} */ (btn).click();
        });
        await new Promise((r) => setTimeout(r, 3000));
      };

      await typeIn(PAYLOAD_A);
      await analyse();
      const analysed = await findingCount();
      assert.ok(analysed > 0, 'the probe payload should produce findings to invalidate');

      // 1. One keystroke is enough to make the result describe other bytes.
      await page.evaluate(() => {
        const ta = /** @type {any} */ (document.getElementById('bidReq'));
        ta.value = ta.value + ' ';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(
        await findingCount(),
        0,
        'editing the payload left the previous analysis on screen',
      );

      // 2. A programmatic load through the app's own action must do the same.
      await typeIn(PAYLOAD_A);
      await analyse();
      assert.ok((await findingCount()) > 0, 're-analysis should restore findings');

      const loaded = await page.evaluate(() => {
        const item = document.querySelector('[data-action="load-demo"]');
        if (!item) return false;
        /** @type {any} */ (item).click();
        return true;
      });
      if (loaded) {
        await new Promise((r) => setTimeout(r, 2500));
        assert.equal(
          await findingCount(),
          0,
          'loading a different payload left the previous analysis on screen',
        );
        const stillA = await page.evaluate(() => {
          const ta = /** @type {any} */ (document.getElementById('bidReq'));
          return String(ta.value || '').includes('AAA-stale-probe');
        });
        assert.equal(stillA, false, 'the demo load should have replaced the probe payload');
      }

      assert.deepEqual(pageErrors, [], `the page threw: ${pageErrors.join(' | ')}`);
      await page.close();
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) await stopChild(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
