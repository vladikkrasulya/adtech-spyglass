'use strict';

/**
 * tests/site-stream.test.js — the /live feed must not lie about what it shows.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four defects, all of them the stream module trusting the SSE socket as if
 * every frame it ever delivers were a new, live event:
 *
 *   1. The server replays the last STREAM_REPLAY_MAX (50) envelopes on EVERY
 *      (re)connection, and EventSource reconnects on its own after any network
 *      hiccup. addRow() appended all of them unconditionally, so one flaky
 *      connection turned 53 real payloads into 100 rows with 47 duplicate
 *      groups and a TIME column that ran backwards.
 *
 *   2. The server answers 429 once an IP holds 8 concurrent streams (shared
 *      NAT, or the user's own tabs). Per the EventSource spec a non-200 is
 *      TERMINAL: the connection closes and never retries. The page then sat
 *      forever saying "connection lost" over "waiting for the first payload…"
 *      — two contradictory sentences, neither of which named the real reason,
 *      with no way back short of F5.
 *
 *   3. The rate counters measured arrivals by RECEIPT time, so the 50-frame
 *      replay burst read as 50 payloads in 0.7s ("streaming · 50/min" before
 *      the page had been open a second, up to 231/min after a reconnect, for a
 *      generator running at a fixed 60/min).
 *
 *   4. Replayed frames rendered identically to live ones. The generator is
 *      demand-gated but the buffer is not, so a fresh viewer can be handed
 *      envelopes emitted minutes — on production, hours — earlier, printed as
 *      a bare HH:MM:SS with no date and no marker.
 *
 * WHAT IS ASSERTED
 * ----------------
 * The module is mounted in jsdom against a fake EventSource, which is what
 * makes "the server replayed frames we already have" expressible at all: the
 * test hands the same envelopes to the page twice, exactly as a reconnect
 * does, and asserts on the rendered table rather than on any internal counter.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { createBrowserEsmLoader } = require('./browser-esm-loader');

const ROOT = path.join(__dirname, '..');
const STREAM_DIR = path.join(ROOT, 'public', 'modules', 'stream');
const TEMPLATE = fs.readFileSync(path.join(STREAM_DIR, 'template.html'), 'utf8');

const ES_CONNECTING = 0;
const ES_OPEN = 1;
const ES_CLOSED = 2;

/**
 * The module resolves its template against `import.meta.url`. Under the ESM
 * loader every module is a data: URL, and a data: URL is an opaque base that
 * `new URL('./template.html', …)` refuses to resolve — so the one line that
 * cannot survive the harness is rewritten to the path it resolves to in the
 * browser. The replacement asserts it matched: if the template lookup is ever
 * rewritten, this test fails loudly instead of silently testing nothing.
 */
function pinTemplateHref(source) {
  const needle = "new URL('./template.html', import.meta.url).href";
  if (!source.includes(needle)) {
    throw new Error('site-stream: template href lookup changed — update pinTemplateHref()');
  }
  return source.replace(needle, "'/modules/stream/template.html'");
}

/** Minimal EventSource stand-in with the two states that matter. */
class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.readyState = ES_CONNECTING;
    this.closed = false;
    this._listeners = new Map();
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, fn, opts) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    if (opts && opts.signal) {
      opts.signal.addEventListener('abort', () => this._listeners.get(type).delete(fn), {
        once: true,
      });
    }
  }

  removeEventListener(type, fn) {
    const set = this._listeners.get(type);
    if (set) set.delete(fn);
  }

  close() {
    this.closed = true;
    this.readyState = ES_CLOSED;
  }

  _dispatch(type, event) {
    for (const fn of [...(this._listeners.get(type) || [])]) fn(event);
  }

  // ── test-side drivers ───────────────────────────────────────────────
  open() {
    this.readyState = ES_OPEN;
    this._dispatch('open', { type: 'open' });
  }

  deliver(envelope) {
    this._dispatch('message', { type: 'message', data: JSON.stringify(envelope) });
  }

  /** What a network blip looks like: EventSource retries on its own. */
  blip() {
    this.readyState = ES_CONNECTING;
    this._dispatch('error', { type: 'error' });
  }

  /** What a 429 looks like: terminal, the browser never retries. */
  refuse() {
    this.readyState = ES_CLOSED;
    this._dispatch('error', { type: 'error' });
  }
}
FakeEventSource.instances = [];
FakeEventSource.CONNECTING = ES_CONNECTING;
FakeEventSource.OPEN = ES_OPEN;
FakeEventSource.CLOSED = ES_CLOSED;

function installGlobals(values) {
  const originals = new Map();
  for (const [name, value] of Object.entries(values)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/**
 * @param {{ realmSalt: string, streamStatus?: number }} options
 */
async function mountStream(options) {
  const { realmSalt, streamStatus = 200 } = options;
  FakeEventSource.instances = [];

  const dom = new JSDOM('<!doctype html><html lang="uk"><body><main id="app-root"></main></body>', {
    url: 'https://ortbtools.test/uk/live',
  });
  const { window } = dom;
  const root = window.document.getElementById('app-root');

  const fetchCalls = [];
  const fakeFetch = async (url, init) => {
    const href = String(url);
    fetchCalls.push({ href, init });
    if (href.includes('/modules/stream/template.html')) {
      return { ok: true, status: 200, text: async () => TEMPLATE };
    }
    if (href.startsWith('/api/v1/stream')) {
      return {
        ok: streamStatus === 200,
        status: streamStatus,
        body: null,
        json: async () => ({ success: false, code: 'too_many_streams' }),
        text: async () => '',
      };
    }
    if (href.startsWith('/api/v1/replay')) {
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    }
    throw new Error('unexpected fetch: ' + href);
  };

  const restore = installGlobals({
    window,
    document: window.document,
    EventSource: FakeEventSource,
    fetch: fakeFetch,
    Node: window.Node,
    Element: window.Element,
    MutationObserver: window.MutationObserver,
  });

  const loader = createBrowserEsmLoader({
    realmSalt,
    transforms: { '/modules/stream/index.js': pinTemplateHref },
  });

  const controller = new window.AbortController();
  const cleanups = [];
  const busListeners = new Map();
  const ctx = {
    // Key-echoing translator: the assertions below are about WHICH string the
    // page reaches for, not about its wording, so a copy edit cannot break
    // them and a wrong key cannot pass them.
    t: (key, vars) => (vars ? key + ' ' + JSON.stringify(vars) : key),
    escapeHtml: (s) => String(s),
    emit: () => {},
    on(name, fn) {
      if (!busListeners.has(name)) busListeners.set(name, new Set());
      busListeners.get(name).add(fn);
      return () => busListeners.get(name).delete(fn);
    },
    off: () => {},
    lang: 'uk',
    theme: 'light',
    signal: controller.signal,
    addCleanup: (fn) => cleanups.push(fn),
  };

  const mod = await loader.import('/modules/stream/index.js');
  await mod.default.mount(root, ctx);

  const q = (sel) => root.querySelector(sel);
  return {
    ctx,
    fetchCalls,
    root,
    stateText: () => q('#streamStateText').textContent,
    state: () => q('#streamState').dataset.state,
    windowText: () => q('#streamWindow').textContent,
    emptyText: () => q('#streamEmpty').textContent,
    emptyHidden: () => q('#streamEmpty').hidden,
    rowEls: () => [...root.querySelectorAll('.stream-row')],
    timeCells: () => [...root.querySelectorAll('.stream-cell--time')].map((c) => c.textContent),
    sockets: () => FakeEventSource.instances,
    latest: () => FakeEventSource.instances[FakeEventSource.instances.length - 1],
    reconnectBtn: () => q('#streamReconnect'),
    close() {
      controller.abort();
      for (const fn of cleanups.reverse()) {
        try {
          fn();
        } catch {
          /* teardown is best-effort */
        }
      }
      restore();
      window.close();
    },
  };
}

/** A generator envelope, shaped exactly like the server's. */
function envelope(n, emittedAt) {
  return {
    source: 'synthetic-banner-request.json',
    hash: 'hash' + String(n).padStart(4, '0'),
    emittedAt,
    specimen: {
      id: 'syn-' + n,
      imp: [{ id: '1', banner: { w: 300, h: 250 } }],
      site: { domain: 'example.test' },
    },
  };
}

test('3.0 auction sides render correctly and rows use the localized Inspector handoff', async () => {
  const h = await mountStream({ realmSalt: 'stream-ortb30-handoff' });
  const socket = h.latest();
  let closed = false;
  try {
    const navigations = [];
    h.root.ownerDocument.defaultView.OrtbtoolsShell = {
      navigateTo: (target) => navigations.push(target),
    };
    socket.open();
    socket.deliver({
      source: 'openrtb30-request.json',
      hash: 'abcdef123456',
      emittedAt: Date.now() - 1,
      specimen: { openrtb: { ver: '3.0', request: { id: 'req-3', item: [] } } },
    });
    socket.deliver({
      source: 'openrtb30-response.json',
      hash: '123456abcdef',
      emittedAt: Date.now(),
      specimen: { openrtb: { ver: '3.0', response: { id: 'res-3', seatbid: [] } } },
    });

    const rows = h.rowEls();
    assert.deepEqual(
      rows.map((row) => row.querySelector('.stream-cell--kind').textContent),
      ['res', 'req'],
      'wrapped responses and requests keep their auction side',
    );
    rows[0].click();
    assert.deepEqual(navigations, ['/uk/r/123456abcdef']);

    h.close();
    closed = true;
    assert.equal(socket.closed, true, 'leaving the stream releases its one EventSource');
  } finally {
    if (!closed) h.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  1. Reconnect replay must not duplicate rows
// ═══════════════════════════════════════════════════════════════════════

test('a reconnect replay does not re-render envelopes the table already shows', async () => {
  const h = await mountStream({ realmSalt: 'stream-dedup' });
  try {
    const now = Date.now();
    const first = h.latest();
    first.open();
    // Live session: five payloads, one per second.
    for (let i = 1; i <= 5; i++) first.deliver(envelope(i, now - (5 - i) * 1000));
    assert.equal(h.rowEls().length, 5, 'five live payloads, five rows');

    // The socket drops and EventSource reconnects by itself; the server
    // replays its whole buffer — the five we have plus two we missed.
    first.blip();
    for (let i = 1; i <= 7; i++) first.deliver(envelope(i, now - (5 - i) * 1000));

    const rows = h.rowEls();
    assert.equal(rows.length, 7, 'only the two unseen payloads are new rows');

    // The TIME column must still run newest-first. This is the symptom a
    // reader actually sees when the replay lands unfiltered.
    const times = h.timeCells();
    assert.deepEqual([...times].sort().reverse(), times, 'TIME column stays monotonic');
  } finally {
    h.close();
  }
});

test('a frame with no hash still dedupes on source + emittedAt + specimen id', async () => {
  const h = await mountStream({ realmSalt: 'stream-dedup-nohash' });
  try {
    const now = Date.now();
    const es = h.latest();
    es.open();
    const bare = envelope(1, now);
    delete bare.hash;
    es.deliver(bare);
    es.deliver(bare);
    assert.equal(h.rowEls().length, 1);
  } finally {
    h.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  2. A terminal close (429) must not be the end of the page
// ═══════════════════════════════════════════════════════════════════════

test('a terminal EventSource close reconnects on its own and says why', async (t) => {
  const h = await mountStream({ realmSalt: 'stream-capped', streamStatus: 429 });
  try {
    const first = h.latest();
    first.refuse();
    await flush();
    await flush();

    assert.equal(h.state(), 'offline', 'the pill goes offline');
    assert.match(
      h.stateText(),
      /stream\.state\.capped/,
      'and names the connection cap, not a generic "connection lost"',
    );
    assert.equal(
      h.emptyText(),
      'stream.empty.capped',
      'the empty state explains the cap instead of claiming it is still waiting for a payload',
    );
    assert.notEqual(
      h.emptyText(),
      'stream.empty',
      'never "waiting for the first payload…" under "connection lost"',
    );

    const btn = h.reconnectBtn();
    assert.ok(btn, 'a manual reconnect control exists');
    assert.equal(btn.hidden, false, 'and is offered while the stream is down');

    // Manual retry opens a new socket immediately.
    btn.dispatchEvent(new h.root.ownerDocument.defaultView.Event('click'));
    assert.equal(h.sockets().length, 2, 'the button opens a fresh EventSource');
    assert.equal(first.closed, true, 'and the dead one is closed');

    // The automatic backoff also fires without any user action.
    await t.test('automatic retry', async () => {
      const second = h.sockets()[1];
      second.refuse();
      await new Promise((resolve) => setTimeout(resolve, 2600));
      assert.ok(h.sockets().length >= 3, 'the module retries on its own after the backoff');
    });
  } finally {
    h.close();
  }
});

test('a network blip is left to EventSource, which retries by itself', async () => {
  const h = await mountStream({ realmSalt: 'stream-blip' });
  try {
    const es = h.latest();
    es.open();
    es.blip();
    await flush();
    assert.equal(h.sockets().length, 1, 'no second socket while the browser is already retrying');
    assert.equal(h.reconnectBtn().hidden, true, 'and no panic button for a self-healing hiccup');
  } finally {
    h.close();
  }
});

test('an offline empty table says the stream is down, not that it is waiting', async () => {
  const h = await mountStream({ realmSalt: 'stream-empty-offline' });
  try {
    assert.equal(h.emptyText(), 'stream.empty', 'while connecting: waiting for the first payload');
    h.latest().refuse();
    await flush();
    await flush();
    assert.equal(h.emptyText(), 'stream.empty.offline');
  } finally {
    h.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  3. The rate counters must measure emission, not delivery
// ═══════════════════════════════════════════════════════════════════════

test('a replay burst is counted at the cadence it was emitted, not the cadence it arrived', async () => {
  const h = await mountStream({ realmSalt: 'stream-rate' });
  try {
    const now = Date.now();
    const es = h.latest();
    es.open();
    // 70 payloads emitted one per second over the last 70 seconds, all
    // delivered in the same millisecond — a replay buffer, i.e. the normal
    // first frame of this page.
    for (let i = 0; i < 70; i++) es.deliver(envelope(i, now - (70 - i) * 1000));

    const rate = Number(/"rate":(\d+)/.exec(h.stateText())[1]);
    assert.ok(rate <= 60, `rate must stay inside one minute of emissions, got ${rate}`);
    assert.ok(rate >= 55, `the last minute of emissions must still be counted, got ${rate}`);

    // The hour counter counts payloads, and a replayed payload is not a
    // second payload.
    assert.match(h.windowText(), /"count":70/);
    es.blip();
    for (let i = 0; i < 70; i++) es.deliver(envelope(i, now - (70 - i) * 1000));
    assert.match(h.windowText(), /"count":70/, 'the replay does not double the hour counter');
  } finally {
    h.close();
  }
});

test('payloads emitted over an hour ago fall out of the hour counter', async () => {
  const h = await mountStream({ realmSalt: 'stream-rate-window' });
  try {
    const now = Date.now();
    const es = h.latest();
    es.open();
    es.deliver(envelope(1, now - 2 * 60 * 60 * 1000));
    es.deliver(envelope(2, now - 1000));
    assert.match(h.windowText(), /"count":1/);
    assert.equal(h.rowEls().length, 2, 'the stale payload is still a row, just not a fresh one');
  } finally {
    h.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  4. A replayed payload must not read as a live one
// ═══════════════════════════════════════════════════════════════════════

test('a payload from the replay buffer is marked as replayed', async () => {
  const h = await mountStream({ realmSalt: 'stream-replay-mark' });
  try {
    const now = Date.now();
    const es = h.latest();
    es.open();
    es.deliver(envelope(1, now - 400 * 1000)); // 6.7 minutes old
    es.deliver(envelope(2, now - 500)); // live

    const [live, replayed] = h.rowEls(); // newest first
    assert.equal(replayed.dataset.replay, '1', 'the buffered payload is flagged');
    assert.ok(!live.dataset.replay, 'the live payload is not');
    assert.match(
      replayed.querySelector('.stream-cell--time').title,
      /stream\.row\.replay/,
      'and its TIME cell says so in words, not only in CSS',
    );
  } finally {
    h.close();
  }
});

test('a payload from another day carries its date, not a bare clock reading', async () => {
  const h = await mountStream({ realmSalt: 'stream-replay-date' });
  try {
    const now = Date.now();
    const es = h.latest();
    es.open();
    es.deliver(envelope(1, now - 26 * 60 * 60 * 1000));
    es.deliver(envelope(2, now - 500));

    const [live, old] = h.timeCells();
    assert.match(old, /^\d{2}\.\d{2} \d{2}:\d{2}:\d{2}$/, 'yesterday reads as DD.MM HH:MM:SS');
    assert.match(live, /^\d{2}:\d{2}:\d{2}$/, "today's rows stay a bare clock reading");
  } finally {
    h.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  Translations for every key the module can now reach for
// ═══════════════════════════════════════════════════════════════════════

test('every new stream string exists in all three locales', () => {
  const source = fs.readFileSync(path.join(STREAM_DIR, 'i18n.js'), 'utf8');
  const index = fs.readFileSync(path.join(STREAM_DIR, 'index.js'), 'utf8');

  const used = new Set();
  for (const m of index.matchAll(/\bt\(\s*'(stream\.[a-z0-9._]+)'/gu)) {
    if (!m[1].endsWith('.')) used.add(m[1]);
  }
  // Keys assembled at the call site from a variable suffix.
  for (const m of index.matchAll(/\bt\(\s*'(stream\.[a-z0-9._]+\.)'\s*\+/gu)) {
    for (const key of ['connecting', 'streaming', 'offline', 'paused', 'capped']) {
      if (m[1] === 'stream.state.') used.add(m[1] + key);
    }
    for (const key of ['pending', 'unknown']) {
      if (m[1] === 'stream.findings.') used.add(m[1] + key);
    }
  }

  const missing = [];
  for (const key of used) {
    // Anchor the closing brace to the start of a line: the values themselves
    // contain `{count}`, so a naive [^}]* stops inside the interpolation.
    const block = new RegExp(
      "'" + key.replace(/\./gu, '\\.') + "':\\s*\\{[\\s\\S]*?\\n\\s*\\},",
      'u',
    ).exec(source);
    if (!block) {
      missing.push(key + ' (absent)');
      continue;
    }
    for (const locale of ['uk', 'en', 'ru']) {
      if (!new RegExp('\\b' + locale + ':', 'u').test(block[0])) missing.push(key + ' → ' + locale);
    }
  }
  assert.deepEqual(missing, [], 'untranslated stream keys');
});
