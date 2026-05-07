/* ============================================================
   public/modules/behavior/index.js — Behavior tab UI module.

   Phase 1 of the Behavior epic. Renders findings (engine output)
   above a raw event timeline (probe output) inside the inspector's
   `tBehavior` tab.

   Architecture (see Behavior R&D doc):
     - public/creative-probe.js         → captures events INSIDE sandbox
     - public/spyglass.app.js           → receives postMessage, validates
                                          source, stores in
                                          __spyglassBehavior.events,
                                          calls our render()
     - this module                      → fetches engine analysis,
                                          renders findings + timeline
     - packages/core/behavior/          → pure analysis (Node + browser
                                          via /api/analyze-behavior)

   Module contract: classic <script>, exposes window.SpyglassBehavior =
   { render }. Loaded alongside the legacy script chain (share.js,
   shortcuts.js, embed.js, export.js) — no ES-module ceremony, runs as
   soon as parsed.

   Why a fetch round-trip per render: keeps a single source of truth for
   analysis logic. The engine in packages/core/behavior/ runs identically
   server-side (Stream-pivot specimen replay) and via this endpoint.
   Render is debounced 150ms so a burst of probe events collapses to one
   request.
   ============================================================ */
(function () {
  'use strict';

  let _pendingTimer = null;
  let _lastEventCount = -1;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function severityForKind(kind) {
    // ERROR-tier patterns: clear fraud signal, no plausible legitimate cause.
    if (
      kind === 'click_skim_suspect' ||
      kind === 'invisible_overlay_click' ||
      kind === 'center_synth_click' ||
      kind === 'click_burst' ||
      kind === 'frame_bust_form' ||
      kind === 'heavy_ad_cpu' ||
      kind === 'heavy_ad_network' ||
      kind === 'frozen_thread'
    ) {
      return 'danger';
    }
    // WARNING-tier patterns: suspicious but with rare legitimate edge cases.
    // frame_bust_anchor severity actually depends on gesture context — the
    // engine finding splits ERROR vs WARNING — but the timeline marker
    // stays warning-level since the event itself isn't unambiguous.
    if (kind === 'auto_navigate' || kind === 'phantom_click' || kind === 'frame_bust_anchor') {
      return 'warning';
    }
    return 'info';
  }

  function severityForLevel(level) {
    if (level === 'error') return 'danger';
    if (level === 'warning') return 'warning';
    return 'info';
  }

  function severityIcon(sev) {
    if (sev === 'danger') return '✕';
    if (sev === 'warning') return '!';
    return 'i';
  }

  function renderFindings(findings, opts) {
    if (!findings || !findings.length) return '';
    const items = findings
      .map(function (f) {
        const sev = severityForLevel(f.level);
        const ic = severityIcon(sev);
        const id = escapeHtml(f.id || '');
        const msg = escapeHtml(f.msg || '');
        return (
          '<div class="validation-item ' +
          sev +
          '">' +
          '<span class="validation-icon">' +
          ic +
          '</span>' +
          '<span><strong>' +
          id +
          '</strong><br>' +
          msg +
          '</span></div>'
        );
      })
      .join('');
    const heading = opts.findingsHeading
      ? '<div class="behavior-section-heading">' + escapeHtml(opts.findingsHeading) + '</div>'
      : '';
    return '<div class="behavior-findings">' + heading + items + '</div>';
  }

  function renderTimeline(events, opts) {
    if (!events.length) return '';
    const labels = opts.kindLabels || {};
    const triggerLabel = opts.triggerLabel || 'trigger';
    const items = events
      .map(function (ev) {
        const sev = severityForKind(ev.kind);
        const ic = severityIcon(sev);
        const label = labels[ev.kind] || ev.kind;
        const url = ev.url ? String(ev.url) : '';
        const urlSnip = url.length > 90 ? escapeHtml(url.slice(0, 90)) + '…' : escapeHtml(url);
        return (
          '<div class="validation-item ' +
          sev +
          '">' +
          '<span class="validation-icon">' +
          ic +
          '</span>' +
          '<span><strong>' +
          escapeHtml(label) +
          '</strong>' +
          ' <span style="color:var(--text-dim);font-family:var(--font-mono);font-size:10px">' +
          escapeHtml(ev.method || '') +
          '</span>' +
          (url
            ? ' → <span style="font-family:var(--font-mono);font-size:11px;color:var(--text)">' +
              urlSnip +
              '</span>'
            : '') +
          (ev.trigger
            ? ' <span style="color:var(--text-dim);font-family:var(--font-mono);font-size:10px">[' +
              escapeHtml(triggerLabel) +
              ': ' +
              escapeHtml(ev.trigger) +
              ']</span>'
            : '') +
          '</span></div>'
        );
      })
      .join('');
    const heading = opts.timelineHeading
      ? '<div class="behavior-section-heading">' + escapeHtml(opts.timelineHeading) + '</div>'
      : '';
    return '<div class="behavior-timeline">' + heading + items + '</div>';
  }

  function paint(container, findings, events, opts) {
    container.innerHTML = renderFindings(findings, opts) + renderTimeline(events, opts);
  }

  function fetchAnalysis(events, locale) {
    // Phase 6: piggy-back the current creative's adm so the engine can
    // run static-payload scans (obfuscation, miners, XSS markers, entropy).
    // setAdPreview parks a (truncated) copy on __spyglassBehavior so we
    // don't have to wire a new function-arg pipeline through the parent.
    // Empty string when no preview is mounted — engine treats that as
    // "skip static analysis" and runs runtime-only rules.
    let adm = '';
    try {
      const ctx = window.__spyglassBehavior;
      if (ctx && typeof ctx.creative_adm === 'string') adm = ctx.creative_adm;
    } catch (e) {
      /* noop */
    }
    return fetch(
      '/api/analyze-behavior' + (locale ? '?locale=' + encodeURIComponent(locale) : ''),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: events, adm: adm }),
      },
    )
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  /**
   * Render the Behavior tab body.
   *
   * Called from spyglass.app.js's renderBehaviorTab on every probe event
   * arrival + every preview reset. The first render paints the timeline
   * synchronously (no findings yet) so users see *something* before the
   * engine round-trip resolves; the engine response then re-paints with
   * findings on top.
   *
   * @param {HTMLElement} container  the #tBehavior tab body
   * @param {Array<object>} allEvents  raw events including probe_ready
   * @param {object} opts  i18n labels + headings
   *   - emptyMessage:    string shown when there are no user-visible events
   *   - findingsHeading: section title for the findings list
   *   - timelineHeading: section title for the raw event log
   *   - triggerLabel:    label for the per-event "trigger: …" marker
   *   - kindLabels:      map of probe-event kind → localized string
   *   - locale:          (optional) explicit locale for engine i18n
   */
  function render(container, allEvents, opts) {
    if (!container) return;
    opts = opts || {};
    const events = (allEvents || []).filter(function (e) {
      return e && e.kind !== 'probe_ready';
    });

    if (!events.length) {
      container.innerHTML =
        '<div class="empty-hint">' + escapeHtml(opts.emptyMessage || '') + '</div>';
      _lastEventCount = 0;
      return;
    }

    // Fast path: render timeline first, before the fetch resolves.
    paint(container, [], events, opts);

    // Debounce the engine call. Multiple probe events can fire in quick
    // succession (e.g. addEventListener wrap + click on the same trap);
    // collapse them into one request.
    if (_pendingTimer) clearTimeout(_pendingTimer);
    const eventsSnapshot = (allEvents || []).slice();
    _pendingTimer = setTimeout(function () {
      _pendingTimer = null;
      fetchAnalysis(eventsSnapshot, opts.locale).then(function (data) {
        if (!data || !data.success) return;
        // The container may have been re-rendered for a *newer* set of
        // events while the request was in flight; only paint if the
        // visible event count still matches what we requested.
        const current = (window.__spyglassBehavior && window.__spyglassBehavior.events) || [];
        if (current.length !== eventsSnapshot.length) return;
        paint(container, data.findings || [], events, opts);
      });
    }, 150);

    _lastEventCount = events.length;
  }

  window.SpyglassBehavior = { render: render };
})();
