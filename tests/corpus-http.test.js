'use strict';

/**
 * Verification corpus — real HTTP API layer.
 *
 * One isolated server process serves every case through POST /api/analyze.
 * Both sides are sent exactly as a client would send them (raw text for the
 * unparseable cases), and the JSON envelope is judged by the same expectations
 * as the Core layer, restricted to what the HTTP contract exposes: when both
 * sides are present the API returns one merged validation object, so
 * per-side type/status/version assertions are replaced by finding-level
 * assertions plus the documented `[response] ` prefix split.
 *
 * Run everything:  node --test tests/corpus-http.test.js
 * One case:        CORPUS_CASE=<id> node --test tests/corpus-http.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCorpus } = require('./corpus/lib/load');
const { startServer, runHttp, evaluateHttp } = require('./corpus/lib/http-run');
const { recordResult, gapFor, deviationVerdict } = require('./corpus/lib/report');

const corpus = loadCorpus();

/**
 * @param {string} url
 * @param {any} c
 */
async function judge(url, c) {
  const actual = await runHttp(url, c);
  return { ...evaluateHttp(actual, c), actual };
}

test(
  `corpus http: ${corpus.all.length} case(s)`,
  { timeout: Math.max(60000, 2000 * corpus.all.length) },
  async (t) => {
    assert.ok(corpus.all.length > 0, 'HTTP corpus is empty or the filter matched no case');
    const server = await startServer();
    try {
      for (const c of corpus.all) {
        const gap = gapFor(c, 'http');
        const label = `${c.kind} ${c.id} — ${c.meta.title}`;
        if (!gap) {
          await t.test(`http: ${label}`, async () => {
            const { failures, actual } = await judge(server.url, c);
            recordResult('http', c, {
              pass: failures.length === 0,
              failures,
              gap: null,
              measured: { httpStatus: actual?.http.status, success: actual?.http.body?.success },
            });
            assert.deepEqual(failures, [], `${c.file}\n${failures.join('\n')}`);
          });
          continue;
        }
        const { failures, actual } = await judge(server.url, c);
        const verdict = deviationVerdict(failures, gap);
        recordResult('http', c, {
          pass: failures.length === 0,
          failures,
          gap: gap.id,
          measured: { httpStatus: actual?.http.status, success: actual?.http.body?.success },
        });
        await t.test(
          `http: ${label} [known gap ${gap.id}]`,
          { todo: `${gap.id}: ${gap.note}` },
          () => {
            assert.deepEqual(failures, [], failures.join('\n'));
          },
        );
        await t.test(`http: ${label} — deviation ${gap.id} is still the recorded one`, () => {
          assert.ok(
            failures.length > 0,
            `${c.file}: the HTTP layer now satisfies the spec expectation — retire ${gap.id} for this case`,
          );
          assert.deepEqual(
            verdict.unexpected,
            [],
            `${c.file}: failures outside the recorded ${gap.id} signature:\n${verdict.unexpected.join('\n')}`,
          );
          assert.ok(verdict.stillPresent, `${c.file}: ${verdict.reason}`);
        });
      }
    } finally {
      await server.stop();
    }
  },
);
