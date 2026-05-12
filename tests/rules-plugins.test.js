'use strict';

/**
 * Tests for the plugin-style validator rules added 2026-05-10.
 *
 * Two layers:
 *   1. The registry (packages/core/rules/index.js) — runs registered
 *      plugins, swallows per-plugin exceptions, respects appliesTo /
 *      applies() filters.
 *   2. The client-hints plugin — first pilot, three rules around
 *      missing UA-CH / Structured-UA fingerprint data.
 *
 * Integration test at the end: validate() in packages/core/index.js
 * actually merges plugin findings with legacy rules-request.js
 * findings (and the dedup+sort pipeline downstream doesn't lose
 * either side).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { runRulePlugins, listPlugins } = require('@kyivtech/spyglass-core/rules');
const clientHints = require('@kyivtech/spyglass-core/rules/client-hints');
const impSecure = require('@kyivtech/spyglass-core/rules/imp-secure');
const { validate } = require('@kyivtech/spyglass-core');

// ── Registry ────────────────────────────────────────────────────────────────

test('registry: listPlugins() returns metadata for each registered plugin', () => {
  const plugins = listPlugins();
  assert.ok(Array.isArray(plugins));
  assert.ok(plugins.length >= 1);
  const ch = plugins.find((p) => p.id === 'client-hints');
  assert.ok(ch, 'client-hints plugin should be registered');
  assert.ok(typeof ch.description === 'string' && ch.description.length > 0);
  assert.deepEqual(ch.appliesTo, ['ORTB_REQUEST']);
});

test('registry: runRulePlugins() respects appliesTo filter', () => {
  // client-hints is appliesTo: ['ORTB_REQUEST']; running against a
  // response-typed payload should produce zero findings from that plugin.
  const out = runRulePlugins({ device: {} }, 'ORTB_RESPONSE', {});
  assert.deepEqual(out, []);
});

test('registry: runRulePlugins() returns array even when no findings', () => {
  const out = runRulePlugins(
    { device: { ua: 'Mozilla/5.0 Chrome/100.0.0.0', sua: { platform: { brand: 'X' } } } },
    'ORTB_REQUEST',
    {},
  );
  assert.ok(Array.isArray(out));
});

// ── client-hints plugin: helper functions ──────────────────────────────────

test('client-hints: looksLikeUACHEraBrowser detects Chrome 100+', () => {
  assert.equal(clientHints._looksLikeUACHEraBrowser('Mozilla/5.0 Chrome/100.0.0.0'), true);
  assert.equal(clientHints._looksLikeUACHEraBrowser('Mozilla/5.0 Chrome/123.0.4567.89'), true);
});

test('client-hints: looksLikeUACHEraBrowser rejects pre-100 Chrome', () => {
  assert.equal(clientHints._looksLikeUACHEraBrowser('Mozilla/5.0 Chrome/89.0.4389.82'), false);
  assert.equal(clientHints._looksLikeUACHEraBrowser('Mozilla/5.0 Chrome/99.0.4844.51'), false);
});

test('client-hints: looksLikeUACHEraBrowser detects modern Edge', () => {
  assert.equal(clientHints._looksLikeUACHEraBrowser('Mozilla/5.0 Edg/120.0.2210.91'), true);
  assert.equal(clientHints._looksLikeUACHEraBrowser('Mozilla/5.0 Edg/99.0.0.0'), false);
});

test('client-hints: looksLikeUACHEraBrowser handles empty/null', () => {
  assert.equal(clientHints._looksLikeUACHEraBrowser(''), false);
  assert.equal(clientHints._looksLikeUACHEraBrowser(null), false);
  assert.equal(clientHints._looksLikeUACHEraBrowser(undefined), false);
});

test('client-hints: hasSuaPlatform checks both brand and version[]', () => {
  assert.equal(clientHints._hasSuaPlatform({ platform: { brand: 'Windows' } }), true);
  assert.equal(clientHints._hasSuaPlatform({ platform: { version: ['10', '0'] } }), true);
  assert.equal(clientHints._hasSuaPlatform({ platform: {} }), false);
  assert.equal(clientHints._hasSuaPlatform({}), false);
  assert.equal(clientHints._hasSuaPlatform(null), false);
});

// ── client-hints plugin: validate() ────────────────────────────────────────

test('client-hints: emits sua_missing on modern Chrome without sua', () => {
  const req = { device: { ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0' } };
  const findings = clientHints.validate(req);
  const ids = findings.map((f) => f.id);
  assert.ok(ids.includes('device.client_hints.sua_missing'));
});

test('client-hints: no sua_missing when sua present', () => {
  const req = {
    device: {
      ua: 'Mozilla/5.0 Chrome/120.0.0.0',
      sua: { platform: { brand: 'Windows', version: ['10'] } },
    },
  };
  const findings = clientHints.validate(req);
  const ids = findings.map((f) => f.id);
  assert.ok(!ids.includes('device.client_hints.sua_missing'));
});

test('client-hints: no sua_missing on pre-100 Chrome (UA still carries detail)', () => {
  const req = { device: { ua: 'Mozilla/5.0 Chrome/89.0.4389.82' } };
  const findings = clientHints.validate(req);
  const ids = findings.map((f) => f.id);
  assert.ok(!ids.includes('device.client_hints.sua_missing'));
});

test('client-hints: emits os_unknown when all OS sources empty', () => {
  const req = { device: { ua: 'Mozilla/5.0 Chrome/120.0.0.0' } };
  const findings = clientHints.validate(req);
  const ids = findings.map((f) => f.id);
  assert.ok(ids.includes('device.client_hints.os_unknown'));
});

test('client-hints: os_unknown suppressed when device.os set', () => {
  const req = { device: { os: 'Windows', osv: '10', ua: 'Mozilla/5.0 Chrome/120.0.0.0' } };
  const findings = clientHints.validate(req);
  const ids = findings.map((f) => f.id);
  assert.ok(!ids.includes('device.client_hints.os_unknown'));
});

test('client-hints: os_unknown suppressed when device.sua.platform set', () => {
  const req = {
    device: {
      ua: 'Mozilla/5.0 Chrome/120.0.0.0',
      sua: { platform: { brand: 'iOS', version: ['16'] } },
    },
  };
  const findings = clientHints.validate(req);
  const ids = findings.map((f) => f.id);
  assert.ok(!ids.includes('device.client_hints.os_unknown'));
});

test('client-hints: emits browser_unknown when UA + device.browser + sua.browsers all empty', () => {
  // Empty UA forces this rule to fire (otherwise the UA itself counts
  // as "browser identity reachable").
  const req = { device: { os: 'Windows' } };
  const findings = clientHints.validate(req);
  const ids = findings.map((f) => f.id);
  assert.ok(ids.includes('device.client_hints.browser_unknown'));
});

test('client-hints: browser_unknown suppressed when device.ua set', () => {
  const req = { device: { ua: 'Mozilla/5.0 Chrome/120.0.0.0', os: 'Windows' } };
  const findings = clientHints.validate(req);
  const ids = findings.map((f) => f.id);
  assert.ok(!ids.includes('device.client_hints.browser_unknown'));
});

test('client-hints: browser_unknown suppressed when sua.browsers[] populated', () => {
  const req = {
    device: {
      os: 'Windows',
      sua: { browsers: [{ brand: 'Chrome', version: ['120'] }] },
    },
  };
  const findings = clientHints.validate(req);
  const ids = findings.map((f) => f.id);
  assert.ok(!ids.includes('device.client_hints.browser_unknown'));
});

test('client-hints: severity is warning, never error', () => {
  const req = { device: { ua: 'Mozilla/5.0 Chrome/120.0.0.0' } };
  const findings = clientHints.validate(req);
  for (const f of findings) {
    assert.equal(f.level, 'warning', `${f.id} should be warning, got ${f.level}`);
  }
});

test('client-hints: returns empty array when device is missing entirely', () => {
  // The legacy rules already flag this as request.device_required (error).
  // Plugin shouldn't pile on with phantom warnings about missing sua etc.
  const findings = clientHints.validate({});
  assert.deepEqual(findings, []);
});

// ── Integration with validate() ────────────────────────────────────────────

test('integration: plugin findings flow through validate() pipeline', () => {
  // Minimal BidRequest that exercises legacy rules (missing imp[]
  // already triggers errors) AND the plugin (Chrome 120 + no sua →
  // warnings).
  const result = validate({
    id: 'integration-test',
    imp: [{ id: '1', banner: { w: 300, h: 250 } }],
    at: 2,
    site: { domain: 'example.com', page: 'https://example.com/' },
    device: { ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0', ip: '1.2.3.4' },
  });
  const ids = result.findings.map((f) => f.id);
  // Plugin findings present:
  assert.ok(
    ids.includes('device.client_hints.sua_missing'),
    'sua_missing should be in findings; got: ' + ids.join(', '),
  );
  assert.ok(ids.includes('device.client_hints.os_unknown'));
});

test('integration: plugin findings are localized in UK', () => {
  const result = validate(
    {
      id: 'loc-test',
      imp: [{ id: '1', banner: { w: 300, h: 250 } }],
      at: 2,
      site: { domain: 'example.com', page: 'https://example.com/' },
      device: { ua: 'Mozilla/5.0 Chrome/120.0.0.0', ip: '1.2.3.4', os: 'Windows', osv: '10' },
    },
    { locale: 'uk' },
  );
  const sua = result.findings.find((f) => f.id === 'device.client_hints.sua_missing');
  assert.ok(sua, 'sua_missing should appear');
  // UK message contains the Ukrainian phrase
  assert.ok(
    sua.msg.includes('відсутнє') || sua.msg.includes('Без'),
    'msg should be Ukrainian, got: ' + sua.msg,
  );
});

test('integration: disabledRules suppresses plugin findings via prefix', () => {
  const result = validate(
    {
      id: 'disabled-test',
      imp: [{ id: '1', banner: { w: 300, h: 250 } }],
      at: 2,
      site: { domain: 'example.com', page: 'https://example.com/' },
      device: { ua: 'Mozilla/5.0 Chrome/120.0.0.0', ip: '1.2.3.4' },
    },
    { disabledRules: ['device.client_hints.*'] },
  );
  const ids = result.findings.map((f) => f.id);
  for (const id of ids) {
    assert.ok(!id.startsWith('device.client_hints.'), `${id} should be suppressed`);
  }
});

// ── imp-secure plugin ──────────────────────────────────────────────────────

test('imp-secure: missing secure flag fires recommended-warning', () => {
  const out = impSecure.validate({ imp: [{ id: 's1' }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'imp.secure_recommended');
  assert.equal(out[0].level, 'info');
  assert.equal(out[0].path, 'imp[0].secure');
  assert.deepEqual(out[0].params, { num: 1 });
});

test('imp-secure: secure: 0 fires recommended-warning', () => {
  const out = impSecure.validate({ imp: [{ id: 's1', secure: 0 }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'imp.secure_recommended');
});

test('imp-secure: secure: 1 produces no finding', () => {
  const out = impSecure.validate({ imp: [{ id: 's1', secure: 1 }] });
  assert.deepEqual(out, []);
});

test('imp-secure: secure: 2 fires invalid-error', () => {
  const out = impSecure.validate({ imp: [{ id: 's1', secure: 2 }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'imp.secure_invalid');
  assert.equal(out[0].level, 'error');
});

test('imp-secure: secure as string "1" fires invalid-error', () => {
  const out = impSecure.validate({ imp: [{ id: 's1', secure: '1' }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'imp.secure_invalid');
});

test('imp-secure: missing imp array returns []', () => {
  assert.deepEqual(impSecure.validate({}), []);
  assert.deepEqual(impSecure.validate({ imp: null }), []);
  assert.deepEqual(impSecure.validate(null), []);
});

test('imp-secure: plugin is registered with correct metadata', () => {
  const meta = listPlugins().find((p) => p.id === 'imp-secure');
  assert.ok(meta, 'imp-secure plugin should appear in listPlugins()');
  assert.deepEqual(meta.appliesTo, ['ORTB_REQUEST']);
  assert.ok(meta.description && meta.description.length > 0);
});

// ── pop-request plugin ─────────────────────────────────────────────────────

const popReq = require('@kyivtech/spyglass-core/rules/pop-request');

test('pop-request: non-pop request → no findings', () => {
  const req = { imp: [{ id: '1', banner: { w: 300, h: 250 } }] };
  assert.deepEqual(popReq.validate(req), []);
});

test('pop-request: imp.ext.adtype=popunder + no fcap → fcap_missing WARN', () => {
  const req = {
    imp: [{ id: '1', ext: { adtype: 'popunder' }, banner: { w: 100, h: 100, btype: [4] } }],
  };
  const out = popReq.validate(req);
  const f = out.find((x) => x.id === 'imp.pop.fcap_missing');
  assert.ok(f, 'fcap_missing should fire');
  assert.equal(f.level, 'warning');
  assert.equal(f.path, 'imp[0].ext');
  assert.equal(f.params.num, 1);
});

test('pop-request: imp.ext.fcap present → fcap_missing NOT fired', () => {
  const req = {
    imp: [
      { id: '1', ext: { adtype: 'popunder', fcap: 3 }, banner: { w: 100, h: 100, btype: [4] } },
    ],
  };
  const ids = popReq.validate(req).map((f) => f.id);
  assert.ok(!ids.includes('imp.pop.fcap_missing'));
});

test('pop-request: clickunder + banner without btype:[4] → btype_popup_recommended INFO', () => {
  const req = {
    imp: [{ id: '1', ext: { adtype: 'clickunder', fcap: 1 }, banner: { w: 300, h: 250 } }],
  };
  const f = popReq.validate(req).find((x) => x.id === 'imp.pop.btype_popup_recommended');
  assert.ok(f);
  assert.equal(f.level, 'info');
  assert.equal(f.path, 'imp[0].banner.btype');
});

test('pop-request: pop + secure:1 → secure_may_block_landing INFO', () => {
  const req = {
    imp: [{ id: '1', ext: { popunder: 1, fcap: 5 }, secure: 1, banner: { btype: [4] } }],
  };
  const f = popReq.validate(req).find((x) => x.id === 'imp.pop.secure_may_block_landing');
  assert.ok(f);
  assert.equal(f.level, 'info');
});

test('pop-request: flag-key shape (imp.ext.popunder=true) is recognised', () => {
  const req = { imp: [{ id: '1', ext: { popunder: true }, banner: { btype: [4] } }] };
  assert.ok(popReq._requestHasPopHint(req));
});

test('pop-request: request-level ext also recognised', () => {
  const req = { ext: { adtype: 'popunder' }, imp: [{ id: '1' }] };
  assert.ok(popReq._requestHasPopHint(req));
});

test('pop-request: plugin metadata registered', () => {
  const meta = listPlugins().find((p) => p.id === 'pop-request');
  assert.ok(meta);
  assert.deepEqual(meta.appliesTo, ['ORTB_REQUEST']);
});

// ── pop-response plugin ────────────────────────────────────────────────────

const popResp = require('@kyivtech/spyglass-core/rules/pop-response');

test('pop-response: non-pop response → no findings', () => {
  const res = { seatbid: [{ bid: [{ impid: '1', price: 1, adm: '<img src=x>' }] }] };
  assert.deepEqual(popResp.validate(res), []);
});

test('pop-response: pop bid with window.open adm → no finding (valid pop)', () => {
  const res = {
    seatbid: [
      {
        bid: [
          {
            impid: '1',
            price: 1,
            ext: { adtype: 'popunder' },
            adm: '<script>window.open("http://x.com")</script>',
          },
        ],
      },
    ],
  };
  const out = popResp.validate(res);
  assert.deepEqual(
    out.filter((f) => f.id === 'bid.pop.adm_not_redirect'),
    [],
  );
});

test('pop-response: pop bid with bare URL adm → no finding (valid pop)', () => {
  const res = {
    seatbid: [
      { bid: [{ impid: '1', price: 1, ext: { adtype: 'popunder' }, adm: 'http://x.com/landing' }] },
    ],
  };
  assert.deepEqual(
    popResp.validate(res).filter((f) => f.id === 'bid.pop.adm_not_redirect'),
    [],
  );
});

test('pop-response: pop bid with banner-HTML adm → adm_not_redirect ERROR', () => {
  const res = {
    seatbid: [
      {
        bid: [
          {
            impid: '1',
            price: 1,
            ext: { adtype: 'popunder' },
            adm: '<img src=banner.png>',
          },
        ],
      },
    ],
  };
  const f = popResp.validate(res).find((x) => x.id === 'bid.pop.adm_not_redirect');
  assert.ok(f);
  assert.equal(f.level, 'error');
  assert.equal(f.path, 'seatbid[0].bid[0].adm');
  assert.equal(f.params.sNum, 1);
  assert.equal(f.params.bNum, 1);
});

test('pop-response: mixed seatbid — only the pop-tagged bid is flagged', () => {
  const res = {
    seatbid: [
      {
        bid: [
          { impid: '1', price: 1, adm: '<img src=clean.png>' }, // banner — no pop hint
          { impid: '2', price: 2, ext: { adtype: 'popunder' }, adm: '<img src=wrong.png>' }, // pop with wrong shape
        ],
      },
    ],
  };
  const flags = popResp.validate(res).filter((f) => f.id === 'bid.pop.adm_not_redirect');
  assert.equal(flags.length, 1);
  assert.equal(flags[0].params.bNum, 2);
});

test('pop-response: plugin metadata registered', () => {
  const meta = listPlugins().find((p) => p.id === 'pop-response');
  assert.ok(meta);
  assert.deepEqual(meta.appliesTo, ['ORTB_RESPONSE']);
});
