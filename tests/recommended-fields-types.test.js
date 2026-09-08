'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Core = require('../packages/core');
const { run, EXIT_OK, EXIT_FINDINGS } = require('../packages/cli/lib/cli');
const { startServer, postAnalyzeRaw } = require('./corpus/lib/http-run');

function request(version) {
  const context = {
    site: { domain: 'publisher.example.test' },
    device: { ua: 'Synthetic fixture agent', ip: '192.0.2.19' },
  };
  return version === '2.x'
    ? { id: 'r1', imp: [{ id: 'slot', banner: { w: 300, h: 250 } }], ...context }
    : {
        openrtb: {
          ver: '3.0',
          domainspec: 'adcom',
          domainver: '1.0',
          request: {
            id: 'r1',
            item: [{ id: 'slot', spec: { placement: { display: { w: 300, h: 250 } } } }],
            context,
          },
        },
      };
}

function context(payload) {
  return payload.openrtb ? payload.openrtb.request.context : payload;
}

function response(version, extra = {}) {
  const body = { id: 'r1', seatbid: [], ...extra };
  return version === '2.x' ? body : { openrtb: { ver: '3.0', response: body } };
}

function assertError(payload, id, findingPath) {
  const result = Core.validate(payload);
  assert.equal(result.status, 'errors', JSON.stringify(payload));
  const finding = result.findings.find((f) => f.id === id);
  assert.ok(finding, id);
  assert.equal(finding.level, 'error');
  assert.equal(finding.path, findingPath);
  return result;
}

const versions = ['2.x', '3.0'];
for (const version of versions) {
  const prefix = version === '2.x' ? 'request.' : 'request.30.context.';
  const basePath = version === '2.x' ? '' : 'openrtb.request.context.';

  test(version + ': supplied malformed objects are errors without child omission cascades', () => {
    for (const field of ['device', 'site', 'app', 'dooh']) {
      for (const value of [null, false, true, 0, 42, '', 'wrong', []]) {
        const payload = request(version);
        const ctx = context(payload);
        delete ctx.site;
        ctx[field] = value;
        const result = assertError(payload, prefix + field + '_invalid', basePath + field);
        if (field === 'device') {
          assert.deepEqual(
            result.findings.filter((f) => f.id.startsWith(prefix + 'device.')),
            [],
          );
        } else {
          assert.ok(!result.findings.some((f) => f.id === prefix + 'no_site_or_app'));
        }
      }
    }
  });

  test(
    version + ': supplied client values retain their string type even with another address',
    () => {
      for (const field of ['ua', 'ip', 'ipv6']) {
        for (const value of [null, false, 0, 42, [], {}]) {
          const payload = request(version);
          context(payload).device[field] = value;
          assertError(
            payload,
            prefix + 'device.' + field + '_invalid',
            basePath + 'device.' + field,
          );
        }
      }
    },
  );

  test(
    version + ': omissions and empty client strings preserve guidance; DOOH remains info',
    () => {
      const absent = request(version);
      delete context(absent).device;
      const missing = Core.validate(absent);
      assert.equal(missing.status, 'warnings');
      assert.deepEqual(
        missing.findings
          .filter((f) => f.id.startsWith(prefix + 'device'))
          .map((f) => [f.id, f.level]),
        [[prefix + 'device_required', 'warning']],
      );

      for (const dooh of [false, true]) {
        for (const device of [{}, { ua: '', ip: '', ipv6: '' }]) {
          const payload = request(version);
          const ctx = context(payload);
          ctx.device = device;
          if (dooh) {
            delete ctx.site;
            ctx.dooh = { id: 'screen' };
          }
          const result = Core.validate(payload);
          assert.ok(!result.findings.some((f) => f.level === 'error'));
          for (const field of ['ip', 'ua']) {
            assert.equal(
              result.findings.find((f) => f.id === prefix + 'device.' + field + '_required').level,
              dooh ? 'info' : 'warning',
            );
          }
        }
      }
      for (const field of ['device', 'site', 'app', 'dooh']) {
        const omitted = request(version);
        delete context(omitted)[field];
        const explicit = structuredClone(omitted);
        context(explicit)[field] = undefined;
        assert.deepEqual(Core.validate(explicit), Core.validate(omitted));
      }
      const undefinedFields = request(version);
      context(undefinedFields).device = { ua: undefined, ip: undefined, ipv6: undefined };
      const emptyDevice = request(version);
      context(emptyDevice).device = {};
      assert.deepEqual(
        Core.validate(undefinedFields).findings,
        Core.validate(emptyDevice).findings,
      );
      const noChannel = request(version);
      delete context(noChannel).site;
      assert.equal(Core.validate(noChannel).status, 'warnings');
      const ipv6 = request(version);
      delete context(ipv6).device.ip;
      context(ipv6).device.ipv6 = '2001:db8::19';
      const valid = Core.validate(ipv6);
      assert.ok(!valid.findings.some((f) => f.level === 'error'));
      assert.ok(!valid.findings.some((f) => f.id === prefix + 'device.ip_required'));
    },
  );

  test(
    version + ': malformed no-bid reasons are errors; omitted and integer reasons stay valid',
    () => {
      const id = version === '2.x' ? 'response.nbr_invalid' : 'response.30.nbr_invalid';
      const findingPath = version === '2.x' ? 'nbr' : 'openrtb.response.nbr';
      for (const nbr of [null, false, '', '2', {}, [], 1.5, NaN, Infinity]) {
        const payload = response(version, { nbr });
        const result = assertError(payload, id, findingPath);
        assert.ok(!result.findings.some((f) => /seatbid_empty_no_nbr$|\.no_bid$/.test(f.id)));
      }
      for (const extra of [{}, { nbr: undefined }, { nbr: 0 }, { nbr: 2 }, { nbr: 500 }]) {
        const payload = response(version, extra);
        assert.equal(Core.validate(payload).status, 'clean');
        assert.deepEqual(
          Core.crosscheck(request(version), payload).map((f) => f.id),
          ['crosscheck.id_match'],
        );
      }
      const withBids = response(version, { nbr: '2', seatbid: [{ bid: [] }] });
      assertError(withBids, id, findingPath);
      const withoutBids = response(version, { nbr: '2', seatbid: undefined });
      assertError(withoutBids, id, findingPath);
    },
  );
}

test('default CLI rejects malformed supplied values and accepts their omission controls', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-field-types-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const version of versions) {
    const badRequest = request(version);
    context(badRequest).device = false;
    const omitted = request(version);
    delete context(omitted).device;
    for (const [payload, expected] of [
      [badRequest, EXIT_FINDINGS],
      [response(version, { nbr: '2' }), EXIT_FINDINGS],
      [omitted, EXIT_OK],
      [response(version), EXIT_OK],
    ]) {
      const file = path.join(dir, 'payload.json');
      fs.writeFileSync(file, JSON.stringify(payload));
      const output = [];
      const code = run(['validate', file, '--json'], {
        out: (s) => output.push(s),
        err: (s) => assert.fail(s),
        isTTY: false,
      });
      assert.equal(code, expected);
      assert.equal(JSON.parse(output.join('\n')).status === 'errors', expected === EXIT_FINDINGS);
    }
  }
});

test('HTTP analysis exposes malformed-value errors in every locale and preserves valid no-bids', async () => {
  const server = await startServer();
  try {
    for (const version of versions) {
      const payload = request(version);
      context(payload).device = false;
      const reqId =
        version === '2.x' ? 'request.device_invalid' : 'request.30.context.device_invalid';
      const resId = version === '2.x' ? 'response.nbr_invalid' : 'response.30.nbr_invalid';
      for (const locale of ['en', 'uk', 'ru']) {
        for (const [body, id] of [
          [{ bidReq: payload }, reqId],
          [{ bidRes: response(version, { nbr: '2' }) }, resId],
        ]) {
          const result = await postAnalyzeRaw(server.url, JSON.stringify(body), { locale });
          assert.equal(result.status, 200);
          assert.equal(result.body.validation.status, 'errors');
          const finding = result.body.validation.findings.find((f) => f.id === id);
          assert.equal(finding.level, 'error');
          assert.ok(finding.msg && !finding.msg.includes('[' + id + ']'));
        }
      }
      const result = await postAnalyzeRaw(
        server.url,
        JSON.stringify({ bidRes: response(version) }),
      );
      assert.equal(result.status, 200);
      assert.equal(result.body.validation.status, 'clean');
    }
  } finally {
    await server.stop();
  }
});
