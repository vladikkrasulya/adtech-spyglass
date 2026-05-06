/* ============================================================
   public/modules/stream/index.js — Stream module (ES module).

   First feature module under the Phase B contract. Mounts the
   live RTB observability stream into a host root element. Uses
   ctx.signal for self-detaching listeners and ctx.addCleanup()
   for resources without AbortSignal support (EventSource, dynamic
   <link>, localStorage flush).
   ============================================================ */
'use strict';

import { escapeHtml } from '/core/utils.js';

const MAX_ROWS = 100;
const THEME_KEY = 'kt-theme';

export default {
  id: 'stream',
  route: '/stream.html',
  manifest: {
    title: { en: 'Stream', uk: 'Стрім', ru: 'Стрим' },
    description: {
      en: 'Live OpenRTB observability feed',
      uk: 'Живий потік OpenRTB-трафіку',
      ru: 'Живой поток OpenRTB-трафика',
    },
  },

  /**
   * Activates the Stream surface inside `root`.
   *
   * The contract has two cleanup channels and we use BOTH on purpose
   * so the patterns are visible to future modules:
   *
   *   1. ctx.signal  — passed to addEventListener({ signal }) and
   *                    fetch({ signal }). The registry's AbortController
   *                    fires it automatically on unmount, so listeners
   *                    detach without us tracking them.
   *
   *   2. ctx.addCleanup(fn) — explicit cleanup callbacks for things
   *                    that don't accept AbortSignal: EventSource.close(),
   *                    document.head additions, intervals. Called LIFO.
   *
   * Anything we put on `root.innerHTML` is auto-swept by the registry
   * after both channels run, so DOM teardown is free.
   */
  async mount(root, ctx) {
    // Per-mount state lives in this closure. A re-mount gets fresh
    // counters / caches automatically.
    let received = 0;
    let firstEvent = true;
    let selectedRow = null;
    let currentTab = 'decoded';
    const analyzeCache = new Map();
    let activeEnvelope = null;
    let activeAnalysis = null;

    // ── 1. Load module-scoped CSS via <link>. addCleanup removes it
    //       on unmount so the next module's CSS doesn't compete. ────
    const cssHref = new URL('./stream.css', import.meta.url).href;
    const linkEl = document.createElement('link');
    linkEl.rel = 'stylesheet';
    linkEl.href = cssHref;
    document.head.appendChild(linkEl);
    ctx.addCleanup(() => linkEl.remove());

    // ── 2. Load template HTML and inject into root. ────────────────
    const tplHref = new URL('./template.html', import.meta.url).href;
    const html = await fetch(tplHref, { signal: ctx.signal }).then((r) => r.text());
    root.innerHTML = html;

    // Cache element refs after innerHTML lands.
    const feedEl = root.querySelector('#feed');
    const detailBody = root.querySelector('#detailBody');
    const counterEl = root.querySelector('#counter');
    const dotEl = root.querySelector('#dot');
    const stateEl = root.querySelector('#state');
    const tabs = Array.from(root.querySelectorAll('.tab'));
    const badgeValidation = root.querySelector('#badgeValidation');
    const themeToggle = root.querySelector('#themeToggle');

    // ── 3. Theme persistence (legacy kt-theme localStorage key). ───
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') {
        document.documentElement.setAttribute('data-theme', saved);
      }
    } catch (_) {
      /* localStorage may be blocked */
    }
    themeToggle.addEventListener(
      'click',
      () => {
        const cur = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch (_) {
          /* ignore */
        }
      },
      { signal: ctx.signal },
    );

    // ── 4. Tabs — click handlers use ctx.signal so they detach when
    //      the module is unmounted by registry. ──────────────────────
    tabs.forEach((tab) => {
      tab.addEventListener(
        'click',
        () => {
          if (tab.disabled) return;
          tabs.forEach((t) => t.classList.toggle('active', t === tab));
          currentTab = tab.dataset.tab;
          renderDetail({});
        },
        { signal: ctx.signal },
      );
    });

    // ── 5. SSE wiring. EventSource has no native AbortSignal, so we
    //      register an explicit cleanup. Closes the connection cleanly
    //      on unmount, freeing the per-IP slot in the server pool. ───
    setState('connecting');
    const es = new EventSource('/api/v1/stream');
    es.addEventListener('open', () => setState('connected'), { signal: ctx.signal });
    es.addEventListener('error', () => setState('error'), { signal: ctx.signal });
    es.addEventListener(
      'message',
      (ev) => {
        let envelope;
        try {
          envelope = JSON.parse(ev.data);
        } catch (_) {
          console.warn('[stream] bad SSE frame', ev.data);
          return;
        }
        appendRow(envelope);
      },
      { signal: ctx.signal },
    );
    ctx.addCleanup(() => es.close());

    // ── Internal helpers (closure-scoped) ──────────────────────────

    function setState(state) {
      dotEl.className = 'dot ' + state;
      stateEl.textContent = state;
    }

    function fmtFrom(specimen) {
      const imp0 = specimen.imp && specimen.imp[0];
      if (!imp0) return '?';
      if (imp0.banner) return 'banner';
      if (imp0.video) return 'video';
      if (imp0.native) return 'native';
      if (imp0.audio) return 'audio';
      return '?';
    }
    function ctxFrom(specimen) {
      if (specimen.site) return 'site=' + (specimen.site.domain || '?');
      if (specimen.app) return 'app=' + (specimen.app.bundle || '?');
      return 'ctx=?';
    }
    function timeStr(ms) {
      const d = new Date(ms);
      return (
        d.toLocaleTimeString('en-US', { hour12: false }) +
        '.' +
        String(d.getMilliseconds()).padStart(3, '0')
      );
    }

    function appendRow(envelope) {
      if (firstEvent) {
        feedEl.innerHTML = '';
        firstEvent = false;
      }
      const row = document.createElement('div');
      row.className = 'row';
      const tsSpan = document.createElement('span');
      tsSpan.className = 'ts';
      tsSpan.textContent = timeStr(envelope.emittedAt);
      const fmtSpan = document.createElement('span');
      fmtSpan.className = 'fmt';
      fmtSpan.textContent = fmtFrom(envelope.specimen);
      const ctxSpan = document.createElement('span');
      ctxSpan.className = 'ctx';
      ctxSpan.textContent = ctxFrom(envelope.specimen);
      row.append(tsSpan, fmtSpan, ctxSpan);
      // Row click: signal-bound so it detaches with the rest on unmount.
      row.addEventListener('click', () => selectRow(row, envelope), { signal: ctx.signal });

      feedEl.insertBefore(row, feedEl.firstChild);
      while (feedEl.children.length > MAX_ROWS) {
        feedEl.removeChild(feedEl.lastChild);
      }
      received++;
      counterEl.textContent = received + ' specimen' + (received === 1 ? '' : 's');
    }

    function selectRow(row, envelope) {
      if (selectedRow) selectedRow.classList.remove('selected');
      row.classList.add('selected');
      selectedRow = row;
      activeEnvelope = envelope;
      tabs.forEach((t) => (t.disabled = false));

      renderDetail({ loading: true });

      const cacheKey = envelope.specimen.id;
      if (analyzeCache.has(cacheKey)) {
        activeAnalysis = analyzeCache.get(cacheKey);
        renderDetail({});
        return;
      }
      analyzeSpecimen(envelope.specimen)
        .then((result) => {
          analyzeCache.set(cacheKey, result);
          if (activeEnvelope === envelope) {
            activeAnalysis = result;
            renderDetail({});
          }
        })
        .catch((err) => {
          // AbortError from ctx.signal during unmount — ignore quietly.
          if (err && err.name === 'AbortError') return;
          console.warn('[stream] analyze failed', err);
          if (activeEnvelope === envelope) {
            activeAnalysis = { error: err.message || 'analyze failed' };
            renderDetail({});
          }
        });
    }

    async function analyzeSpecimen(specimen) {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidReq: specimen }),
        signal: ctx.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'HTTP ' + res.status);
      }
      return res.json();
    }

    function renderDetail(opts) {
      const { loading } = opts || {};
      if (loading || !activeAnalysis) {
        detailBody.innerHTML = '<div class="loading">analyzing…</div>';
        return;
      }
      if (activeAnalysis.error) {
        detailBody.innerHTML =
          '<div class="placeholder" style="color: #dc2626">' +
          escapeHtml(activeAnalysis.error) +
          '</div>';
        return;
      }
      updateValidationBadge();
      if (currentTab === 'decoded') return renderDecoded();
      if (currentTab === 'validation') return renderValidation();
      if (currentTab === 'raw') return renderRaw();
    }

    function updateValidationBadge() {
      const findings = (activeAnalysis.validation && activeAnalysis.validation.findings) || [];
      const danger = findings.filter((f) => f.level === 'error' || f.level === 'danger').length;
      const warn = findings.filter((f) => f.level === 'warning' || f.level === 'warn').length;
      const total = findings.length;
      if (total === 0) {
        badgeValidation.hidden = true;
        return;
      }
      badgeValidation.hidden = false;
      badgeValidation.textContent = total;
      badgeValidation.className = 'badge';
      if (danger > 0) badgeValidation.classList.add('danger');
      else if (warn > 0) badgeValidation.classList.add('warn');
    }

    function renderDecoded() {
      const sp = activeEnvelope.specimen;
      const v = activeAnalysis.validation || {};
      const ver = v.version || {};
      const fmt = fmtFrom(sp);
      const imp0 = (sp.imp && sp.imp[0]) || {};
      const banner = imp0.banner || {};
      const video = imp0.video || {};
      const sctx = sp.site || sp.app || {};
      const pub = sctx.publisher || {};
      const geo = (sp.device && sp.device.geo) || {};

      const meta =
        '<div class="meta-line">' +
        escapeHtml(activeEnvelope.source) +
        ' · emitted ' +
        new Date(activeEnvelope.emittedAt).toISOString() +
        '</div>';

      const rows = [];
      rows.push(['Type', v.type || '?']);
      rows.push([
        'Version',
        ver.version
          ? ver.version + ' <span class="finding-id">conf ' + ver.confidence + '</span>'
          : '?',
      ]);
      rows.push(['Status', v.status || '?']);
      rows.push(['Format', '<span class="pill">' + fmt + '</span>']);
      if (banner.format && banner.format.length) {
        rows.push([
          'Banner sizes',
          banner.format.map((f) => `<span class="pill">${f.w}×${f.h}</span>`).join(''),
        ]);
      } else if (banner.w && banner.h) {
        rows.push(['Banner size', `<span class="pill">${banner.w}×${banner.h}</span>`]);
      }
      if (video.w && video.h) {
        rows.push(['Video size', `<span class="pill">${video.w}×${video.h}</span>`]);
        if (video.maxduration) {
          rows.push(['Video duration', `${video.minduration || 0}–${video.maxduration}s`]);
        }
      }
      rows.push(['Context', sp.site ? 'site' : sp.app ? 'app' : '?']);
      rows.push(['Domain / Bundle', escapeHtml(sctx.domain || sctx.bundle || '?')]);
      if (pub.name) rows.push(['Publisher', escapeHtml(pub.name)]);
      if (geo.country) {
        rows.push([
          'Geo',
          [geo.country, geo.region, geo.city].filter(Boolean).map(escapeHtml).join(' · '),
        ]);
      }
      if (imp0.bidfloor != null) {
        rows.push(['Bid floor', imp0.bidfloor + ' ' + (imp0.bidfloorcur || '<em>(no cur)</em>')]);
      }
      rows.push(['Request id', escapeHtml(sp.id || '?')]);

      detailBody.innerHTML =
        meta +
        '<dl class="decoded">' +
        rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') +
        '</dl>';
    }

    function renderValidation() {
      const findings = (activeAnalysis.validation && activeAnalysis.validation.findings) || [];
      if (findings.length === 0) {
        detailBody.innerHTML =
          '<div class="findings-clean">no validation findings — specimen is clean ✓</div>';
        return;
      }
      const html = findings
        .map((f) => {
          const lvl = (f.level || 'info').toLowerCase();
          const lvlClass =
            lvl === 'error' || lvl === 'danger'
              ? 'danger'
              : lvl === 'warning' || lvl === 'warn'
                ? 'warn'
                : 'info';
          return (
            '<div class="finding">' +
            `<div class="finding-level ${lvlClass}"></div>` +
            '<div class="finding-body">' +
            `<div class="finding-id">${escapeHtml(f.id || '')}</div>` +
            `<div class="finding-msg">${escapeHtml(f.msg || '')}</div>` +
            (f.path ? `<div class="finding-path">${escapeHtml(f.path)}</div>` : '') +
            '</div>' +
            '</div>'
          );
        })
        .join('');
      detailBody.innerHTML = '<div class="findings">' + html + '</div>';
    }

    function renderRaw() {
      const meta =
        '<div class="meta-line">' +
        escapeHtml(activeEnvelope.source) +
        ' · emitted ' +
        new Date(activeEnvelope.emittedAt).toISOString() +
        '</div>';
      detailBody.innerHTML =
        meta +
        '<div class="raw"><pre>' +
        escapeHtml(JSON.stringify(activeEnvelope.specimen, null, 2)) +
        '</pre></div>';
    }
  },

  /**
   * Optional unmount hook. Most cleanup is handled automatically:
   *   - addEventListener({signal}) detaches when registry aborts.
   *   - addCleanup queue runs (closes EventSource, removes <link>).
   *   - registry sweeps root.innerHTML.
   * Implementing unmount is only useful for non-resource teardown
   * (state flushing, custom logging). For Stream there's nothing
   * left to do, so we keep this minimal.
   */
  async unmount(_root) {
    // No-op. The contract documents that returning is sufficient.
  },
};
