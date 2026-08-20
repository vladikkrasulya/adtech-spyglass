'use strict';

/**
 * The verdict must report everything that needs action, not the loudest
 * severity only.
 *
 * HISTORY. `public/ortbtools.app.js` once carried a comment true of its intent
 * and false of its output: "Outcome-first: status pill leads with an icon and
 * the counts of findings." The chain under it stopped at the first match:
 *
 *     } else if (errCount) { statusText = errCount + ' error(s)'; }
 *     else if (warnCount)  { statusText = warnCount + ' warning(s)'; }
 *
 * so a payload with 1 error and 4 warnings rendered "✗ 1 error" and the four
 * warnings never reached the top-level answer. That is also why the other
 * counters on screen felt like rivals: they were the only place the rest of
 * the findings appeared.
 *
 * WHY THIS FILE WAS REWRITTEN. The first version of this guard matched the
 * source line `statusText = warnText ? errText + ' · ' + warnText : errText`.
 * It defended the right property with the wrong evidence: when v2 replaced
 * the pill with a `#verdict` element, the property was preserved and improved
 * — questions joined the detail — and the test failed anyway, because it was
 * pinned to a string rather than to what a reader sees. A guard that fails on
 * a correct change is a guard that will eventually be deleted rather than
 * understood.
 *
 * So it now asserts the rendered verdict in a real browser, across payloads
 * built to produce specific severity mixes. It also keeps one structural
 * check — the one that cannot be observed from output — that both counts are
 * computed before the branch that chooses between them, since restoring the
 * early-exit shape would otherwise read as a tidy-up.
 *
 * SCOPE. Errors, warnings and questions are in; info is deliberately out.
 * Errors block, warnings risk, questions need a mapping decision — each asks
 * something of the reader. Info findings request nothing, and a verdict
 * carrying four numbers stops being a verdict.
 */

/* global document */

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
const APP = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');

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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* Errors, warnings AND unmapped fields together — the mix that used to render
   as the error count alone. */
const MIXED = JSON.stringify({
  id: '',
  imp: [
    {
      id: '1',
      banner: { w: 300, h: 250, battr: [16] },
      bidfloor: 0.45,
      bidfloorcur: 'USD',
      secure: 1,
      ext: { adtype: 'popunder', viewability_provider: 'acme' },
    },
  ],
  device: { ua: 'Mozilla/5.0 (Linux; Android 14)', geo: { country: 'UKR', city: 'Kyiv' } },
  site: { domain: 'example-publisher.com', cat: ['IAB1'] },
  regs: { gpp: 'DBABMA~CPXxRfAPXxRfA' },
  source: { ext: { schain: { complete: 0, nodes: [{ asi: 'ssp.example', sid: '42', hp: 1 }] } } },
});

test('each severity reaches the meta line through its own if, not an else-chain', () => {
  // The one property invisible from the rendered output: the original defect
  // was an else-if chain that reported only the loudest severity. The v2 meta
  // line builds parts[] with an independent `if` per severity; an edit that
  // "tidies" those into a chain would look reasonable and quietly restore the
  // bug. The browser test below proves the rendered result; this pins the
  // shape that makes the result possible.
  const start = APP.indexOf('const parts = [];');
  assert.ok(start > -1, 'the verdict must build its meta line as parts[]');
  const region = APP.slice(start, start + 900);
  for (const marker of [
    /if \(errCount\) \{/,
    /if \(warnCount\) parts\.push/,
    /if \(questionCount\) \{/,
  ]) {
    assert.match(region, marker, `the verdict region lost its independent ${marker} push`);
  }
  assert.ok(
    !/else if \((warnCount|questionCount)\)/.test(region),
    'a severity count must not be gated behind another severity — that is the ' +
      'early-exit shape that reported a fifth of what was found',
  );
});

test(
  'browser: the verdict names every severity that asks something of the reader',
  { timeout: 240000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-verdict-'));
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

      /* Every locale: the verdict is the one line a non-engineer reads, and a
         locale that lost it would silently fall back to Ukrainian. */
      for (const [locale, prefix] of [
        ['en', ''],
        ['uk', '/uk'],
        ['ru', '/ru'],
      ]) {
        const page = await browser.newPage();
        await page.setViewport({ width: 1600, height: 1000 });
        await page.goto(`${serverInfo.url}${prefix}/inspector`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForSelector('#bidReq', { timeout: 15000 });

        const before = await page.evaluate(() => {
          const v = document.getElementById('verdict');
          return v ? v.hidden : null;
        });
        assert.equal(before, true, `${locale}: an unanalysed workbench must state no verdict`);

        await page.evaluate((v) => {
          const el = /** @type {any} */ (document.getElementById('bidReq'));
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, MIXED);
        await page.evaluate(() =>
          /** @type {any} */ (document.querySelector('[data-action="analyze"]')).click(),
        );
        await page.waitForSelector('.validation-item', { timeout: 15000 });
        await delay(500);

        const shown = await page.evaluate(() => {
          const box = document.getElementById('verdict');
          const rows = [...document.querySelectorAll('.validation-item')];
          const count = (cls) => rows.filter((r) => r.classList.contains(cls)).length;
          return {
            hidden: box.hidden,
            kind: box.dataset.verdict,
            headline: document.getElementById('verdictHeadline').textContent.trim(),
            detail: document.getElementById('verdictDetail').textContent.trim(),
            errors: count('danger'),
            warnings: count('warning'),
            questions: count('question'),
          };
        });

        assert.equal(shown.hidden, false, `${locale}: the verdict must appear after an analysis`);
        assert.equal(shown.kind, 'blocked', `${locale}: errors present must read as blocked`);
        assert.ok(shown.headline.length > 12, `${locale}: the headline must be a sentence`);

        // The premise: this payload must actually produce all three, or the
        // assertions below would pass vacuously.
        assert.ok(shown.errors > 0, `${locale}: fixture must produce errors`);
        assert.ok(shown.warnings > 0, `${locale}: fixture must produce warnings`);
        assert.ok(shown.questions > 0, `${locale}: fixture must produce unmapped fields`);

        // Every actionable count reaches the top-level answer. Pre-fix, only
        // the error count did.
        for (const [label, n] of [
          ['errors', shown.errors],
          ['warnings', shown.warnings],
          ['questions', shown.questions],
        ]) {
          assert.match(
            shown.detail,
            new RegExp(`(^|\\D)${n}(\\D|$)`),
            `${locale}: the verdict detail "${shown.detail}" omits the ${label} count (${n})`,
          );
        }

        // …and the counts are inflected, not concatenated. Ukrainian and
        // Russian would otherwise read "5 критичні помилки" for any figure
        // of five or more.
        assert.ok(
          !/\d+\s*\[/.test(shown.detail),
          `${locale}: the detail contains an unresolved message id: ${shown.detail}`,
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
