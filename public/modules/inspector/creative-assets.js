/* Explicit raster loading for the sealed creative preview. The manifest keeps
 * successful resources across retries; only a user action can start a batch.
 * Neither this parser nor the rendered frame fetches advertiser resources. */
(function () {
  'use strict';
  const MAX_ASSETS = 12;
  const IMAGE_PROPERTIES =
    /^(?:background(?:-image)?|border-image(?:-source)?|list-style(?:-image)?|(?:-webkit-)?mask(?:-image)?|content|cursor)$/i;
  const RASTER_DATA =
    /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon);base64,[a-zA-Z0-9+/]+=*$/;
  function t(key, params) {
    return typeof window.t === 'function' ? window.t(key, params) : key;
  }
  function remote(value) {
    if (!/^https?:\/\//i.test(value || '')) return null;
    try {
      const url = new URL(value);
      if (url.username || url.password) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }
  function unescapeCss(value) {
    return value.replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi, (_match, hex, char) => {
      const point = hex && parseInt(hex, 16);
      return hex ? String.fromCodePoint(point > 0 && point <= 0x10ffff ? point : 0xfffd) : char;
    });
  }
  // URL tokens are rewritten only inside supported image declarations. Strings,
  // comments, delimiters inside functions and other CSS properties stay intact.
  function cssImageRanges(css) {
    const ranges = [];
    let start = 0,
      colon = -1,
      quote = '',
      comment = false,
      depth = 0;
    const consume = (end) => {
      if (colon < 0) return;
      const property = css
        .slice(start, colon)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
      if (!IMAGE_PROPERTIES.test(property)) return;
      const value = css.slice(colon + 1, end);
      const rx = /^url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^)\\])*))\s*\)/i;
      let inQuote = '',
        inComment = false;
      const functions = [];
      for (let i = 0; i < value.length; i++) {
        const c = value[i],
          next = value[i + 1];
        if (inComment) {
          if (c === '*' && next === '/') {
            inComment = false;
            i++;
          }
          continue;
        }
        if (inQuote) {
          if (c === '\\') i++;
          else if (c === inQuote) inQuote = '';
          continue;
        }
        if (c === '/' && next === '*') {
          inComment = true;
          i++;
          continue;
        }
        if (c === '"' || c === "'") {
          if (/^(?:-webkit-)?image-set$/i.test(functions.at(-1) || '')) {
            let end = i + 1;
            while (end < value.length && value[end] !== c) {
              if (value[end] === '\\') end++;
              end++;
            }
            if (end < value.length) {
              const url = remote(unescapeCss(value.slice(i + 1, end)));
              if (url) ranges.push({ start: colon + 1 + i, end: colon + 2 + end, url });
              i = end;
              continue;
            }
          }
          inQuote = c;
          continue;
        }
        if (c === '(') functions.push((/([-\w]+)$/.exec(value.slice(0, i)) || [])[1] || '');
        if (c === ')') functions.pop();
        if (i && /[\w-]/.test(value[i - 1])) continue;
        const m = rx.exec(value.slice(i));
        if (!m) continue;
        const url = remote(unescapeCss((m[1] ?? m[2] ?? m[3]).trim()));
        if (url) ranges.push({ start: colon + 1 + i, end: colon + 1 + i + m[0].length, url });
        i += m[0].length - 1;
      }
    };
    for (let i = 0; i < css.length; i++) {
      const c = css[i],
        next = css[i + 1];
      if (comment) {
        if (c === '*' && next === '/') {
          comment = false;
          i++;
        }
        continue;
      }
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '/' && next === '*') {
        comment = true;
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === '(') {
        depth++;
        continue;
      }
      if (c === ')') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth) continue;
      if (c === ':' && colon < 0) colon = i;
      if (c === '{' || c === '}' || c === ';') {
        if (c !== '{') consume(i);
        start = i + 1;
        colon = -1;
      }
    }
    consume(css.length);
    return ranges;
  }
  // The URL token ends at whitespace, not a comma inside a data URI or URL.
  // Descriptors remain exactly as authored. This also covers picture sources.
  function srcsetRanges(value) {
    const ranges = [];
    let i = 0;
    while (i < value.length) {
      while (/[\s,]/.test(value[i] || '') && i < value.length) i++;
      const start = i;
      while (i < value.length && !/\s/.test(value[i])) i++;
      let end = i;
      while (end > start && value[end - 1] === ',') end--;
      const url = remote(value.slice(start, end));
      if (url) ranges.push({ start, end, url });
      if (end < i) continue;
      let depth = 0;
      while (i < value.length) {
        const c = value[i++];
        if (c === '(') depth++;
        if (c === ')') depth = Math.max(0, depth - 1);
        if (c === ',' && !depth) break;
      }
    }
    return ranges;
  }
  function references(doc) {
    const refs = [];
    const attr = (selector, name, role, parser) => {
      for (const el of doc.querySelectorAll(selector)) {
        const value = el.getAttribute(name) || '';
        const ranges = parser
          ? parser(value)
          : [{ start: 0, end: value.length, url: remote(value) }].filter((r) => r.url);
        if (ranges.length) refs.push({ el, name, value, role, ranges });
      }
    };
    attr('img[src]', 'src', 'image');
    attr('video[poster]', 'poster', 'poster');
    attr('img[srcset], picture > source[srcset]', 'srcset', 'responsive', srcsetRanges);
    attr('[style]', 'style', 'css', cssImageRanges);
    for (const el of doc.querySelectorAll('style')) {
      const value = el.textContent || '';
      const ranges = cssImageRanges(value);
      if (ranges.length) refs.push({ el, name: null, value, role: 'css', ranges });
    }
    return refs;
  }
  function createManifest(html) {
    const source = String(html || '');
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const seen = new Map();
    for (const ref of references(doc))
      for (const range of ref.ranges) {
        let entry = seen.get(range.url);
        if (!entry) {
          entry = {
            url: range.url,
            host: new URL(range.url).host,
            roles: [],
            status: 'pending',
            code: null,
            dataUri: null,
          };
          seen.set(range.url, entry);
        }
        if (!entry.roles.includes(ref.role)) entry.roles.push(ref.role);
      }
    return {
      source,
      entries: [...seen.values()].slice(0, MAX_ASSETS),
      total: seen.size,
      omitted: Math.max(0, seen.size - MAX_ASSETS),
      cap: MAX_ASSETS,
    };
  }
  function collectRemoteUrls(html) {
    return createManifest(html).entries.map((entry) => entry.url);
  }
  function rewrittenHtml(manifest) {
    const loaded = new Map(
      manifest.entries.filter((e) => e.status === 'loaded').map((e) => [e.url, e.dataUri]),
    );
    if (!loaded.size) return manifest.source;
    const doc = new DOMParser().parseFromString(manifest.source, 'text/html');
    for (const ref of references(doc)) {
      let value = ref.value;
      for (const range of [...ref.ranges].reverse()) {
        if (!loaded.has(range.url)) continue;
        const replacement =
          ref.role === 'css' ? 'url("' + loaded.get(range.url) + '")' : loaded.get(range.url);
        value = value.slice(0, range.start) + replacement + value.slice(range.end);
      }
      if (ref.name) ref.el.setAttribute(ref.name, value);
      else ref.el.textContent = value;
    }
    // Keep the original document structure, including styles in <head>. The
    // preview wrapper accepts complete HTML as well as fragments.
    const doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : '';
    return doctype + doc.documentElement.outerHTML;
  }
  async function inlineAssets(html, options) {
    const opts = options || {};
    const manifest = opts.manifest || createManifest(html);
    const signal = opts.signal;
    let inlined = 0;
    const failed = [];
    const progress = () => {
      if (opts.onProgress && !(signal && signal.aborted)) opts.onProgress(manifest);
    };
    for (const entry of manifest.entries) {
      if (signal && signal.aborted) break;
      if (entry.status === 'loaded') continue;
      entry.status = 'loading';
      entry.code = null;
      progress();
      try {
        const response = await fetch('/api/creative/asset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: entry.url }),
          ...(signal ? { signal } : {}),
        });
        const result = await response.json().catch(() => null);
        if (signal && signal.aborted) break;
        if (
          response.ok &&
          result &&
          result.ok &&
          typeof result.dataUri === 'string' &&
          RASTER_DATA.test(result.dataUri)
        ) {
          entry.status = 'loaded';
          entry.dataUri = result.dataUri;
          inlined++;
        } else {
          entry.status = 'failed';
          entry.code = result && typeof result.code === 'string' ? result.code : 'invalid_response';
        }
      } catch (_) {
        if (signal && signal.aborted) break;
        entry.status = 'failed';
        entry.code = 'network';
      }
      if (entry.status === 'failed') failed.push({ url: entry.url, code: entry.code });
      progress();
    }
    const cancelled = !!(signal && signal.aborted);
    if (cancelled)
      for (const entry of manifest.entries)
        if (entry.status === 'loading' || entry.status === 'pending') entry.status = 'cancelled';
    return { html: rewrittenHtml(manifest), inlined, failed, cancelled, manifest };
  }
  function describe(res) {
    if (res.cancelled) return t('creative.assets.cancelled');
    if (!res.inlined && res.failed.length)
      return t('creative.assets.all_failed', { n: res.failed.length });
    if (res.failed.length)
      return t('creative.assets.partial', { ok: res.inlined, bad: res.failed.length });
    return t('creative.assets.loaded', { n: res.inlined });
  }
  window.OrtbtoolsCreativeAssets = {
    createManifest,
    collectRemoteUrls,
    inlineAssets,
    describe,
    MAX_ASSETS,
  };
})();
