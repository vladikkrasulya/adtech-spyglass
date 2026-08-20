/* ============================================================
   public/modules/stream/index.js — Stream module (ES module).

   Renders the live RTB observability feed as ONE full-width table:
   TIME / KIND / SOURCE / FORMAT / SIZE / FINDINGS, under a title
   band (status pill + Pause) and a filter row. Clicking a row opens
   that payload in the Inspector — the stream names what arrived,
   the Inspector is where a payload is read.

   Two cleanup channels, both used on purpose so the patterns stay
   visible to future modules:

     1. ctx.signal  — passed to addEventListener({ signal }) and
                      fetch({ signal }); the registry's AbortController
                      fires it on unmount so listeners detach on their own.
     2. ctx.addCleanup(fn) — for things with no AbortSignal support:
                      EventSource.close(), setInterval, the .stream-view
                      class, the kt:lang-change unsubscribe. Runs LIFO.

   Grading (the FINDINGS column) is the one piece of this page that
   talks to the server per payload, and it is batched deliberately.
   Every specimen the generator emits is a mutated clone of a corpus
   fixture — the only thing that varies between two emissions of the
   same fixture is the request id — so findings are a property of
   `envelope.source`, not of the individual payload. We therefore grade
   each SOURCE once, via one POST /api/v1/replay carrying up to 100
   samples, and reuse the answer for every later row from that fixture.
   With a ~28-fixture corpus that is a handful of calls per mount and
   then nothing, instead of one /api/analyze round trip per second
   (which would spend the whole 60/min/IP analyze budget on a page
   nobody is reading closely).
   ============================================================ */
'use strict';

import { specimenPath } from '/core/routes.js';
import { classifyAuctionPayload } from '/core/auction-shape.js';

/** Rows kept in the DOM. Older ones fall off the bottom. */
const MAX_ROWS = 100;
/** Window the "N in the last hour" counter reports on. */
const ROLLING_WINDOW_MS = 60 * 60 * 1000;
/** Window the status pill's per-minute rate is measured over. */
const RATE_WINDOW_MS = 60 * 1000;
/**
 * Frame keys remembered for de-duplication. The server replays its whole
 * buffer (STREAM_REPLAY_MAX = 50) on EVERY connection, and EventSource
 * reconnects by itself after any hiccup, so without this a flaky link turns
 * one payload into as many rows as it was replayed. Four times MAX_ROWS is
 * comfortably more than the replay window and still bounded.
 */
const SEEN_MAX = MAX_ROWS * 4;
/**
 * A frame that reaches us older than this was sitting in the server's replay
 * buffer, not just emitted. The generator is demand-gated but the buffer is
 * not, so on a quiet server the "live" feed opens with minutes- or hours-old
 * payloads; they are shown, but never as if they had just happened.
 */
const REPLAY_AGE_MS = 10 * 1000;
/** First wait before we re-open a stream that closed for good. */
const RECONNECT_BASE_MS = 2000;
/** Ceiling for the reconnect backoff. */
const RECONNECT_MAX_MS = 30 * 1000;
/** EventSource.CLOSED. Read as a number so a stubbed EventSource still works. */
const ES_CLOSED = 2;
/** Coalescing delay before a grading batch goes out. */
const GRADE_DEBOUNCE_MS = 400;
/** Server caps /api/v1/replay at 100 samples per call; don't exceed it. */
const GRADE_BATCH_MAX = 100;
/** Hard stop on grading traffic from one mount, whatever happens. */
const GRADE_CALL_BUDGET = 40;

const FILTERS = ['all', 'requests', 'responses', 'findings', 'pops', 'vast'];
const COLUMNS = ['time', 'kind', 'source', 'format', 'size', 'findings'];

export default {
  id: 'stream',
  // ?v=bundle-hash so edits to stream.css actually reach browsers — registry
  // loads mod.css as a runtime <link>, which the import/<link> version-rewrite
  // passes don't see, so without this it ships unversioned and sticks behind
  // browser/CDN cache (max-age). Server replaces the token via injectModuleBundleHashes().
  css: '/modules/stream/stream.css?v=__STREAM_BUNDLE_HASH__',
  route: '/live',
  manifest: {
    // shell-boot's updateSectionTitle() puts this in the tab on every SPA
    // section swap, so it is the same name the rail and the page's own h1
    // carry — plural, matching `stream.title`. It used to be singular, which
    // made switching language on /live rename the section in the tab.
    title: { en: 'Streams', uk: 'Стріми', ru: 'Стримы' },
    description: {
      en: 'Live OpenRTB observability feed',
      uk: 'Живий потік OpenRTB-трафіку',
      ru: 'Живой поток OpenRTB-трафика',
    },
  },

  async mount(root, ctx) {
    // Scope the full-bleed stream grid to this mount. stream.css targets
    // #app-root.stream-view (not bare #app-root); without this class the
    // persistent stylesheet would keep #app-root as a stream grid for the
    // NEXT section the user navigates to. Removed on unmount.
    root.classList.add('stream-view');
    ctx.addCleanup(() => root.classList.remove('stream-view'));

    const t = ctx.t;

    // ── Per-mount state. A re-mount gets fresh caches automatically. ──
    /** @type {Array<object>} newest first; mirrors the DOM order of rows. */
    const rows = [];
    /** Source name → { sev, count, type }. One entry per corpus fixture. */
    const gradeCache = new Map();
    /** Source name → a representative specimen still waiting to be graded. */
    const gradeQueue = new Map();
    /**
     * EMISSION timestamps of every distinct payload seen, oldest first — not
     * receipt timestamps. A 50-frame replay burst lands in one millisecond;
     * counting receipts made the pill claim 50 payloads in 0.7s, and up to
     * 231/min for a generator pinned at 60/min. What the reader wants to know
     * is how fast the auction is going, and that is when the payloads were
     * emitted.
     */
    const arrivals = [];
    /** Envelopes that arrived while paused, oldest first. Bounded by MAX_ROWS. */
    const held = [];
    /**
     * How many payloads have arrived during THIS pause — including the ones
     * `held` has already had to drop. The array is capped at MAX_ROWS, so
     * reporting held.length froze the pill on "100 held" after 100 seconds
     * while the feed kept running: on a 210-payload pause the page showed
     * "100 held" beside a window counter that had gone up by 210. The queue
     * still keeps only the newest MAX_ROWS — that part was never wrong — so
     * what the pill owes the reader is the real figure plus the cap.
     */
    let heldTotal = 0;
    /** Frame keys already rendered — see SEEN_MAX. */
    const seen = new Set();
    /** Same keys in insertion order, so the oldest can be evicted. */
    const seenOrder = [];

    let activeFilter = 'all';
    let paused = false;
    let connState = 'connecting';
    /** '' | 'capped' — why the socket is down, when we managed to find out. */
    let downReason = '';
    /**
     * True only when EventSource has closed for good and the retry is ours.
     * A plain network hiccup leaves it false: the browser is already
     * reconnecting, and flashing a "Reconnect" button at a socket that is
     * mid-retry invites a click that cancels its own recovery.
     */
    let ownsRetry = false;
    let gradeTimer = null;
    let gradeInFlight = false;
    let gradeCalls = 0;
    let gradingGaveUp = false;

    // ── Template + translations. The i18n table is imported dynamically
    //    rather than statically so the server's ES-import version rewrite
    //    (which only matches `from '…'` / `import('…')`) fingerprints it —
    //    a static side-effect import would ship uncacheable-stale. ──
    const tplHref = new URL('./template.html', import.meta.url).href;
    const [html] = await Promise.all([
      fetch(tplHref, { signal: ctx.signal }).then((r) => r.text()),
      import('/modules/stream/i18n.js'),
    ]);
    root.innerHTML = html;

    const titleEl = root.querySelector('#streamTitle');
    const ledeEl = root.querySelector('#streamLede');
    const stateEl = root.querySelector('#streamState');
    const stateTextEl = root.querySelector('#streamStateText');
    const freezeEl = root.querySelector('#streamFreeze');
    const reconnectEl = root.querySelector('#streamReconnect');
    const filtersLabelEl = root.querySelector('#streamFiltersLabel');
    const chipsEl = root.querySelector('#streamChips');
    const windowEl = root.querySelector('#streamWindow');
    const theadEl = root.querySelector('#streamThead');
    const rowsEl = root.querySelector('#streamRows');
    const emptyEl = root.querySelector('#streamEmpty');

    // ── Static chrome ────────────────────────────────────────────────
    const chips = FILTERS.map((name) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stream-chip';
      b.dataset.filter = name;
      b.setAttribute('aria-pressed', String(name === activeFilter));
      b.addEventListener(
        'click',
        () => {
          activeFilter = name;
          chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filter === name)));
          applyFilter();
        },
        { signal: ctx.signal },
      );
      chipsEl.append(b);
      return b;
    });

    const headCells = COLUMNS.map((name) => {
      const s = document.createElement('span');
      s.dataset.col = name;
      theadEl.append(s);
      return s;
    });

    freezeEl.setAttribute('aria-pressed', 'false');
    freezeEl.addEventListener(
      'click',
      () => {
        paused = !paused;
        // Each pause counts from zero, whichever direction the toggle went.
        heldTotal = 0;
        if (!paused) {
          // Flush oldest-first so the newest held row still lands on top.
          while (held.length) addRow(held.shift());
          applyFilter();
        }
        renderLabels();
        renderLive();
      },
      { signal: ctx.signal },
    );

    renderLabels();
    renderLive();

    // Re-render every translated string when the seamless language switch
    // fires. Row cells are re-rendered too: FINDINGS is the only cell whose
    // text is a translated phrase rather than data.
    ctx.addCleanup(
      ctx.on('kt:lang-change', () => {
        renderLabels();
        renderLive();
        rows.forEach((rec) => {
          // Everything on a row that is a translated word or a locale-formatted
          // number: the findings phrase, the KIND title, the FORMAT fallback,
          // the KB unit and its decimal separator, the timestamp tooltip — and
          // the accessible name, which is built out of all of them.
          paintKind(rec);
          paintFormat(rec);
          paintSize(rec);
          paintFindings(rec);
          paintTime(rec);
          paintRowName(rec);
        });
      }),
    );

    // ── SSE ──────────────────────────────────────────────────────────
    //
    // EventSource has no AbortSignal, so the socket gets an explicit cleanup —
    // closing it frees the per-IP slot in the server pool and lets the
    // demand-gated generator stop when we were the last viewer.
    //
    // It also has a failure mode the spec makes permanent: on any non-200 the
    // browser closes the connection and NEVER retries. The server answers 429
    // once one IP holds 8 concurrent streams — a shared NAT, a corporate
    // proxy, or simply the user's own tabs — and that used to leave this page
    // dead until F5, showing "connection lost" above "waiting for the first
    // payload…", two sentences that contradict each other and neither of which
    // named the reason. So the reconnect is ours: connect() owns the socket,
    // and a terminal close schedules a retry instead of ending the session.
    let es = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;

    connect();
    ctx.addCleanup(closeStream);
    ctx.addCleanup(() => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    });

    reconnectEl.addEventListener(
      'click',
      () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        reconnectAttempts = 0;
        connect();
      },
      { signal: ctx.signal },
    );

    function closeStream() {
      if (!es) return;
      const dead = es;
      es = null;
      try {
        dead.close();
      } catch (_) {
        /* already gone */
      }
    }

    function connect() {
      closeStream();
      let next;
      try {
        next = new EventSource('/api/v1/stream');
      } catch (err) {
        console.warn('[stream] EventSource unavailable', err);
        setConnState('offline');
        return;
      }
      es = next;
      setConnState('connecting');

      // Every listener checks it is still the current socket: a retry can be
      // scheduled while the old one is mid-teardown, and a stale error must
      // not push the fresh connection back offline.
      next.addEventListener(
        'open',
        () => {
          if (next !== es) return;
          reconnectAttempts = 0;
          downReason = '';
          ownsRetry = false;
          setConnState('streaming');
        },
        { signal: ctx.signal },
      );

      next.addEventListener(
        'error',
        () => {
          if (next !== es) return;
          // readyState CONNECTING means the browser is already retrying on
          // its own; opening a second socket there would only spend another
          // slot from the very pool that may have refused us.
          ownsRetry = next.readyState === ES_CLOSED;
          setConnState('offline');
          if (ownsRetry) {
            closeStream();
            scheduleReconnect();
            explainOutage();
          }
        },
        { signal: ctx.signal },
      );

      next.addEventListener(
        'message',
        (ev) => {
          if (next !== es) return;
          let envelope;
          try {
            envelope = JSON.parse(ev.data);
          } catch (_) {
            console.warn('[stream] bad SSE frame', ev.data);
            return;
          }
          // The replay window overlaps everything we already have. Drop the
          // repeats here, before they can become rows, arrivals or held
          // frames — one gate for all three.
          if (!claimFrame(envelope)) return;
          arrivals.push(emittedAtOf(envelope));
          pruneArrivals();
          if (paused) {
            heldTotal++;
            held.push(envelope);
            if (held.length > MAX_ROWS) held.shift();
          } else {
            addRow(envelope);
            applyFilter();
          }
          renderLive();
        },
        { signal: ctx.signal },
      );
    }

    function scheduleReconnect() {
      if (reconnectTimer || ctx.signal.aborted) return;
      const step = Math.min(reconnectAttempts, 4);
      const wait = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, step));
      reconnectAttempts++;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, wait);
    }

    /**
     * Ask the endpoint why it hung up. EventSource hands out an untyped
     * `error` event with no status on it, so the connection cap — the one
     * outage the reader can actually do something about — is invisible from
     * the socket alone. fetch does expose the status; the response is dropped
     * as soon as we have it, which on a 200 releases the slot the server just
     * counted for the probe.
     */
    function explainOutage() {
      if (typeof fetch !== 'function') return;
      const probe = new AbortController();
      const stopProbe = () => probe.abort();
      ctx.signal.addEventListener('abort', stopProbe, { once: true });
      fetch('/api/v1/stream', { headers: { Accept: 'text/event-stream' }, signal: probe.signal })
        .then((res) => {
          probe.abort();
          if (ctx.signal.aborted) return;
          downReason = res.status === 429 ? 'capped' : '';
          renderLive();
        })
        .catch(() => {
          /* offline, or the abort above — the generic message already fits */
        })
        .finally(() => ctx.signal.removeEventListener('abort', stopProbe));
    }

    /** Emission time of an envelope, falling back to now for a malformed one. */
    function emittedAtOf(envelope) {
      const ms = Number(envelope && envelope.emittedAt);
      return Number.isFinite(ms) && ms > 0 ? ms : Date.now();
    }

    /**
     * Identity of a frame. `hash` is the server's own sha1 of the specimen and
     * every emission mutates the request id, so two frames share a hash only
     * when they are literally the same emission replayed. The fallback keeps
     * de-duplication working if a frame ever arrives before the hash is
     * attached.
     *
     * @returns {boolean} true when this frame has not been seen yet.
     */
    function claimFrame(envelope) {
      const spec = (envelope && envelope.specimen) || {};
      const key =
        envelope && typeof envelope.hash === 'string' && envelope.hash
          ? envelope.hash
          : String((envelope && envelope.source) || '?') +
            '|' +
            String((envelope && envelope.emittedAt) || '') +
            '|' +
            String(spec.id || '');
      if (seen.has(key)) return false;
      seen.add(key);
      seenOrder.push(key);
      while (seenOrder.length > SEEN_MAX) seen.delete(seenOrder.shift());
      return true;
    }

    // The pill reports a rate, so it has to decay on its own when nothing
    // arrives — otherwise a dead stream keeps advertising its last speed.
    const ticker = setInterval(() => {
      pruneArrivals();
      renderLive();
    }, 2000);
    ctx.addCleanup(() => clearInterval(ticker));

    // One cleanup for the grading debounce, registered once. Re-registering
    // it inside scheduleGrade() would grow the queue by an entry per batch.
    ctx.addCleanup(() => {
      if (gradeTimer) clearTimeout(gradeTimer);
    });

    // ══════════════════════════════════════════════════════════════════
    //  Chrome rendering
    // ══════════════════════════════════════════════════════════════════

    /** Text that only changes when the locale does. */
    function renderLabels() {
      titleEl.textContent = t('stream.title');
      ledeEl.textContent = t('stream.lede');
      filtersLabelEl.textContent = t('stream.filter.label');
      chips.forEach((c) => {
        c.textContent = t('stream.filter.' + c.dataset.filter);
      });
      headCells.forEach((s) => {
        s.textContent = t('stream.col.' + s.dataset.col);
      });
      freezeEl.textContent = paused ? t('stream.resume') : t('stream.pause');
      freezeEl.title = paused ? t('stream.resume.hint') : t('stream.pause.hint');
      freezeEl.setAttribute('aria-pressed', String(paused));
      reconnectEl.textContent = t('stream.reconnect');
      reconnectEl.title = t('stream.reconnect.hint');
    }

    /** Text that moves with the feed — runs on every frame and every tick. */
    function renderLive() {
      windowEl.textContent = t('stream.window', { count: arrivals.length });
      const state = paused ? 'paused' : connState;
      stateEl.dataset.state = state;
      stateEl.removeAttribute('title');
      if (state === 'paused') {
        // Past the cap the queue is losing its oldest frames, and saying so
        // is the difference between a counter that stopped and a counter that
        // is telling the reader what Resume will actually hand back.
        if (heldTotal > MAX_ROWS) {
          stateTextEl.textContent = t('stream.state.paused.capped', {
            held: heldTotal,
            kept: MAX_ROWS,
          });
          stateEl.title = t('stream.state.paused.hint', { kept: MAX_ROWS });
        } else {
          stateTextEl.textContent = t('stream.state.paused', { held: heldTotal });
        }
      } else if (state === 'streaming') {
        stateTextEl.textContent = t('stream.state.streaming', { rate: ratePerMinute() });
      } else if (state === 'offline' && downReason === 'capped') {
        stateTextEl.textContent = t('stream.state.capped');
      } else {
        stateTextEl.textContent = t('stream.state.' + state);
      }
      // The retry control belongs to the one state it can act on: the stream
      // is down AND nobody else is already bringing it back.
      reconnectEl.hidden = !(state === 'offline' && ownsRetry);
      renderEmpty();
    }

    function renderEmpty() {
      const visible = rows.some((r) => !r.el.hidden);
      emptyEl.hidden = visible;
      if (rows.length > 0) {
        emptyEl.textContent = t('stream.empty.filtered');
        return;
      }
      // An empty table under a dead socket is not "waiting for the first
      // payload" — nothing is on its way. Say which of the two it is, and when
      // the reason is the connection cap, say that instead: it is the only
      // outage the reader can actually clear (close the other tabs).
      if (connState === 'offline') {
        emptyEl.textContent =
          downReason === 'capped' ? t('stream.empty.capped') : t('stream.empty.offline');
      } else {
        emptyEl.textContent = t('stream.empty');
      }
    }

    function setConnState(next) {
      connState = next;
      if (next !== 'offline') downReason = '';
      renderLive();
    }

    function pruneArrivals() {
      const cutoff = Date.now() - ROLLING_WINDOW_MS;
      while (arrivals.length && arrivals[0] < cutoff) arrivals.shift();
    }

    /**
     * Distinct payloads EMITTED in the last 60s — a measurement of the feed,
     * not of our socket, so a throttled or stalled generator shows as the
     * lower number and a replay burst is credited to the minutes it actually
     * happened in. Scans the whole (hour-bounded) array rather than walking
     * back from the end: a reconnect can splice older-but-unseen frames in
     * after newer ones, and a rate that depends on sort order is a rate that
     * will be wrong exactly when the connection misbehaves.
     */
    function ratePerMinute() {
      const cutoff = Date.now() - RATE_WINDOW_MS;
      let n = 0;
      for (let i = 0; i < arrivals.length; i++) {
        if (arrivals[i] >= cutoff) n++;
      }
      return n;
    }

    // ══════════════════════════════════════════════════════════════════
    //  Payload shape → the six cells
    // ══════════════════════════════════════════════════════════════════

    /** mtype values, oRTB 2.5 §5.25 — the response's own word for the media. */
    const MTYPE = { 1: 'banner', 2: 'video', 3: 'audio', 4: 'native' };
    /** bid.media subtree keys, oRTB 3.0 — `display` is what 2.x calls banner. */
    const MEDIA_KEYS = {
      display: 'banner',
      banner: 'banner',
      video: 'video',
      audio: 'audio',
      native: 'native',
    };

    /**
     * What one bid declares: which media it says it is, and the markup string
     * if it carries one. 2.x puts both on the bid (`mtype` + `adm`); 3.0 nests
     * them under `bid.media.<mediatype>.adm`, which is why reading `bid.adm`
     * alone left every 3.0 response unlabelled.
     */
    function creativeOfBid(bid) {
      if (!bid || typeof bid !== 'object') return { media: '', adm: '' };
      if (typeof bid.adm === 'string') {
        return { media: MTYPE[bid.mtype] || '', adm: bid.adm };
      }
      const media = bid.media;
      if (media && typeof media === 'object') {
        for (const key of Object.keys(MEDIA_KEYS)) {
          const slot = media[key];
          if (slot && typeof slot === 'object') {
            return { media: MEDIA_KEYS[key], adm: typeof slot.adm === 'string' ? slot.adm : '' };
          }
        }
      }
      return { media: MTYPE[bid.mtype] || '', adm: '' };
    }

    /**
     * The creative this response is best described by. Reading bid[0] and
     * stopping was enough for a clean response and wrong for every response
     * that leads with a bid declaring nothing: the deep-response-errors
     * specimen opens with a priced bid that has neither `media` nor `adm`,
     * three bids before the one carrying a VAST 4 creative, so the FORMAT
     * cell printed a bare "3.0" and the `vast` filter never caught the row.
     *
     * So walk the bids and prefer the first that carries actual markup —
     * markup is what the Inspector will open — falling back to the first that
     * at least names a media type. Bounded by the response's own bid count.
     */
    function firstCreative(body) {
      const seats = Array.isArray(body.seatbid) ? body.seatbid : [];
      let declared = null;
      for (const seat of seats) {
        const bids = seat && Array.isArray(seat.bid) ? seat.bid : [];
        for (const bid of bids) {
          const got = creativeOfBid(bid);
          if (got.adm) return got;
          if (got.media && !declared) declared = got;
        }
      }
      return declared || { media: '', adm: '' };
    }

    /** VAST major version declared in an adm string, or '' when it isn't VAST. */
    function vastVersion(adm) {
      const head = adm.slice(0, 400);
      if (!/<\s*VAST/i.test(head)) return '';
      const m = head.match(/<\s*VAST[^>]*\bversion\s*=\s*["'](\d+)/i);
      return m ? 'vast-' + m[1] : 'vast';
    }

    /** True when any ext object on the path declares a pop/clickunder format. */
    function popHint(ext) {
      if (!ext || typeof ext !== 'object') return false;
      const declared = [ext.adtype, ext.ad_format, ext.format, ext.type]
        .filter((v) => typeof v === 'string')
        .join(' ')
        .toLowerCase();
      return /pop|clickunder/.test(declared);
    }

    /**
     * FORMAT cell: a media word plus the qualifier that actually distinguishes
     * this payload from the next one of the same media — the oRTB major version
     * for 3.0, the VAST version for video creatives, otherwise the inventory
     * context. Mirrors the vocabulary core/format-detect.js uses so the word on
     * the row is the word the Inspector will show.
     */
    function formatOf(specimen, shape) {
      const body = shape.body;
      let media = '';
      let sub = '';
      let vast = false;

      if (shape.kind === 'req') {
        const items = Array.isArray(body.imp)
          ? body.imp
          : Array.isArray(body.item)
            ? body.item
            : [];
        for (const it of items) {
          if (!it || typeof it !== 'object') continue;
          const slot = it.spec && it.spec.placement ? it.spec.placement : it;
          if (slot.banner || slot.display) media = media || 'banner';
          if (slot.video) {
            media = media || 'video';
            const protocols = slot.video.protocols || slot.video.ctype;
            if (Array.isArray(protocols) && protocols.some((p) => Number(p) >= 2)) vast = true;
          }
          if (slot.native) media = media || 'native';
          if (slot.audio) media = media || 'audio';
          if (popHint(it.ext) || popHint(slot.ext)) media = 'pops';
        }
        if (popHint(body.ext)) media = 'pops';
      } else if (shape.kind === 'res') {
        const creative = firstCreative(body);
        media = creative.media;
        const adm = creative.adm;
        const v = vastVersion(adm);
        if (v) {
          media = media || 'video';
          sub = v;
          vast = true;
        } else if (/^\s*\{/.test(adm) && /"(?:native|assets)"/.test(adm)) {
          media = media || 'native';
          sub = 'json';
        } else if (/^\s*</.test(adm)) {
          media = media || 'banner';
          sub = 'html';
        }
        const seat = Array.isArray(body.seatbid) ? body.seatbid[0] : null;
        const bid = seat && Array.isArray(seat.bid) ? seat.bid[0] : null;
        if (bid && popHint(bid.ext)) media = 'pops';
      } else if (body && (body.redirecturl || body.redirect_url)) {
        // Single-object vendor feed: a redirect and a bid, no creative assets.
        media = 'pops';
        sub = 'jsonfeed';
      }

      // For an oRTB 3.0 payload the major version IS the distinguishing fact —
      // it outranks the VAST version or the inventory context, the way the
      // mockup's "banner · 3.0" row does. `vast` stays set either way so the
      // vast filter still catches a 3.0 response carrying a VAST creative.
      if (shape.version === '3.0') sub = '3.0';
      if (!sub) {
        const site = body.site || (body.context && body.context.site);
        const app = body.app || (body.context && body.context.app);
        const dooh = body.dooh || (body.context && body.context.dooh);
        const device = body.device || (body.context && body.context.device);
        if (dooh) sub = 'dooh';
        else if (device && Number(device.devicetype) === 7) sub = 'ctv';
        else if (app) sub = 'inapp';
        else if (site) sub = 'web';
      }
      return { media: media || '', sub, vast: vast || /^vast/.test(sub) };
    }

    /** "synthetic-pop-clean-request.json" → "synthetic · pop-clean-request". */
    function sourceLabel(source) {
      const name = String(source || '?').replace(/\.json$/i, '');
      const cut = name.indexOf('-');
      if (cut <= 0) return name;
      return name.slice(0, cut) + ' · ' + name.slice(cut + 1);
    }

    /**
     * A bare HH:MM:SS is only honest for a payload from today. The server
     * replays its buffer to every new viewer and the generator only runs while
     * someone is watching, so the top of a freshly opened feed can be hours or
     * days old — printed as a clock reading, that reads as "just now". A
     * payload from another day therefore carries its date.
     */
    function timeLabel(ms, now) {
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, '0');
      const clock = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
      const today = new Date(now);
      const sameDay =
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate();
      return sameDay ? clock : p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + clock;
    }

    /** Wire size of the payload as it came off the stream, in bytes, or null. */
    function byteSize(specimen) {
      try {
        return new TextEncoder().encode(JSON.stringify(specimen)).length;
      } catch (_) {
        return null;
      }
    }

    /**
     * The SIZE reading in the active locale. Both halves were English before:
     * the unit was a hardcoded " KB" under a translated «РОЗМІР» header, and
     * the decimal point stayed a point in uk/ru, where the separator is a
     * comma. Intl is asked for the number and i18n for the unit.
     */
    function sizeLabel(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '';
      const kb = bytes / 1024;
      let n;
      try {
        n = kb.toLocaleString(ctx.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      } catch (_) {
        n = kb.toFixed(1);
      }
      return n + ' ' + t('stream.size.kb');
    }

    // ══════════════════════════════════════════════════════════════════
    //  Rows
    // ══════════════════════════════════════════════════════════════════

    function addRow(envelope) {
      const specimen = envelope.specimen || {};
      const shape = classifyAuctionPayload(specimen);
      const fmt = formatOf(specimen, shape);
      const now = Date.now();
      const emitted = emittedAtOf(envelope);
      // Old on arrival = it came out of the server's replay buffer, not off
      // the live generator. Both are real payloads; only one of them just
      // happened, and the row has to say which.
      const replayed = now - emitted > REPLAY_AGE_MS;
      const rec = {
        envelope,
        source: String(envelope.source || '?'),
        kind: shape.kind,
        media: fmt.media,
        sub: fmt.sub,
        vast: fmt.vast,
        // Measured once. The KB reading is re-rendered on a language change
        // (the unit is a translated word), and re-serialising the specimen
        // for every row on every switch would be the page's only O(payload)
        // work in a handler that must feel instant.
        bytes: byteSize(specimen),
        emitted,
        replayed,
        grade: null,
        el: null,
        cells: {},
      };

      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'stream-row';
      if (replayed) el.dataset.replay = '1';

      const cell = (col, text) => {
        const s = document.createElement('span');
        s.className = 'stream-cell stream-cell--' + col;
        s.textContent = text;
        el.append(s);
        return s;
      };
      rec.cells.time = cell('time', timeLabel(emitted, now));
      paintTime(rec);
      rec.cells.kind = cell('kind', '');
      rec.cells.source = cell('source', sourceLabel(rec.source));
      rec.cells.format = cell('format', '');
      rec.cells.size = cell('size', '');
      rec.cells.findings = cell('findings', '');
      paintKind(rec);
      paintFormat(rec);
      paintSize(rec);

      if (envelope.hash) {
        el.addEventListener('click', () => openInInspector(envelope.hash), { signal: ctx.signal });
      } else {
        // Nothing to link to: the permalink is the specimen cache key and the
        // server attaches it on push. Say so rather than offering a dead click.
        el.disabled = true;
      }

      rec.el = el;
      rows.unshift(rec);
      rowsEl.insertBefore(el, rowsEl.firstChild);
      while (rows.length > MAX_ROWS) {
        const dropped = rows.pop();
        dropped.el.remove();
      }
      paintFindings(rec);
      paintRowName(rec);
      requestGrade(rec);
      return rec;
    }

    function openInInspector(hash) {
      // specimenPath() knows en is the no-prefix locale (/r/<hash>) while uk/ru
      // are prefixed — building the path by hand here is how /en/r/<hash>, a
      // route the server has never had, used to get shipped.
      const target = specimenPath(hash, ctx.lang);
      const shell = window.OrtbtoolsShell;
      if (shell && typeof shell.navigateTo === 'function') shell.navigateTo(target);
      else window.location.assign(target);
    }

    function applyFilter() {
      for (const rec of rows) rec.el.hidden = !matchesFilter(rec);
      renderEmpty();
    }

    function matchesFilter(rec) {
      switch (activeFilter) {
        case 'requests':
          return rec.kind === 'req';
        case 'responses':
          return rec.kind === 'res';
        case 'findings':
          return !!rec.grade && (rec.grade.sev === 'danger' || rec.grade.sev === 'warn');
        case 'pops':
          return rec.media === 'pops';
        case 'vast':
          return rec.vast === true;
        default:
          return true;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    //  FINDINGS — batched grading through /api/v1/replay
    // ══════════════════════════════════════════════════════════════════

    /**
     * Agreement form for the "N blocking" cell.
     *
     * This is deliberately a TWO-form rule, not the three-form one in
     * public/ortbtools.app.js (pluralKey), because the uk/ru strings here
     * inflect a VERB rather than a noun: "1 блокує" against "2 / 5 / 11
     * блокують". Verbs take the singular for a count ending in 1 (except
     * 11) and the plural for everything else — 2-4 and 5+ are the same
     * word, so a third form would be two identical strings pretending to
     * be a distinction. Every other counted string on this page is phrased
     * so one form covers all numbers.
     */
    function blockingForm(n) {
      return n % 10 === 1 && n % 100 !== 11 ? 'one' : 'other';
    }

    /**
     * The TIME cell's tooltip: the full timestamp, and — for a payload that
     * came out of the replay buffer — that fact in words. The CSS marker on
     * its own is a symbol nobody can look up, and the row's accessible name
     * would carry no trace of it at all.
     */
    function paintTime(rec) {
      const stamp = new Date(rec.emitted);
      let full;
      try {
        full = stamp.toLocaleString(ctx.lang);
      } catch (_) {
        full = stamp.toISOString();
      }
      rec.cells.time.title = rec.replayed ? full + ' · ' + t('stream.row.replay') : full;
    }

    /**
     * The translated word for a side of the auction. Written as three literal
     * keys rather than `t('stream.kind.' + kind)` so the i18n coverage test's
     * static scan of this file can see every key that ships.
     */
    function kindWord(kind) {
      if (kind === 'req') return t('stream.kind.req');
      if (kind === 'res') return t('stream.kind.res');
      return t('stream.kind.unknown');
    }

    /**
     * KIND cell. The visible token stays REQ / RES — trade shorthand that
     * survives a 60px track — and the translated word rides on the cell's
     * title and in the row's accessible name.
     */
    function paintKind(rec) {
      const cellEl = rec.cells.kind;
      cellEl.textContent = rec.kind === 'unknown' ? '?' : rec.kind;
      cellEl.dataset.kind = rec.kind;
      cellEl.title = kindWord(rec.kind);
    }

    /** FORMAT cell: media word plus qualifier, never a bare qualifier. */
    function paintFormat(rec) {
      const media = rec.media || t('stream.format.unknown');
      rec.cells.format.textContent = [media, rec.sub].filter(Boolean).join(' · ');
    }

    function paintSize(rec) {
      rec.cells.size.textContent = sizeLabel(rec.bytes);
    }

    /**
     * The row's accessible name.
     *
     * The row is one <button> holding six <span>s, and a name assembled from
     * them by the browser has nothing between the cells: a screen reader read
     * "23:14:46RESsynthetic · trap-invisible-overlay1.4 KBclean" as a single
     * run. So the name is stated rather than inherited — the same six readings
     * in the same order, separated, with the Latin REQ/RES spelled out as the
     * translated word and the replay fact (which lives in a CSS ::before glyph
     * and would otherwise be invisible to a reader) said in words.
     *
     * Must be re-run whenever any cell changes: grading fills FINDINGS and can
     * settle KIND minutes after the row was drawn.
     */
    function paintRowName(rec) {
      const parts = [
        rec.cells.time.textContent,
        kindWord(rec.kind),
        rec.cells.source.textContent,
        rec.cells.format.textContent,
        rec.cells.size.textContent,
        rec.cells.findings.textContent,
      ].filter(Boolean);
      if (rec.replayed) parts.push(t('stream.row.replay'));
      parts.push(rec.envelope.hash ? t('stream.row.open') : t('stream.row.no_permalink'));
      rec.el.setAttribute('aria-label', parts.join(', '));
      // The hover hint stays the action (or the reason there isn't one) —
      // the cells beside the pointer already say the rest.
      rec.el.title = rec.envelope.hash ? t('stream.row.open') : t('stream.row.no_permalink');
    }

    /** FINDINGS changed → the accessible name that quotes it changed too. */
    function repaintGrade(rec) {
      paintFindings(rec);
      paintRowName(rec);
    }

    function paintFindings(rec) {
      const cellEl = rec.cells.findings;
      const g = rec.grade;
      if (!g) {
        const pending = gradingGaveUp ? 'unknown' : 'pending';
        cellEl.dataset.sev = pending;
        cellEl.textContent = t('stream.findings.' + pending);
        return;
      }
      cellEl.dataset.sev = g.sev;
      if (g.sev === 'danger') {
        cellEl.textContent = t('stream.findings.blocking.' + blockingForm(g.count), {
          count: g.count,
        });
      } else if (g.sev === 'warn') {
        cellEl.textContent = t('stream.findings.tofix', { count: g.count });
      } else if (g.sev === 'ok') {
        cellEl.textContent = t('stream.findings.clean');
      } else {
        cellEl.textContent = t('stream.findings.unknown');
      }
    }

    function requestGrade(rec) {
      const cached = gradeCache.get(rec.source);
      if (cached) {
        applyGrade(rec, cached);
        return;
      }
      if (gradingGaveUp) return;
      if (!gradeQueue.has(rec.source)) gradeQueue.set(rec.source, rec.envelope.specimen);
      scheduleGrade();
    }

    function applyGrade(rec, grade) {
      rec.grade = grade;
      // The grader is authoritative about which side of the auction this is:
      // vendor feeds carry neither `imp` nor `seatbid`, and only validate()
      // knows that a bid-redirect body is a response.
      if (rec.kind === 'unknown' && grade.type) {
        if (/response/i.test(grade.type)) rec.kind = 'res';
        else if (/request/i.test(grade.type)) rec.kind = 'req';
        if (rec.kind !== 'unknown') paintKind(rec);
      }
      paintFindings(rec);
      paintRowName(rec);
    }

    function scheduleGrade() {
      if (gradeTimer || gradeInFlight || gradingGaveUp) return;
      gradeTimer = setTimeout(flushGrades, GRADE_DEBOUNCE_MS);
    }

    function flushGrades() {
      gradeTimer = null;
      if (gradeInFlight || gradingGaveUp) return;
      const batch = [...gradeQueue.entries()].slice(0, GRADE_BATCH_MAX);
      if (batch.length === 0) return;
      if (gradeCalls >= GRADE_CALL_BUDGET) {
        // A corpus this size should have settled long ago; something is
        // pathological. Stop rather than keep spending the analyze bucket.
        gradingGaveUp = true;
        rows.forEach(repaintGrade);
        return;
      }
      gradeCalls++;
      gradeInFlight = true;
      // Everything goes in as `bidReq`: validate() detects the payload type
      // itself and returns it as validation.type, and sending a response under
      // bidRes would only differ by skipping that detection.
      const samples = batch.map(([source, specimen]) => ({ label: source, bidReq: specimen }));
      fetch('/api/v1/replay?locale=' + encodeURIComponent(ctx.lang), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ samples }),
        signal: ctx.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then((data) => {
          gradeInFlight = false;
          for (const result of (data && data.results) || []) {
            if (!result || !result.label) continue;
            gradeCache.set(result.label, toGrade(result));
            gradeQueue.delete(result.label);
          }
          for (const rec of rows) {
            const g = gradeCache.get(rec.source);
            if (g && rec.grade !== g) applyGrade(rec, g);
          }
          // A row that just turned out to have findings belongs in the
          // "with findings" view, which was rendered before we knew.
          applyFilter();
          if (gradeQueue.size) scheduleGrade();
        })
        .catch((err) => {
          gradeInFlight = false;
          if (err && err.name === 'AbortError') return; // unmount, not a failure
          // Rate limit or server trouble: one retry's worth of budget is
          // already spent, so stop asking and say the column is unchecked
          // instead of leaving every row spinning forever.
          console.warn('[stream] grading failed', err);
          gradingGaveUp = true;
          rows.forEach(repaintGrade);
        });
    }

    function toGrade(result) {
      if (!result || result.status === 'skipped') return { sev: 'unknown', count: 0, type: null };
      const type = (result.validation && result.validation.type) || null;
      const blocking = (result.critCount || 0) + (result.errorCount || 0);
      const tofix = result.warningCount || 0;
      // `invalid` means the payload failed to parse as either side at all —
      // blocking even when the finding list came back empty.
      if (result.status === 'invalid') {
        return { sev: 'danger', count: Math.max(blocking, 1), type };
      }
      if (blocking > 0) return { sev: 'danger', count: blocking, type };
      if (tofix > 0) return { sev: 'warn', count: tofix, type };
      return { sev: 'ok', count: 0, type };
    }
  },

  /**
   * Optional unmount hook. Everything is handled by the two cleanup
   * channels already: listeners detach on ctx.signal, addCleanup closes
   * the EventSource / clears the interval / drops .stream-view, and the
   * registry sweeps root.innerHTML.
   */
  async unmount(_root) {
    // No-op. The contract documents that returning is sufficient.
  },
};
