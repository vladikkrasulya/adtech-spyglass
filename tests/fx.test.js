'use strict';

/**
 * tests/fx.test.js — the USD rate table behind the Inspector's floor conversion.
 *
 * What matters here is not that the arithmetic works — it is division — but
 * that the module never produces a number it cannot stand behind:
 *
 *   1. A malformed or partial provider response never replaces a good table.
 *   2. A failed refresh keeps the last good table and reports it as stale
 *      rather than dropping the conversion or silently aging.
 *   3. No table at all means no conversion, never an invented rate.
 *   4. FX_DISABLED actually stops the outbound call, rather than only
 *      stopping the scheduler that also makes it.
 *   5. Nothing about a payload is an input — the fetch takes no amount and no
 *      currency, which is what keeps docs/PRIVACY.md's "not forwarded to any
 *      third party" true for analysed payloads.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A data dir per run so the disk cache never leaks between tests.
process.env.ORTBTOOLS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-fx-'));
delete process.env.FX_DISABLED;

const fx = require('../lib/fx');

/** A provider response with enough currencies to be considered real. */
function goodPayload(over) {
  const rates = { USD: 1, RUB: 83.274165, EUR: 0.867144, UAH: 44.706745, JPY: 159.393562 };
  // Pad past the 100-currency floor with synthetic but well-formed codes.
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let a = 0; a < 26 && Object.keys(rates).length < 130; a++) {
    for (let b = 0; b < 26 && Object.keys(rates).length < 130; b++) {
      const code = 'Q' + A[a] + A[b];
      if (!rates[code]) rates[code] = 1 + a + b / 100;
    }
  }
  return {
    result: 'success',
    base_code: 'USD',
    time_last_update_utc: 'Fri, 14 Aug 2026 00:02:32 +0000',
    rates,
    ...over,
  };
}

function fetchReturning(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok,
      status,
      json: async () => payload,
    };
  };
  impl.calls = calls;
  return impl;
}

test('a good response becomes the cached table', async () => {
  fx._reset();
  const fetchImpl = fetchReturning(goodPayload());
  const table = await fx.refresh({ fetchImpl, now: () => 1_000_000 });

  assert.ok(table, 'refresh returned a table');
  assert.equal(table.base, 'USD');
  assert.equal(table.rates.RUB, 83.274165);
  assert.equal(table.providerUpdatedAt, 'Fri, 14 Aug 2026 00:02:32 +0000');
  assert.equal(table.fetchedAt, 1_000_000);

  const got = fx.getRates({ now: () => 1_000_000 });
  assert.equal(got.rates.RUB, 83.274165);
  assert.equal(got.stale, false);
});

test('the request carries no payload-derived input', async () => {
  fx._reset();
  const fetchImpl = fetchReturning(goodPayload());
  await fx.refresh({ fetchImpl });

  assert.equal(fetchImpl.calls.length, 1);
  const { url, opts } = fetchImpl.calls[0];
  // The whole table, for everyone, with no amount and no currency in it.
  assert.equal(url, fx.PROVIDER_URL);
  assert.match(url, /latest\/USD$/);
  assert.ok(!/amount|from=|to=|\?/.test(url), 'URL carries no query at all');
  assert.equal(opts.body, undefined, 'no request body');
  assert.equal(opts.method, undefined, 'a plain GET');
});

test('a malformed response does not replace a good table', async () => {
  fx._reset();
  await fx.refresh({ fetchImpl: fetchReturning(goodPayload()), now: () => 1_000 });

  const bad = [
    goodPayload({ result: 'error' }),
    goodPayload({ base_code: 'EUR' }),
    goodPayload({ rates: { USD: 1, RUB: 83 } }), // too few to be the real table
    goodPayload({ rates: { RUB: 83 } }), // USD itself missing
    goodPayload({ rates: null }),
    null,
  ];
  for (const payload of bad) {
    const after = await fx.refresh({ fetchImpl: fetchReturning(payload), now: () => 2_000 });
    assert.equal(after.rates.RUB, 83.274165, 'kept the previous good table');
    assert.equal(after.fetchedAt, 1_000, 'and did not restamp it as fresh');
  }
});

test('a table whose USD is not 1 is rejected', async () => {
  fx._reset();
  const skewed = goodPayload();
  skewed.rates.USD = 1.02;
  const table = await fx.refresh({ fetchImpl: fetchReturning(skewed) });
  assert.equal(table, null, 'no table rather than one that misprices every currency');
});

test('non-numeric and non-positive rates are dropped, not converted', async () => {
  fx._reset();
  const payload = goodPayload();
  payload.rates.AAA = 'not a number';
  payload.rates.BBB = 0;
  payload.rates.CCC = -5;
  payload.rates.DDD = Infinity;
  const table = await fx.refresh({ fetchImpl: fetchReturning(payload) });

  for (const code of ['AAA', 'BBB', 'CCC', 'DDD']) {
    assert.equal(table.rates[code], undefined, `${code} dropped`);
  }
  assert.equal(table.rates.RUB, 83.274165, 'the good ones survive');
});

test('an HTTP error keeps the last good table', async () => {
  fx._reset();
  await fx.refresh({ fetchImpl: fetchReturning(goodPayload()), now: () => 5_000 });
  const after = await fx.refresh({
    fetchImpl: fetchReturning(null, { ok: false, status: 503 }),
    now: () => 6_000,
  });
  assert.equal(after.rates.RUB, 83.274165);
  assert.equal(after.fetchedAt, 5_000, 'still stamped with when it was actually fetched');
});

test('a thrown fetch keeps the last good table', async () => {
  fx._reset();
  await fx.refresh({ fetchImpl: fetchReturning(goodPayload()), now: () => 5_000 });
  const after = await fx.refresh({
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
    now: () => 6_000,
  });
  assert.equal(after.rates.RUB, 83.274165);
});

test('an old table is served but flagged stale', async () => {
  fx._reset();
  await fx.refresh({ fetchImpl: fetchReturning(goodPayload()), now: () => 0 });

  const fresh = fx.getRates({ now: () => fx.STALE_AFTER_MS - 1 });
  assert.equal(fresh.stale, false);

  const old = fx.getRates({ now: () => fx.STALE_AFTER_MS + 1 });
  assert.equal(old.stale, true, 'age is reported, not hidden');
  assert.equal(old.rates.RUB, 83.274165, 'and the rates are still there to show');
});

test('no table means no rates — never a fallback rate', async () => {
  fx._reset();
  // Point at an empty data dir so no disk cache can be picked up.
  const prev = process.env.ORTBTOOLS_DATA_DIR;
  process.env.ORTBTOOLS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-fx-empty-'));
  try {
    delete require.cache[require.resolve('../lib/fx')];
    const isolated = require('../lib/fx');
    isolated._reset();
    assert.equal(isolated.getRates(), null);
  } finally {
    process.env.ORTBTOOLS_DATA_DIR = prev;
    delete require.cache[require.resolve('../lib/fx')];
  }
});

test('FX_DISABLED stops the outbound call itself', async () => {
  // A clean data dir, so no cache from an earlier test can answer for the
  // network and hide a fetch that should never have happened.
  const prev = process.env.ORTBTOOLS_DATA_DIR;
  process.env.ORTBTOOLS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-fx-off-'));
  process.env.FX_DISABLED = '1';
  delete require.cache[require.resolve('../lib/fx')];
  const isolated = require('../lib/fx');
  try {
    isolated._reset();
    let realFetchCalls = 0;
    const globalFetch = global.fetch;
    global.fetch = /** @type {any} */ (
      async () => {
        realFetchCalls++;
        throw new Error('should not be called');
      }
    );
    try {
      // ensureRates() is the on-demand path the route uses; with the flag set
      // it must not reach the network at all.
      const table = await isolated.ensureRates();
      assert.equal(realFetchCalls, 0, 'the provider was never contacted');
      assert.equal(table, null, 'and no table was conjured from anywhere else');
    } finally {
      global.fetch = globalFetch;
    }
  } finally {
    delete process.env.FX_DISABLED;
    process.env.ORTBTOOLS_DATA_DIR = prev;
    delete require.cache[require.resolve('../lib/fx')];
  }
});

test('the table survives a restart through the disk cache', async () => {
  fx._reset();
  await fx.refresh({ fetchImpl: fetchReturning(goodPayload()), now: () => 7_000 });

  // Simulate a process restart: drop the in-memory table, keep the data dir.
  fx._reset();
  const recovered = fx.getRates({ now: () => 7_000 });
  assert.ok(recovered, 'read back from disk');
  assert.equal(recovered.rates.RUB, 83.274165);
  assert.equal(recovered.fetchedAt, 7_000, 'with its original age, not a fresh stamp');
});

test('concurrent ensureRates callers share one fetch', async () => {
  fx._reset();
  const prev = process.env.ORTBTOOLS_DATA_DIR;
  process.env.ORTBTOOLS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ortbtools-fx-conc-'));
  delete require.cache[require.resolve('../lib/fx')];
  const isolated = require('../lib/fx');
  try {
    isolated._reset();
    let calls = 0;
    const globalFetch = global.fetch;
    global.fetch = /** @type {any} */ (
      async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true, status: 200, json: async () => goodPayload() };
      }
    );
    try {
      await Promise.all([isolated.ensureRates(), isolated.ensureRates(), isolated.ensureRates()]);
      assert.equal(calls, 1, 'one fetch, not three');
    } finally {
      global.fetch = globalFetch;
    }
  } finally {
    process.env.ORTBTOOLS_DATA_DIR = prev;
    delete require.cache[require.resolve('../lib/fx')];
  }
});
