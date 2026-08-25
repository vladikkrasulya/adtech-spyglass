/* global document, window, parent */
'use strict';

/**
 * End-to-end contract tests for the creative preview boundary.
 *
 * These cases intentionally use a real browser. Structural source checks cannot
 * prove that a sandboxed frame's messages stay bounded, that Chrome's
 * `*-src-elem` directive spellings are localized, or that the exact body put in
 * `srcdoc` is also the body sent to the static behavior scanner.
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
const chromeExecutable = [
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
    } catch (_error) {
      return false;
    }
  });

const browserSkipReason = !puppeteer
  ? `puppeteer-core unavailable: ${puppeteerLoadError}`
  : !chromeExecutable
    ? 'No executable Chrome/Chromium found; set CHROME_BIN'
    : false;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function startServer(port, dataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
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
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGTERM');
      reject(new Error('Server did not start within 10s'));
    }, 10000);
    const onData = (chunk) => {
      if (settled || !chunk.toString().includes('listening')) return;
      settled = true;
      clearTimeout(timer);
      resolve({ proc, url: `http://127.0.0.1:${port}` });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('error', reject);
    proc.once('exit', (code) => {
      if (!settled) reject(new Error(`Server exited ${code}`));
    });
  });
}

function stopServer(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => proc.kill('SIGKILL'), 2000);
    proc.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

const SAMPLE_REQ = JSON.stringify({
  id: 'creative-preview-browser-request',
  imp: [{ id: 'imp-1', banner: { w: 300, h: 250 } }],
  site: { domain: 'example.test' },
});

function responseWithAdm(adm) {
  return JSON.stringify({
    id: 'creative-preview-browser-response',
    cur: 'USD',
    seatbid: [
      {
        seat: 'test-seat',
        bid: [{ id: 'bid-1', impid: 'imp-1', price: 1, w: 300, h: 250, adm }],
      },
    ],
  });
}

async function analyze(page, adm) {
  await page.evaluate(
    (req, res) => {
      /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq')).value = req;
      /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes')).value = res;
      /** @type {any} */ (window).runAnalysis();
    },
    SAMPLE_REQ,
    responseWithAdm(adm),
  );
}

function base64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function decodeBehaviorAdm(body) {
  return typeof body?.adm_b64 === 'string'
    ? Buffer.from(body.adm_b64, 'base64').toString('utf8')
    : body?.adm;
}

function withoutProbeChannel(srcdoc) {
  return srcdoc.replace(
    /const PROBE_CHANNEL = '[0-9a-f]{48}';/,
    "const PROBE_CHANNEL = '<per-render>';",
  );
}

test(
  'browser: creative preview classification, refusal ledger, and static-analysis bytes stay safe',
  { timeout: 120000, skip: browserSkipReason },
  async () => {
    assert.ok(puppeteer);
    assert.ok(chromeExecutable);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-preview-'));
    const port = await getFreePort();
    let serverInfo = null;
    let browser = null;

    try {
      serverInfo = await startServer(port, dataDir);
      browser = await puppeteer.launch({
        headless: true,
        protocolTimeout: 120000,
        executablePath: chromeExecutable,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      // `runAnalysis` is a supported global and becomes visible while the
      // inspector is still mounting. Hold the first probe request, call that
      // early entry point, and prove it cannot create an allow-scripts frame
      // until the authenticated probe source is ready.
      const earlyPage = await browser.newPage();
      await earlyPage.setRequestInterception(true);
      let releaseHeldProbe;
      const heldProbe = new Promise((resolve) => {
        releaseHeldProbe = resolve;
      });
      earlyPage.on('request', (request) => {
        if (request.url().includes('/creative-probe.js')) {
          releaseHeldProbe(request);
          return;
        }
        request.continue();
      });
      const earlyNavigation = earlyPage.goto(serverInfo.url + '/inspector', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      const delayedProbeRequest = await heldProbe;
      await earlyPage.waitForFunction(
        () => typeof (/** @type {any} */ (window).runAnalysis) === 'function',
      );
      await earlyPage.evaluate(
        (req, res) => {
          /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq')).value = req;
          /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes')).value = res;
          void (/** @type {any} */ (window).runAnalysis());
        },
        SAMPLE_REQ,
        responseWithAdm('<div data-preview-case="early-probe">early</div>'),
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        await earlyPage.$('#creativePreview iframe'),
        null,
        'an early external runAnalysis call must wait rather than mount an unprobed frame',
      );
      await delayedProbeRequest.continue();
      await earlyNavigation;
      await earlyPage.waitForFunction(
        () => {
          const frame = /** @type {HTMLIFrameElement|null} */ (
            document.querySelector('#creativePreview iframe')
          );
          return (
            frame?.srcdoc.includes('data-preview-case="early-probe"') &&
            /** @type {any} */ (window).__ortbtoolsBehavior?.events?.some(
              (event) => event?.method === 'init',
            )
          );
        },
        { timeout: 8000 },
      );
      await earlyPage.close();

      const page = await browser.newPage();
      const behaviorRequests = [];
      const probeRequests = [];
      page.on('request', (request) => {
        if (request.url().includes('/creative-probe.js')) probeRequests.push(request.url());
        if (!request.url().includes('/api/analyze-behavior') || request.method() !== 'POST') return;
        try {
          behaviorRequests.push(JSON.parse(request.postData() || '{}'));
        } catch (_error) {
          // A malformed request will fail the assertions below with useful context.
        }
      });
      await page.goto(serverInfo.url + '/inspector', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      await page.waitForSelector('#bidReq', { timeout: 10000 });
      assert.ok(
        probeRequests.some((url) => /\/creative-probe\.js\?v=[0-9a-f]{8}(?:$|&)/.test(url)),
        'the runtime-fetched probe must carry its content hash',
      );

      // The source-pinned creative can call parent.postMessage itself, but it
      // cannot read the probe's per-render capability after the probe removes
      // its own script element. Forged reserved messages must be rejected;
      // real probe-raised events and a 200-entry CSP ledger still work.
      const refusalBoundaryAdm = [
        '<div>bounded refusal test</div>',
        '<script>',
        'setTimeout(function(){',
        "parent.postMessage({type:'ortbtools-probe',v:1,ts:Date.now(),kind:'navigation',method:'forged',url:'',trigger:'manual',marker:'must-not-land'},'*');",
        "parent.postMessage({type:'ortbtools-preview-refusal',v:1,ts:Date.now(),items:[{directive:'img-src',blockedUri:'https://forged-only.invalid/a'}],truncated:false},'*');",
        'var originalAssign=Object.assign;',
        'window.__retainedAssignResults=[];',
        "window.__leakedProbeChannel='';",
        'Object.assign=function(){var result=originalAssign.apply(Object,arguments);window.__retainedAssignResults.push(result);if(result&&result.channel)window.__leakedProbeChannel=result.channel;return result;};',
        "Object.defineProperty(Object.prototype,'channel',{configurable:true,set:function(value){window.__leakedProbeChannel=value;}});",
        'Date.now=function(){return NaN;};',
        "window.open('https://legitimate-navigation.example.invalid/a');",
        "try{dispatchEvent(new SecurityPolicyViolationEvent('securitypolicyviolation',{effectiveDirective:'img-src',blockedURI:'https://fabricated-by-creative.invalid/pixel'}));}catch(e){}",
        "parent.postMessage({type:'ortbtools-probe',v:1,ts:1,channel:window.__leakedProbeChannel,kind:'navigation',method:'forged-after-hook',url:'',trigger:'manual',marker:'must-not-land-after-hook'},'*');",
        'delete Object.prototype.channel;',
        '},40);',
        '</script>',
      ].join('');
      await analyze(page, refusalBoundaryAdm);
      await page.waitForFunction(
        () => {
          const browserWindow = /** @type {any} */ (window);
          return (browserWindow.__ortbtoolsBehavior?.events || []).some(
            (event) => event && event.method === 'window.open',
          );
        },
        { timeout: 6000 },
      );
      const creativeFrameHandle = await page.$('#creativePreview iframe');
      assert.ok(creativeFrameHandle);
      const creativeSrcdoc = await creativeFrameHandle.evaluate(
        (frame) => /** @type {HTMLIFrameElement} */ (frame).srcdoc,
      );
      const channelMatch = /const PROBE_CHANNEL = '([0-9a-f]{48})';/.exec(creativeSrcdoc);
      assert.ok(channelMatch, 'test harness could not locate the per-render probe channel');
      const creativeFrame = await creativeFrameHandle.contentFrame();
      assert.ok(creativeFrame);
      assert.equal(
        await creativeFrame.evaluate(() => /** @type {any} */ (window).__leakedProbeChannel),
        '',
        'creative replacements for mutable intrinsics must not observe the probe channel',
      );
      assert.equal(
        await creativeFrame.evaluate(() =>
          Array.from(document.scripts).some((script) =>
            (script.textContent || '').includes('const PROBE_CHANNEL'),
          ),
        ),
        false,
        'the channel-bearing probe script must be gone before creative code can inspect the DOM',
      );
      // The harness can read parent-owned srcdoc and therefore exercise the
      // authenticated reducer directly. First retain 199; then put the 200th
      // unique item BEFORE a duplicate to prove ordering alone cannot turn an
      // exact ledger into a truncated one.
      await creativeFrame.evaluate((channel) => {
        const first = Array.from({ length: 199 }, (_, i) => ({
          directive: i % 2 ? 'script-src-elem' : 'img-src',
          blockedUri: `https://bounded-${i}.invalid/a`,
        }));
        parent.postMessage(
          {
            type: 'ortbtools-preview-refusal',
            v: 1,
            ts: 1,
            channel,
            items: first,
            truncated: false,
          },
          '*',
        );
        const second = [
          { directive: 'style-src-elem', blockedUri: 'https://bounded-199.invalid/a' },
          first[0],
        ];
        parent.postMessage(
          {
            type: 'ortbtools-preview-refusal',
            v: 1,
            ts: 1,
            channel,
            items: second,
            truncated: false,
          },
          '*',
        );
      }, channelMatch[1]);
      await page.waitForFunction(
        () => {
          const text = document.getElementById('creativeBlocked')?.textContent || '';
          return text.includes('200 resource(s)') && !text.includes('at least');
        },
        { timeout: 6000 },
      );
      // A repeated duplicate at exact capacity is not truncation. A batch
      // larger than the 500-event behavior ring then proves refusals still
      // cannot evict the legitimate navigation evidence.
      await creativeFrame.evaluate((channel) => {
        parent.postMessage(
          {
            type: 'ortbtools-preview-refusal',
            v: 1,
            ts: 1,
            channel,
            items: [{ directive: 'img-src', blockedUri: 'https://bounded-0.invalid/a' }],
            truncated: false,
          },
          '*',
        );
      }, channelMatch[1]);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.doesNotMatch(
        await page.$eval('#creativeBlocked', (node) => node.textContent || ''),
        /at least/,
      );
      await creativeFrame.evaluate((channel) => {
        parent.postMessage(
          {
            type: 'ortbtools-preview-refusal',
            v: 1,
            ts: 1,
            channel,
            items: Array.from({ length: 600 }, (_, i) => ({
              directive: 'style-src-elem',
              blockedUri: `https://over-cap-${i}.invalid/a`,
            })),
            truncated: false,
          },
          '*',
        );
      }, channelMatch[1]);
      await page.waitForFunction(
        () => document.getElementById('creativeBlocked')?.textContent.includes('at least 200'),
        { timeout: 6000 },
      );
      const refusalBoundary = await page.evaluate(() => {
        const browserWindow = /** @type {any} */ (window);
        return {
          ledger: document.getElementById('creativeBlocked')?.textContent || '',
          behavior: browserWindow.__ortbtoolsBehavior?.events || [],
          refusalLeak: (browserWindow.__ortbtoolsBehavior?.events || []).some(
            (event) => event && event.type === 'ortbtools-preview-refusal',
          ),
        };
      });
      assert.match(refusalBoundary.ledger, /at least 200 resource\(s\)/);
      assert.doesNotMatch(refusalBoundary.ledger, /forged-only\.invalid/);
      assert.doesNotMatch(refusalBoundary.ledger, /fabricated-by-creative\.invalid/);
      assert.equal(refusalBoundary.refusalLeak, false, 'refusals must never enter behavior events');
      assert.equal(
        refusalBoundary.behavior.some(
          (event) => event && /^must-not-land/.test(String(event.marker || '')),
        ),
        false,
        'creative-authored reserved messages must fail authentication even after intrinsic hooks',
      );
      assert.equal(
        refusalBoundary.behavior.some(
          (event) => event && event.method === 'window.open' && event.kind === 'auto_navigate',
        ),
        true,
        'a legitimate authenticated probe event must survive',
      );

      // A delayed asset rewrite belongs to the frame that requested it. If a
      // newer analysis replaces that frame first, the old promise must not
      // overwrite the newer preview or its static-analysis source.
      const assetA =
        '<img data-preview-case="asset-old" src="https://asset-old.example.invalid/a.png">';
      await analyze(page, assetA);
      await page.waitForSelector('.creative-inline-assets', { timeout: 6000 });
      await page.evaluate(() => {
        const api = /** @type {any} */ (window).OrtbtoolsCreativeAssets;
        api.inlineAssets = () =>
          new Promise((resolve) => {
            /** @type {any} */ (window).__resolveOldInline = resolve;
          });
        /** @type {HTMLButtonElement} */ (
          document.querySelector('.creative-inline-assets')
        ).click();
      });
      await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).__resolveOldInline) === 'function',
      );
      const assetB = '<div data-preview-case="asset-newer">newer</div>';
      await analyze(page, assetB);
      await page.waitForFunction(
        () =>
          /** @type {HTMLIFrameElement} */ (
            document.querySelector('#creativePreview iframe')
          )?.srcdoc.includes('data-preview-case="asset-newer"'),
        { timeout: 6000 },
      );
      await page.evaluate(() => {
        /** @type {any} */ (window).__resolveOldInline({
          html: '<div data-preview-case="asset-stale">stale</div>',
          inlined: 1,
          failed: [],
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const postInlineRace = await page.$eval(
        '#creativePreview iframe',
        (frame) => /** @type {HTMLIFrameElement} */ (frame).srcdoc,
      );
      assert.match(postInlineRace, /data-preview-case="asset-newer"/);
      assert.doesNotMatch(postInlineRace, /data-preview-case="asset-stale"/);
      assert.ok(
        behaviorRequests.some((body) => decodeBehaviorAdm(body) === assetB),
        'the newer frame must remain the static-analysis source after a stale inline response',
      );

      // These are real browser-raised CSP refusals. Chromium reports the
      // element-specific spellings (`script-src-elem`, `style-src-elem`), but
      // the analyst-facing contract groups them into localized resource kinds.
      await analyze(
        page,
        '<script>window.__timerCaptured=0;window.setTimeout=function(){window.__timerCaptured++;return 1}</script>' +
          '<style>@import url("https://style.example.invalid/a.css");</style>' +
          '<script src="https://script.example.invalid/a.js"></script>' +
          '<img src="https://image.example.invalid/a.png" alt="blocked">',
      );
      await page.waitForFunction(
        () => {
          const text = document.getElementById('creativeBlocked')?.textContent || '';
          return text.includes('images') && text.includes('scripts') && text.includes('styles');
        },
        { timeout: 8000 },
      );
      const realLedger = await page.$eval('#creativeBlocked', (node) => node.textContent || '');
      assert.doesNotMatch(realLedger, /\[creative\.blocked\.kind\./);
      const realRefusalFrame = await (await page.$('#creativePreview iframe'))?.contentFrame();
      assert.ok(realRefusalFrame);
      assert.equal(
        await realRefusalFrame.evaluate(() => /** @type {any} */ (window).__timerCaptured),
        0,
        'creative replacement of setTimeout must not suppress a real CSP refusal flush',
      );

      // Numbered timer handles are predictable within a frame. A creative
      // policy listener must not be able to allocate the next timer and
      // cancel the probe's pending batch by guessing `next - 1`.
      await analyze(
        page,
        '<script>window.__timerCancelAttempts=0;addEventListener("securitypolicyviolation",function(){var next=setTimeout(function(){},1000);clearTimeout(next);clearTimeout(next-1);window.__timerCancelAttempts++})</script>' +
          '<img src="https://timer-id-cancel.example.invalid/pixel" alt="blocked">',
      );
      await page.waitForFunction(
        () =>
          (document.getElementById('creativeBlocked')?.textContent || '').includes(
            'timer-id-cancel.example.invalid',
          ),
        { timeout: 8000 },
      );
      const timerCancelFrame = await (await page.$('#creativePreview iframe'))?.contentFrame();
      assert.ok(timerCancelFrame);
      assert.ok(
        (await timerCancelFrame.evaluate(() => /** @type {any} */ (window).__timerCancelAttempts)) >
          0,
        'the cancellation attempt itself must have run before the ledger assertion',
      );

      // VAST and URL bodies are text, never revealable creative markup.
      await analyze(page, '<VAST version="4.0"><Ad></Ad></VAST>');
      await page.waitForSelector('#creativePreview .preview-text-body');
      const vastState = await page.evaluate(() => ({
        frame: !!document.querySelector('#creativePreview iframe'),
        revealable: document.getElementById('creativePreviewSafe')?.dataset.revealable || '',
        text: document.querySelector('#creativePreview .preview-text-body')?.textContent || '',
      }));
      assert.equal(vastState.frame, false);
      assert.equal(vastState.revealable, '');
      assert.match(vastState.text, /<VAST/);

      const bareUrl = 'https://creative.example.invalid/banner';
      await analyze(page, bareUrl);
      await page.waitForFunction(
        (expected) =>
          document.querySelector('#creativePreview .preview-text-body')?.textContent === expected,
        { timeout: 5000 },
        bareUrl,
      );
      assert.equal(await page.$('#creativePreview iframe'), null);
      assert.equal(await page.$('#creativePreview a'), null);

      // Padded and standards-valid unpadded base64 both decode to the bytes
      // mounted in the frame. The static behavior request must carry those
      // decoded bytes too, otherwise the scanner analyses a harmless-looking
      // wrapper while different code executes.
      const decodedObfuscated =
        '<div data-preview-case="decoded">decoded</div>' +
        ' '.repeat(70 * 1024) +
        '<script>eval(atob("dmFyIHg9MTs="))</script>';
      const padded = base64(decodedObfuscated);
      await analyze(page, padded);
      await page.waitForFunction(
        (expected) =>
          /** @type {HTMLIFrameElement} */ (
            document.querySelector('#creativePreview iframe')
          )?.srcdoc.includes(expected),
        { timeout: 6000 },
        'data-preview-case="decoded"',
      );
      await page.waitForFunction(
        () =>
          document
            .getElementById('tBehavior')
            ?.textContent.includes('Creative source contains obfuscation pattern'),
        { timeout: 8000 },
      );
      assert.ok(
        behaviorRequests.some((body) => decodeBehaviorAdm(body) === decodedObfuscated),
        'behavior analysis must receive the decoded body mounted in srcdoc',
      );
      assert.equal(
        behaviorRequests.some((body) => decodeBehaviorAdm(body) === padded),
        false,
        'the encoded transport wrapper must not be scanned as the executing creative',
      );
      assert.equal(
        behaviorRequests.some((body) => Object.prototype.hasOwnProperty.call(body, 'adm')),
        false,
        'browser transport must avoid raw JSON string expansion',
      );

      const unpaddedBody = '<div data-preview-case="unpadded">unpadded!</div>';
      const unpadded = base64(unpaddedBody).replace(/=+$/, '');
      assert.notEqual(unpadded.length % 4, 0, 'fixture must exercise omitted base64 padding');
      await analyze(page, unpadded);
      await page.waitForFunction(
        (expected) =>
          /** @type {HTMLIFrameElement} */ (
            document.querySelector('#creativePreview iframe')
          )?.srcdoc.includes(expected),
        { timeout: 6000 },
        'data-preview-case="unpadded"',
      );

      // Wrapped and unwrapped Native bodies normalize to the same safe
      // synthetic frame. Wave 1 must not expose the server-fetch action on
      // this newly reachable branch, because its contract adds no requests.
      const native = {
        assets: [
          { id: 1, title: { text: 'Native parity marker' } },
          {
            id: 2,
            img: { url: 'https://native-image.example.invalid/a.png', w: 300, h: 180 },
          },
        ],
        link: { url: 'https://click.example.invalid/' },
      };
      await analyze(page, JSON.stringify({ native }));
      await page.waitForFunction(
        () =>
          /** @type {HTMLIFrameElement} */ (
            document.querySelector('#creativePreview iframe')
          )?.srcdoc.includes('Native parity marker'),
        { timeout: 6000 },
      );
      const wrappedSrcdoc = await page.$eval(
        '#creativePreview iframe',
        (frame) => /** @type {HTMLIFrameElement} */ (frame).srcdoc,
      );
      assert.equal(await page.$('.creative-inline-assets'), null);

      await analyze(page, JSON.stringify(native));
      await page.waitForFunction(
        () =>
          /** @type {HTMLIFrameElement} */ (
            document.querySelector('#creativePreview iframe')
          )?.srcdoc.includes('Native parity marker'),
        { timeout: 6000 },
      );
      const unwrappedSrcdoc = await page.$eval(
        '#creativePreview iframe',
        (frame) => /** @type {HTMLIFrameElement} */ (frame).srcdoc,
      );
      assert.equal(withoutProbeChannel(unwrappedSrcdoc), withoutProbeChannel(wrappedSrcdoc));
      assert.equal(await page.$('.creative-inline-assets'), null);

      // A missing classifier is a failed safety dependency, not permission to
      // restore the old catch-all. Abort that one asset and prove a URL stays
      // inert rather than reaching srcdoc.
      const noClassifier = await browser.newPage();
      await noClassifier.setRequestInterception(true);
      noClassifier.on('request', (request) => {
        if (request.url().includes('/modules/inspector/creative-classify.js')) request.abort();
        else request.continue();
      });
      await noClassifier.goto(serverInfo.url + '/inspector', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      await noClassifier.waitForSelector('#bidReq', { timeout: 10000 });
      await analyze(noClassifier, bareUrl);
      await noClassifier.waitForFunction(
        () => document.querySelector('#creativePreview .preview-text-body')?.textContent.length,
        { timeout: 6000 },
      );
      assert.equal(await noClassifier.$('#creativePreview iframe'), null);
      assert.equal(await noClassifier.$('#creativePreview a'), null);
      await noClassifier.close();

      // The VAST truncation message uses the module dictionary, including on
      // the Ukrainian route; no hard-coded English leaks into localized UI.
      const ukPage = await browser.newPage();
      await ukPage.goto(serverInfo.url + '/uk/inspector', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      await ukPage.waitForSelector('#bidReq', { timeout: 10000 });
      await analyze(ukPage, '<VAST>' + 'x'.repeat(8200) + '</VAST>');
      await ukPage.waitForSelector('#creativePreview .preview-text-trimmed');
      const ukTrim = await ukPage.$eval(
        '#creativePreview .preview-text-trimmed',
        (node) => node.textContent || '',
      );
      assert.match(ukTrim, /обрізано/);
      assert.doesNotMatch(ukTrim, /trimmed|chars hidden/i);
      await ukPage.close();
    } finally {
      if (browser) await browser.close();
      if (serverInfo) await stopServer(serverInfo.proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
