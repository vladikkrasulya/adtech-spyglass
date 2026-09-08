/* global document, window, getComputedStyle, MutationObserver */
'use strict';

/**
 * tests/corpus/lib/browser.js — drive the real Inspector in real Chrome for
 * corpus cases and MEASURE what a user would see.
 *
 * Nothing here decides whether a result is right; it only reads the DOM (and
 * the creative frame's DOM) into a plain object the oracle compares with the
 * case's contract expectation. The measured preview state says, separately:
 *   kind          what the preview decided the body is (markup/native/push/vast/json/url/unidentified/empty)
 *   rendered      full | partial | inert-text | empty  — derived from visible content and asset loads
 *   mediaPlays    yes | no | n/a  — observed <video>/<audio> time progression inside the frame
 *   assets        image totals: how many, how many loaded with a non-zero natural size, how many the frame refused
 *   limitationShown  whether the page explained a limitation (refusal ledger, policy notice, inert-text label, empty state)
 * A frame with a blurred rectangle and nothing inside it is `empty`, not
 * `full`, no matter how many elements the DOM holds.
 *
 * Automation hooks used are the ones the frontend contract names as stable:
 * `#bidReq`/`#bidRes`, `window.runAnalysis`, `#verdict[data-verdict]`,
 * `[data-finding-id]`, `[data-action="goto-path"]`, `#creativePreview`,
 * `#creativePreviewSafe[data-has-creative]`, `#creativeBlocked`,
 * `.preview-text-label`, `.preview-empty`, `.creative-inline-assets`,
 * `[data-action="reveal-creative"]`, `#mPrice`, `#mFormatChips`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { nextClientIp } = require('./http-run');

// Harness state belongs to the page lifetime. Never reset product globals to
// make a stale or incomplete analysis look fresh.
const pageState = new WeakMap();
let fixtureAssets;

/** Exact original URLs are intercepted; payloads and the product CSP stay intact. */
function loadFixtureAssets() {
  if (fixtureAssets) return fixtureAssets;
  const root = path.resolve(__dirname, '../assets');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const assets = new Map();
  for (const entry of manifest.assets) {
    const filename = path.resolve(root, entry.path);
    const url = new URL(entry.url);
    if (
      !filename.startsWith(`${root}${path.sep}`) ||
      !url.hostname.endsWith('.test') ||
      !['http:', 'https:'].includes(url.protocol) ||
      assets.has(entry.url)
    )
      throw new Error(`Invalid controlled fixture asset: ${entry.id}`);
    if (entry.stored === false) {
      // Media bodies live in the private archive named by the manifest; the
      // frame policy never fetches them, so the corpus keeps identity only.
      assets.set(entry.url, { ...entry, body: null });
      continue;
    }
    const body = fs.readFileSync(filename);
    if (
      body.length !== entry.byteLength ||
      createHash('sha256').update(body).digest('hex') !== entry.sha256
    )
      throw new Error(`Fixture asset integrity mismatch: ${entry.id}`);
    assets.set(entry.url, { ...entry, body });
  }
  fixtureAssets = assets;
  return assets;
}

let puppeteer = null;
let puppeteerLoadError = '';
try {
  puppeteer = require('puppeteer-core');
} catch (err) {
  puppeteerLoadError = err instanceof Error ? err.message : String(err);
}

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch (_error) {
      return false;
    }
  });
}

const chromeExecutable = findChrome();

/** A string reason when the browser layer cannot run here; false when it can. */
const browserSkipReason = !puppeteer
  ? `puppeteer-core unavailable: ${puppeteerLoadError}`
  : !chromeExecutable
    ? 'No executable Chrome/Chromium found; set CHROME_BIN'
    : false;

async function launchBrowser() {
  if (browserSkipReason) throw new Error(browserSkipReason);
  return puppeteer.launch({
    headless: true,
    protocolTimeout: 180000,
    executablePath: chromeExecutable,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
}

/**
 * Chrome version string for the evidence record (what was actually tested).
 * @param {any} browser
 */
async function browserVersion(browser) {
  return browser.version();
}

/**
 * @param {any} browser
 * @param {string} baseUrl
 * @param {{locale?: 'en'|'uk'|'ru', theme?: 'light'|'dark'|null, viewport?: {width: number, height: number}}} [opts]
 */
async function openInspector(browser, baseUrl, opts = {}) {
  const assets = loadFixtureAssets();
  const page = await browser.newPage();
  const locale = opts.locale || 'en';
  await page.setViewport(opts.viewport || { width: 1440, height: 900 });
  /** @type {string[]} */
  const pageErrors = [];
  /** @type {Array<{text: string, url: string}>} */
  const consoleErrors = [];
  const state = {
    requests: [],
    responses: [],
    blockedNetwork: [],
    requestErrors: [],
    consoleErrors,
    pageErrors,
    nextTransport: null,
    analysisStart: 0,
    previousAt: null,
    fixtureAssetCount: assets.size,
    servedAssets: [],
    unavailableAssets: [],
    assetStart: 0,
    blockedStart: 0,
    requestErrorStart: 0,
  };
  pageState.set(page, state);
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    try {
      const url = request.url();
      if (/^(data:|blob:|about:)/.test(url)) return await request.continue();
      const asset = assets.get(url);
      if (asset && asset.body === null) {
        // Identity-only asset (media body kept outside the repository): answer
        // 404 and record it as unavailable, never as served bytes.
        state.unavailableAssets.push({ id: asset.id, role: asset.role });
        await request.respond({ status: 404, contentType: 'text/plain', body: 'unavailable' });
        return;
      }
      if (asset) {
        // CSP-denied resources never reach this handler. A served body is
        // availability evidence, not proof that the creative displayed it.
        await request.respond({ status: 200, contentType: asset.contentType, body: asset.body });
        state.servedAssets.push({ id: asset.id, role: asset.role, byteLength: asset.byteLength });
        return;
      }
      if (new URL(url).origin !== new URL(baseUrl).origin) {
        state.blockedNetwork.push({ url, type: request.resourceType() });
        return await request.abort('blockedbyclient');
      }
      if (new URL(url).pathname === '/api/analyze' && request.method() === 'POST') {
        state.requests.push({ url, body: JSON.parse(request.postData() || '{}') });
        const control = state.nextTransport;
        state.nextTransport = null;
        if (control) {
          control.started();
          if (control.abort) return await request.abort('failed');
          if (control.status)
            return await request.respond({
              status: control.status,
              contentType: 'application/json',
              body: JSON.stringify(control.body),
            });
          await control.released;
        }
        return await request.continue({
          headers: { ...request.headers(), 'x-forwarded-for': nextClientIp() },
        });
      }
      if (new URL(url).pathname === '/api/analyze-behavior' && request.method() === 'POST') {
        return await request.continue({
          headers: { ...request.headers(), 'x-forwarded-for': nextClientIp() },
        });
      }
      return await request.continue();
    } catch (error) {
      state.requestErrors.push(String(error));
    }
  });
  page.on('response', async (response) => {
    if (new URL(response.url()).pathname !== '/api/analyze') return;
    try {
      state.responses.push({
        status: response.status(),
        body: await response.json(),
        url: response.url(),
      });
    } catch (error) {
      state.requestErrors.push(`analyze response: ${String(error)}`);
    }
  });
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error')
      consoleErrors.push({ text: msg.text(), url: msg.location().url || '' });
  });
  await page.evaluateOnNewDocument((theme) => {
    try {
      if (theme) window.localStorage.setItem('kt-theme', theme);
      else window.localStorage.removeItem('kt-theme');
      window.localStorage.removeItem('ortbtools_version_pin');
    } catch (_e) {
      /* storage may be unavailable in some contexts */
    }
    /** @type {any} */ (window).__corpusToasts = [];
    const attach = () => {
      const host = document.getElementById('toastContainer') || document.body;
      if (!host) return;
      const obs = new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            const el = /** @type {any} */ (n);
            if (el && el.nodeType === 1 && /toast/.test(el.className || '')) {
              /** @type {any} */ (window).__corpusToasts.push({
                text: el.textContent || '',
                cls: el.className,
              });
            }
          }
        }
      });
      obs.observe(host, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
    else attach();
  }, opts.theme || null);
  const prefix = locale === 'en' ? '' : `/${locale}`;
  await page.goto(`${baseUrl}${prefix}/inspector`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('#bidReq', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const button = /** @type {HTMLButtonElement|null} */ (document.getElementById('analyzeBtn'));
      return (
        typeof (/** @type {any} */ (window).runAnalysis) === 'function' &&
        button &&
        !button.disabled
      );
    },
    { timeout: 15000 },
  );
  return { page, pageErrors, consoleErrors, locale };
}

/**
 * Put a case's payloads into the editors. Raw text is written verbatim so an
 * unparseable paste reaches the same client-side parse path a user hits.
 *
 * @param {any} page
 * @param {import('./load').Materialized} c
 */
async function setPayload(page, c) {
  // Dispatch only real changes: change-dialect and change-version-pin may
  // intentionally analyze the existing input. Sending redundant changes here
  // would introduce extra requests and race the user's explicit Analyze.
  for (const [selector, value] of [
    ['#dialectSelector', c.meta?.dialect || 'iab'],
    ['#versionPinSelector', ''],
  ]) {
    if ((await page.$eval(selector, (el) => el.value)) !== value) {
      await page.evaluate(() => {
        for (const id of ['bidReq', 'bidRes']) {
          const el = /** @type {HTMLTextAreaElement} */ (document.getElementById(id));
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await page.select(selector, value);
    }
  }
  const reqText =
    c.rawRequest !== undefined
      ? c.rawRequest
      : c.request === undefined
        ? ''
        : typeof c.request === 'string'
          ? c.request
          : JSON.stringify(c.request, null, 2);
  const resText =
    c.rawResponse !== undefined
      ? c.rawResponse
      : c.response === undefined
        ? ''
        : JSON.stringify(c.response, null, 2);
  await page.evaluate(
    (req, res) => {
      const reqEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq'));
      const resEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('bidRes'));
      reqEl.value = req;
      reqEl.dispatchEvent(new Event('input', { bubbles: true }));
      resEl.value = res;
      resEl.dispatchEvent(new Event('input', { bubbles: true }));
    },
    reqText,
    resText,
  );
}

/**
 * Trigger Analyze and wait until the page settles into success or a visible
 * failure state. Returns which state ended the wait.
 *
 * @param {any} page
 * @param {{timeout?: number, via?: 'button'|'keyboard'}} [opts]
 * @returns {Promise<'success'|'failed'|'timeout'>}
 */
async function analyze(page, opts = {}) {
  const timeout = opts.timeout || 20000;
  const state = pageState.get(page);
  state.analysisStart = state.requests.length;
  state.responseStart = state.responses.length;
  state.assetStart = state.servedAssets.length;
  state.blockedStart = state.blockedNetwork.length;
  state.requestErrorStart = state.requestErrors.length;
  state.previousAt = await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    return w.__ortbtoolsLast?.at || null;
  });
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__corpusToasts = [];
  });
  const via = opts.via || 'button';
  if (via === 'button') await clickControl(page, await page.$('#analyzeBtn'));
  else if (via === 'keyboard') {
    await page.focus('#bidReq');
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');
  }
  try {
    await page.waitForFunction(
      (previousAt) => {
        const w = /** @type {any} */ (window);
        const btn = /** @type {HTMLButtonElement|null} */ (document.getElementById('analyzeBtn'));
        if (!btn || btn.disabled) return false;
        if (w.__ortbtoolsLast && w.__ortbtoolsLast.at !== previousAt) return 'success';
        const toasts = w.__corpusToasts || [];
        if (toasts.some((t) => /error/.test(t.cls))) return 'failed';
        const dot = document.getElementById('statusDot');
        if (toasts.length && dot && /\berror\b/.test(dot.className)) return 'failed';
        return false;
      },
      { timeout, polling: 50 },
      state.previousAt,
    );
  } catch (_e) {
    return 'timeout';
  }
  const outcome = await page.evaluate(
    (previousAt) =>
      /** @type {any} */ (window).__ortbtoolsLast?.at &&
      /** @type {any} */ (window).__ortbtoolsLast.at !== previousAt
        ? 'success'
        : 'failed',
    state.previousAt,
  );
  return outcome;
}

/** Hold or abort exactly one real Analyze request, only for an explicit UX scenario. */
function controlNextAnalyze(page, { abort = false, status = 0, body = null } = {}) {
  /** @type {(value?: unknown) => void} */
  let started = () => {};
  /** @type {(value?: unknown) => void} */
  let release = () => {};
  const requested = new Promise((resolve) => {
    started = resolve;
  });
  const released = new Promise((resolve) => {
    release = resolve;
  });
  pageState.get(page).nextTransport = { abort, status, body, started, released };
  return { requested, release: () => release() };
}

/** Read transport evidence without retaining it in product state or reports. */
function measureTransport(page) {
  const s = pageState.get(page);
  return {
    requests: s.requests.slice(s.analysisStart),
    responses: s.responses.slice(s.responseStart),
    blockedNetwork: s.blockedNetwork.slice(s.blockedStart),
    requestErrors: s.requestErrors.slice(s.requestErrorStart),
    fixtureAssetCount: s.fixtureAssetCount,
    servedAssets: s.servedAssets.slice(s.assetStart),
  };
}

/**
 * Read the analysis surface: verdict, chips, badges, findings, crosscheck rows.
 * @param {any} page
 */
async function measureAnalysis(page) {
  return page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    const text = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
    const verdict = $('verdict');
    const chip = $('validityChip');
    const badges = {};
    for (const id of [
      'validationBadge',
      'crossBadge',
      'inspectorBadge',
      'categoriesBadge',
      'behaviorBadge',
      'macrosBadge',
    ]) {
      const b = $(id);
      badges[id] = b
        ? { hidden: b.hidden, text: text(b), severity: b.dataset.severity || '' }
        : null;
    }
    const findings = Array.from(document.querySelectorAll('[data-finding-id]')).map((el) => {
      const d = /** @type {HTMLElement} */ (el).dataset;
      return {
        id: d.findingId || '',
        path: d.findingPath || '',
        level: d.findingLevel || '',
        side: d.findingSide || '',
        hasSpec: !!(d.findingSpec && d.findingSpec !== 'null' && d.findingSpec !== ''),
        open: /** @type {any} */ (el).open === true,
        title: text(el.querySelector('.finding-title')),
        line: text(el.querySelector('.finding-line')),
      };
    });
    const crossRows = Array.from(document.querySelectorAll('#tCross .cross-item')).map((el) => ({
      cls: el.className,
      text: text(el),
      path: text(el.querySelector('.cross-path')),
      visible:
        getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().height > 0,
    }));
    const w = /** @type {any} */ (window);
    const last = w.__ortbtoolsLast || null;
    return {
      verdict: verdict
        ? {
            hidden: verdict.hidden,
            verdict: verdict.dataset.verdict || '',
            status: verdict.dataset.status || '',
            headline: text($('verdictHeadline')),
            detail: text($('verdictDetail')),
          }
        : null,
      validityChip: chip
        ? { hidden: chip.hidden, state: chip.dataset.state || '', text: text(chip) }
        : null,
      badges,
      findings,
      crossRows,
      crossPanelText: text($('tCross')).slice(0, 300),
      validationPanelText: text($('tValidation')).slice(0, 300),
      slotCards: document.querySelectorAll('#slotGrid .slot-card').length,
      slotGridText: text($('slotGrid')).slice(0, 200),
      formatChips: text($('mFormatChips')),
      formatText: text($('mFormat')),
      priceChip: text($('mPrice')),
      statusEntity: text($('stEntity')),
      statusText: text($('statusText')),
      statusDotClass: $('statusDot') ? $('statusDot').className : '',
      toasts: (w.__corpusToasts || []).map((t) => t.text),
      last: last
        ? {
            type: last.validation && last.validation.type,
            status: last.validation && last.validation.status,
            version: last.validation && last.validation.version && last.validation.version.version,
            findingIds: ((last.validation && last.validation.findings) || []).map((f) => f.id),
            crosscheckIds: (last.crosscheck || []).map((f) => f.id),
            format: last.meta && last.meta.format,
            validation: last.validation,
            crosscheck: last.crosscheck || [],
            request: last.req,
            response: last.res,
          }
        : null,
    };
  });
}

/** Wait until the user can actually hit the control (transient toasts can cover it). */
async function clickControl(page, element) {
  await element.evaluate((el) =>
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' }),
  );
  // Mobile content-visibility/layout can move a hittable control by an entire
  // button height between two protocol calls. Require a settled, unobscured
  // target and take its coordinates from that same measurement. This remains
  // one physical click: a delivered click that does not act still fails.
  const stability = await page.evaluateHandle(() => ({ box: null, since: 0 }));
  let pointHandle;
  try {
    pointHandle = await page.waitForFunction(
      (el, state) => {
        const rect = el.getBoundingClientRect();
        const box = [rect.left, rect.top, rect.width, rect.height];
        const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
        const hit = document.elementFromPoint(x, y);
        const hittable =
          rect.width > 0 && rect.height > 0 && hit && (hit === el || el.contains(hit));
        const now = performance.now();
        if (
          !hittable ||
          !state.box ||
          box.some((value, index) => Math.abs(value - state.box[index]) > 0.5)
        ) {
          state.box = box;
          state.since = now;
          return false;
        }
        return now - state.since >= 100 ? { x, y } : false;
      },
      { timeout: 8000, polling: 'raf' },
      element,
      stability,
    );
    const point = await pointHandle.jsonValue();
    // ElementHandle.click would scroll again after the stability check.
    await page.mouse.click(point.x, point.y);
  } finally {
    await pointHandle?.dispose();
    await stability.dispose();
  }
}

/**
 * Activate a results tab with the native keyboard action, opening the
 * More menu first when the tab lives inside it. Returns whether the target
 * panel became visible.
 *
 * @param {any} page
 * @param {string} targetId e.g. 'tCreative', 'tValidation', 'tCross'
 */
async function openTab(page, targetId) {
  const selector = `.tab-btn[data-target="${targetId}"]`;
  const button = await page.$(selector);
  if (!button) return { found: false, visible: false };
  const more = await button.evaluate((el) => !!el.closest('details.tab-more'));
  if (more && !(await button.evaluate((el) => el.closest('details').open))) {
    await page.click('details.tab-more > summary');
  }
  // Tabs also promise native keyboard activation. Focusing then pressing Enter
  // avoids clicking a moving horizontal tab strip as mobile layout settles.
  await button.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (id) => {
      const button = document.querySelector(`.tab-btn[data-target="${id}"]`);
      const panel = document.getElementById(id);
      return (
        button?.classList.contains('active') && panel && getComputedStyle(panel).display !== 'none'
      );
    },
    { timeout: 5000 },
    targetId,
  );
  return page.evaluate((id) => {
    const btn = /** @type {HTMLElement|null} */ (
      document.querySelector(`.tab-btn[data-target="${id}"]`)
    );
    if (!btn) return { found: false, visible: false };
    const more = btn.closest('details.tab-more');
    const panel = document.getElementById(id);
    const cs = panel ? getComputedStyle(panel) : null;
    const r = panel ? panel.getBoundingClientRect() : null;
    return {
      found: true,
      inMore: !!more,
      active: btn.classList.contains('active'),
      visible: !!(cs && cs.display !== 'none' && r && r.height > 0),
    };
  }, targetId);
}

/**
 * Read the preview column, including the creative frame's own document. The
 * Creative tab is opened first (unless `ensureTab` is false) because a frame in
 * a hidden panel has no layout and could not be seen by anyone.
 * @param {any} page
 * @param {{ensureTab?: boolean}} [opts]
 */
async function measurePreview(page, opts = {}) {
  const tab = opts.ensureTab === false ? null : await openTab(page, 'tCreative');
  if (tab) await new Promise((r) => setTimeout(r, 150));
  const outer = await page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    const text = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const obscured = (el) => {
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number(style.opacity) === 0 ||
          [...style.filter.matchAll(/blur\(([^)]+)\)/g)].some((m) => parseFloat(m[1]) > 0)
        )
          return true;
      }
      return false;
    };
    const preview = $('creativePreview');
    const safe = $('creativePreviewSafe');
    const iframe = preview ? preview.querySelector('iframe') : null;
    const textLabel = preview ? preview.querySelector('.preview-text-label') : null;
    const textBody = preview ? preview.querySelector('.preview-text-body') : null;
    const empty = preview ? preview.querySelector('.preview-empty') : null;
    const blocked = $('creativeBlocked');
    const cspNotice = document.querySelector('.preview-csp-notice');
    const notes = $('creativeNotes');
    const inline = document.querySelector('.creative-inline-assets');
    const overlayBtn = document.querySelector('[data-action="reveal-creative"]');
    const srcdoc = iframe ? String(/** @type {any} */ (iframe).srcdoc || '') : '';
    const label = text(textLabel);
    let kind = 'n/a';
    if (empty) kind = 'empty';
    else if (iframe) {
      if (srcdoc.includes('native · synthetic render')) kind = 'native';
      else if (srcdoc.includes('push · synthetic render')) kind = 'push';
      else kind = 'markup';
    } else if (textLabel) {
      const l = label.toLowerCase();
      if (l.startsWith('vast')) kind = 'vast';
      else if (/json/.test(l)) kind = 'json';
      else if (/link|url|посилання|ссылк/.test(l)) kind = 'url';
      else kind = 'unidentified';
    }
    const blockedText = text(blocked);
    const refusedMatch = /(\d+)\s+resource/.exec(blockedText) || /(\d+)/.exec(blockedText);
    return {
      kind,
      hasIframe: !!iframe,
      sandbox: iframe ? iframe.getAttribute('sandbox') : null,
      iframeVisible: visible(iframe),
      iframeObscured: !!iframe && obscured(iframe),
      iframeBox: iframe ? iframe.getBoundingClientRect().toJSON() : null,
      srcdocLength: srcdoc.length,
      srcdocHasProbe: /PROBE_CHANNEL = '[0-9a-f]{48}'/.test(srcdoc),
      label,
      inertTextLength: textBody ? (textBody.textContent || '').length : 0,
      inertText: textBody ? textBody.textContent || '' : '',
      textVisible: visible(textBody) && !obscured(textBody),
      trimmedNote: text(preview ? preview.querySelector('.preview-text-trimmed') : null),
      emptyText: text(empty),
      hasCreative: safe ? safe.dataset.hasCreative || '' : '',
      revealable: safe ? safe.dataset.revealable || '' : '',
      revealed: safe ? safe.classList.contains('is-revealed') : false,
      overlayVisible: visible(overlayBtn),
      bidW: safe ? safe.style.getPropertyValue('--bid-w') : '',
      bidH: safe ? safe.style.getPropertyValue('--bid-h') : '',
      blockedText,
      refusedCount: blocked ? Number(refusedMatch ? refusedMatch[1] : 0) : 0,
      cspNoticeVisible: visible(cspNotice),
      notesText: text(notes),
      inlineOffer: inline ? text(inline) : null,
      priceChip: text($('mPrice')),
      formatChips: text($('mFormatChips')),
    };
  });

  /** @type {any} */
  let inner = null;
  if (outer.hasIframe) {
    const handle = await page.$('#creativePreview iframe');
    const frame = handle ? await handle.contentFrame() : null;
    if (frame) {
      try {
        await frame.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 });
      } catch (_e) {
        /* measure whatever state the frame reached */
      }
      // data: images decode asynchronously; give them a bounded moment.
      try {
        await frame.waitForFunction(
          () => Array.from(document.images).every((img) => img.complete),
          { timeout: 2000 },
        );
      } catch (_error) {
        /* pending assets are measured as pending, never loaded */
      }
      const mediaBefore = await frame.evaluate(() =>
        Array.from(document.querySelectorAll('video,audio')).map(
          (m) => /** @type {any} */ (m).currentTime,
        ),
      );
      if (mediaBefore.length) await new Promise((r) => setTimeout(r, 300));
      inner = await frame.evaluate((times) => {
        const imgs = Array.from(document.images);
        const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0 && i.naturalHeight > 0);
        const visibleLoaded = loaded.filter((img) => {
          const rect = img.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          for (let node = /** @type {Element|null} */ (img); node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              Number(style.opacity) === 0
            )
              return false;
          }
          return true;
        });
        const failed = imgs.filter((i) => i.complete && i.naturalWidth === 0);
        const media = Array.from(document.querySelectorAll('video, audio'));
        const bodyText = (document.body ? document.body.innerText || '' : '')
          .replace(/\s+/g, ' ')
          .trim();
        const rect = document.body ? document.body.getBoundingClientRect() : null;
        const anyVisibleBox = Array.from(
          document.body ? document.body.querySelectorAll('*') : [],
        ).some((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        return {
          imgTotal: imgs.length,
          imgLoaded: loaded.length,
          imgVisibleLoaded: visibleLoaded.length,
          imgFailed: failed.length,
          imgSources: imgs.map((i) => (i.getAttribute('src') || '').slice(0, 60)),
          imgLoadedSources: loaded.map((i) => i.getAttribute('src') || ''),
          mediaTotal: media.length,
          mediaReady: media.filter((m) => /** @type {any} */ (m).readyState >= 2).length,
          mediaProgressed: media.filter(
            (m, i) =>
              /** @type {any} */ (m).currentTime > times[i] + 0.01 &&
              !(/** @type {any} */ (m).paused),
          ).length,
          mediaTimes: media.map((m, i) => ({
            before: times[i],
            after: /** @type {any} */ (m).currentTime,
            paused: /** @type {any} */ (m).paused,
          })),
          mediaErrors: media.filter((m) => !!(/** @type {any} */ (m).error)).length,
          bodyTextLength: bodyText.length,
          bodyTextSample: bodyText.slice(0, 120),
          bodyText,
          imageAlt: visibleLoaded.map((img) => img.alt),
          bodyHeight: rect ? rect.height : 0,
          anyVisibleBox,
          links: document.querySelectorAll('a[href]').length,
          scripts: document.scripts.length,
        };
      }, mediaBefore);
    }
  }

  let rendered = 'n/a';
  if (outer.kind === 'empty') rendered = 'empty';
  else if (['vast', 'json', 'url', 'unidentified'].includes(outer.kind))
    rendered = outer.textVisible ? 'inert-text' : 'empty';
  else if (outer.hasIframe) {
    const i = inner || {
      imgTotal: 0,
      imgLoaded: 0,
      imgVisibleLoaded: 0,
      imgFailed: 0,
      bodyTextLength: 0,
      anyVisibleBox: false,
    };
    const refused = outer.refusedCount > 0 || i.imgFailed > 0;
    const somethingVisible =
      outer.iframeVisible &&
      !outer.iframeObscured &&
      !outer.overlayVisible &&
      (i.bodyTextLength > 0 || i.imgVisibleLoaded > 0);
    if (!somethingVisible) rendered = 'empty';
    else if (refused || (i.imgTotal > 0 && i.imgLoaded < i.imgTotal)) rendered = 'partial';
    else rendered = 'full';
  }
  let mediaPlays = outer.kind === 'vast' ? 'no' : 'n/a';
  if (inner && inner.mediaTotal > 0) mediaPlays = inner.mediaProgressed > 0 ? 'yes' : 'no';

  const limitationShown =
    outer.kind === 'empty' ||
    ['vast', 'json', 'url', 'unidentified'].includes(outer.kind) ||
    outer.refusedCount > 0 ||
    outer.cspNoticeVisible;

  return {
    kind: outer.kind,
    rendered,
    mediaPlays,
    limitationShown,
    // Identity is proven by what is on screen: visible text, image alt text, or
    // the exact src of an image that actually decoded (non-zero natural size).
    markerText:
      inner && outer.iframeVisible && !outer.iframeObscured && !outer.overlayVisible
        ? inner.bodyText +
          '\n' +
          inner.imageAlt.join('\n') +
          '\n' +
          (inner.imgLoadedSources || []).join('\n')
        : outer.textVisible
          ? outer.inertText
          : '',
    tab,
    assets: {
      imgTotal: inner ? inner.imgTotal : 0,
      imgLoaded: inner ? inner.imgLoaded : 0,
      imgFailed: inner ? inner.imgFailed : 0,
      refused: outer.refusedCount,
      mediaTotal: inner ? inner.mediaTotal : 0,
      textVisible: inner
        ? outer.iframeVisible &&
          !outer.iframeObscured &&
          !outer.overlayVisible &&
          inner.bodyTextLength > 0
        : outer.textVisible && outer.inertTextLength > 0,
    },
    outer,
    inner,
  };
}

/**
 * Click the reveal overlay if it is offered; report whether the blur lifted.
 * @param {any} page
 */
async function reveal(page) {
  const offered = await page.$('[data-action="reveal-creative"]');
  if (!offered) return { offered: false, revealed: false, filter: '' };
  // Mobile content below the viewport may not acquire layout until scrolled
  // into view. Force only the same scrolling a user performs, then measure.
  await offered.evaluate((el) =>
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' }),
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve(undefined))),
      ),
  );
  if (!(await offered.isVisible())) return { offered: false, revealed: false, filter: '' };
  await clickControl(page, offered);
  try {
    await page.waitForFunction(
      () => {
        const safe = document.getElementById('creativePreviewSafe');
        const frame = document.querySelector('#creativePreview iframe');
        return (
          safe?.classList.contains('is-revealed') &&
          (!frame || getComputedStyle(frame).filter === 'none')
        );
      },
      { timeout: 3000, polling: 50 },
    );
  } catch (_error) {
    // Keep the observed unrevealed/blurred state so the oracle reports it.
  }
  return page.evaluate(() => {
    const safe = document.getElementById('creativePreviewSafe');
    const frame = document.querySelector('#creativePreview iframe');
    return {
      offered: true,
      revealed:
        !!safe &&
        safe.classList.contains('is-revealed') &&
        (!frame || getComputedStyle(frame).filter === 'none'),
      filter: frame ? getComputedStyle(frame).filter : '',
    };
  });
}

/**
 * Click the "go to field" chip of a finding and report the editor selection.
 * @param {any} page
 * @param {string} findingId
 * @param {string} [findingPath]
 */
async function gotoFinding(page, findingId, findingPath) {
  await openTab(page, 'tValidation');
  const index = await page.evaluate(
    (id, p) =>
      Array.from(document.querySelectorAll('[data-finding-id]')).findIndex((el) => {
        const data = /** @type {HTMLElement} */ (el).dataset;
        return data.findingId === id && (p === undefined || data.findingPath === p);
      }),
    findingId,
    findingPath,
  );
  if (index < 0) return { found: false };
  const rows = await page.$$('[data-finding-id]');
  const row = rows[index];
  const summary = await row.$('summary');
  if (summary && !(await row.evaluate((el) => el.open))) await clickControl(page, summary);
  const button = await row.$('[data-action="goto-path"]');
  if (!button) return { found: true, button: false };
  await clickControl(page, button);
  return page.evaluate(
    (id, p) => {
      const rows = Array.from(document.querySelectorAll('[data-finding-id]'));
      const row = /** @type {HTMLElement|undefined} */ (
        rows.find(
          (el) =>
            /** @type {HTMLElement} */ (el).dataset.findingId === id &&
            (p === undefined || /** @type {HTMLElement} */ (el).dataset.findingPath === p),
        )
      );
      if (!row) return { found: false };
      const btn = /** @type {HTMLElement|null} */ (row.querySelector('[data-action="goto-path"]'));
      if (!btn) return { found: true, button: false };
      const side = row.dataset.findingSide === 'response' ? 'bidRes' : 'bidReq';
      const ta = /** @type {HTMLTextAreaElement} */ (document.getElementById(side));
      const before = { start: ta.selectionStart, end: ta.selectionEnd, scrollTop: ta.scrollTop };
      const after = { start: ta.selectionStart, end: ta.selectionEnd, scrollTop: ta.scrollTop };
      const mark = document.querySelector('.src-hl-overlay mark.src-hl');
      return {
        found: true,
        button: true,
        side,
        before,
        after,
        selectedText: ta.value.slice(after.start, after.end).slice(0, 80),
        focused: document.activeElement === ta,
        marked: !!mark,
        moved:
          after.start !== before.start ||
          after.end !== before.end ||
          after.scrollTop !== before.scrollTop,
      };
    },
    findingId,
    findingPath,
  );
}

/**
 * Save a screenshot when an evidence directory is configured; otherwise no-op.
 * @param {any} page
 * @param {string} name file stem (no extension)
 * @param {{selector?: string, fullPage?: boolean}} [opts]
 * @returns {Promise<string|null>} the file written
 */
async function screenshot(page, name, opts = {}) {
  const dir =
    process.env.CORPUS_EVIDENCE_DIR ||
    (process.env.CORPUS_REPORT_DIR
      ? path.join(process.env.CORPUS_REPORT_DIR, 'screenshots')
      : null);
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name.replace(/[^a-z0-9._-]+/gi, '_')}.png`);
  if (opts.selector) {
    const el = await page.$(opts.selector);
    if (el) {
      await el.screenshot({ path: file });
      return file;
    }
  }
  await page.screenshot({ path: file, fullPage: !!opts.fullPage });
  return file;
}

/**
 * Console/page-error messages Chrome raises when the sealed creative frame
 * refuses a navigation or a popup. A case may declare which refusal kinds it
 * expects (`expect.browser.sandboxRefusals`); only these exact shapes are then
 * recorded as refusals instead of failures. Nothing else is ever tolerated.
 * @type {Record<string, RegExp[]>}
 */
const SANDBOX_REFUSALS = {
  popup: [
    /^Blocked opening '[^']+' in a new window because the request was made in a sandboxed frame whose 'allow-popups' permission is not set\.$/,
  ],
  navigation: [
    /^SecurityError: Failed to set a named property 'href' on 'Location': The current window does not have permission to navigate the target frame to '[^']+'\.$/,
    /^SecurityError: Failed to execute '(?:replace|assign)' on 'Location': The current window does not have permission to navigate the target frame to '[^']+'\.$/,
    /^Unsafe attempt to initiate navigation for frame with URL '[^']+' from frame with URL 'about:srcdoc'\. The frame attempting navigation of the top-level window is sandboxed, but the flag of '[^']+'(?: or '[^']+')? is not set\.$/,
  ],
};

/**
 * @param {string} text a console error or page error message
 * @param {string[]} kinds declared refusal kinds (keys of SANDBOX_REFUSALS)
 * @returns {string|null} the matching kind, or null when the message is not a declared sandbox refusal
 */
function classifySandboxRefusal(text, kinds) {
  for (const kind of kinds || []) {
    for (const re of SANDBOX_REFUSALS[kind] || []) {
      if (re.test(String(text).trim())) return kind;
    }
  }
  return null;
}

module.exports = {
  SANDBOX_REFUSALS,
  classifySandboxRefusal,
  browserSkipReason,
  chromeExecutable,
  launchBrowser,
  browserVersion,
  openInspector,
  setPayload,
  analyze,
  measureAnalysis,
  measureTransport,
  controlNextAnalyze,
  measurePreview,
  openTab,
  reveal,
  gotoFinding,
  screenshot,
};
