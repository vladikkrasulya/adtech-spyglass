(function () {
  'use strict';

  let inspectorReady = !!document.querySelector('#bidReq');
  // Queue of clicks that landed before the inspector mounted. Drained on
  // kt:inspector-ready. Replaces the per-click addEventListener pattern
  // which stacked one listener per impatient click and fired N fetches
  // when the inspector finally mounted.
  const pendingClicks = [];

  // Listen to the inspector readiness event
  window.addEventListener('kt:inspector-ready', () => {
    inspectorReady = true;
    init();
    while (pendingClicks.length) {
      const { sampleId, button } = pendingClicks.shift();
      loadSample(sampleId, button);
    }
  });

  // Safe label localization helper. The shell exposes window.t (see
  // public/i18n.js:948). Module bootstrap order means /i18n.js loads
  // eagerly before any deferred module script, so window.t is always
  // ready by the time we read it — but we still guard for safety.
  function getLabel(key, fallback) {
    if (typeof window.t === 'function') {
      try {
        return window.t(key);
      } catch (_e) {
        /* never let i18n lookup break a UI label */
      }
    }
    return fallback;
  }

  // Display brief inline error message that clears after 1.5s
  function showInlineError(button, message) {
    let errSpan = button.parentNode.querySelector(`.sp-err[data-for="${button.id}"]`);
    if (!errSpan) {
      errSpan = document.createElement('span');
      errSpan.className = 'sp-err';
      errSpan.setAttribute('data-for', button.id);
      button.parentNode.insertBefore(errSpan, button.nextSibling);
    }
    errSpan.textContent = getLabel(
      `sample_preview.err_${message.toLowerCase().replace(/\s+/g, '_')}`,
      message,
    );
    setTimeout(() => errSpan.remove(), 1500);
  }

  // Fetch from the static API, fill fields, and trigger analyzer
  async function executeFetch(sampleId, button, textarea, analyzeBtn) {
    button.disabled = true;
    button.classList.add('loading');

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`/api/sample-preview/${sampleId}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const json = data.json || data;

      textarea.value = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      analyzeBtn.click();
    } catch (err) {
      console.warn(`SpyglassSamplePreview: Failed to load sample "${sampleId}":`, err);
      showInlineError(button, 'Fetch failed');
    } finally {
      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, 1500 - elapsed);
      setTimeout(() => {
        button.disabled = false;
        button.classList.remove('loading');
      }, delay);
    }
  }

  // Handles CTA click and waits for inspector if not ready
  function loadSample(sampleId, button) {
    const textarea = document.querySelector('#bidReq');
    const analyzeBtn = document.querySelector('#analyzeBtn');

    if (!textarea || !analyzeBtn) {
      if (!inspectorReady) {
        // Queue once — the top-level kt:inspector-ready listener will
        // drain pendingClicks via loadSample again. Guard against the
        // same button being queued twice if the user mashes it.
        if (!pendingClicks.some((p) => p.button === button)) {
          pendingClicks.push({ sampleId, button });
        }
      } else {
        console.warn('SpyglassSamplePreview: Inspector elements missing.');
        showInlineError(button, 'Inspector missing');
      }
      return;
    }

    executeFetch(sampleId, button, textarea, analyzeBtn);
  }

  // Construct CTA buttons markup
  function createCTAContainer() {
    const container = document.createElement('div');
    container.className = 'sample-preview-cta';
    container.setAttribute('role', 'group');
    container.setAttribute(
      'aria-label',
      getLabel('sample_preview.aria_label', 'Load sample bid requests'),
    );

    const samples = [
      {
        id: 'sp-banner26',
        sample: 'banner26',
        text: 'Try OpenRTB 2.6 banner →',
        key: 'sample_preview.banner26',
      },
      {
        id: 'sp-video26',
        sample: 'video26',
        text: 'Try OpenRTB 2.6 video →',
        key: 'sample_preview.video26',
      },
      {
        id: 'sp-env30',
        sample: 'env30',
        text: 'Try OpenRTB 3.0 envelope →',
        key: 'sample_preview.env30',
      },
    ];

    samples.forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cta-btn';
      btn.id = s.id;
      btn.setAttribute('data-sample', s.sample);
      btn.textContent = getLabel(s.key, s.text);
      btn.addEventListener('click', () => loadSample(s.sample, btn));
      container.appendChild(btn);
    });

    return container;
  }

  // Main UI insertion point
  function init() {
    if (document.querySelector('.sample-preview-cta')) return;

    const heroUl = document.querySelector('.pre-render-hero ul');
    if (heroUl) {
      heroUl.parentNode.insertBefore(createCTAContainer(), heroUl.nextSibling);
    } else {
      const appRoot = document.getElementById('app-root');
      if (appRoot) {
        const header = appRoot.querySelector(
          'header, .header, .workbench-header, .inspector-header',
        );
        const container = createCTAContainer();
        if (header) {
          header.appendChild(container);
        } else {
          appRoot.insertBefore(container, appRoot.firstChild);
        }
      }
    }
  }

  // Bootstrap module
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export optional debug handle
  window.SpyglassSamplePreview = { init, loadSample };
})();
