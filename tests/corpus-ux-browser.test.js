/* global document, window, getComputedStyle */
'use strict';

// puppeteer-core: real, serial UI matrix; ordinary tests report unavailable
// Chrome as skipped, while the dedicated corpus audit requires the browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./corpus/lib/http-run');
const { recordResult, gapFor, deviationVerdict } = require('./corpus/lib/report');
const B = require('./corpus/lib/browser');

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
/** @type {Array<{locale: 'en'|'uk'|'ru',theme: 'light'|'dark',viewport: string,id: string}>} */
const MATRIX = ['en', 'uk', 'ru'].flatMap((locale) =>
  ['light', 'dark'].flatMap((theme) =>
    ['desktop', 'mobile'].map((viewport) => ({
      locale: /** @type {'en'|'uk'|'ru'} */ (locale),
      theme: /** @type {'light'|'dark'} */ (theme),
      viewport,
      id: `ux-${locale}-${theme}-${viewport}`,
    })),
  ),
);
const skipReason = B.browserSkipReason || '';
const requireBrowser = process.env.CORPUS_REQUIRE_BROWSER === '1';

test(
  'corpus UX driver: a moving reveal target receives one trusted click after layout settles',
  { skip: !requireBrowser && (skipReason || false), timeout: 20000 },
  async () => {
    if (skipReason) assert.fail(skipReason);
    const browser = await B.launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844 });
      await page.setContent(`<!doctype html><style>
        body { margin: 0; height: 700px; }
        button { position: absolute; top: 100px; left: 80px; width: 160px; height: 32px; }
        .moving { animation: move 250ms linear forwards; }
        @keyframes move { to { transform: translateY(240px); } }
      </style><div id="creativePreviewSafe"><button data-action="reveal-creative">Reveal</button></div>`);
      await page.evaluate(() => {
        const button = document.querySelector('button');
        const state = { settled: false, enabled: true, clicks: [] };
        /** @type {any} */ (window).__pointerProbe = state;
        button.addEventListener('animationend', () => {
          state.settled = true;
        });
        button.addEventListener('click', (event) => {
          state.clicks.push({ trusted: event.isTrusted, settled: state.settled });
          if (state.enabled)
            document.getElementById('creativePreviewSafe').classList.add('is-revealed');
        });
        button.classList.add('moving');
      });
      const physicalClick = page.mouse.click.bind(page.mouse);
      page.mouse.click = async (...args) => {
        // Emulate protocol latency between receiving coordinates and sending
        // a real pointer event. The button moves farther than half its height.
        await new Promise((resolve) => setTimeout(resolve, 60));
        return physicalClick(...args);
      };
      assert.equal((await B.reveal(page)).revealed, true);
      assert.deepEqual(
        await page.evaluate(() => /** @type {any} */ (window).__pointerProbe.clicks),
        [{ trusted: true, settled: true }],
      );
      await page.evaluate(() => {
        /** @type {any} */ (window).__pointerProbe.enabled = false;
        document.getElementById('creativePreviewSafe').classList.remove('is-revealed');
      });
      assert.equal(
        (await B.reveal(page)).revealed,
        false,
        'a delivered click with a broken handler must remain an unrevealed failure',
      );
      assert.equal(
        await page.evaluate(() => /** @type {any} */ (window).__pointerProbe.clicks.length),
        2,
      );
    } finally {
      await browser.close();
    }
  },
);

/** @returns {import('./corpus/lib/load').Materialized} */
function fixture(id, marker, price = 2) {
  return {
    id,
    kind: 'pair',
    file: 'inline synthetic UX fixture',
    meta: { dialect: 'iab' },
    request: {
      id,
      at: 1,
      cur: ['USD'],
      site: { domain: 'publisher.example.test' },
      imp: [{ id: 'ux-imp', bidfloor: 1, bidfloorcur: 'USD', banner: { w: 300, h: 250 } }],
    },
    response: {
      id,
      cur: 'USD',
      seatbid: [
        {
          bid: [
            {
              id: 'ux-bid',
              impid: 'ux-imp',
              price,
              adomain: ['advertiser.example.test'],
              crid: 'ux-creative',
              w: 300,
              h: 250,
              adm: `<div style="width:300px;height:250px;background:#184a6b;color:white"><p>${marker}</p><img alt="Local UX asset" src="${PIXEL}"></div>`,
            },
          ],
        },
      ],
    },
  };
}

async function surface(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el || el.hidden) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const button = /** @type {HTMLButtonElement} */ (document.getElementById('analyzeBtn'));
    const controls = [
      '#analyzeBtn',
      '.kt-topbar .kt-lang-menu',
      window.innerWidth < 600 ? '.workbar-settings-menu > summary' : '#dialectSelectorControl',
    ].map((selector) => {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect();
      return {
        selector,
        visible: visible(el),
        whole: !!r && r.left >= -1 && r.right <= window.innerWidth + 1,
        width: r?.width || 0,
        name:
          el?.getAttribute('aria-label') ||
          el?.getAttribute('title') ||
          el?.textContent?.trim() ||
          '',
      };
    });
    const focus = document.activeElement;
    const css = focus ? getComputedStyle(focus) : null;
    return {
      locale: document.documentElement.lang,
      theme: document.documentElement.getAttribute('data-theme'),
      storedTheme: window.localStorage.getItem('kt-theme'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      controls,
      buttonDisabled: button.disabled,
      buttonText: button.textContent.trim(),
      spinner: !!button.querySelector('.spinner'),
      ariaBusy: button.getAttribute('aria-busy'),
      liveRegions: Array.from(document.querySelectorAll('[aria-live], [role=alert]')).map((el) => ({
        role: el.getAttribute('role'),
        live: el.getAttribute('aria-live'),
      })),
      focusId: focus?.id || '',
      focusVisible:
        !!css &&
        ((css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) > 0) ||
          css.boxShadow !== 'none'),
      last: !!(/** @type {any} */ (window).__ortbtoolsLast),
      verdictVisible: visible(document.getElementById('verdict')),
      requestLength: /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq')).value
        .length,
      responseLength: /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes')).value
        .length,
      findingCount: document.querySelectorAll('[data-finding-id]').length,
      staleMarks: document.querySelectorAll('.src-hl-overlay mark.src-hl').length,
    };
  });
}

// UI-only gap metadata lives in the same ledger as corpus deviations. Explicit
// scenario IDs prevent a CSS exception from masking an unrelated combination.
function uxCase(config, ledger) {
  const gap = Object.entries(ledger).find(([, value]) => value.cases?.includes(config.id));
  return {
    id: config.id,
    kind: 'ux',
    file: 'tests/corpus-ux-browser.test.js',
    meta: {
      title: `${config.locale} ${config.theme} ${config.viewport}`,
      format: 'ui',
      protocol: 'n/a',
      context: 'web',
      dialect: 'iab',
      scenario: 'interaction',
      knownGap: gap
        ? {
            id: gap[0],
            layers: ['ux'],
            note: gap[1].note || gap[1].title || '',
            matches: gap[1].matches,
          }
        : null,
    },
  };
}

// The loader's public list is read here without filtering by CORPUS_CASE:
// selecting one ad fixture must not accidentally turn a 12-cell UX audit into 0.
function readLedger() {
  const fs = require('node:fs');
  const { KNOWN_GAPS_FILE } = require('./corpus/lib/load');
  return fs.existsSync(KNOWN_GAPS_FILE)
    ? JSON.parse(fs.readFileSync(KNOWN_GAPS_FILE, 'utf8')).gaps || {}
    : {};
}

if (skipReason && !requireBrowser) {
  for (const config of MATRIX)
    recordResult('ux', uxCase(config, {}), {
      pass: false,
      failures: [],
      gap: null,
      outcome: 'skip',
      reason: skipReason,
    });
}

test(
  'corpus UX: 12 locale/theme/viewport scenarios',
  { skip: !requireBrowser && (skipReason || false), timeout: 300000 },
  async (t) => {
    if (skipReason) {
      for (const config of MATRIX)
        recordResult('ux', uxCase(config, {}), {
          pass: false,
          failures: [skipReason],
          gap: null,
          outcome: 'skip',
          reason: skipReason,
        });
      assert.fail(skipReason);
    }
    const server = await startServer();
    let browser;
    try {
      browser = await B.launchBrowser();
      const version = await B.browserVersion(browser);
      const ledger = readLedger();
      for (const config of MATRIX) {
        await t.test(config.id, async () => {
          const c = uxCase(config, ledger);
          const gap = gapFor(c, 'ux');
          const failures = [];
          const screenshots = [];
          const observations = {};
          const view = await B.openInspector(browser, server.url, {
            locale: config.locale,
            theme: config.theme,
            viewport:
              config.viewport === 'desktop'
                ? { width: 1440, height: 900 }
                : { width: 390, height: 844 },
          });
          const { page, pageErrors, consoleErrors } = view;
          const check = (condition, message) => {
            if (!condition) failures.push(`ux.${message}`);
          };
          const shot = async (state) =>
            screenshots.push(await B.screenshot(page, `${config.id}-${state}`, { fullPage: true }));
          try {
            const initial = await surface(page);
            check(
              initial.buttonText.startsWith(
                { en: 'Analyze', uk: 'Аналізувати', ru: 'Анализировать' }[config.locale],
              ),
              'locale: primary action is not translated',
            );
            observations.initial = initial;
            check(
              initial.locale === config.locale,
              `locale: expected ${config.locale}, got ${initial.locale}`,
            );
            check(
              initial.theme === config.theme && initial.storedTheme === config.theme,
              `theme: expected ${config.theme}, got ${initial.theme}`,
            );
            check(
              initial.overflow <= 1,
              `overflow: document exceeds viewport by ${initial.overflow}px`,
            );
            check(
              initial.controls.every((control) => control.visible && control.whole && control.name),
              'controls: offered primary controls must be visible, named and whole',
            );
            check(
              !initial.last && !initial.verdictVisible,
              'empty: initial page claims an analysis',
            );
            await shot('empty');
            await page.focus('#analyzeBtn');
            await page.keyboard.press('Tab');
            const focus = await surface(page);
            observations.keyboardFocus = focus;
            check(focus.focusId !== 'analyzeBtn', 'keyboard: Tab cannot leave the Analyze button');
            check(focus.focusVisible, 'keyboard: focused control has no visible focus treatment');
            const emptyState = await B.analyze(page);
            check(
              emptyState === 'failed',
              `empty: expected explanatory rejection, got ${emptyState}`,
            );
            const emptyAnalysis = await B.measureAnalysis(page);
            check(emptyAnalysis.toasts.length > 0, 'empty: rejection has no visible explanation');

            const a = fixture(config.id, 'UX creative A');
            await B.setPayload(page, a);
            const control = B.controlNextAnalyze(page);
            const running = B.analyze(page, { via: 'keyboard' });
            try {
              await Promise.race([
                control.requested,
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Analyze POST was never observed')), 12000),
                ),
              ]);
              observations.loading = await surface(page);
              check(
                observations.loading.buttonDisabled && observations.loading.spinner,
                'loading: Analyze is not disabled with a progress indicator',
              );
              await shot('loading');
            } finally {
              control.release();
            }
            check(
              (await running) === 'success',
              'analyze: keyboard analysis did not complete successfully',
            );
            const transport = B.measureTransport(page);
            check(
              transport.responses[0]?.status === 200 &&
                transport.responses[0]?.body?.success === true,
              'transport: keyboard Analyze did not use a successful real HTTP response',
            );
            await B.openTab(page, 'tCreative');
            const initialReveal = await B.reveal(page);
            const preview = await B.measurePreview(page);
            check(
              !initialReveal.offered || initialReveal.revealed,
              'preview: offered reveal control did not remove blur',
            );
            observations.preview = {
              reveal: initialReveal,
              kind: preview.kind,
              rendered: preview.rendered,
              assets: preview.assets,
              marker: preview.markerText.includes('UX creative A'),
              outer: preview.outer,
            };
            check(
              preview.rendered === 'full' &&
                preview.markerText.includes('UX creative A') &&
                preview.assets.imgLoaded === 1,
              'preview: original creative and local image are not fully visible',
            );
            check(preview.outer.sandbox === 'allow-scripts', 'preview: sandbox policy changed');
            await shot('creative');

            const bad = fixture(config.id, 'UX invalid-price creative', -1);
            await B.setPayload(page, bad);
            check(
              (await B.analyze(page)) === 'success',
              'validation: negative-price analysis did not complete',
            );
            const negative = await B.measureAnalysis(page);
            check(
              negative.findings.some(
                (f) =>
                  f.id === 'err-bid-price-negative' && f.side === 'response' && f.level === 'error',
              ),
              'validation: exact negative-price finding is not visible',
            );
            observations.source = await B.gotoFinding(
              page,
              'err-bid-price-negative',
              'seatbid[0].bid[0].price',
            );
            check(
              observations.source.found &&
                observations.source.button &&
                observations.source.focused &&
                observations.source.selectedText === '-1',
              'source: finding does not focus and select the exact response price',
            );
            await shot('source');

            const b = fixture(config.id, 'UX creative B');
            await B.setPayload(page, b);
            observations.edited = await surface(page);
            check(
              !observations.edited.last &&
                !observations.edited.verdictVisible &&
                observations.edited.staleMarks === 0,
              'stale: editing leaves old analysis or source markers',
            );
            check(
              (await B.analyze(page)) === 'success',
              'reanalyze: corrected input did not complete',
            );
            await B.openTab(page, 'tCreative');
            const replacedReveal = await B.reveal(page);
            const replaced = await B.measurePreview(page);
            observations.replacedReveal = replacedReveal;
            check(
              !replacedReveal.offered || replacedReveal.revealed,
              'reanalyze: offered reveal control did not remove blur',
            );
            check(
              replaced.markerText.includes('UX creative B') &&
                !replaced.markerText.includes('UX creative A') &&
                !replaced.markerText.includes('UX invalid-price creative'),
              'reanalyze: previous creative remains visible',
            );

            B.controlNextAnalyze(page, {
              status: 429,
              body: { success: false, code: 'rate_limited', error: 'Controlled audit rate limit' },
            });
            check(
              (await B.analyze(page)) === 'failed',
              'http-error: structured 429 did not produce a failure state',
            );
            observations.httpError = await surface(page);
            const httpErrorTransport = B.measureTransport(page);
            check(
              httpErrorTransport.requests.length === 1 &&
                httpErrorTransport.responses.length === 1 &&
                httpErrorTransport.responses[0].status === 429,
              'http-error: expected exactly one controlled 429 Analyze response',
            );
            check(
              !observations.httpError.last && !observations.httpError.verdictVisible,
              'http-error: successful analysis remains claimed after structured 429',
            );
            await shot('http-error');

            // 031 — a 2xx whose body is not the documented envelope. The
            // guard used to read `j.success === false`, so an undefined
            // `success` satisfied neither branch and the analysis stopped in
            // silence with the previous result still on screen. Nothing about
            // that was visible to a user; nothing about it was visible here
            // either, because no test ever sent one.
            B.controlNextAnalyze(page, {
              status: 200,
              body: { note: 'a 200 that is not the documented envelope' },
            });
            const unreadableOutcome = await B.analyze(page);
            observations.unreadable = await surface(page);
            const unreadableAnalysis = await B.measureAnalysis(page);
            check(
              unreadableOutcome === 'failed',
              'unreadable-2xx: a 200 without the documented envelope was treated as a success',
            );
            check(
              unreadableAnalysis.toasts.length > 0,
              'unreadable-2xx: the analysis stopped with no visible explanation',
            );
            check(
              !observations.unreadable.last && !observations.unreadable.verdictVisible,
              'unreadable-2xx: a previous verdict is still claimed after an unreadable response',
            );
            await shot('unreadable-2xx');

            const aborted = fixture(config.id, 'UX network failure');
            await B.setPayload(page, aborted);
            B.controlNextAnalyze(page, { abort: true });
            check(
              (await B.analyze(page)) === 'failed',
              'network: failed request did not produce a failure state',
            );
            observations.network = await surface(page);
            const networkTransport = B.measureTransport(page);
            check(
              networkTransport.requests.length === 1 && networkTransport.responses.length === 0,
              'network: expected exactly one aborted Analyze request',
            );
            const networkAnalysis = await B.measureAnalysis(page);
            check(networkAnalysis.toasts.length > 0, 'network: failure has no visible explanation');
            check(
              !observations.network.last && !observations.network.verdictVisible,
              'network: previous result is still claimed after failure',
            );
            await shot('network-error');

            const rawSeed = fixture(config.id, 'UX raw provenance');
            const prettyRequest = JSON.stringify(rawSeed.request, null, 2);
            const duplicateRequest = prettyRequest.replace(
              /\{/,
              `{\n  "id": ${JSON.stringify(config.id)},`,
            );
            await B.setPayload(page, { ...rawSeed, rawRequest: duplicateRequest });
            check(
              (await B.analyze(page)) === 'success',
              'raw-input: duplicate-key seed did not complete',
            );
            const rawSeedAnalysis = await B.measureAnalysis(page);
            check(
              rawSeedAnalysis.last?.validation?.findings.some(
                (f) => f.id === 'payload.duplicate_key',
              ),
              'raw-input: seed did not expose its duplicate-key finding',
            );
            await B.setPayload(page, rawSeed);
            check(
              (await B.analyze(page)) === 'success',
              'raw-input: clean pasted request did not complete',
            );
            const rawCleanAnalysis = await B.measureAnalysis(page);
            const rawTransport = B.measureTransport(page);
            observations.rawInput = {
              seedDuplicateObserved: rawSeedAnalysis.last?.validation?.findings.some(
                (f) => f.id === 'payload.duplicate_key',
              ),
              cleanDuplicateObserved: rawCleanAnalysis.last?.validation?.findings.some(
                (f) => f.id === 'payload.duplicate_key',
              ),
              submittedRawEqualsCleanPaste:
                rawTransport.requests[0]?.body?.bidReqRaw === prettyRequest,
            };
            check(
              !observations.rawInput.cleanDuplicateObserved &&
                observations.rawInput.submittedRawEqualsCleanPaste,
              'raw-input: clean pasted request retains prior duplicate-key provenance',
            );
            await shot('raw-input');

            for (const [side, target] of [
              ['req', 'bidReq'],
              ['res', 'bidRes'],
            ]) {
              const tab = await page.$(`[data-payload="${side}"]`);
              if (tab && (await tab.isVisible())) await tab.click();
              await page.click(`[data-action="clear-input"][data-target="${target}"]`);
            }
            observations.cleared = await surface(page);
            check(
              !observations.cleared.last &&
                !observations.cleared.verdictVisible &&
                observations.cleared.requestLength === 0 &&
                observations.cleared.responseLength === 0 &&
                observations.cleared.findingCount === 0,
              'clear: content or analysis remains',
            );
            check(
              observations.cleared.buttonText === initial.buttonText,
              'locale: Analyze label changed after processing',
            );
            await shot('clear');
            check(pageErrors.length === 0, `pageerror: ${pageErrors.join(' | ')}`);
            // Exactly one deliberately aborted Analyze is allowed. No analysis,
            // renderer, or random network errors are generally suppressed.
            let abortedConsoleCount = 0;
            let limitedConsoleCount = 0;
            const unexpected = consoleErrors.filter((e) => {
              if (e.url && new URL(e.url).pathname === '/api/analyze') {
                if (
                  e.text === 'Failed to load resource: net::ERR_FAILED' &&
                  abortedConsoleCount++ === 0
                )
                  return false;
                if (
                  e.text ===
                    'Failed to load resource: the server responded with a status of 429 (Too Many Requests)' &&
                  limitedConsoleCount++ === 0
                )
                  return false;
              }
              return true;
            });
            check(
              abortedConsoleCount === 1 && limitedConsoleCount === 1,
              'console: expected one controlled abort and one controlled 429',
            );
            check(unexpected.length === 0, `console: ${unexpected.map((e) => e.text).join(' | ')}`);
            observations.consoleErrors = consoleErrors;
            const assetTransport = B.measureTransport(page);
            observations.fixtureAssetCount = assetTransport.fixtureAssetCount;
            observations.servedAssetCount = assetTransport.servedAssets.length;
            observations.servedAssetIds = assetTransport.servedAssets.map((asset) => asset.id);
          } catch (error) {
            failures.push(`ux.exception: ${error.message || String(error)}`);
            observations.exceptionStack = error.stack;
            await shot('exception');
          } finally {
            await page.close();
          }
          const deviation = gap ? deviationVerdict(failures, gap) : null;
          const acceptedGap = !!deviation?.stillPresent;
          recordResult('ux', c, {
            pass: failures.length === 0,
            failures,
            gap: gap?.id || null,
            reason: gap ? deviation.reason : null,
            measured: {
              version,
              ...config,
              observations,
              screenshots: screenshots.filter(Boolean),
            },
          });
          if (gap)
            assert.ok(acceptedGap, `${config.id}: ${deviation.reason}\n${failures.join('\n')}`);
          else assert.deepEqual(failures, [], `${config.id}\n${failures.join('\n')}`);
        });
      }
    } finally {
      if (browser) await browser.close();
      await server.stop();
    }
  },
);
