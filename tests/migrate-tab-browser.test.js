/* global window, document */
'use strict';

/**
 * tests/migrate-tab-browser.test.js — the Migration tab in a real browser.
 *
 * The advisor and the tab's pure logic have their own tests. This covers the
 * wiring, and specifically the four ways a tool that REWRITES a user's payload
 * goes wrong:
 *
 *   1. It writes before being told to.
 *   2. It applies something the user did not tick.
 *   3. Undo does not actually restore the text.
 *   4. It reports "nothing to migrate" for a payload it never examined.
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

/**
 * A 2.5 request that exercises every rule at once. The categories are NUMERIC
 * on purpose: numeric codes are Content Taxonomy 2.x, so `cattax` comes back at
 * `review` confidence — which is the proposal that must arrive UNTICKED.
 */
const LEGACY = JSON.stringify(
  {
    id: 'auction-1',
    imp: [
      { id: 'i1', bidfloor: 0.5, video: { protocol: 3, ext: { rewarded: 1, vendor: 'keep' } } },
      { id: 'i2', banner: { w: 300, h: 250 } },
    ],
    site: { id: 's1', cat: ['52', '150'], content: { videoquality: 1 } },
    regs: { ext: { gdpr: 1 } },
    user: { id: 'u1', ext: { consent: 'CONSENT-STRING', vendorThing: 'keep-me' } },
    source: { ext: { schain: { complete: 1, nodes: [{ asi: 'a.com' }] } } },
  },
  null,
  2,
);

test(
  'browser smoke test: the Migration tab',
  { timeout: 120000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-migtab-'));
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

      // ── 1. The mirrored advisor is present ─────────────────────────────
      const globals = await page.evaluate(() => ({
        engine: !!(/** @type {any} */ (window).OrtbtoolsMigrate),
        rules: !!(/** @type {any} */ (window).OrtbtoolsMigrateRules),
        tab: !!(/** @type {any} */ (window).OrtbtoolsMigrateTab),
        button: !!document.querySelector('[data-target="tMigrate"]'),
      }));
      assert.deepEqual(globals, { engine: true, rules: true, tab: true, button: true });

      const setEditor = (value) =>
        page.evaluate((v) => {
          const el = /** @type {any} */ (document.getElementById('bidReq'));
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
      const openTab = async () => {
        // v2 puts the migration tab behind the strip's "more ▾" menu — open
        // it first, the way the user reaches the tab. switchTab() closes the
        // menu after the switch, so every call re-opens it.
        await page.evaluate(() => {
          const m = /** @type {any} */ (document.querySelector('details.tab-more'));
          if (m) m.open = true;
        });
        await page.click('[data-target="tMigrate"]');
        await delay(400);
      };

      await setEditor(LEGACY);
      await openTab();

      // ── 2. Proposals are listed, and the badge agrees ──────────────────
      const listed = await page.evaluate(() => ({
        items: document.querySelectorAll('.mig-item').length,
        badge: (document.getElementById('migrateBadge') || {}).textContent,
        rows: [...document.querySelectorAll('.mig-item')].map((n) => ({
          confidence: /mig-(certain|likely|review)/.exec(n.className)[1],
          ticked: /** @type {any} */ (n.querySelector('input')).checked,
          rule: (n.querySelector('.mig-rule') || {}).textContent,
        })),
        applyLabel: (document.getElementById('migrateApply') || {}).textContent,
        specHrefs: [...document.querySelectorAll('.mig-spec')].map((a) =>
          /** @type {any} */ (a).getAttribute('href'),
        ),
      }));
      assert.equal(listed.items, 7, JSON.stringify(listed.rows));
      assert.equal(listed.badge, '7', 'the tab badge must match the proposal count');
      assert.ok(
        listed.specHrefs.length &&
          listed.specHrefs.every((h) => /^https:\/\/github\.com\//.test(h)),
        JSON.stringify(listed.specHrefs),
      );

      // ── 3. `review` arrives unticked; everything else is ticked ────────
      const review = listed.rows.filter((r) => r.confidence === 'review');
      assert.equal(review.length, 1, JSON.stringify(listed.rows));
      assert.equal(review[0].rule, 'ortb26.category.cattax');
      assert.equal(review[0].ticked, false, 'a `review` proposal must never be pre-ticked');
      assert.ok(
        listed.rows.filter((r) => r.confidence !== 'review').every((r) => r.ticked),
        JSON.stringify(listed.rows),
      );
      assert.match(listed.applyLabel, /\(6\)/, listed.applyLabel);

      // ── 4. Nothing is written before Apply ─────────────────────────────
      assert.equal(
        await page.evaluate(() => /** @type {any} */ (document.getElementById('bidReq')).value),
        LEGACY,
        'the tab modified the editor before Apply was clicked',
      );

      // ── 5. Apply writes exactly what was ticked ────────────────────────
      await page.click('#migrateApply');
      await delay(500);
      const applied = await page.evaluate(() => ({
        outcome: (document.querySelector('.mig-outcome') || {}).textContent || '',
        hasUndo: !!document.getElementById('migrateUndo'),
        editor: /** @type {any} */ (document.getElementById('bidReq')).value,
        remaining: [...document.querySelectorAll('.mig-item')].map(
          (n) => (n.querySelector('.mig-rule') || {}).textContent,
        ),
      }));
      assert.ok(applied.hasUndo, 'Apply must always leave an Undo');
      assert.match(applied.outcome, /6/, applied.outcome);

      const after = JSON.parse(applied.editor);
      assert.equal(after.regs.gdpr, 1);
      assert.equal(after.regs.ext.gdpr, undefined);
      assert.equal(after.user.consent, 'CONSENT-STRING');
      assert.deepEqual(after.imp[0].video.protocols, [3]);
      assert.equal(after.imp[0].rwdd, 1);
      assert.equal(after.site.content.prodq, 1);
      assert.ok(after.source.schain, 'schain must be promoted, not lost');
      // The unticked `review` proposal must NOT have been applied, and must
      // still be on offer.
      assert.equal(after.site.cattax, undefined, 'an unticked proposal was applied anyway');
      assert.deepEqual(applied.remaining, ['ortb26.category.cattax'], applied.remaining.join(','));
      // Untouched user data survives a rewrite of the whole document.
      assert.equal(after.id, 'auction-1');
      assert.equal(after.imp[0].bidfloor, 0.5);
      assert.equal(after.imp[0].video.ext.vendor, 'keep');
      assert.equal(after.user.ext.vendorThing, 'keep-me');
      assert.deepEqual(after.imp[1], { id: 'i2', banner: { w: 300, h: 250 } });

      // ── 6. Undo restores the text byte-for-byte ────────────────────────
      await page.click('#migrateUndo');
      await delay(400);
      const undone = await page.evaluate(() => ({
        editor: /** @type {any} */ (document.getElementById('bidReq')).value,
        items: document.querySelectorAll('.mig-item').length,
      }));
      assert.equal(undone.editor, LEGACY, 'Undo did not restore the original text exactly');
      assert.equal(undone.items, 7, 'the full proposal list must come back after Undo');

      // ── 7. A BidResponse is declared un-examined, not "clean" ──────────
      await setEditor(JSON.stringify({ id: 'r', seatbid: [{ bid: [{ id: 'b', impid: 'i1' }] }] }));
      await openTab();
      const notRequest = await page.evaluate(
        () => (document.querySelector('#migrateContainer .empty-hint') || {}).textContent || '',
      );
      assert.match(notRequest, /not examined/i, notRequest);
      assert.doesNotMatch(
        notRequest,
        /already matches 2\.6/i,
        'an unexamined payload must not read as an already-migrated one',
      );

      assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) await stopChild(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
