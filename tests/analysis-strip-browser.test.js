/* global document, getComputedStyle */
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

const req = (over) =>
  JSON.stringify({
    id: 'a1',
    cur: ['USD'],
    imp: [{ id: '1', bidfloor: 0.001, bidfloorcur: 'USD', banner: { w: 300, h: 250 }, secure: 1 }],
    site: { id: 's1', domain: 'example.com', page: 'https://example.com/a' },
    device: { ua: 'Mozilla/5.0 (Windows NT 10.0)', ip: '8.8.8.8', devicetype: 2 },
    user: { id: 'u1' },
    at: 1,
    tmax: 120,
    ...over,
  });

const RUB_FLOOR = req({
  imp: [{ id: '1', bidfloor: 12500, bidfloorcur: 'RUB', banner: { w: 300, h: 250 }, secure: 1 }],
});
const SUBCENT = req({});
const BROKEN = JSON.stringify({
  id: '',
  imp: [],
  site: {},
  app: {},
  device: {},
  regs: { gdpr: 'yes' },
  cur: 'USD',
  at: 99,
  tmax: -1,
});

// The three-panel layout hands the centre panel `viewport − ~900px`, so these
// viewports exercise bar widths from roomy down to the ~130px sliver just
// above the 1024px stacking breakpoint, plus the stacked and phone layouts.
const WIDTHS = [1600, 1440, 1300, 1200, 1100, 1030, 1000, 860, 700];
const LOCALES = ['uk', 'en', 'ru'];
const WIDEST_LABEL = { uk: 'Потребує уваги', en: 'Needs Attention', ru: 'Требует внимания' };

test(
  'browser smoke test: the analysis strip',
  { timeout: 240000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-strip-'));
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
            NEWS_CRAWLER_DISABLED: '1',
            // No outbound rate fetch from a test run. The conversion is
            // additive, so every assertion below holds without it — which is
            // itself the contract: the strip is complete without the network.
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

      const analyze = async (body) => {
        await page.evaluate((v) => {
          const el = /** @type {any} */ (document.getElementById('bidReq'));
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, body);
        await page.evaluate(() =>
          /** @type {any} */ (document.querySelector('[data-action="analyze"]')).click(),
        );
        await page.waitForSelector('#analysisStrip .quality-pill', { timeout: 15000 });
        await delay(500);
      };

      const measure = () =>
        page.evaluate(() => {
          const strip = /** @type {any} */ (document.getElementById('analysisStrip'));
          const pill = strip.querySelector('.quality-pill');
          const score = strip.querySelector('.quality-score');
          const status = strip.querySelector('.quality-status');
          const R = (e) => e.getBoundingClientRect();
          const s = R(strip);
          const p = R(pill);
          const statusHidden = status ? getComputedStyle(status).display === 'none' : true;
          return {
            // >0 means the capsule is shorter than the text inside it
            squash: pill.scrollHeight - pill.clientHeight,
            // >0 means the number pokes out above the capsule's top border
            numberAbove: +(p.top - R(score).top).toFixed(1),
            // >0 means the tier label hangs below the capsule's bottom border
            labelBelow: statusHidden ? 0 : +(R(status).bottom - p.bottom).toFixed(1),
            pillBelowBar: +(p.bottom - s.bottom).toFixed(1),
            pillPastRight: +(p.right - s.right).toFixed(1),
            scrollable: getComputedStyle(strip).overflowX === 'auto',
            statusHidden,
          };
        });

      /** Assert the pill is inside its own capsule, and the capsule inside the bar. */
      const assertFits = (m, where) => {
        assert.equal(m.squash, 0, `${where}: capsule squashed below its text by ${m.squash}px`);
        assert.ok(m.numberAbove <= 0.5, `${where}: number ${m.numberAbove}px above the capsule`);
        assert.ok(m.labelBelow <= 0.5, `${where}: tier label ${m.labelBelow}px below the capsule`);
        assert.ok(m.pillBelowBar <= 0.5, `${where}: pill ${m.pillBelowBar}px below the bar`);
        // A scrollable bar may legitimately extend past its right edge; a
        // clipped one may not.
        if (!m.scrollable) {
          assert.ok(m.pillPastRight <= 0.5, `${where}: pill ${m.pillPastRight}px past the bar`);
        }
      };

      for (const loc of LOCALES) {
        await page.setViewport({ width: 1440, height: 900 });
        await page.goto(`${serverInfo.url}/${loc}`, { waitUntil: 'networkidle2', timeout: 20000 });
        await page.waitForSelector('#bidReq', { timeout: 10000 });

        // ── 1. Pill geometry, ordinary payload ───────────────────────────
        await analyze(SUBCENT);
        for (const w of WIDTHS) {
          await page.setViewport({ width: w, height: 900 });
          await delay(180);
          assertFits(await measure(), `${loc} @${w}`);
        }

        // ── 2. Pill geometry, worst-case tier label ──────────────────────
        // Longest string in every locale; drive it directly rather than
        // hunting for a payload that scores 40-69.
        await page.setViewport({ width: 1440, height: 900 });
        await delay(180);
        await page.evaluate((label) => {
          const pill = /** @type {any} */ (document.querySelector('.quality-pill'));
          pill.querySelector('.quality-status').textContent = label;
          pill.className = 'quality-pill q-needs-attention';
        }, WIDEST_LABEL[loc]);
        for (const w of WIDTHS) {
          await page.setViewport({ width: w, height: 900 });
          await delay(180);
          assertFits(await measure(), `${loc} @${w} widest-label`);
        }

        // ── 3. The critical tier still fits ──────────────────────────────
        await page.setViewport({ width: 1440, height: 900 });
        await delay(180);
        await analyze(BROKEN);
        assertFits(await measure(), `${loc} critical`);
      }

      // ── 4. A rouble floor is not labelled in dollars ────────────────────
      await page.setViewport({ width: 1700, height: 900 });
      await page.goto(`${serverInfo.url}/en`, { waitUntil: 'networkidle2', timeout: 20000 });
      await page.waitForSelector('#bidReq', { timeout: 10000 });
      await analyze(RUB_FLOOR);

      const pricing = await page.evaluate(() => {
        // Address the pricing cell by its own class, not by position. The
        // original `blocks[4]` encoded "pricing is the fifth cell" — a record
        // describing the strip's layout rather than the thing it wanted, and
        // the v2 chip reorder (money first) falsified it without touching the
        // cell itself.
        const cell = document.querySelector(
          '#analysisStrip .analysis-strip-pricing .analysis-strip-value',
        );
        const text = cell ? cell.textContent.replace(/\s+/g, ' ').trim() : '';
        const mismatch = document.querySelector('#analysisStrip .floor-cur-mismatch');
        const slot = document.querySelector('.slot-floor-value');
        return {
          text,
          mismatch: !!mismatch,
          mismatchTitle: mismatch ? mismatch.getAttribute('title') : '',
          slot: slot ? slot.textContent.trim() : '',
        };
      });

      assert.match(pricing.text, /RUB/, 'the arriving currency is named');
      assert.match(pricing.text, /12,500/, 'the amount that actually arrived is shown');
      assert.ok(
        !/\$\s*12,?500/.test(pricing.text),
        `a rouble amount must not wear a dollar sign — got "${pricing.text}"`,
      );
      // req.cur is ['USD'] while the imp prices its floor in RUB: a real
      // mismatch the bar should surface rather than swallow.
      assert.ok(pricing.mismatch, 'a floor outside req.cur is marked');
      assert.match(pricing.mismatchTitle, /USD/, 'the tooltip names what was allowed');
      // The slot card reads the imp's own bidfloorcur, not req.cur[0].
      assert.match(
        pricing.slot,
        /RUB/,
        `slot card shows the imp's currency, got "${pricing.slot}"`,
      );

      // ── 5. With FX off, the strip is still complete ─────────────────────
      const usdSlot = await page.evaluate(() => {
        const el = document.querySelector('#analysisStrip .floor-usd');
        return el ? el.textContent : null;
      });
      assert.equal(usdSlot, '', 'no rate table means no conversion, not a made-up one');

      // ── 6. A sub-cent floor never reads as zero ─────────────────────────
      await analyze(SUBCENT);
      const subcent = await page.evaluate(() => {
        // By class, not by position — the second of the two indexed reads
        // this file carried. The first was caught by the RUB assertion the
        // moment the chip order changed; this one failed one section later
        // with "got 'No Privacy'", which is the same defect naming itself.
        const cell = document.querySelector(
          '#analysisStrip .analysis-strip-pricing .analysis-strip-value',
        );
        return cell ? cell.textContent.replace(/\s+/g, ' ').trim() : '';
      });
      assert.match(subcent, /0\.001/, `a 0.001 floor must not round to 0.00 — got "${subcent}"`);

      // ── 7. The pill tooltip is not clipped away by the bar ──────────────
      const overflow = await page.evaluate(() => {
        const s = getComputedStyle(document.getElementById('analysisStrip'));
        return { x: s.overflowX, y: s.overflowY };
      });
      assert.equal(
        overflow.y,
        'visible',
        'the bar must not clip the pill tooltip, which renders above it',
      );

      assert.deepEqual(pageErrors, [], 'no page errors');
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (serverInfo) await stopChild(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);

// ── STATIC: every label in the bar carries an explanation ───────────────────
// The bar's labels are abbreviated — VER, TRAF, DEV, PRIV, PRICE — because it
// gets the width of the centre column and every pixel a label takes is paid
// for by a value. An abbreviation is only honest if the full meaning is one
// hover away, so `stripLabel()` renders each with a title from
// `strip.hint.<key>`. Both lookups come from the same key, so the pairing
// cannot drift per call site; what CAN drift is a hint missing from a locale,
// which renders as a bracketed id in that language only — invisible to anyone
// testing in English.
test('every strip label has a hint in all three locales', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');

  const keys = [...new Set([...app.matchAll(/stripLabel\('([a-z]+)'\)/g)].map((m) => m[1]))];
  // The count moved with the mockup: the bar's five labelled cells plus the
  // quality pill. Traffic, device and privacy merged into one unlabelled
  // context chip ("web · Google (Android) · UKR/Kyiv · GPP") because they are
  // four facts about one thing, and a reader needs no label to know that
  // "UKR/Kyiv" is a place. Floor for it: every label that IS rendered must
  // still have its hint, which is what the loop below checks.
  assert.ok(keys.length >= 4, `expected the bar's labels, parsed ${keys.length}: ${keys}`);

  for (const key of keys) {
    for (const kind of ['label', 'hint']) {
      const found = (i18n.match(new RegExp(`'strip\\.${kind}\\.${key}'\\s*:`, 'g')) || []).length;
      assert.equal(
        found,
        3,
        `strip.${kind}.${key} must exist in all three locale blocks of public/i18n.js — ` +
          `found ${found}. An abbreviated label with no hint in a locale is an abbreviation ` +
          'nobody in that language can resolve.',
      );
    }
  }
});
