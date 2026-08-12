'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

// ── Helper: load macros engine into a fresh window ──────────────
function loadMacros(windowObj) {
  const code = fs.readFileSync(path.join(ROOT, 'public/modules/macros/index.js'), 'utf8');
  const fn = new Function('window', 'document', code);
  fn(windowObj, windowObj.document || {});
  return windowObj.OrtbtoolsMacros;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. STRUCTURAL: zero-network policy
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('macro-evaluator adheres to zero-network policy', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'public/modules/macros/index.js'), 'utf8');
  const code = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  assert.doesNotMatch(code, /\bfetch\s*\(/, 'must not call fetch()');
  assert.doesNotMatch(code, /\bXMLHttpRequest\b/, 'must not use XMLHttpRequest');
  assert.doesNotMatch(code, /\bnew\s+Image\s*\(/, 'must not create Image objects');
  assert.doesNotMatch(code, /\bsendBeacon\s*\(/, 'must not call sendBeacon()');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. STRUCTURAL: CSP meta tag in creative preview
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('creative preview iframe enforces CSP to block external network requests (structural grep)', () => {
  const appCode = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');
  assert.match(
    appCode,
    /Content-Security-Policy.*default-src\s+'none'/,
    'buildProbedSrcdoc must inject restrictive CSP',
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. AUCTION_PRICE semantics
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('AUCTION_PRICE: requires explicit simulated clearing price; bid.price/bidfloor are NOT substituted', () => {
  const M = loadMacros({});

  const res = {
    seatbid: [
      {
        seat: 'dsp-1',
        bid: [
          {
            id: 'bid-1',
            impid: 'imp-1',
            price: 1.11,
            nurl: 'https://dsp-1.example/win?p=${AUCTION_PRICE}',
          },
        ],
      },
      {
        seat: 'dsp-2',
        bid: [
          {
            id: 'bid-2',
            impid: 'imp-2',
            price: 2.22,
            nurl: 'https://dsp-2.example/win?p=${AUCTION_PRICE}',
          },
        ],
      },
    ],
  };
  const req = { id: 'auc-1', imp: [{ id: 'imp-1', bidfloor: 0.5 }] };

  const items = M.extractBidTrackers(res, req);
  assert.equal(items.length, 2);

  // Case A: simPrice is empty → ${AUCTION_PRICE} stays literal
  const evalA0 = M.evaluateMacros(items[0].rawUrl, items[0].context);
  const evalA1 = M.evaluateMacros(items[1].rawUrl, items[1].context);

  assert.equal(evalA0.evaluatedUrl, 'https://dsp-1.example/win?p=${AUCTION_PRICE}');
  assert.equal(evalA0.detectedMacros[0].isUnresolved, true);
  assert.equal(evalA0.detectedMacros[0].reason, 'simulation_value_required');

  assert.equal(evalA1.evaluatedUrl, 'https://dsp-2.example/win?p=${AUCTION_PRICE}');
  assert.equal(evalA1.detectedMacros[0].isUnresolved, true);

  // Verify bid.price (1.11, 2.22) and bidfloor (0.50) do NOT appear in evaluated URLs
  assert.doesNotMatch(evalA0.evaluatedUrl, /1\.11/);
  assert.doesNotMatch(evalA0.evaluatedUrl, /0\.50/);
  assert.doesNotMatch(evalA0.evaluatedUrl, /0\.00/);
  assert.doesNotMatch(evalA1.evaluatedUrl, /2\.22/);

  // Case B: explicit simulation price 9.99
  const evalB0 = M.evaluateMacros(items[0].rawUrl, { ...items[0].context, price: '9.99' });
  const evalB1 = M.evaluateMacros(items[1].rawUrl, { ...items[1].context, price: '9.99' });

  assert.equal(evalB0.evaluatedUrl, 'https://dsp-1.example/win?p=9.99');
  assert.equal(evalB0.detectedMacros[0].isUnresolved, false);
  assert.equal(evalB1.evaluatedUrl, 'https://dsp-2.example/win?p=9.99');
  assert.equal(evalB1.detectedMacros[0].isUnresolved, false);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. AUCTION_ID: strictly BidRequest.id; never falls back to BidResponse.id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('AUCTION_ID: uses BidRequest.id only; response-only analysis does NOT use BidResponse.id', () => {
  const M = loadMacros({});

  // Case A: req.id is present → AUCTION_ID resolves to req.id
  const res1 = {
    id: 'response-id',
    seatbid: [{ bid: [{ id: 'b1', nurl: 'https://x?a=${AUCTION_ID}' }] }],
  };
  const ext1 = M.extractBidTrackers(res1, { id: 'request-id' });
  const eval1 = M.evaluateMacros(ext1[0].rawUrl, ext1[0].context);
  assert.equal(eval1.evaluatedUrl, 'https://x?a=request-id');

  // Case B: req absent, res.id='response-id' → AUCTION_ID stays literal
  const res2 = {
    id: 'response-id',
    seatbid: [{ bid: [{ id: 'b1', nurl: 'https://x?a=${AUCTION_ID}' }] }],
  };
  const ext2 = M.extractBidTrackers(res2, {});
  const eval2 = M.evaluateMacros(ext2[0].rawUrl, ext2[0].context);
  // Must NOT become response-id
  assert.doesNotMatch(eval2.evaluatedUrl, /response-id/);
  assert.match(eval2.evaluatedUrl, /\$\{AUCTION_ID\}/);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. :X suffix handling: no hardcoded algorithms
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test(':X suffix: does not assume hardcoded B64/HEX; requires explicit context.encoders', () => {
  const M = loadMacros({});
  const rawUrl =
    'https://tracker.example/win?p_b64=${AUCTION_PRICE:B64}&p_rot13=${AUCTION_PRICE:ROT13}';

  // Without encoders → stays literal
  const evalA = M.evaluateMacros(rawUrl, { price: '2.50' });
  assert.match(evalA.evaluatedUrl, /\$\{AUCTION_PRICE:B64\}/);
  assert.match(evalA.evaluatedUrl, /\$\{AUCTION_PRICE:ROT13\}/);
  assert.equal(evalA.detectedMacros[0].isUnresolved, true);
  assert.equal(evalA.detectedMacros[0].reason, 'unsupported_encoder');

  // With explicit B64 encoder
  const evalB = M.evaluateMacros(rawUrl, {
    price: '2.50',
    encoders: { B64: (val) => Buffer.from(val).toString('base64url') },
  });
  assert.equal(
    evalB.evaluatedUrl,
    'https://tracker.example/win?p_b64=Mi41MA&p_rot13=${AUCTION_PRICE:ROT13}',
  );
  assert.equal(evalB.detectedMacros[0].isUnresolved, false);
  assert.equal(evalB.detectedMacros[1].isUnresolved, true);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. Currency source: BidResponse.cur; normative default USD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('AUCTION_CURRENCY: BidResponse.cur; normative USD fallback; NOT BidRequest.cur[0]', () => {
  const M = loadMacros({});

  // Case A: BidResponse.cur = EUR → uses EUR
  const resA = {
    cur: 'EUR',
    seatbid: [{ bid: [{ id: 'b1', nurl: 'https://win?cur=${AUCTION_CURRENCY}' }] }],
  };
  const extA = M.extractBidTrackers(resA, { cur: ['USD', 'GBP'] });
  const evalA = M.evaluateMacros(extA[0].rawUrl, extA[0].context);
  assert.equal(evalA.evaluatedUrl, 'https://win?cur=EUR');

  // Case B: BidResponse.cur absent, BidRequest.cur = ['EUR'] → still USD
  const resB = {
    seatbid: [{ bid: [{ id: 'b1', nurl: 'https://win?cur=${AUCTION_CURRENCY}' }] }],
  };
  const extB = M.extractBidTrackers(resB, { cur: ['EUR'] });
  const evalB = M.evaluateMacros(extB[0].rawUrl, extB[0].context);
  assert.equal(evalB.evaluatedUrl, 'https://win?cur=USD');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. CDATA extraction: boundary-safe
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('CDATA extraction: A. VAST adm with CDATA yields URL without ]]', () => {
  const M = loadMacros({});
  const res = {
    seatbid: [
      {
        bid: [
          {
            id: 'b1',
            adm: '<VAST><Impression><![CDATA[https://x.example/p?m=${AUCTION_PRICE}]]></Impression></VAST>',
          },
        ],
      },
    ],
  };
  const ext = M.extractBidTrackers(res, {});
  assert.equal(ext.length, 1);
  assert.equal(ext[0].type, 'adm');
  assert.equal(ext[0].rawUrl, 'https://x.example/p?m=${AUCTION_PRICE}');
});

test('CDATA extraction: B. URL legitimately ending in ] retains it', () => {
  const M = loadMacros({});
  const res = {
    seatbid: [
      {
        bid: [
          {
            id: 'b1',
            adm: '<VAST><Impression><![CDATA[https://x.example/p?m=${AUCTION_PRICE}&filter[0]=123]]]></Impression></VAST>',
          },
        ],
      },
    ],
  };
  const ext = M.extractBidTrackers(res, {});
  assert.equal(ext.length, 1);
  assert.equal(ext[0].rawUrl, 'https://x.example/p?m=${AUCTION_PRICE}&filter[0]=123]');
});

test('CDATA extraction: C. nurl/burl CDATA continue working', () => {
  const M = loadMacros({});
  const res = {
    seatbid: [
      {
        bid: [
          {
            id: 'b1',
            nurl: '<![CDATA[https://n.example/p?m=${AUCTION_PRICE}]]>',
            burl: '<![CDATA[https://b.example/p?m=${AUCTION_PRICE}]]>',
          },
        ],
      },
    ],
  };
  const ext = M.extractBidTrackers(res, {});
  assert.equal(ext.length, 2);
  const nurl = ext.find((e) => e.type === 'nurl');
  const burl = ext.find((e) => e.type === 'burl');
  assert.equal(nurl.rawUrl, 'https://n.example/p?m=${AUCTION_PRICE}');
  assert.equal(burl.rawUrl, 'https://b.example/p?m=${AUCTION_PRICE}');
});

test('CDATA extraction: D. Native JSON event tracker continues to work', () => {
  const M = loadMacros({});
  const res = {
    seatbid: [
      {
        bid: [{ id: 'b1', adm: '{"imptrackers":["https://n.example/event?m=${AUCTION_PRICE}"]}' }],
      },
    ],
  };
  const ext = M.extractBidTrackers(res, {});
  assert.equal(ext.length, 1);
  assert.equal(ext[0].rawUrl, 'https://n.example/event?m=${AUCTION_PRICE}');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. resolveAdmMacros: shared evaluator for preview and table
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('resolveAdmMacros: shared evaluator applies same rules as evaluateMacros', () => {
  const M = loadMacros({});

  // With empty price → AUCTION_PRICE stays literal
  const adm1 = '<img src="https://dsp.example/px?p=${AUCTION_PRICE}&c=${AUCTION_CURRENCY}">';
  const out1 = M.resolveAdmMacros(adm1, { price: '', currency: 'EUR' });
  assert.match(out1, /\$\{AUCTION_PRICE\}/);
  assert.match(out1, /c=EUR/);

  // With explicit price → AUCTION_PRICE resolved
  const out2 = M.resolveAdmMacros(adm1, { price: '9.99', currency: 'EUR' });
  assert.match(out2, /p=9\.99/);
  assert.match(out2, /c=EUR/);

  // bid.price never bleeds into resolved output
  const adm3 = '<script src="https://x?p=${AUCTION_PRICE}"></script>';
  const out3 = M.resolveAdmMacros(adm3, { price: '', bidPrice: '1.11', currency: 'USD' });
  assert.doesNotMatch(out3, /p=1\.11/);
  assert.match(out3, /\$\{AUCTION_PRICE\}/);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. setAdPreview structural: no hardcoded .replace() in app.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('setAdPreview does not contain hardcoded .replace(AUCTION_PRICE/CURRENCY/LOSS)', () => {
  const appCode = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');
  // Find the setAdPreview function body
  const fnStart = appCode.indexOf('function setAdPreview(');
  assert.ok(fnStart > -1, 'setAdPreview function must exist');
  // Check ~200 lines after the function start for hardcoded .replace calls
  const fnSlice = appCode.slice(fnStart, fnStart + 5000);
  assert.doesNotMatch(
    fnSlice,
    /\.replace\([^)]*AUCTION_PRICE/,
    'setAdPreview must NOT contain hardcoded .replace(AUCTION_PRICE,...)',
  );
  assert.doesNotMatch(
    fnSlice,
    /\.replace\([^)]*AUCTION_CURRENCY/,
    'setAdPreview must NOT contain hardcoded .replace(AUCTION_CURRENCY,...)',
  );
  assert.doesNotMatch(
    fnSlice,
    /\.replace\([^)]*AUCTION_LOSS/,
    'setAdPreview must NOT contain hardcoded .replace(AUCTION_LOSS,...)',
  );
  // Must use resolveAdmMacros instead
  assert.match(fnSlice, /resolveAdmMacros/, 'setAdPreview must use the shared resolveAdmMacros');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. autoPrice removed: no bid.price→bidfloor→0.00 fallback
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('onAnalyzed does not fallback simPrice to bid.price/bidfloor/0.00', () => {
  const appCode = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');
  assert.doesNotMatch(appCode, /autoPrice/, 'autoPrice variable must not exist');
  assert.doesNotMatch(
    appCode,
    /simPriceEl\.value\s*\|\|\s*\(.*formatPrice/,
    'simPrice must not fallback to formatted bid.price',
  );
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 11. Mount lifecycle: resetState exists and is called
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('mount lifecycle: resetState is called in mountInspector and cleanup', () => {
  const appCode = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');
  // resetState must be called at mount start
  assert.match(
    appCode,
    /OrtbtoolsMacros\.resetState\(\)/,
    'mountInspector must call OrtbtoolsMacros.resetState()',
  );
  // resetState must be registered in addCleanup
  const cleanupMatch = appCode.match(/ctx\.addCleanup\([\s\S]*?resetState/);
  assert.ok(cleanupMatch, 'resetState must be registered in ctx.addCleanup');
});

test('resetState clears all overrides', () => {
  const M = loadMacros({
    document: {
      getElementById: () => ({ value: '' }),
    },
  });
  M.syncPriceInputs('9.99');
  assert.equal(M.getOverrides().price, '9.99');
  M.resetState();
  const cleared = M.getOverrides();
  assert.equal(cleared.price, '');
  assert.equal(cleared.auctionId, '');
  assert.equal(cleared.lossCode, '');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. DOM integration: sync, focus, caret preservation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('DOM integration: input sync and focus preservation', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <input id="simPrice" type="text" />
    <div id="macroEvaluatorContainer"></div>
  </body></html>`);

  const win = dom.window;
  const doc = win.document;
  const M = loadMacros(win);
  const container = doc.getElementById('macroEvaluatorContainer');
  const simPrice = doc.getElementById('simPrice');

  const items = [
    {
      bidId: 'b1',
      impid: 'imp1',
      bidPrice: '1.50',
      type: 'nurl',
      typeKey: 'macros.type_nurl',
      rawUrl: 'https://dsp.example/win?p=${AUCTION_PRICE}',
      context: { bidId: 'b1', impid: 'imp1', bidPrice: '1.50', price: '' },
    },
  ];

  // 1. Initial mount
  M.renderMacroTable(container, items);
  const macroSimPrice = container.querySelector('#macroSimPrice');
  assert.ok(macroSimPrice);

  // 2. Toolbar → syncs simPrice
  macroSimPrice.value = '9.99';
  macroSimPrice.dispatchEvent(new win.Event('input'));
  assert.equal(simPrice.value, '9.99');
  assert.equal(M.getOverrides().price, '9.99');

  const tbody = container.querySelector('#macroTableBody');
  assert.match(tbody.innerHTML, /p=9\.99/);

  // 3. External sync → updates toolbar
  M.syncPriceInputs('8.88');
  M.renderMacroTable(container, items, { price: '8.88' });
  assert.equal(macroSimPrice.value, '8.88');
  assert.match(tbody.innerHTML, /p=8\.88/);

  // 4. DOM node stability (focus/caret preservation)
  const ref = container.querySelector('#macroSimPrice');
  M.renderMacroTable(container, items, { price: '7.77' });
  const after = container.querySelector('#macroSimPrice');
  assert.strictEqual(ref, after, 'Toolbar input node must not be destroyed across re-renders');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 13. CSP notice text: explicit trade-off wording
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('CSP notice text mentions Behavior findings may be incomplete (all 3 locales)', () => {
  const noticeText = (locale) => {
    const html = fs.readFileSync(
      path.join(ROOT, `public/modules/inspector/template.${locale}.html`),
      'utf8',
    );
    const parsed = new JSDOM(html);
    return parsed.window.document
      .querySelector('.preview-csp-notice')
      .textContent.replace(/\s+/g, ' ')
      .trim();
  };

  assert.match(
    noticeText('en'),
    /External resources are blocked\. Visual preview and Behavior findings may be incomplete\./,
  );
  assert.match(noticeText('uk'), /Зовнішні ресурси заблоковані\..*Behavior.*неповними\./);
  assert.match(noticeText('ru'), /Внешние ресурсы заблокированы\..*Behavior.*неполными\./);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 14. Translations: all three locales complete
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
test('i18n: all keys have en, uk, ru translations with non-empty values', () => {
  const code = fs.readFileSync(path.join(ROOT, 'public/modules/macros/i18n.js'), 'utf8');
  let registered = null;
  const fn = new Function('window', code);
  fn({
    registerI18nModule(dict) {
      registered = dict;
    },
  });

  assert.ok(registered);
  assert.equal(/** @type {any} */ (registered).id, 'macros');

  for (const [key, trans] of Object.entries(/** @type {any} */ (registered).keys)) {
    for (const loc of ['en', 'uk', 'ru']) {
      assert.ok(trans[loc], `Key "${key}" must have locale "${loc}"`);
      assert.ok(trans[loc].trim().length > 0, `Key "${key}" must not be empty for "${loc}"`);
    }
  }
});
