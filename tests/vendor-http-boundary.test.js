'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, postAnalyzeRaw } = require('./corpus/lib/http-run');

/** @returns {Record<string, any>} */
const exadsRequest = () => ({
  id: 'synthetic-http-request',
  ip: '192.0.2.29',
  language: 'en',
  type: 'push_notification',
  ua: 'Synthetic HTTP fixture',
  url: 'https://publisher.example.test/article',
  user_id: 'synthetic-user',
  export: 'json',
});
/** @returns {{bid: Record<string, any>}} */
const exadsResponse = () => ({
  bid: {
    id: 'synthetic-http-request',
    value: 0.0125,
    btype: 2,
    iconUrl: 'https://assets.example.test/icon.png',
    clickUrl: 'https://advertiser.example.test/landing',
    nUrl: 'https://notice.example.test/win',
    title: 'An original HTTP notice',
  },
});

/** @param {any} body @param {string} id @param {string} path */
function find(body, id, path) {
  return body.validation.findings.find((f) => f.id === id && f.path === path);
}

test(
  'vendor HTTP boundary uses real analysis routing and preserves scoped verdicts',
  { timeout: 60000 },
  async (t) => {
    const server = await startServer();
    /** @param {any} bidReq @param {any} bidRes @param {string} [locale] */
    const analyze = async (bidReq, bidRes, locale = 'en') => {
      const result = await postAnalyzeRaw(server.url, JSON.stringify({ bidReq, bidRes }), {
        locale,
      });
      assert.equal(result.status, 200, result.transportError || result.text);
      assert.equal(result.body?.success, true);
      assert.ok(Array.isArray(result.body.validation?.findings));
      assert.ok(Array.isArray(result.body.crosscheck));
      return result.body;
    };
    try {
      await t.test(
        'EXADS bypass requires two recognized carriers, not merely one vendor side',
        async () => {
          for (const btype of [1, 2]) {
            const response = exadsResponse();
            response.bid.btype = btype;
            const body = await analyze(exadsRequest(), response);
            assert.equal(body.validation.type, 'EXADS RTB Request');
            assert.equal(body.validation.status, 'clean');
            assert.deepEqual(body.crosscheck, []);
          }
          const unknownRequest = await analyze({ id: 'unrelated-object' }, exadsResponse());
          assert.ok(
            unknownRequest.crosscheck.some(
              (f) => f.id === 'crosscheck.no_request' && f.level === 'crit',
            ),
          );
          assert.ok(unknownRequest.validation.findings.some((f) => f.level === 'error'));
          const unknownResponse = await analyze(exadsRequest(), { bid: null });
          assert.ok(unknownResponse.crosscheck.some((f) => f.level === 'crit'));
          assert.ok(unknownResponse.validation.findings.some((f) => f.level === 'error'));
          const iabResponse = await analyze(exadsRequest(), {
            id: 'synthetic-http-request',
            seatbid: [],
          });
          assert.ok(
            iabResponse.crosscheck.some(
              (f) => f.id === 'crosscheck.no_request' && f.level === 'crit',
            ),
          );
        },
      );

      await t.test(
        'EXADS recognition retains malformed supplied values and omission errors over HTTP',
        async () => {
          const request = exadsRequest();
          request.ip = null;
          delete request.user_id;
          const response = exadsResponse();
          response.bid.value = '0.0125';
          response.bid.btype = '2';
          response.bid.iconUrl = null;
          const body = await analyze(request, response);
          assert.equal(body.validation.status, 'errors');
          assert.deepEqual(body.crosscheck, []);
          for (const [id, path] of [
            ['request.exads.field_invalid', 'ip'],
            ['request.exads.field_required', 'user_id'],
            ['feed.exads.value_invalid', 'bid.value'],
            ['feed.exads.btype_invalid', 'bid.btype'],
            ['feed.exads.field_invalid', 'bid.iconUrl'],
          ]) {
            assert.equal(find(body, id, path)?.level, 'error', `${id}@${path}`);
          }
          assert.equal(find(body, 'request.exads.field_required', 'ip'), undefined);
          assert.equal(find(body, 'request.exads.field_invalid', 'user_id'), undefined);
          assert.equal(
            find(body, 'request.exads.field_invalid', 'ip').location.primary.side,
            'request',
          );
          assert.equal(
            find(body, 'feed.exads.value_invalid', 'bid.value').location.primary.side,
            'response',
          );
        },
      );

      await t.test(
        'malformed own IAB markers retain baseline errors and prevent the EXADS bypass',
        async () => {
          for (const marker of ['imp', 'seatbid', 'openrtb']) {
            for (const side of ['request', 'response']) {
              const request = exadsRequest();
              const response = exadsResponse();
              if (side === 'request') request[marker] = null;
              else response[marker] = null;
              const body = await analyze(request, response);
              assert.equal(body.validation.status, 'errors', `${side}.${marker}`);
              assert.ok(
                body.validation.findings.some(
                  (f) =>
                    f.level === 'error' &&
                    f.msg.startsWith('[response] ') === (side === 'response'),
                ),
                `${side}.${marker}`,
              );
              assert.ok(
                body.crosscheck.some((f) => f.level === 'crit'),
                `${side}.${marker}`,
              );
            }
          }
        },
      );

      await t.test(
        'Adon3 HTTP inspection keeps provisional warnings and string-only decimal semantics',
        async () => {
          const request =
            'https://feed.example.test/v1/feed/synthetic-key?ip=192.0.2.29&ua=Synthetic';
          const response = (price) => ({
            rid: 'synthetic-http-request',
            cur: 'USD',
            ads: [
              {
                url: 'https://advertiser.example.test/landing',
                price,
                imp_url: 'https://notice.example.test/win',
                pop_type: 'under',
              },
            ],
          });
          // Values beyond Number's precision/range must remain valid decimal text.
          // The endpoint does not echo raw payloads; acceptance of these strings
          // and rejection of numeric counterparts exercise the transport contract.
          for (const price of ['0.0038250', '9007199254740993.0001', `${'9'.repeat(400)}.000010`]) {
            for (const locale of ['en', 'uk', 'ru']) {
              const body = await analyze(request, response(price), locale);
              assert.equal(body.validation.status, 'warnings');
              assert.deepEqual(body.crosscheck, []);
              for (const id of [
                'request.url.provisional_contract',
                'feed.adon3.provisional_contract',
              ]) {
                const f = find(body, id, '');
                assert.equal(f?.level, 'warning', locale);
                assert.ok(f.specRef);
                assert.ok(f.msg && !f.msg.includes(`[${id}]`));
              }
              assert.equal(find(body, 'feed.adon3.price_invalid', 'ads[0].price'), undefined);
            }
          }
          for (const price of [0.003825, null, '0.03oops']) {
            const body = await analyze(request, response(price));
            assert.equal(body.validation.status, 'errors');
            assert.equal(find(body, 'feed.adon3.price_invalid', 'ads[0].price')?.level, 'error');
            assert.equal(find(body, 'feed.adon3.provisional_contract', '')?.level, 'warning');
            assert.equal(find(body, 'request.url.provisional_contract', '')?.level, 'warning');
          }
        },
      );
    } finally {
      await server.stop();
    }
  },
);
