'use strict';

// puppeteer-core runs through the shared driver. Keeping this marker also lets
// the existing browser-test runner discover this file for serial execution.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCorpus } = require('./corpus/lib/load');
const { startServer } = require('./corpus/lib/http-run');
const { evaluate, evaluatePreview, matches } = require('./corpus/lib/oracle');
const { recordResult, gapFor, deviationVerdict } = require('./corpus/lib/report');
const B = require('./corpus/lib/browser');

const corpus = loadCorpus();
const browserApplies = (c) => c.kind === 'pair' || c.meta.expect?.browser || c.meta.expect?.preview;
const browserCases = corpus.all.filter(browserApplies);
const skipReason = B.browserSkipReason || '';
const requireBrowser = process.env.CORPUS_REQUIRE_BROWSER === '1';

for (const c of corpus.mutations.filter((candidate) => !browserApplies(candidate))) {
  assert.deepEqual(
    Object.keys(c.meta.expect),
    ['http'],
    `${c.id}: an unasserted browser layer needs explicit expectations; only a transport-envelope probe is HTTP-only`,
  );
  assert.equal(
    gapFor(c, 'browser'),
    null,
    `${c.id}: unexecuted browser mutation cannot claim a gap`,
  );
  recordResult('browser', c, {
    outcome: 'not-applicable',
    reason:
      'HTTP-only transport-envelope size probe; the server body cap is asserted before Core parsing, independently of the Inspector input path.',
  });
}
if (skipReason && !requireBrowser) {
  for (const c of browserCases) recordResult('browser', c, { outcome: 'skip', reason: skipReason });
}

function findingSide(f) {
  return (
    f.side ||
    f.location?.primary?.side ||
    (String(f.msg || '').startsWith('[response] ') ? 'response' : 'request')
  );
}
function rollup(findings) {
  return findings.some((f) => f.level === 'error')
    ? 'errors'
    : findings.some((f) => f.level === 'warning')
      ? 'warnings'
      : 'clean';
}

function inputFor(c, side) {
  const raw = c[side === 'request' ? 'rawRequest' : 'rawResponse'];
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return side === 'request' && /^https?:\/\//.test(raw) ? raw : undefined;
    }
  }
  return c[side];
}

/** Judge actual UI completion and observable findings, never an invented success. */
function judgeAnalysis(measured, c) {
  const failures = [];
  const e = c.meta.expect || {};
  const expectedState = e.browser?.state || 'success';
  if (measured.state !== expectedState)
    failures.push(`browser.state: expected ${expectedState}, got ${measured.state}`);
  if (
    e.browser?.toastMatch &&
    !measured.analysis.toasts.some((t) => new RegExp(e.browser.toastMatch, 'i').test(t))
  )
    failures.push(`browser.toast: expected /${e.browser.toastMatch}/`);
  if (
    e.browser?.verdict &&
    (measured.analysis.verdict?.hidden || measured.analysis.verdict?.verdict !== e.browser.verdict)
  )
    failures.push(
      `browser.verdict: expected ${e.browser.verdict}, got ${measured.analysis.verdict?.verdict || 'none'}`,
    );
  if (measured.state !== 'success') {
    if (measured.analysis.last)
      failures.push('browser.stale: previous analysis remains after failed analysis');
    if (measured.analysis.verdict && !measured.analysis.verdict.hidden)
      failures.push('browser.stale: verdict remains after failed analysis');
    return failures;
  }
  const transport = measured.transport;
  if (transport.requests.length !== 1)
    failures.push(`browser.transport: expected one Analyze POST, got ${transport.requests.length}`);
  if (
    transport.responses.length !== 1 ||
    transport.responses[0]?.status !== 200 ||
    transport.responses[0]?.body?.success !== true
  )
    failures.push('browser.transport: successful real Analyze response missing');
  const last = measured.analysis.last;
  if (!last?.validation) {
    failures.push('browser.analysis: current result missing');
    return failures;
  }
  const sent = transport.requests[0];
  const requestInput = inputFor(c, 'request');
  const responseInput = inputFor(c, 'response');
  if (sent) {
    for (const [rawKey, bodyKey] of [
      ['rawRequest', 'bidReqRaw'],
      ['rawResponse', 'bidResRaw'],
    ]) {
      if (typeof c[rawKey] === 'string' && sent.body[bodyKey] !== c[rawKey])
        failures.push(`browser.transport: ${bodyKey} differs from original bytes`);
    }
    if (
      JSON.stringify(sent.body.bidReq) !==
      JSON.stringify(requestInput === undefined ? {} : requestInput)
    )
      failures.push('browser.transport: request differs from case');
    if (
      JSON.stringify(sent.body.bidRes) !==
      JSON.stringify(responseInput === undefined ? {} : responseInput)
    )
      failures.push('browser.transport: response differs from case');
    if (new URL(sent.url).searchParams.get('dialect') !== c.meta.dialect)
      failures.push(`browser.transport: wrong dialect, expected ${c.meta.dialect}`);
  }
  if (
    JSON.stringify(last.request) !==
      JSON.stringify(requestInput === undefined ? {} : requestInput) ||
    JSON.stringify(last.response) !==
      JSON.stringify(responseInput === undefined ? {} : responseInput)
  )
    failures.push('browser.stale: displayed analysis belongs to different input');
  const findings = last.validation.findings || [];
  const actual = { crosscheck: last.crosscheck, format: last.format };
  const expected = { crosscheck: e.crosscheck, format: e.format, consistency: e.consistency };
  for (const side of ['request', 'response']) {
    if (!e[side]) continue;
    const sideFindings = findings
      .filter((f) => findingSide(f) === side)
      .map((f) => ({ ...f, side }));
    actual[side] = { findings: sideFindings, status: rollup(sideFindings) };
    expected[side] = { ...e[side] };
    // The API exposes type/version for its primary side only. Secondary
    // metadata remains covered by the independent Core/HTTP layer; record
    // that boundary instead of fabricating it from the submitted payload.
    const primary = side === (requestInput === undefined ? 'response' : 'request');
    if (primary) {
      actual[side].type = last.type;
      actual[side].version = last.version;
    } else {
      delete expected[side].type;
      delete expected[side].version;
    }
    const rows = measured.analysis.findings.filter((f) => (f.side || 'request') === side);
    for (const f of sideFindings) {
      const n = rows.filter(
        (r) => r.id === f.id && r.path === f.path && r.level === f.level,
      ).length;
      if (!n) failures.push(`browser.row: missing ${side} ${f.id}@${f.path}[${f.level}]`);
    }
    for (const ref of e[side].mustNot || [])
      if (matches(rows, ref).length)
        failures.push(`browser.row: forbidden ${side} ${typeof ref === 'string' ? ref : ref.id}`);
    for (const prefix of e[side].mustNotPrefix || [])
      if (rows.some((f) => f.id.startsWith(prefix)))
        failures.push(`browser.row: forbidden ${side} prefix ${prefix}`);
  }
  failures.push(...evaluate(actual, expected).failures.map((f) => `browser.${f}`));
  const crossRows = measured.analysis.crossRows;
  const crossFindings = last.crosscheck || [];
  if (crossRows.length !== crossFindings.length)
    failures.push(
      `browser.crossRows: expected ${crossFindings.length} displayed rows, got ${crossRows.length}`,
    );
  for (const [index, finding] of crossFindings.entries()) {
    const row = crossRows[index];
    const levelClass = finding.level === 'crit' ? 'crit' : finding.level === 'warn' ? 'warn' : 'ok';
    if (
      !row ||
      !row.visible ||
      !row.cls.split(/\s+/).includes(levelClass) ||
      row.path !== (finding.path || '') ||
      !row.text.includes(
        String(finding.msg || '')
          .replace(/\s+/g, ' ')
          .trim(),
      )
    )
      failures.push(
        `browser.crossRow: missing or mismatched visible ${finding.id}@${finding.path || ''}[${finding.level}]`,
      );
  }
  if (!measured.analysis.verdict || measured.analysis.verdict.hidden)
    failures.push('browser.verdict: successful analysis has no visible verdict');
  return failures;
}

/** Original indices are preserved. Missing selection is measured, never faked by reordering. */
function bidsFor(c) {
  if (c.response === undefined) return [];
  const envelope = c.response?.openrtb?.response || c.response;
  const seats = envelope?.seatbid;
  if (!Array.isArray(seats)) {
    const materials = Array.isArray(envelope) ? envelope : envelope?.ads;
    if (Array.isArray(materials))
      return materials.map((material, bidIndex) => ({
        seatIndex: 0,
        bidIndex,
        id: material?.id || `material-${bidIndex}`,
        collection: 'material',
        marker: material?.title || material?.url || material?.link || '',
      }));
    return [{ seatIndex: 0, bidIndex: 0, id: 'feed-or-single' }];
  }
  return seats.flatMap((seat, seatIndex) =>
    (Array.isArray(seat?.bid) ? seat.bid : []).map((bid, bidIndex) => ({
      seatIndex,
      bidIndex,
      id: bid?.id || '',
      impid: bid?.impid ?? bid?.item ?? null,
    })),
  );
}

async function measureBids(page, c, failures) {
  const expected = c.meta.expect?.preview;
  if (c.response === undefined || !expected || expected.kind === 'n/a') return [];
  const bids = bidsFor(c);
  const observations = [];
  if (!bids.length) bids.push({ seatIndex: 0, bidIndex: 0, id: 'no-bid' });
  for (const [index, bid] of bids.entries()) {
    const override = (expected.bids || []).find(
      (p) => p.seatIndex === bid.seatIndex && p.bidIndex === bid.bidIndex,
    );
    const expectation = { ...expected, ...(bid.marker ? { marker: bid.marker } : {}), ...override };
    delete expectation.bids;
    if (index > 0) {
      const selector = `[data-action="select-creative-bid"][data-seat-index="${bid.seatIndex}"][data-bid-index="${bid.bidIndex}"]`;
      const control = await page.$(selector);
      if (!control) {
        const reason =
          bid.collection === 'material'
            ? `browser.selection: unavailable material[${bid.bidIndex}]`
            : `browser.selection: unavailable seat[${bid.seatIndex}].bid[${bid.bidIndex}]`;
        failures.push(reason);
        observations.push({
          ...bid,
          outcome: 'not-applicable',
          reason,
          expectedMarker: expectation.marker || null,
        });
        continue;
      }
      await control.click();
    }
    await B.openTab(page, 'tCreative');
    const revealed = await B.reveal(page);
    const preview = await B.measurePreview(page);
    const before = failures.length;
    if (revealed.offered && !revealed.revealed)
      failures.push(
        `browser.bid[${bid.seatIndex},${bid.bidIndex}].reveal: offered control failed to reveal creative`,
      );
    failures.push(
      ...evaluatePreview(preview, expectation).failures.map(
        (f) => `browser.bid[${bid.seatIndex},${bid.bidIndex}].${f}`,
      ),
    );
    const response = inputFor(c, 'response');
    const adm = (response?.openrtb?.response || response)?.seatbid?.[bid.seatIndex]?.bid?.[
      bid.bidIndex
    ]?.adm;
    const blankBody =
      typeof adm === 'string' &&
      adm.length > 0 &&
      adm.trim() === '' &&
      expectation.kind === 'unidentified' &&
      expectation.rendered === 'inert-text' &&
      expectation.marker == null;
    let identityNote = null;
    if (
      expectation.rendered === 'empty' &&
      (expectation.marker === undefined || expectation.marker === null)
    ) {
      // A declared empty render has no on-screen identity by definition; the
      // `rendered: empty` expectation is the assertion and is judged above.
      identityNote = 'no on-screen identity (empty render declared)';
    } else if (blankBody) {
      // This deliberately blank creative cannot carry a marker. Assert its
      // exact inert body and absence of rendered assets instead of skipping identity.
      if (
        preview.outer.inertText !== adm ||
        preview.outer.hasIframe ||
        preview.assets.imgTotal !== 0 ||
        preview.assets.mediaTotal !== 0
      )
        failures.push(
          `browser.bid[${bid.seatIndex},${bid.bidIndex}].identity: blank input must remain exact inert whitespace without rendered assets`,
        );
      identityNote = 'intentionally blank input; exact inert body and absence of assets asserted';
    } else if (typeof expectation.marker !== 'string' || !expectation.marker)
      failures.push(
        `browser.bid[${bid.seatIndex},${bid.bidIndex}].identity: expected marker missing`,
      );
    else if (!preview.markerText.includes(expectation.marker))
      failures.push(
        `browser.bid[${bid.seatIndex},${bid.bidIndex}].identity: expected marker ${JSON.stringify(expectation.marker)} absent`,
      );
    if (preview.outer.hasIframe && preview.outer.sandbox !== 'allow-scripts')
      failures.push(
        `browser.bid[${bid.seatIndex},${bid.bidIndex}].sandbox: expected allow-scripts`,
      );
    if (!preview.tab?.visible)
      failures.push(
        `browser.bid[${bid.seatIndex},${bid.bidIndex}].tab: creative panel not visible`,
      );
    const screenshot = await B.screenshot(
      page,
      `case-${c.id}-seat-${bid.seatIndex}-bid-${bid.bidIndex}`,
      { selector: '.workbench' },
    );
    observations.push({
      ...bid,
      outcome: failures.length === before ? 'pass' : 'fail',
      kind: preview.kind,
      rendered: preview.rendered,
      mediaPlays: preview.mediaPlays,
      mediaReady: preview.inner?.mediaReady || 0,
      mediaProgressed: preview.inner?.mediaProgressed || 0,
      assets: preview.assets,
      expectedMarker: expectation.marker || null,
      identityNote,
      markerPresent: !!expectation.marker && preview.markerText.includes(expectation.marker),
      limitationShown: preview.limitationShown,
      label: preview.outer.label,
      blocked: preview.outer.blockedText,
      revealed: revealed.revealed,
      screenshot,
    });
  }
  return observations;
}

test(
  `corpus browser: ${browserCases.length} case(s)`,
  {
    skip: !requireBrowser && (skipReason || false),
    timeout: Math.max(120000, browserCases.length * 25000),
  },
  async (t) => {
    if (skipReason) {
      for (const c of browserCases)
        recordResult('browser', c, {
          pass: false,
          failures: [skipReason],
          gap: null,
          outcome: 'skip',
          reason: skipReason,
        });
      assert.fail(skipReason);
    }
    assert.ok(browserCases.length, 'browser corpus is empty');
    const server = await startServer();
    let browser;
    try {
      browser = await B.launchBrowser();
      const version = await B.browserVersion(browser);
      t.diagnostic(`browser: ${version}; chrome: ${B.chromeExecutable}`);
      for (const c of browserCases) {
        await t.test(`${c.kind} ${c.id}`, async () => {
          // Independent fixtures start from a fresh document. Cross-analysis
          // state transitions have explicit, reproducible UX scenarios.
          const { page, pageErrors, consoleErrors } = await B.openInspector(browser, server.url);
          const errorStart = pageErrors.length;
          const consoleStart = consoleErrors.length;
          const gap = gapFor(c, 'browser');
          const failures = [];
          /** @type {any} */
          let measured = {};
          try {
            await B.setPayload(page, c);
            const state = await B.analyze(page);
            if (state === 'success') await B.openTab(page, 'tCross');
            const analysis = await B.measureAnalysis(page);
            let transport = B.measureTransport(page);
            failures.push(...judgeAnalysis({ state, analysis, transport }, c));
            const previews = state === 'success' ? await measureBids(page, c, failures) : [];
            transport = B.measureTransport(page);
            const refusalKinds = c.meta.expect?.browser?.sandboxRefusals || [];
            const declaredRefusal = (text) => B.classifySandboxRefusal(text, refusalKinds) !== null;
            // A case may declare console/page errors the sandbox is expected to
            // raise (popup or navigation refusals); they are recorded as
            // observations, never counted as failures or hidden elsewhere.
            const sandboxRefusals = [];
            for (const e of pageErrors.slice(errorStart)) {
              if (declaredRefusal(String(e))) sandboxRefusals.push(`pageerror: ${e}`);
              else failures.push(`browser.pageerror: ${e}`);
            }
            failures.push(...transport.requestErrors.map((e) => `browser.transport-error: ${e}`));
            // CSP denials are separately evidenced by the preview refusal ledger.
            // Other console errors must remain visible failures, not blanket ignored.
            const console = consoleErrors.slice(consoleStart);
            const expectedParseFailure =
              c.meta.expect?.browser?.state === 'failed' &&
              (c.meta.expect?.request?.parse === 'invalid-json' ||
                c.meta.expect?.response?.parse === 'invalid-json');
            // Inspector has a deliberate object-root preflight. Derive its
            // exact message from the rejected input; never admit a runtime
            // TypeError or an arbitrary console message as an expected failure.
            let expectedRootError = '';
            if (c.meta.expect?.browser?.state === 'failed' && !expectedParseFailure) {
              for (const side of ['request', 'response']) {
                const value = inputFor(c, side);
                const root = Array.isArray(value)
                  ? 'array'
                  : value === null
                    ? 'null'
                    : typeof value;
                if (
                  value !== undefined &&
                  (root === 'null' ||
                    (root !== 'object' && root !== 'array') ||
                    (side === 'request' && root === 'array'))
                ) {
                  expectedRootError = `Analysis error: Error: The bid ${side} pane must hold a JSON object — got ${root}`;
                  break;
                }
              }
            }
            if (
              expectedParseFailure &&
              (transport.requests.length !== 0 ||
                analysis.toasts.length === 0 ||
                !console.some((e) => /^Analysis error: SyntaxError: .+$/.test(e.text)))
            )
              failures.push(
                'browser.parse: expected explained JSON SyntaxError before any Analyze POST',
              );
            if (
              expectedRootError &&
              (state !== 'failed' ||
                transport.requests.length !== 0 ||
                !analysis.toasts.some((message) =>
                  message.includes(expectedRootError.replace('Analysis error: Error: ', '')),
                ) ||
                !console.some((e) => e.text === expectedRootError))
            )
              failures.push(
                'browser.root: expected exact explained object-root rejection before any Analyze POST',
              );
            const unexpectedConsole = console.filter(
              (e) =>
                !(
                  state === 'failed' &&
                  expectedParseFailure &&
                  /^Analysis error: SyntaxError: .+$/.test(e.text)
                ) &&
                !(state === 'failed' && expectedRootError && e.text === expectedRootError) &&
                !(
                  e.url &&
                  new URL(e.url).pathname === '/api/v1/fx-rates' &&
                  e.text ===
                    'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
                ) &&
                !/violates (?:the following |the )?Content Security Policy|Refused to .*Content Security Policy|Executing inline .* violates|Loading (?:the image|the script|the stylesheet|the frame|the media).*violates|Framing .* violates/i.test(
                  e.text,
                ),
            );
            for (const e of unexpectedConsole) {
              if (declaredRefusal(e.text)) sandboxRefusals.push(`console: ${e.text}`);
              else failures.push(`browser.console: ${e.text}`);
            }
            measured = {
              state,
              version,
              sandboxRefusals,
              verdict: analysis.verdict,
              type: analysis.last?.type,
              status: analysis.last?.status,
              findings: analysis.findings.length,
              crossRows: analysis.crossRows.length,
              preview: previews[0] || null,
              bids: previews,
              expectedBidCount: bidsFor(c).length,
              selectedBidCount: previews.filter((p) => p.outcome !== 'not-applicable').length,
              analysisPostCount: transport.requests.length,
              analysisHttpStatus: transport.responses[0]?.status || null,
              secondaryTypeVersion:
                c.request !== undefined && c.response !== undefined
                  ? 'not exposed by combined UI API; covered independently'
                  : null,
              consoleErrors: console,
              controlledDependencies: console.some((e) => e.url.includes('/api/v1/fx-rates'))
                ? [
                    'FX_DISABLED=1: live exchange-rate dependency intentionally unavailable; 503 recorded',
                  ]
                : [],
              blockedNetwork: transport.blockedNetwork.map((r) => r.type),
              fixtureAssetCount: transport.fixtureAssetCount,
              servedAssetCount: transport.servedAssets.length,
              servedAssetIds: transport.servedAssets.map((asset) => asset.id),
              toasts: analysis.toasts,
            };
          } catch (error) {
            failures.push(`browser.exception: ${error.message || String(error)}`);
            measured.screenshot = await B.screenshot(page, `failure-${c.id}`, { fullPage: true });
          } finally {
            await page.close();
          }
          const deviation = gap ? deviationVerdict(failures, gap) : null;
          const acceptedGap = !!deviation?.stillPresent;
          recordResult('browser', c, {
            pass: failures.length === 0,
            failures,
            gap: gap?.id || null,
            reason: gap ? deviation.reason : null,
            measured,
          });
          if (gap) {
            // This assertion is deliberately outside TODO: new failures or a fixed
            // defect invalidate the old allowance and fail the suite.
            assert.ok(acceptedGap, `${c.file}: ${deviation.reason}\n${failures.join('\n')}`);
          } else assert.deepEqual(failures, [], `${c.file}\n${failures.join('\n')}`);
        });
      }
    } finally {
      if (browser) await browser.close();
      await server.stop();
    }
  },
);
