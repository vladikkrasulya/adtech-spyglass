/* global document, window, getComputedStyle */
'use strict';

// puppeteer-core: serial real-browser checks. The 12 locale/theme/viewport
// journeys remain in corpus-ux-browser.test.js; these 19 scenarios cover
// additional accessibility, responsive layout and state assertions.
// Observations describe unasserted boundaries. Contract deviations are failures
// unless a reviewed, exact known-gap signature is still reproduced in full.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./corpus/lib/http-run');
const { A11Y_SCENARIOS, validateA11yReport } = require('./corpus/lib/a11y-contract');
const { gapFor, deviationVerdict } = require('./corpus/lib/report');
const { loadKnownGaps } = require('./corpus/lib/load');
const B = require('./corpus/lib/browser');

const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
// A complete device keeps the fixture free of the device guidance findings (warnings since 021),
// so the scenarios measure accessibility rather than validator output.
const DEVICE = { ip: '203.0.113.1', ua: 'Mozilla/5.0 (compatible; ortbtools-a11y-audit)' };

// Populate only after reproducing and reviewing the exact browser evidence.
// No exception is inferred from an observed failure during execution.
/** @type {Record<string, {id:string, matches:string[], note?:string}>} */
const KNOWN_GAPS = Object.freeze({
  'names-desktop': {
    id: 'DEF-260',
    note: 'The creative iframe is present but has no accessible name.',
    matches: ['^a11y: creative frame or its accessible title is missing$'],
  },
  'state-partial': {
    id: 'DEF-201',
    note: 'The second returned bid cannot be selected for inspection.',
    matches: ['^partial: second bid is unavailable for inspection$'],
  },
});
/** @type {{schemaVersion:number, scenarios:any[], findings:any[], meta:Record<string,any>}} */
const evidence = { schemaVersion: 1, scenarios: [], findings: [], meta: {} };
/** @type {any} */
let active = null;
const openedPages = new WeakMap();

/** @param {any} entry */
function record(entry) {
  if (!active) {
    evidence.meta[entry.area] = entry.actual;
    return;
  }
  evidence.findings.push({
    scenarioId: active.id,
    kind: 'observation',
    screenshot: null,
    severity: 'info',
    ...entry,
  });
}

function checkOk(condition, message) {
  if (condition) return true;
  const failure = String(message || 'assertion failed');
  active.failures.push(failure);
  record({
    kind: 'deviation',
    area: 'assertion',
    severity: 'medium',
    repro: active.id,
    expected: 'The stated contract assertion holds',
    actual: failure,
  });
  return false;
}
function checkEqual(actual, expected, message) {
  return checkOk(
    actual === expected,
    message || `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}
function checkDeepEqual(actual, expected, message) {
  return checkOk(isDeepStrictEqual(actual, expected), message || 'values differ');
}

function writeFindings() {
  const dir = process.env.CORPUS_REPORT_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'ux-a11y-findings.json'),
    JSON.stringify({ ...evidence, generatedAt: new Date().toISOString() }, null, 2) + '\n',
  );
}

/** @param {any} page @param {string} name */
async function shot(page, name) {
  const file = await B.screenshot(page, `a11y-${name}`, { fullPage: true });
  if (file && active && !active.screenshots.includes(file)) active.screenshots.push(file);
  return file;
}

async function openInspector(browser, url, options = {}) {
  const opened = await B.openInspector(browser, url, options);
  openedPages.set(opened.page, {
    ...opened,
    errorStart: opened.pageErrors.length,
    consoleStart: opened.consoleErrors.length,
  });
  return opened;
}

async function closePage(page) {
  try {
    const opened = openedPages.get(page);
    if (opened) {
      for (const error of opened.pageErrors.slice(opened.errorStart))
        checkOk(false, `pageerror: ${error}`);
      for (const error of opened.consoleErrors.slice(opened.consoleStart)) {
        let controlledFx = false;
        try {
          controlledFx =
            new URL(error.url).pathname === '/api/v1/fx-rates' &&
            error.text ===
              'Failed to load resource: the server responded with a status of 503 (Service Unavailable)';
        } catch {
          /* An absent source URL is not an exception allowance. */
        }
        if (controlledFx)
          record({
            area: 'harness.fx',
            repro: 'FX_DISABLED=1',
            expected: 'Live FX dependency disabled',
            actual: error.text,
          });
        else checkOk(false, `console: ${error.text}`);
      }
    }
    if (!page.isClosed()) await shot(page, `${active.id}-final`);
  } finally {
    await page.close();
  }
}

async function scenario(t, id, run) {
  assert.ok(A11Y_SCENARIOS.includes(id), `unknown a11y scenario ${id}`);
  assert.ok(!evidence.scenarios.some((row) => row.id === id), `duplicate a11y scenario ${id}`);
  await t.test(id, { timeout: 90000 }, async (st) => {
    const row = { id, status: 'fail', failures: [], screenshots: [], measured: {} };
    active = row;
    evidence.scenarios.push(row);
    let finished = false;
    st.signal.addEventListener(
      'abort',
      () => {
        if (finished) return;
        row.failures.push('scenario timeout or cancellation');
        row.status = 'fail';
        writeFindings();
      },
      { once: true },
    );
    try {
      await run();
    } catch (error) {
      checkOk(false, `execution: ${error.message || String(error)}`);
    } finally {
      const pinned = KNOWN_GAPS[id];
      row.status = row.failures.length ? 'fail' : 'pass';
      if (pinned) {
        try {
          const ledger = loadKnownGaps();
          assert.ok(
            ledger[pinned.id]?.cases?.includes(id),
            `${id}: gap ${pinned.id} is absent from the ledger or lacks case membership`,
          );
          const gap = gapFor(
            {
              meta: {
                knownGap: {
                  id: pinned.id,
                  note: pinned.note || '',
                  layers: ['a11y'],
                  matches: { a11y: pinned.matches },
                },
              },
            },
            'a11y',
          );
          const verdict = deviationVerdict(row.failures, gap);
          if (verdict.stillPresent) {
            row.status = 'known-gap';
            row['gap'] = { id: gap.id, matches: gap.matches };
          } else {
            checkOk(false, `gap guard ${pinned.id}: ${verdict.reason}`);
            row.status = 'fail';
          }
        } catch (error) {
          checkOk(false, `gap guard: ${error.message || String(error)}`);
          row.status = 'fail';
        }
      }
      finished = true;
      writeFindings();
      active = null;
    }
    assert.ok(['pass', 'known-gap'].includes(row.status), `${id}:\n${row.failures.join('\n')}`);
  });
}

/** DOM visibility and actual on-screen reachability after scrolling. */
async function visibleElement(page, selector) {
  return page.evaluate((query) => {
    const el = document.querySelector(query);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    for (let node = el; node; node = node.parentElement) {
      const css = getComputedStyle(node);
      if (
        node.hidden ||
        css.display === 'none' ||
        css.visibility !== 'visible' ||
        Number(css.opacity) === 0
      )
        return false;
    }
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    const x = Math.max(0, Math.min(window.innerWidth - 1, r.left + r.width / 2));
    const y = Math.max(0, Math.min(window.innerHeight - 1, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && (el === hit || el.contains(hit));
  }, selector);
}

/** Use Chrome's computed accessible names, including native labels and aria-hidden handling. */
async function scanAccessibleNames(page) {
  const client = await page.createCDPSession();
  try {
    const { root } = await client.send('DOM.getDocument');
    const { nodeId } = await client.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '.workbench',
    });
    assert.ok(nodeId, 'a11y: .workbench is missing');
    const selector =
      'button,[role="button"],a[href],summary,input:not([type="hidden"]),textarea,select,[role="combobox"]';
    const { nodeIds } = await client.send('DOM.querySelectorAll', { nodeId, selector });
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const axByNode = new Map(
      nodes.filter((node) => node.backendDOMNodeId).map((node) => [node.backendDOMNodeId, node]),
    );
    const offenders = [];
    const controls = [];
    for (const id of nodeIds) {
      const { node } = await client.send('DOM.describeNode', { nodeId: id });
      const { object } = await client.send('DOM.resolveNode', { nodeId: id });
      if (!object.objectId) continue;
      const { result } = await client.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        returnByValue: true,
        functionDeclaration: `function () {
          const r = this.getBoundingClientRect();
          for (let node=this; node; node=node.parentElement) {
            const css=getComputedStyle(node);
            if (node.hidden || css.display==='none' || css.visibility!=='visible' || Number(css.opacity)===0) return null;
          }
          return r.width>0 && r.height>0 ? {id:this.id,tag:this.tagName.toLowerCase(),role:this.getAttribute('role')} : null;
        }`,
      });
      await client.send('Runtime.releaseObject', { objectId: object.objectId });
      if (!result.value) continue;
      const ax = axByNode.get(node.backendNodeId);
      const control = { ...result.value, name: ax?.name?.value || '', ignored: !ax || ax.ignored };
      controls.push(control);
      if (control.ignored || !String(control.name).trim()) offenders.push(control);
    }
    return { rootFound: true, total: controls.length, controls, offenders };
  } finally {
    await client.detach();
  }
}

/** Read the browser's name for the iframe itself, independently of its document title. */
async function frameAccessibleName(page) {
  const client = await page.createCDPSession();
  try {
    const { root } = await client.send('DOM.getDocument');
    const { nodeId } = await client.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#creativePreview iframe',
    });
    if (!nodeId) return { found: false, name: '' };
    const { node } = await client.send('DOM.describeNode', { nodeId });
    const { nodes } = await client.send('Accessibility.getPartialAXTree', {
      nodeId,
      fetchRelatives: false,
    });
    const ax = nodes.find((item) => item.backendDOMNodeId === node.backendNodeId);
    return { found: true, name: ax?.name?.value || '', ignored: !ax || ax.ignored };
  } finally {
    await client.detach();
  }
}

/**
 * A single-imp banner request/response pair whose adm carries a text marker
 * (to prove which creative is on screen) and a local, always-loadable image.
 * @param {string} id
 * @param {string} marker
 * @param {{price?: number, domain?: string}} [opts]
 * @returns {import('./corpus/lib/load').Materialized}
 */
function bannerPair(id, marker, opts = {}) {
  const domain = opts.domain || 'publisher.example.test';
  return {
    id,
    kind: 'pair',
    file: 'inline synthetic ux-a11y fixture',
    meta: { dialect: 'iab' },
    request: {
      id,
      at: 1,
      cur: ['USD'],
      site: { domain },
      device: DEVICE,
      imp: [{ id: 'imp-1', bidfloor: 1, bidfloorcur: 'USD', banner: { w: 300, h: 250 } }],
    },
    response: {
      id,
      cur: 'USD',
      seatbid: [
        {
          bid: [
            {
              id: 'bid-1',
              impid: 'imp-1',
              price: opts.price ?? 2.5,
              adomain: ['advertiser.example.test'],
              crid: 'cr-1',
              w: 300,
              h: 250,
              adm:
                '<div style="width:300px;height:250px;background:#123456;color:#fff">' +
                `<p>${marker}</p>` +
                `<img alt="a11y probe asset" width="300" height="250" src="${PIXEL_PNG}">` +
                '</div>',
            },
          ],
        },
      ],
    },
  };
}

/**
 * bidfloor set without bidfloorcur — the one clean, request-side WARNING.
 * @returns {import('./corpus/lib/load').Materialized}
 */
function warningPair(id) {
  return {
    id,
    kind: 'pair',
    file: 'inline synthetic ux-a11y fixture',
    meta: { dialect: 'iab' },
    request: {
      id,
      at: 1,
      cur: ['USD'],
      site: { domain: 'publisher.example.test' },
      device: DEVICE,
      imp: [{ id: 'imp-1', bidfloor: 1, banner: { w: 300, h: 250 } }],
    },
    response: {
      id,
      cur: 'USD',
      seatbid: [
        {
          bid: [
            {
              id: 'bid-1',
              impid: 'imp-1',
              price: 2,
              adomain: ['advertiser.example.test'],
              crid: 'cr-1',
              w: 300,
              h: 250,
              adm: '<div>ok</div>',
            },
          ],
        },
      ],
    },
  };
}

/**
 * A negative bid.price — the one clean, response-side ERROR.
 * @returns {import('./corpus/lib/load').Materialized}
 */
function errorPair(id) {
  return {
    id,
    kind: 'pair',
    file: 'inline synthetic ux-a11y fixture',
    meta: { dialect: 'iab' },
    request: {
      id,
      at: 1,
      cur: ['USD'],
      site: { domain: 'publisher.example.test' },
      device: DEVICE,
      imp: [{ id: 'imp-1', bidfloor: 1, bidfloorcur: 'USD', banner: { w: 300, h: 250 } }],
    },
    response: {
      id,
      cur: 'USD',
      seatbid: [
        {
          bid: [
            {
              id: 'bid-1',
              impid: 'imp-1',
              price: -1,
              adomain: ['advertiser.example.test'],
              crid: 'cr-1',
              w: 300,
              h: 250,
              adm: '<div>bad</div>',
            },
          ],
        },
      ],
    },
  };
}

/**
 * Two bids answering the same single imp — a "partial"/ambiguous response.
 * @returns {import('./corpus/lib/load').Materialized}
 */
function partialPair(id) {
  return {
    id,
    kind: 'pair',
    file: 'inline synthetic ux-a11y fixture',
    meta: { dialect: 'iab' },
    request: {
      id,
      at: 1,
      cur: ['USD'],
      site: { domain: 'publisher.example.test' },
      device: DEVICE,
      imp: [{ id: 'imp-1', bidfloor: 1, bidfloorcur: 'USD', banner: { w: 300, h: 250 } }],
    },
    response: {
      id,
      cur: 'USD',
      seatbid: [
        {
          bid: [
            {
              id: 'bid-1',
              impid: 'imp-1',
              price: 2,
              adomain: ['advertiser-a.example.test'],
              crid: 'cr-1',
              w: 300,
              h: 250,
              adm: '<div>first bid</div>',
            },
            {
              id: 'bid-2',
              impid: 'imp-1',
              price: 3,
              adomain: ['advertiser-b.example.test'],
              crid: 'cr-2',
              w: 300,
              h: 250,
              adm: '<div>second bid</div>',
            },
          ],
        },
      ],
    },
  };
}

/**
 * A VAST InLine whose Linear has no Duration child — one deterministic ERROR
 * (per packages/core/rules/price-floor and vast.test.js precedent, "Linear
 * without Duration"), and a body the preview classifies as VAST (inert,
 * scrollable text — contract B02) — enough to sample verdict, finding-row
 * and preview-inert-text contrast from a single payload.
 * @returns {import('./corpus/lib/load').Materialized}
 */
function vastErrorPair(id) {
  const vast =
    '<VAST version="4.0"><Ad id="1"><InLine>' +
    '<AdSystem>Test</AdSystem><AdTitle>Test</AdTitle>' +
    '<Impression><![CDATA[https://track.example.test/imp]]></Impression>' +
    '<Creatives><Creative><Linear><MediaFiles>' +
    '<MediaFile delivery="progressive" type="video/mp4" width="640" height="360">' +
    '<![CDATA[https://cdn.example.invalid/video.mp4]]></MediaFile>' +
    '</MediaFiles></Linear></Creative></Creatives>' +
    '</InLine></Ad></VAST>';
  return {
    id,
    kind: 'pair',
    file: 'inline synthetic ux-a11y fixture',
    meta: { dialect: 'iab' },
    request: {
      id,
      at: 1,
      cur: ['USD'],
      site: { domain: 'publisher.example.test' },
      device: DEVICE,
      imp: [
        {
          id: 'imp-1',
          bidfloor: 1,
          bidfloorcur: 'USD',
          video: { mimes: ['video/mp4'], protocols: [2, 3], w: 640, h: 360 },
        },
      ],
    },
    response: {
      id,
      cur: 'USD',
      seatbid: [
        {
          bid: [
            {
              id: 'bid-1',
              impid: 'imp-1',
              price: 2,
              adomain: ['advertiser.example.test'],
              crid: 'cr-1',
              w: 640,
              h: 360,
              adm: vast,
            },
          ],
        },
      ],
    },
  };
}

/** A synthetic ext.* key long enough that `imp[0].ext.<key>` exceeds 150 chars. */
const LONG_EXT_KEY = 'x_vendor_extension_probe_' + 'q'.repeat(140);

/** @param {number} totalLength @returns {string} a `.publisher.example.test` domain padded to exactly totalLength chars. */
function buildLongDomain(totalLength) {
  const suffix = '.publisher.example.test';
  const headLen = Math.max(1, totalLength - suffix.length);
  return 'x'.repeat(headLen) + suffix;
}

const VIEWPORTS = [
  { width: 1440, height: 900, label: '1440x900', stacked: false },
  { width: 1100, height: 800, label: '1100x800-stack-breakpoint', stacked: true },
  { width: 768, height: 1024, label: '768x1024', stacked: true },
  { width: 390, height: 844, label: '390x844', stacked: true },
];

const CONTRAST_TARGETS = [
  { key: 'verdictHeadline', selector: '#verdictHeadline', panel: 'tValidation' },
  { key: 'findingRowTitle', selector: '.validation-item .finding-title', panel: 'tValidation' },
  { key: 'tabLabel', selector: '.tab-btn.active', panel: 'tValidation' },
  { key: 'validityChip', selector: '#validityChipText', panel: 'tValidation' },
  { key: 'previewInertLabel', selector: '.preview-text-label', panel: 'tCreative' },
];

async function computeContrast(page) {
  const results = [];
  for (const target of CONTRAST_TARGETS) {
    const tab = await B.openTab(page, target.panel);
    const visible = tab.visible && (await visibleElement(page, target.selector));
    if (!visible) {
      results.push({
        ...target,
        found: false,
        limitation: 'Expected text is absent, hidden or obscured',
      });
      continue;
    }
    results.push(
      await page.evaluate((target) => {
        function color(text) {
          const match = /^rgba?\(([^)]+)\)$/.exec(text || '');
          if (!match) return null;
          const values = match[1].split(',').map(Number);
          if (![3, 4].includes(values.length) || values.some((v) => !Number.isFinite(v)))
            return null;
          return { r: values[0], g: values[1], b: values[2], a: values[3] ?? 1 };
        }
        function over(front, back) {
          const a = front.a + back.a * (1 - front.a);
          if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
          const channel = (key) => (front[key] * front.a + back[key] * back.a * (1 - front.a)) / a;
          return { r: channel('r'), g: channel('g'), b: channel('b'), a };
        }
        function luminance(c) {
          const linear = (v) => {
            const x = v / 255;
            return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
        }
        const el = document.querySelector(target.selector);
        const css = getComputedStyle(el);
        const text = (el.textContent || '').trim();
        const result = {
          ...target,
          found: true,
          text,
          fontSize: parseFloat(css.fontSize),
          fontWeight: parseInt(css.fontWeight, 10),
        };
        if (!text) return { ...result, limitation: 'Expected target has no text' };
        let background = { r: 0, g: 0, b: 0, a: 0 };
        for (let node = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (
            Number(style.opacity) !== 1 ||
            style.filter !== 'none' ||
            (style.backdropFilter && style.backdropFilter !== 'none') ||
            style.mixBlendMode !== 'normal'
          )
            return {
              ...result,
              limitation: 'Opacity, filter or blending requires a pixel measurement',
            };
          if (background.a < 1) {
            if (style.backgroundImage !== 'none')
              return {
                ...result,
                limitation: 'Background image or gradient requires a pixel measurement',
              };
            const layer = color(style.backgroundColor);
            if (!layer)
              return {
                ...result,
                limitation: `Unsupported background color ${style.backgroundColor}`,
              };
            background = over(background, layer);
          }
        }
        background = over(background, { r: 255, g: 255, b: 255, a: 1 });
        const ink = color(css.color);
        if (!ink) return { ...result, limitation: `Unsupported foreground color ${css.color}` };
        const foreground = over(ink, background);
        const l1 = luminance(foreground),
          l2 = luminance(background);
        const large =
          result.fontSize >= 24 || (result.fontSize >= (14 * 96) / 72 && result.fontWeight >= 700);
        return {
          ...result,
          foreground,
          background,
          ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
          threshold: large ? 3 : 4.5,
        };
      }, target),
    );
  }
  return results;
}

const skipReason = B.browserSkipReason || false;
const requireBrowser = process.env.CORPUS_REQUIRE_BROWSER === '1';
if (skipReason) {
  evidence.meta.browserUnavailable = String(skipReason);
  evidence.scenarios = A11Y_SCENARIOS.map((id) => ({
    id,
    status: 'skip',
    failures: [],
    reason: String(skipReason),
  }));
  writeFindings();
}

test(
  'corpus UX a11y/overflow audit: viewports, contrast, names, keyboard, states, zoom',
  { timeout: 600000, skip: !requireBrowser && skipReason },
  async (t) => {
    if (skipReason) assert.fail(String(skipReason));
    writeFindings();
    const server = await startServer();
    let browser;
    try {
      browser = await B.launchBrowser();
      const version = await B.browserVersion(browser);
      record({
        area: 'harness',
        repro: 'B.browserVersion(browser)',
        expected: 'n/a — recorded for the evidence write-up',
        actual: version,
        severity: 'info',
      });

      // ── 1. Viewports ────────────────────────────────────────────────────
      for (const vp of VIEWPORTS) {
        await scenario(t, `viewport-${vp.width}x${vp.height}`, async () => {
          const { page } = await openInspector(browser, server.url, {
            viewport: { width: vp.width, height: vp.height },
          });
          try {
            const layout = await page.evaluate(() => {
              const split = document.querySelector('.workbench-split');
              const cols = split
                ? getComputedStyle(split).gridTemplateColumns.trim().split(/\s+/).filter(Boolean)
                    .length
                : 0;
              return { cols };
            });
            const expectedCols = vp.stacked ? 1 : 2;
            checkEqual(
              layout.cols,
              expectedCols,
              `${vp.label}: expected ${expectedCols} editor/result column(s) on ` +
                `.workbench-split, got ${layout.cols}`,
            );

            await B.setPayload(
              page,
              bannerPair(`vp-${vp.width}x${vp.height}-a`, 'Viewport creative A'),
            );
            checkEqual(
              await B.analyze(page),
              'success',
              `${vp.label}: baseline banner analysis did not complete`,
            );

            const overflowAfterA = await page.evaluate(
              () => document.scrollingElement.scrollWidth - window.innerWidth,
            );
            checkOk(
              overflowAfterA <= 1,
              `${vp.label}: page overflows horizontally by ${overflowAfterA}px`,
            );

            const btn = await page.evaluate(() => {
              const el = document.getElementById('analyzeBtn');
              const r = el.getBoundingClientRect();
              return { left: r.left, right: r.right };
            });
            checkOk(
              btn.left >= -1 && btn.right <= vp.width + 1,
              `${vp.label}: Analyze button runs outside the viewport (left=${btn.left}, right=${btn.right})`,
            );

            const tabReach = await B.openTab(page, 'tCreative');
            checkOk(
              tabReach.visible,
              `${vp.label}: the Creative tab could not be reached by focus + Enter`,
            );

            const menuVisible = await page.evaluate(() => {
              const el = document.querySelector('.workbar-settings-menu > summary');
              if (!el) return false;
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') return false;
              return el.getBoundingClientRect().width > 0;
            });
            if (vp.width === 390) {
              checkOk(menuVisible, `${vp.label}: the mobile settings menu is not present`);
            } else {
              record({
                area: 'viewport.mobile-settings-menu',
                repro: `${vp.label}, .workbar-settings-menu > summary`,
                expected: 'hidden above the 720px breakpoint (contract, inspector.css)',
                actual: menuVisible ? 'visible' : 'hidden',
                severity: 'info',
              });
            }

            const overlap = await page.evaluate(() => {
              function rect(sel) {
                const el = document.querySelector(sel);
                if (!el) return null;
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') return null;
                const r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) return null;
                return r;
              }
              function intersectArea(a, b) {
                if (!a || !b) return 0;
                const left = Math.max(a.left, b.left);
                const right = Math.min(a.right, b.right);
                const top = Math.max(a.top, b.top);
                const bottom = Math.min(a.bottom, b.bottom);
                if (right <= left || bottom <= top) return 0;
                return Math.round((right - left) * (bottom - top));
              }
              const verdict = rect('#verdict');
              const tabBar = rect('.tab-bar');
              const preview = rect('#creativePreview');
              return {
                verdictVsTabBar: intersectArea(verdict, tabBar),
                tabBarVsPreview: intersectArea(tabBar, preview),
                verdictVsPreview: intersectArea(verdict, preview),
              };
            });
            record({
              area: 'viewport.panel-overlap',
              repro: `${vp.label}, #verdict / .tab-bar / #creativePreview bounding boxes`,
              expected: '0px^2 intersection for every pair',
              actual: JSON.stringify(overlap),
              severity:
                overlap.verdictVsTabBar || overlap.tabBarVsPreview || overlap.verdictVsPreview
                  ? 'medium'
                  : 'info',
            });

            await B.reveal(page);
            const firstPreview = await B.measurePreview(page);
            active.measured.preview = {
              kind: firstPreview.kind,
              rendered: firstPreview.rendered,
              assets: firstPreview.assets,
            };
            checkOk(
              firstPreview.rendered === 'full' &&
                firstPreview.assets.imgLoaded === 1 &&
                firstPreview.markerText.includes('Viewport creative A'),
              `${vp.label}: the controlled creative did not fully render with its identity and image`,
            );
            const shotA = await shot(page, `viewport-${vp.width}x${vp.height}-a`);

            // Stale-preview proof — only once, at the widest viewport, so the
            // functional check runs without repeating four times over.
            if (vp.width === 1440) {
              await B.setPayload(
                page,
                bannerPair(`vp-${vp.width}x${vp.height}-b`, 'Viewport creative B'),
              );
              checkEqual(
                await B.analyze(page),
                'success',
                `${vp.label}: second analysis did not complete`,
              );
              await B.openTab(page, 'tCreative');
              // The creative is blurred behind a reveal overlay until clicked
              // (Phase 8 safe-demo blur) — measurePreview reports empty text
              // for an unrevealed frame by design, so reveal it first.
              await B.reveal(page);
              const preview = await B.measurePreview(page);
              checkOk(
                preview.markerText.includes('Viewport creative B'),
                `${vp.label}: the new creative marker is not visible after re-analyze`,
              );
              checkOk(
                !preview.markerText.includes('Viewport creative A'),
                `${vp.label}: STALE PREVIEW — the previous creative marker is still visible after re-analyze`,
              );
            }

            // Long-value clipping: a >150-char finding path (a single very
            // long ext.* key) and a 120-char site.domain.
            const longDomain = buildLongDomain(120);
            const longPayload = bannerPair(
              `vp-${vp.width}x${vp.height}-long`,
              'Viewport long-value probe',
              { domain: longDomain },
            );
            longPayload.request.imp[0].ext = { [LONG_EXT_KEY]: 'probe-value' };
            await B.setPayload(page, longPayload);
            checkEqual(
              await B.analyze(page),
              'success',
              `${vp.label}: long-value analysis did not complete`,
            );
            // The long ext.* key surfaces as a `question`-level finding on the
            // Findings tab — measure it there, not on whatever tab a previous
            // step left active, or every element inside the inactive
            // `display:none` panel measures as a meaningless 0x0.
            await B.openTab(page, 'tValidation');
            const clip = await page.evaluate((expectedKey) => {
              function metrics(el) {
                if (!el) return null;
                const cs = getComputedStyle(el);
                return {
                  text: (el.textContent || '').trim().slice(0, 40),
                  scrollWidth: el.scrollWidth,
                  clientWidth: el.clientWidth,
                  clipped: el.scrollWidth > el.clientWidth + 1,
                  textOverflow: cs.textOverflow,
                  overflowX: cs.overflowX,
                  whiteSpace: cs.whiteSpace,
                };
              }
              /** @param {Element} el */
              function findingPathOf(el) {
                return /** @type {HTMLElement} */ (el).dataset.findingPath || '';
              }
              const pathRow = /** @type {HTMLElement|undefined} */ (
                Array.from(document.querySelectorAll('[data-finding-id]')).find((el) =>
                  findingPathOf(el).includes(expectedKey),
                )
              );
              const pathText = pathRow ? pathRow.querySelector('.finding-path-text') : null;
              const chipEls = Array.from(
                document.querySelectorAll(
                  '.finding-code, .validity-chip, .format-pill, .tab-badge, #stEntity',
                ),
              );
              return {
                pathLength: pathRow ? (pathRow.dataset.findingPath || '').length : 0,
                pathTextMetrics: metrics(pathText),
                chips: chipEls.map((el) => ({
                  selector: el.id
                    ? `#${el.id}`
                    : `.${(el.className || '').toString().split(/\s+/)[0]}`,
                  ...metrics(el),
                })),
                pageOverflow: document.scrollingElement.scrollWidth - window.innerWidth,
              };
            }, LONG_EXT_KEY);
            checkOk(
              clip.pageOverflow <= 1,
              `${vp.label}: the 120-char domain / long finding path overflow the page horizontally by ${clip.pageOverflow}px`,
            );
            const shotLong = await shot(page, `viewport-${vp.width}x${vp.height}-longvalue`);
            record({
              area: 'viewport.long-value-clipping',
              repro: `${vp.label}, finding path ${clip.pathLength} chars (target >150), domain ${longDomain.length} chars`,
              expected:
                'a controlled ellipsis truncation or a scrollable container for the long path/chips — never raw layout breakage',
              actual: JSON.stringify(clip),
              screenshot: shotLong || shotA,
              severity: 'info',
            });
          } finally {
            await closePage(page);
          }
        });
      }

      // ── 2. Themes ───────────────────────────────────────────────────────
      for (const theme of /** @type {const} */ (['light', 'dark'])) {
        await scenario(t, `contrast-${theme}`, async () => {
          const { page } = await openInspector(browser, server.url, {
            theme,
            viewport: { width: 1440, height: 900 },
          });
          try {
            await B.setPayload(page, vastErrorPair(`theme-${theme}`));
            checkEqual(
              await B.analyze(page),
              'success',
              `theme ${theme}: VAST-error analysis did not complete`,
            );
            await B.openTab(page, 'tCreative');
            const results = await computeContrast(page);
            const shotPath = await shot(page, `theme-${theme}-contrast`);
            active.measured.contrast = results;
            for (const r of results) {
              record({
                area: 'contrast.ratio',
                repro: `theme=${theme}, ${r.selector}`,
                expected: 'Visible measured text meets 4.5:1, or 3:1 for qualifying large text',
                actual: JSON.stringify(r),
                screenshot: shotPath,
              });
              if (
                !checkOk(
                  r.found && !r.limitation,
                  `contrast ${theme} ${r.key}: ${r.limitation || 'measurement unavailable'}`,
                )
              )
                continue;
              checkOk(
                Number.isFinite(r.ratio) && r.ratio >= r.threshold,
                `contrast ${theme} ${r.key}: below ${r.threshold}:1`,
              );
            }
          } finally {
            await closePage(page);
          }
        });
      }

      // ── 3. Accessible names, keyboard operability, iframe/aria-live ────
      await scenario(t, 'names-desktop', async () => {
        const { page } = await openInspector(browser, server.url, {
          viewport: { width: 1440, height: 900 },
        });
        try {
          await B.setPayload(page, bannerPair('a11y-names', 'A11y names probe'));
          checkEqual(await B.analyze(page), 'success', 'a11y: baseline analysis did not complete');

          // Open the More tab menu and the left sidebar so their controls
          // gain real layout before the accessible-name sweep — a control
          // inside a closed <details> is not user-reachable and would be a
          // false "offender."
          await page.evaluate(() => {
            const more = /** @type {HTMLDetailsElement|null} */ (
              document.querySelector('.tab-more')
            );
            if (more) more.open = true;
          });
          const sidebarToggle = await page.$('#toggleSidebarLeft');
          if (sidebarToggle) await sidebarToggle.click();
          await B.openTab(page, 'tCreative');

          const scan = await scanAccessibleNames(page);
          active.measured.accessibleControls = scan.controls;
          checkOk(scan.total > 0, 'a11y: no visible controls were checked');
          checkOk(scan.rootFound, 'a11y: .workbench root not found in the DOM');
          checkDeepEqual(
            scan.offenders,
            [],
            `a11y: ${scan.offenders.length} of ${scan.total} visible .workbench controls have ` +
              `no accessible name — ${JSON.stringify(scan.offenders)}`,
          );

          // Reveal button: focusable + Enter-activatable (native <button>).
          const revealOffered = await page.$('[data-action="reveal-creative"]');
          if (revealOffered) {
            await revealOffered.focus();
            const focusedIsReveal = await page.evaluate(
              () =>
                document.activeElement ===
                document.querySelector('[data-action="reveal-creative"]'),
            );
            checkOk(
              focusedIsReveal,
              'a11y: the reveal overlay button did not accept keyboard focus',
            );
            await page.keyboard.press('Enter');
            await page
              .waitForFunction(
                () =>
                  document.getElementById('creativePreviewSafe')?.classList.contains('is-revealed'),
                { timeout: 3000 },
              )
              .catch(() => {});
            const revealed = await page.evaluate(
              () =>
                !!document.getElementById('creativePreviewSafe')?.classList.contains('is-revealed'),
            );
            checkOk(
              revealed,
              'a11y: pressing Enter on the focused reveal button did not reveal the creative',
            );
          } else {
            checkOk(false, 'a11y: markup creative reveal control is missing');
            record({
              area: 'a11y.reveal-button',
              repro: 'a11y-names fixture, Creative tab',
              expected: 'a reveal overlay is offered for a markup creative',
              actual: 'no [data-action="reveal-creative"] control found',
              severity: 'medium',
            });
          }

          // Tab buttons: focusable + Enter-activatable, proven via the same
          // path the product's own click handler uses.
          for (const target of ['tValidation', 'tInspector', 'tCross', 'tCreative']) {
            const res = await B.openTab(page, target);
            checkOk(
              res.visible,
              `a11y: tab button for #${target} is not both focusable and Enter-activatable`,
            );
          }

          const extras = await page.evaluate(() => {
            const iframe = document.querySelector('#creativePreview iframe');
            const verdict = document.getElementById('verdict');
            return {
              iframePresent: !!iframe,
              iframeTitle: iframe ? iframe.getAttribute('title') : null,
              verdictAriaLive: verdict ? verdict.getAttribute('aria-live') : null,
            };
          });
          const frameName = await frameAccessibleName(page);
          active.measured.frameAccessibleName = frameName;
          checkOk(extras.iframePresent && frameName.found, 'a11y: creative frame is missing');
          if (extras.iframePresent && frameName.found)
            checkOk(
              !frameName.ignored && !!frameName.name.trim(),
              'a11y: creative frame or its accessible title is missing',
            );
          checkEqual(
            extras.verdictAriaLive,
            'polite',
            'a11y: verdict lacks its polite live region',
          );
          const shotPath = await shot(page, 'a11y-desktop');
          record({
            area: 'a11y.iframe-title',
            repro: 'a11y-names fixture, #creativePreview iframe',
            expected:
              'The rendered creative frame exposes an accessible name; its title attribute is also recorded',
            actual: JSON.stringify({ ...extras, frameName }),
            screenshot: shotPath,
            severity: frameName.name ? 'info' : 'medium',
          });
          record({
            area: 'a11y.verdict-aria-live',
            repro: '#verdict',
            expected: 'aria-live="polite" so the verdict is announced on analyze',
            actual: `aria-live=${JSON.stringify(extras.verdictAriaLive)}`,
            screenshot: shotPath,
            severity: extras.verdictAriaLive ? 'info' : 'medium',
          });
        } finally {
          await closePage(page);
        }
      });

      await scenario(t, 'names-mobile', async () => {
        const { page } = await openInspector(browser, server.url, {
          viewport: { width: 390, height: 844 },
        });
        try {
          await B.setPayload(page, bannerPair('a11y-names-mobile', 'A11y names mobile probe'));
          checkEqual(
            await B.analyze(page),
            'success',
            'a11y mobile: baseline analysis did not complete',
          );
          await page.evaluate(() => {
            const menu = /** @type {HTMLDetailsElement|null} */ (
              document.querySelector('.workbar-settings-menu')
            );
            if (menu) menu.open = true;
          });
          const scan = await scanAccessibleNames(page);
          active.measured.accessibleControls = scan.controls;
          checkOk(
            scan.rootFound && scan.total > 0,
            'a11y mobile: no visible workbench controls were checked',
          );
          checkDeepEqual(
            scan.offenders,
            [],
            `a11y mobile: ${scan.offenders.length} of ${scan.total} visible .workbench controls have ` +
              `no accessible name — ${JSON.stringify(scan.offenders)}`,
          );
          await shot(page, 'a11y-mobile');
        } finally {
          await closePage(page);
        }
      });

      // ── 4. Keyboard ─────────────────────────────────────────────────────
      await scenario(t, 'keyboard', async () => {
        const { page } = await openInspector(browser, server.url, {
          viewport: { width: 1440, height: 900 },
        });
        try {
          const readFocus = () =>
            page.evaluate(() => {
              const el = document.activeElement;
              return el
                ? {
                    tag: el.tagName.toLowerCase(),
                    id: el.id || '',
                    cls: (el.className || '').toString().slice(0, 60),
                  }
                : null;
            });

          const sequence = [];
          for (let i = 0; i < 15; i += 1) {
            await page.keyboard.press('Tab');
            sequence.push(await readFocus());
          }
          record({
            area: 'keyboard.tab-sequence',
            repro: '15x Tab from page load, no prior click',
            expected: 'n/a — recorded for the write-up',
            actual: JSON.stringify(sequence),
            severity: 'info',
          });
          await shot(page, 'keyboard-after-15-tabs');

          await page.keyboard.down('Shift');
          await page.keyboard.press('Tab');
          await page.keyboard.up('Shift');
          const afterShiftTab = await readFocus();
          checkOk(
            sequence.some((item, index) => index > 0 && !isDeepStrictEqual(item, sequence[0])),
            'keyboard: Tab focus remained trapped at one stop',
          );
          checkOk(
            afterShiftTab && afterShiftTab.tag !== 'body',
            'keyboard: Shift+Tab lost the focused control',
          );
          record({
            area: 'keyboard.shift-tab-returns',
            repro: 'Shift+Tab immediately after the 15th Tab',
            expected: `focus returns to the 14th stop: ${JSON.stringify(sequence[13])}`,
            actual: JSON.stringify(afterShiftTab),
            severity:
              sequence[13] &&
              afterShiftTab &&
              sequence[13].id === afterShiftTab.id &&
              sequence[13].tag === afterShiftTab.tag
                ? 'info'
                : 'low',
          });

          await B.setPayload(page, bannerPair('keyboard-ctrl-enter', 'Keyboard trigger marker'));
          const outcome = await B.analyze(page, { via: 'keyboard' });
          checkEqual(outcome, 'success', 'keyboard: Ctrl+Enter did not complete analysis');
          const transport = B.measureTransport(page);
          checkOk(
            transport.requests.length === 1 &&
              transport.responses.length === 1 &&
              transport.responses[0].status === 200 &&
              transport.responses[0].body?.success === true,
            'keyboard: Ctrl+Enter did not use one successful real Analyze request',
          );
          record({
            area: 'keyboard.ctrl-enter-analyze',
            repro: 'focus #bidReq, Ctrl+Enter',
            expected: 'success',
            actual: outcome,
            severity: outcome === 'success' ? 'info' : 'medium',
          });

          await page.evaluate(() => {
            const more = /** @type {HTMLDetailsElement|null} */ (
              document.querySelector('.tab-more')
            );
            if (more) more.open = true;
          });
          const summary = await page.$('.tab-more > summary');
          checkOk(!!summary, 'keyboard: More menu summary is missing');
          if (summary) await summary.focus();
          await page.keyboard.press('Escape');
          const moreState = await page.evaluate(() => {
            const more = document.querySelector('.tab-more');
            return {
              open: !!more && more.hasAttribute('open'),
              focusedIsSummary: document.activeElement === more?.querySelector('summary'),
            };
          });
          checkOk(
            !moreState.open && moreState.focusedIsSummary,
            'keyboard: Escape did not close More and restore summary focus',
          );
          record({
            area: 'keyboard.escape-closes-more',
            repro: 'open .tab-more, focus its summary, press Escape',
            expected: '{"open":false,"focusedIsSummary":true}',
            actual: JSON.stringify(moreState),
            severity: moreState.open ? 'medium' : 'info',
          });

          await shot(page, 'keyboard-final');
        } finally {
          await closePage(page);
        }
      });

      // ── 5. States ───────────────────────────────────────────────────────
      await scenario(t, 'state-empty', async () => {
        const { page } = await openInspector(browser, server.url, {});
        try {
          const info = await page.evaluate(() => ({
            verdictHidden: document.getElementById('verdict').hidden,
            placeholder: document.getElementById('bidReq').getAttribute('placeholder') || '',
          }));
          checkEqual(
            info.verdictHidden,
            true,
            'empty state: #verdict must stay hidden until an analysis has run',
          );
          checkOk(
            info.placeholder.includes('paste a BidRequest'),
            `empty state: #bidReq placeholder is missing the expected localized guidance, got: "${info.placeholder}"`,
          );
          record({
            area: 'state.empty',
            repro: 'fresh page load, nothing pasted',
            expected: '#verdict hidden; placeholder guides pasting a BidRequest',
            actual: JSON.stringify(info),
            severity: 'info',
          });
          await shot(page, 'state-empty');
        } finally {
          await closePage(page);
        }
      });

      await scenario(t, 'state-unsupported', async () => {
        const { page, pageErrors } = await openInspector(browser, server.url, {});
        try {
          /** @type {import('./corpus/lib/load').Materialized} */
          const unsupported = {
            id: 'state-unsupported',
            kind: 'pair',
            file: 'inline synthetic ux-a11y fixture',
            meta: {},
            request: { foo: 1 },
            response: undefined,
          };
          await B.setPayload(page, unsupported);
          const outcome = await B.analyze(page);
          checkEqual(
            outcome,
            'success',
            `unsupported-shape payload should still analyze without crashing, got ${outcome}`,
          );
          const info = await B.measureAnalysis(page);
          checkOk(await visibleElement(page, '#verdict'), 'unsupported: current verdict is hidden');
          checkOk(
            info.last?.request?.foo === 1,
            'unsupported: displayed result does not belong to the submitted payload',
          );
          checkEqual(
            pageErrors.length,
            0,
            `unsupported-shape payload triggered a page error: ${pageErrors.join(' | ')}`,
          );
          record({
            area: 'state.unsupported-payload',
            repro: 'paste {"foo":1} as the request, leave the response empty',
            expected:
              'no distinct "unrecognized format" UI state exists today — the payload gets a normal ' +
              'clean/risky/blocked verdict from whatever findings fire (see i18n-ux map §1)',
            actual: `verdict=${JSON.stringify(info.verdict)} formatText="${info.formatText}"`,
            severity: 'low',
          });
          await shot(page, 'state-unsupported');
        } finally {
          await closePage(page);
        }
      });

      await scenario(t, 'state-request-only', async () => {
        const { page, pageErrors } = await openInspector(browser, server.url, {});
        try {
          const pair = bannerPair('state-req-only', 'n/a');
          await B.setPayload(page, { ...pair, response: undefined });
          checkEqual(await B.analyze(page), 'success', 'request-only: analysis did not complete');
          checkOk(
            (await B.openTab(page, 'tCross')).visible,
            'request-only: Crosscheck panel is hidden',
          );
          const crossText = await page.evaluate(() =>
            (document.getElementById('tCross').textContent || '').replace(/\s+/g, ' ').trim(),
          );
          checkOk(
            crossText.includes('Crosscheck needs a BidResponse in the right pane'),
            `request-only: crosscheck panel is missing the expected localized text, got: "${crossText}"`,
          );
          checkEqual(
            pageErrors.length,
            0,
            `request-only triggered a page error: ${pageErrors.join(' | ')}`,
          );
          record({
            area: 'state.request-only',
            repro: 'paste a valid BidRequest, leave the response empty',
            expected: 'Crosscheck tab explains it needs a BidResponse',
            actual: crossText,
            severity: 'info',
          });
          await shot(page, 'state-request-only');
        } finally {
          await closePage(page);
        }
      });

      await scenario(t, 'state-response-only', async () => {
        const { page, pageErrors } = await openInspector(browser, server.url, {});
        try {
          const pair = bannerPair('state-res-only', 'n/a');
          await B.setPayload(page, { ...pair, request: undefined });
          checkEqual(await B.analyze(page), 'success', 'response-only: analysis did not complete');
          checkOk(
            (await B.openTab(page, 'tInspector')).visible,
            'response-only: Impressions panel is hidden',
          );
          const slotText = await page.evaluate(() =>
            (document.getElementById('slotGrid').textContent || '').replace(/\s+/g, ' ').trim(),
          );
          checkOk(
            slotText.includes('Inspector preview needs a paired BidRequest'),
            `response-only: slot grid is missing the expected localized text, got: "${slotText}"`,
          );
          checkEqual(
            pageErrors.length,
            0,
            `response-only triggered a page error: ${pageErrors.join(' | ')}`,
          );
          record({
            area: 'state.response-only',
            repro: 'paste a valid BidResponse, leave the request empty',
            expected: 'Impressions tab explains it needs a paired BidRequest',
            actual: slotText,
            severity: 'info',
          });
          await shot(page, 'state-response-only');
        } finally {
          await closePage(page);
        }
      });

      await scenario(t, 'state-partial', async () => {
        const { page, pageErrors } = await openInspector(browser, server.url, {});
        try {
          await B.setPayload(page, partialPair('state-partial'));
          checkEqual(await B.analyze(page), 'success', 'partial: analysis did not complete');
          checkEqual(
            pageErrors.length,
            0,
            `partial triggered a page error: ${pageErrors.join(' | ')}`,
          );
          await B.openTab(page, 'tCreative');
          await B.reveal(page);
          await B.reveal(page);
          const preview = await B.measurePreview(page);
          checkOk(
            preview.markerText.includes('first bid'),
            'partial: first bid creative is not visible',
          );
          const selection = await page.$(
            '[data-action="select-creative-bid"][data-seat-index="0"][data-bid-index="1"]',
          );
          checkOk(!!selection, 'partial: second bid is unavailable for inspection');
          if (selection) {
            await selection.click();
            await B.reveal(page);
            const second = await B.measurePreview(page);
            checkOk(
              second.markerText.includes('second bid'),
              'partial: selected second bid creative is not visible',
            );
          }
          const priceText = await page.evaluate(() =>
            (document.getElementById('mPrice')?.textContent || '').trim(),
          );
          record({
            area: 'state.partial-multibid',
            repro: 'response.seatbid[0].bid has 2 entries for the same impid',
            expected:
              'no bid selector exists (contract B14, specs/014-push-creative-preview) — the preview ' +
              'shows only seatbid[0].bid[0], with no on-screen indication that a second bid was ignored',
            actual: `priceChip="${priceText}" previewMarker="${preview.markerText.slice(0, 60)}"`,
            severity: 'low',
          });
          await shot(page, 'state-partial');
        } finally {
          await closePage(page);
        }
      });

      await scenario(t, 'state-warning', async () => {
        const { page } = await openInspector(browser, server.url, {});
        try {
          await B.setPayload(page, warningPair('state-warning'));
          checkEqual(await B.analyze(page), 'success', 'warning-level: analysis did not complete');
          const verdict = await page.evaluate(() => {
            const el = document.getElementById('verdict');
            return {
              hidden: el.hidden,
              verdict: el.dataset.verdict || '',
              status: el.dataset.status || '',
              headline: (document.getElementById('verdictHeadline').textContent || '').trim(),
            };
          });
          checkOk(
            await visibleElement(page, '#verdictHeadline'),
            'state: verdict headline is hidden',
          );
          checkEqual(
            verdict.verdict,
            'risky',
            `warning-level: expected #verdict[data-verdict="risky"], got ${JSON.stringify(verdict)}`,
          );
          checkEqual(
            verdict.headline,
            'This payload will pass, but carries risks',
            `warning-level: verdict headline text mismatch, got: "${verdict.headline}"`,
          );
          record({
            area: 'state.warning',
            repro: 'imp.bidfloor set without imp.bidfloorcur',
            expected: verdict.headline,
            actual: JSON.stringify(verdict),
            severity: 'info',
          });
          await shot(page, 'state-warning');
        } finally {
          await closePage(page);
        }
      });

      await scenario(t, 'state-error', async () => {
        const { page } = await openInspector(browser, server.url, {});
        try {
          await B.setPayload(page, errorPair('state-error'));
          checkEqual(await B.analyze(page), 'success', 'error-level: analysis did not complete');
          const verdict = await page.evaluate(() => {
            const el = document.getElementById('verdict');
            return {
              hidden: el.hidden,
              verdict: el.dataset.verdict || '',
              status: el.dataset.status || '',
              headline: (document.getElementById('verdictHeadline').textContent || '').trim(),
            };
          });
          checkOk(
            await visibleElement(page, '#verdictHeadline'),
            'state: verdict headline is hidden',
          );
          checkEqual(
            verdict.verdict,
            'blocked',
            `error-level: expected #verdict[data-verdict="blocked"], got ${JSON.stringify(verdict)}`,
          );
          checkEqual(
            verdict.headline,
            'This bid will not serve',
            `error-level: verdict headline text mismatch, got: "${verdict.headline}"`,
          );
          record({
            area: 'state.error',
            repro: 'bid.price = -1',
            expected: verdict.headline,
            actual: JSON.stringify(verdict),
            severity: 'info',
          });
          await shot(page, 'state-error');
        } finally {
          await closePage(page);
        }
      });

      await scenario(t, 'state-large-json', async () => {
        const { page, pageErrors } = await openInspector(browser, server.url, {});
        try {
          const req = {
            id: 'large-json',
            at: 1,
            cur: ['USD'],
            site: { domain: 'publisher.example.test' },
            device: DEVICE,
            imp: [],
          };
          let n = 0;
          while (Buffer.byteLength(JSON.stringify(req, null, 2)) < 200 * 1024) {
            n += 1;
            req.imp.push({
              id: `imp-${String(n).padStart(4, '0')}`,
              bidfloor: 1,
              bidfloorcur: 'USD',
              banner: { w: 300, h: 250 },
            });
          }
          const bytes = Buffer.byteLength(JSON.stringify(req, null, 2));
          const res = {
            id: 'large-json',
            cur: 'USD',
            seatbid: [
              {
                bid: [
                  {
                    id: 'bid-1',
                    impid: req.imp[0].id,
                    price: 2,
                    adomain: ['advertiser.example.test'],
                    crid: 'cr-1',
                    w: 300,
                    h: 250,
                    adm: '<div>ok</div>',
                  },
                ],
              },
            ],
          };
          /** @type {import('./corpus/lib/load').Materialized} */
          const large = {
            id: 'large-json',
            kind: 'pair',
            file: 'inline synthetic ux-a11y fixture',
            meta: {},
            request: req,
            response: res,
          };
          await B.setPayload(page, large);
          const start = Date.now();
          const outcome = await B.analyze(page, { timeout: 20000 });
          const elapsedMs = Date.now() - start;
          checkEqual(
            outcome,
            'success',
            `large payload (${Math.round(bytes / 1024)}KB) should still analyze successfully, got ${outcome}`,
          );
          checkOk(
            elapsedMs < 15000,
            `analysis of a ~${Math.round(bytes / 1024)}KB payload took ${elapsedMs}ms, over the 15s budget`,
          );
          const editor = await page.evaluate(() => {
            const el = /** @type {HTMLTextAreaElement} */ (document.getElementById('bidReq'));
            const lines = el.value.split('\n').length;
            const before = el.scrollTop;
            el.scrollTop = 500;
            const after = el.scrollTop;
            return {
              lines,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
              before,
              after,
            };
          });
          checkOk(
            editor.scrollHeight > editor.clientHeight,
            'large payload: the editor does not need to scroll — the fixture is too small to prove readability',
          );
          checkOk(
            editor.after > editor.before,
            `large payload: setting #bidReq.scrollTop had no effect (before=${editor.before}, after=${editor.after}) — scrolling appears broken`,
          );
          checkEqual(
            pageErrors.length,
            0,
            `large payload triggered a page error: ${pageErrors.join(' | ')}`,
          );
          record({
            area: 'state.large-json',
            repro: `paste a ~${Math.round(bytes / 1024)}KB pretty-printed request (${n} imp entries)`,
            expected: 'readable (scrolls), analyzes under 15s, no page error',
            actual: `lines=${editor.lines} elapsedMs=${elapsedMs}`,
            severity: 'info',
          });
          await shot(page, 'state-large-json');
        } finally {
          await closePage(page);
        }
      });

      // ── 6. Zoom ─────────────────────────────────────────────────────────
      await scenario(t, 'zoom-dsf2', async () => {
        const { page } = await openInspector(browser, server.url, {
          viewport: { width: 1440, height: 900 },
        });
        try {
          await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
          await B.setPayload(page, bannerPair('zoom-dsf2', 'Zoom DSF2 marker'));
          checkEqual(
            await B.analyze(page),
            'success',
            'deviceScaleFactor 2: analysis did not complete',
          );
          const info = await page.evaluate(() => ({
            overflow: document.scrollingElement.scrollWidth - window.innerWidth,
            verdictVisible: !document.getElementById('verdict').hidden,
            devicePixelRatio: window.devicePixelRatio,
            rootZoom: getComputedStyle(document.documentElement).zoom,
          }));
          checkOk(info.overflow <= 1, `deviceScaleFactor 2: page overflows by ${info.overflow}px`);
          checkOk(
            info.verdictVisible,
            'deviceScaleFactor 2: #verdict is not visible after analysis',
          );
          checkEqual(info.devicePixelRatio, 2, 'density: devicePixelRatio did not become 2');
          checkOk(
            await visibleElement(page, '#verdictHeadline'),
            'density: verdict headline is not visible',
          );
          record({
            area: 'density.device-scale-factor-2',
            repro: 'setViewport({..., deviceScaleFactor:2}), analyze a valid banner pair',
            expected: 'no overflow; verdict visible',
            actual: JSON.stringify(info),
            severity: 'info',
          });
          await shot(page, 'zoom-dsf2');
        } finally {
          await closePage(page);
        }
      });

      await scenario(t, 'zoom-css150', async () => {
        const { page } = await openInspector(browser, server.url, {
          viewport: { width: 1440, height: 900 },
        });
        try {
          await B.setPayload(page, bannerPair('zoom-css150', 'Zoom CSS150 marker'));
          checkEqual(await B.analyze(page), 'success', 'CSS zoom 150%: analysis did not complete');
          await page.evaluate(() => {
            document.documentElement.style.zoom = '150%';
          });
          await new Promise((r) => setTimeout(r, 150));
          const info = await page.evaluate(() => ({
            overflow: document.scrollingElement.scrollWidth - window.innerWidth,
            verdictVisible: !document.getElementById('verdict').hidden,
            devicePixelRatio: window.devicePixelRatio,
            rootZoom: getComputedStyle(document.documentElement).zoom,
          }));
          checkOk(info.overflow <= 1, `CSS zoom 150%: page overflows by ${info.overflow}px`);
          checkOk(info.verdictVisible, 'CSS zoom 150%: #verdict is not visible after analysis');
          checkEqual(Number(info.rootZoom), 1.5, 'CSS zoom: root zoom did not become 150%');
          checkOk(
            await visibleElement(page, '#verdictHeadline'),
            'CSS zoom: verdict headline is not visible',
          );
          record({
            area: 'zoom.css-zoom-150',
            repro: "document.documentElement.style.zoom = '150%' after a successful analysis",
            expected: 'no overflow; verdict visible',
            actual: JSON.stringify(info),
            severity: 'info',
          });
          await shot(page, 'zoom-css150');
        } finally {
          await closePage(page);
        }
      });
      const validation = validateA11yReport(evidence);
      assert.ok(validation.valid, validation.problems.join('\n'));
    } finally {
      try {
        if (browser) await browser.close();
      } finally {
        try {
          await server.stop();
        } finally {
          writeFindings();
        }
      }
    }
  },
);
