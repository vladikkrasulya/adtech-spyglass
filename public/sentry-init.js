// public/sentry-init.js — vanilla browser error reporter for GlitchTip.
//
// ~70 LOC, no deps, no build step. Captures window.onerror +
// unhandledrejection and POSTs Sentry-compatible envelopes to the
// same-origin /glitchtip-ingest/* proxy (handled by modules/sentry-ingest
// server-side, forwarded to glitchtip-web:8000).
//
// DSN flows in via <meta name="sentry-dsn"> whose `content` is server-
// templated from SENTRY_DSN_PUBLIC env. When the env is unset, the meta
// content stays as `__SENTRY_DSN_PUBLIC__` and the reporter self-disables.
//
// Safety:
//   - Per-page hard cap: 20 events (a misbehaving page can't spray).
//   - Per-page dedup via message+top-stack-frame fingerprint.
//   - Server enforces 60 events/min/IP on top.
//   - fetch keepalive=true so events survive page unload.
//   - Wrapped in try/catch end-to-end — observability never breaks the app.

(function () {
  const meta = document.querySelector('meta[name="sentry-dsn"]');
  const dsn = meta && meta.content;
  if (!dsn || dsn.startsWith('__') || dsn.length < 10) return;

  let key, projectId, endpoint;
  try {
    // DSN: <scheme>://<key>@<host>[/<path>]/<projectId>
    // Endpoint per Sentry convention: <scheme>://<host>[/<path>]/api/<projectId>/envelope/
    const u = new URL(dsn);
    key = u.username;
    const segments = u.pathname.replace(/^\/|\/$/g, '').split('/');
    projectId = segments.pop();
    const subpath = segments.join('/');
    endpoint = u.origin + (subpath ? '/' + subpath : '') + '/api/' + projectId + '/envelope/';
    if (!key || !projectId) return;
  } catch (_e) {
    return;
  }

  const MAX_PER_PAGE = 20;
  let sent = 0;
  const seen = new Set();

  function fingerprint(err) {
    const msg = (err && err.message) || String(err || '');
    const topFrame = ((err && err.stack) || '').split('\n')[1] || '';
    return msg + '|' + topFrame;
  }

  function parseStack(stack) {
    if (!stack || typeof stack !== 'string') return [];
    return stack
      .split('\n')
      .slice(1, 20)
      .map((line) => {
        // Chrome: "    at funcName (https://host/file.js:12:34)"
        // Firefox: "funcName@https://host/file.js:12:34"
        const m =
          line.match(/at (?:(.+?)\s+\()?(\S+?):(\d+):(\d+)\)?$/) ||
          line.match(/(.*)@(.*?):(\d+):(\d+)$/);
        return m
          ? {
              function: (m[1] || '<anon>').trim(),
              filename: m[2],
              lineno: parseInt(m[3], 10),
              colno: parseInt(m[4], 10),
              in_app: m[2].indexOf(location.host) !== -1,
            }
          : { function: line.trim().slice(0, 200) };
      })
      .reverse(); // Sentry expects oldest frame first
  }

  function send(payload) {
    if (sent >= MAX_PER_PAGE) return;
    sent++;
    try {
      const eventId =
        (crypto.randomUUID ? crypto.randomUUID() : '').replace(/-/g, '') ||
        Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32);
      const sentAt = new Date().toISOString();
      const header = JSON.stringify({
        event_id: eventId,
        sent_at: sentAt,
        sdk: { name: 'spyglass.vanilla', version: '1.0' },
      });
      const itemHeader = JSON.stringify({ type: 'event' });
      const body = JSON.stringify({
        ...payload,
        event_id: eventId,
        timestamp: Date.now() / 1000,
      });
      const envelope = header + '\n' + itemHeader + '\n' + body;
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth':
            'Sentry sentry_version=7, sentry_key=' + key + ', sentry_client=spyglass-vanilla/1.0',
        },
        body: envelope,
        keepalive: true,
      }).catch(() => {});
    } catch (_e) {
      // never let observability throw into the app
    }
  }

  function capture(err, source) {
    try {
      const fp = fingerprint(err);
      if (seen.has(fp)) return;
      seen.add(fp);
      const e =
        err instanceof Error ? err : new Error(String(err && err.message ? err.message : err));
      send({
        level: 'error',
        platform: 'javascript',
        tags: {
          runtime: 'browser',
          source: source,
          locale: document.documentElement.lang || 'unknown',
        },
        contexts: {
          browser: { name: (navigator.userAgent || '').slice(0, 200) },
          page: {
            url: location.href.slice(0, 500),
            referrer: (document.referrer || '').slice(0, 200),
          },
        },
        exception: {
          values: [
            {
              type: e.name || 'Error',
              value: (e.message || '').slice(0, 500),
              stacktrace: { frames: parseStack(e.stack) },
            },
          ],
        },
      });
    } catch (_e) {
      // swallow
    }
  }

  window.addEventListener('error', function (ev) {
    capture(ev.error || new Error(ev.message || 'window.onerror'), 'window.onerror');
  });
  window.addEventListener('unhandledrejection', function (ev) {
    capture(ev.reason, 'unhandledrejection');
  });
})();
