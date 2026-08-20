/* global document, getComputedStyle */
'use strict';

/**
 * tests/site-app.test.js — the Inspector's dialect state, seen from the page.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two defects, one subject: which validation dialect is active, and whether a
 * person can see or change it.
 *
 * 1. The work bar's left half was hidden until the first analysis landed. That
 *    strip carries two READOUTS about the payload (the validity chip, the
 *    dialect-overlay pill) and two CONTROLS that decide how the next analysis
 *    runs (the version pin, the dialect switch). Hiding all four until a result
 *    existed meant that on a fresh tab the dialect switch was 0px tall, and the
 *    only dialect-shaped thing on screen was the footer chip — which opens the
 *    temporary-dialect BUILDER, and on an empty session the builder can only
 *    say "not enough data yet. Run analyze on a few requests first." Someone
 *    who came to validate against a vendor dialect had nowhere to go.
 *
 * 2. Switching away from a dialect that writes ?dialect= into the URL
 *    (ext-rtb, inpage-push) left the footer stating the dialect the user had
 *    just left. setActiveDialect wrote localStorage, repainted the label, and
 *    only then rewrote the URL — and the label's source of truth reads the URL
 *    first. So the footer and the <select> disagreed about the active dialect
 *    until some unrelated repaint came along.
 *
 * WHAT THIS ASSERTS, AND WHY IT IS SHAPED THIS WAY
 * -----------------------------------------------
 * Nothing here names a CSS rule, an attribute, or the order of statements
 * inside setActiveDialect. Defect 2 WAS an ordering bug, so a test written in
 * terms of ordering would have to be right about the same thing the code got
 * wrong. These assertions are about what a person can see and do: is the
 * switch on screen before there is anything to analyse, does the label agree
 * with the switch after every move, and does the bar keep quiet about a
 * payload that is not there.
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

const REQUEST = {
  id: 'site-app-1',
  at: 1,
  tmax: 120,
  cur: ['USD'],
  imp: [
    {
      id: '1',
      tagid: 'slot-top',
      secure: 1,
      bidfloor: 0.16,
      bidfloorcur: 'USD',
      banner: { w: 300, h: 250, pos: 1 },
    },
  ],
  site: { id: 's1', domain: 'example.com', page: 'https://example.com/article' },
  device: { ua: 'Mozilla/5.0', ip: '203.0.113.7' },
  user: { id: 'u1' },
};

const RESPONSE = {
  id: 'site-app-1',
  cur: 'USD',
  seatbid: [
    {
      seat: 'seat-1',
      bid: [
        {
          id: 'b1',
          impid: '1',
          price: 0.65,
          adm: '<div>ad</div>',
          crid: 'cr-1',
          w: 300,
          h: 250,
        },
      ],
    },
  ],
};

/* What the page shows, in the only terms a reader has: can I see it, and what
   does it say. `shown` deliberately measures the box too — the defect this
   file guards against was a control with a computed height of zero. */
function photograph() {
  const shown = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const byId = (id) => document.getElementById(id);
  const sel = /** @type {any} */ (byId('dialectSelector'));
  return {
    dialectSwitchShown: shown(sel),
    versionPinShown: shown(byId('versionPinSelector')),
    validityChipShown: shown(byId('validityChip')),
    verdictShown: shown(byId('verdict')),
    dialectSwitchValue: sel ? sel.value : null,
    footerDialect: (document.querySelector('.footer-dialect-value') || {}).textContent || '',
  };
}

test(
  'browser: the dialect switch is reachable before the first analysis, and the footer never lies about it',
  { timeout: 240000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-site-app-'));
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
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e instanceof Error ? e.message : String(e)));
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${serverInfo.url}/inspector`, { waitUntil: 'networkidle2' });
      await delay(1200);

      // ── A fresh tab: no payload, therefore no readouts — but the controls
      //    that decide how the next analysis runs must already be usable.
      const fresh = await page.evaluate(photograph);
      assert.equal(
        fresh.dialectSwitchShown,
        true,
        'the dialect switch is off screen before the first analysis, so the only way to reach a ' +
          'vendor dialect is the footer chip — and that opens the builder, which has nothing to ' +
          'offer an empty session',
      );
      assert.equal(
        fresh.versionPinShown,
        true,
        'the version pin states what the payload is EXPECTED to be; it is an input to the ' +
          'analysis and has to exist before one runs',
      );
      assert.equal(
        fresh.validityChipShown,
        false,
        'the validity chip claims the editor holds valid JSON before anything has been pasted',
      );
      assert.equal(fresh.verdictShown, false, 'a freshly loaded page should state no verdict');
      assert.ok(
        !fresh.footerDialect.includes('▾'),
        `the footer chip wears a dropdown chevron ("${fresh.footerDialect}") but opens the ` +
          'dialect builder, not a list of dialects',
      );

      // ── Switching before any analysis has to take effect and be stated.
      const switchTo = async (value) => {
        await page.select('#dialectSelector', value);
        await delay(500);
        return page.evaluate(photograph);
      };

      const vendor = await switchTo('inpage-push');
      assert.equal(vendor.dialectSwitchValue, 'inpage-push', 'the switch did not take the value');
      assert.ok(
        /In-Page Push/i.test(vendor.footerDialect),
        `the footer says "${vendor.footerDialect}" while the switch is on inpage-push`,
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem('ortbtools_dialect_v1')),
        'inpage-push',
        'a dialect chosen before the first analysis is forgotten',
      );

      // ── …and switching BACK. This is the half that regressed: inpage-push
      //    puts ?dialect= in the URL, the label resolves the URL before
      //    storage, and the label was painted before the URL was rewritten.
      const back = await switchTo('iab');
      assert.equal(back.dialectSwitchValue, 'iab', 'the switch did not return to iab');
      assert.ok(
        /IAB/i.test(back.footerDialect) && !/Push/i.test(back.footerDialect),
        `the switch is back on IAB but the footer still states "${back.footerDialect}" — the ` +
          'two controls disagree about which rules the engine is applying',
      );

      // ── With a payload analysed, the readouts arrive and the controls stay.
      await page.evaluate(
        (req, res) => {
          const fill = (id, value) => {
            const el = /** @type {any} */ (document.getElementById(id));
            el.value = JSON.stringify(value, null, 2);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };
          fill('bidReq', req);
          fill('bidRes', res);
        },
        REQUEST,
        RESPONSE,
      );
      await page.click('#analyzeBtn');
      for (let i = 0; i < 40; i++) {
        if ((await page.evaluate(photograph)).verdictShown) break;
        await delay(250);
      }
      const analysed = await page.evaluate(photograph);
      assert.equal(analysed.verdictShown, true, 'the analysis produced no verdict');
      assert.equal(
        analysed.validityChipShown,
        true,
        'the work bar says nothing about JSON validity for a payload it just analysed',
      );
      assert.equal(analysed.dialectSwitchShown, true, 'the dialect switch left with the analysis');
      assert.ok(
        /IAB/i.test(analysed.footerDialect),
        `the footer states "${analysed.footerDialect}" for an analysis run under IAB`,
      );

      // ── Clearing the payload takes the claims about it away, and only them.
      await page.evaluate(() => {
        document
          .querySelectorAll('[data-action="clear-input"]')
          .forEach((b) => /** @type {any} */ (b).click());
      });
      await delay(1200);
      const cleared = await page.evaluate(photograph);
      assert.equal(
        cleared.verdictShown,
        false,
        'the verdict survived Clear. It describes a payload that is no longer on screen.',
      );
      assert.equal(
        cleared.validityChipShown,
        false,
        'the validity chip survived Clear — there is no JSON left for it to be valid about',
      );
      assert.equal(
        cleared.dialectSwitchShown,
        true,
        'clearing the payload also took away the dialect switch, which is not about the payload',
      );
      assert.equal(
        cleared.versionPinShown,
        true,
        'clearing the payload also took away the version pin, which is not about the payload',
      );

      assert.deepEqual(pageErrors, [], `the page threw: ${pageErrors.join(' | ')}`);
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) await stopChild(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
