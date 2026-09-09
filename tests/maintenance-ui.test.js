'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');

function realm() {
  const dom = new JSDOM(
    '<div id="modalRoot"></div><div id="toastContainer" role="status" aria-live="polite"></div>',
    {
      url: 'https://ortbtools.test/inspector',
      runScripts: 'outside-only',
    },
  );
  const notices = [];
  dom.window.t = (key, params) => key + (params ? JSON.stringify(params) : '');
  dom.window.__utils = {
    $: (id) => dom.window.document.getElementById(id),
    escapeHtml: String,
    t: dom.window.t,
    toast: (msg, type) => notices.push({ msg, type }),
  };
  return { dom, w: dom.window, notices };
}

test('analysis authority invalidates first-flight, rejects stale finally and survives remount independently', async () => {
  const file = '../public/modules/inspector/analysis-run.js';
  const { createAnalysisRun } = await import(file);
  const mount = new AbortController();
  const transitions = [];
  const runs = createAnalysisRun(mount.signal, (state) => transitions.push(state));
  const bytes = { req: '{"id":1,"id":2}', res: '' };
  const first = runs.start(bytes);
  bytes.req = 'changed';
  assert.equal(first.snapshot.req, '{"id":1,"id":2}');
  runs.invalidate();
  assert.equal(first.signal.aborted, true);
  assert.equal(runs.isCurrent(first), false);
  const next = runs.start({ req: 'B' });
  assert.equal(runs.finish(first), false);
  assert.equal(runs.state, 'pending');
  assert.equal(runs.isCurrent(next), true);
  mount.abort();
  assert.equal(next.signal.aborted, true);
  assert.equal(runs.finish(next), false);
  const second = createAnalysisRun(new AbortController().signal);
  const fresh = second.start({ req: 'C' });
  assert.equal(second.finish(fresh), true);
  assert.equal(second.state, 'success');
  assert.equal(runs.start({ req: 'unmounted' }), null);
  assert.ok(transitions.includes('pending'));
});

test('partner mutations reject malformed success and visibly disclose unavailable counts before generic confirmation', async () => {
  const { dom, w, notices } = realm();
  try {
    w.eval(
      source('modules/partners/index.js')
        .replace(
          /import .*?from '\/core\/utils.js';/,
          'const { $, escapeHtml, toast, t } = window.__utils;',
        )
        .replace(/export /g, ''),
    );
    w.document.getElementById('modalRoot').innerHTML =
      '<div id="pList">unchanged</div><input id="pName" value="Sample">';
    let refreshes = 0;
    w.refreshPartners = async () => {
      refreshes += 1;
    };
    w.getPartners = () => [];
    const malformed = [
      null,
      [],
      false,
      {},
      { partner: {} },
      { success: true },
      { success: true, partner: [] },
      { success: true, partner: {} },
      { success: true, partner: { id: -1, name: 'bad' } },
    ];
    for (const response of malformed) {
      w.fetch = async () => ({ ok: true, status: 200, json: async () => response });
      await w.confirmAddPartner();
      assert.equal(notices.at(-1).type, 'error');
      assert.equal(w.document.getElementById('pName').value, 'Sample');
      assert.equal(w.document.getElementById('pList').textContent, 'unchanged');
    }
    assert.equal(refreshes, 0);
    w.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, partner: { id: 1, name: 'Sample' } }),
    });
    await w.confirmAddPartner();
    assert.equal(notices.at(-1).type, 'success');
    assert.equal(refreshes, 1);
    const invalidCounts = [
      'malformed-json',
      null,
      {},
      [],
      { success: false },
      ...[null, -1, 1.5, '3'].map((count) => ({ success: true, count })),
    ];
    for (const response of invalidCounts) {
      let message;
      let deleteCalls = 0;
      const noticeStart = notices.length;
      w.confirm = (text) => {
        message = text;
        assert.deepEqual(
          notices.slice(noticeStart),
          [{ msg: 'toast.partner_count_failed', type: 'error' }],
          'the unavailable count is disclosed before confirmation',
        );
        return false;
      };
      w.fetch = async (_url, init) => {
        if (init.method === 'DELETE') deleteCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => {
            if (response === 'malformed-json') throw new SyntaxError('synthetic malformed JSON');
            return response;
          },
        };
      };
      await w.deletePartner(1);
      assert.equal(message, 'toast.partner_count_failed\n\nconfirm.delete_partner');
      assert.equal(deleteCalls, 0);
      assert.equal(
        notices.slice(noticeStart).some((notice) => notice.type === 'success'),
        false,
      );
    }
    w.confirm = () => true;
    const verifiedNotices = notices.length;
    w.fetch = async (_url, init) => ({
      ok: true,
      status: 200,
      json: async () => (init.method === 'GET' ? { success: true, count: 2 } : {}),
    });
    await w.deletePartner(1);
    assert.equal(notices.length, verifiedNotices + 1);
    assert.equal(
      notices.at(-1).type,
      'error',
      'malformed DELETE does not claim success even after a valid count',
    );
    assert.equal(refreshes, 1);
  } finally {
    dom.window.close();
  }
});

test('failed server logout still wipes local user and persisted DEK, with no success announcement', async () => {
  const { dom, w, notices } = realm();
  try {
    w.eval(
      source('core/session.js')
        .replace("import { toast, t } from './utils.js';", 'const { toast, t } = window.__utils;')
        .replace('export const session =', 'window.testSession =')
        .replace('export function installSessionFacade', 'function installSessionFacade'),
    );
    const session = w.testSession;
    session.setUser({ id: 1 });
    w.sessionStorage.setItem('kt-dek-v1', 'synthetic-key');
    w.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ success: false, code: 'logout_persistence_failed', error: 'safe' }),
    });
    await session.signOut();
    assert.equal(session.user, null);
    assert.equal(session.hasSession(), false);
    assert.equal(w.sessionStorage.getItem('kt-dek-v1'), null);
    assert.deepEqual(notices, [{ msg: 'toast.logout_failed', type: 'error' }]);
  } finally {
    dom.window.close();
  }
});

test('temporary dialect findings retain explicit request/response origin without cosmetic prefixes', async () => {
  const { dom, w } = realm();
  try {
    w.eval(source('modules/intel/index.js'));
    w.OrtbtoolsIntelStorage = {
      getTempDialect: async () => ({
        id: 'temp:synthetic',
        name: 'Synthetic',
        fields: [
          { path: 'req.site.id', required: true },
          { path: 'res.cur', expectedType: 'number' },
        ],
      }),
    };
    w.OrtbtoolsIntel.activate('temp:synthetic');
    const validation = await w.OrtbtoolsIntel.applyToFindings(
      { req: {}, res: { cur: 'EUR' } },
      { status: 'clean', findings: [] },
    );
    const findings = validation.findings;
    assert.equal(findings.length, 2);
    assert.equal(findings[0].origin.side, 'request');
    assert.equal(findings[1].origin.side, 'response');
    assert.equal(
      findings.some((finding) => /^\[(request|response)\]/.test(finding.msg)),
      false,
    );
  } finally {
    dom.window.close();
  }
});
