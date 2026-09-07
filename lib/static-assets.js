'use strict';

// The static handler's single transformation and identity pipeline. Source files
// remain ordinary browser assets; no generated files or deployment store exists.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const IMPORT_RE =
  /(\b(?:from|import\s*(?:\(\s*)?)\s*['"])((?:\/|\.\.?\/)[^'"?]+\.js)(?:\?v=[^'"]*)?(['"])/g;
const TAG_RE =
  /(<(?:script|link)\b[^>]*?\b(?:src|href)=["'])(\/[^"'?]+\.(?:js|css))(?:\?v=[^"']*)?(["'])/g;
const CSS_LITERAL_RE = /(['"])(\/(?:core|modules)\/[A-Za-z0-9_./-]+\.css)(?:\?v=[^'"]*)?\1/g;
const PROBE_RE = /(['"])(\/creative-probe\.js)(?:\?v=[^'"]*)?\1/g;
const CSS_URL_RE = /(url\(\s*['"]?)(\/(?!\/)[^'"\s)]+)(['"]?\s*\))/g;
const BUNDLE_RE = /__([A-Z][A-Z0-9_]*)_BUNDLE_HASH__/g;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const STALE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
});

function createStaticAssets(publicDir, { immutable = false } = {}) {
  const root = fs.realpathSync(publicDir);
  const rendered = new Map();
  const bundles = new Map();
  const digest = (body) => crypto.createHash('sha256').update(body).digest('hex');
  function signature(target, stat) {
    // Timestamps can be identical for two same-size writes within one filesystem
    // clock tick. Validate bytes (and directory membership) before reusing a
    // transformed response, including on development and test servers.
    return stat.isDirectory()
      ? 'dir:' + digest(fs.readdirSync(target).sort().join('\0'))
      : digest(fs.readFileSync(target));
  }

  function locate(url) {
    const target = path.resolve(root, '.' + url);
    if (!target.startsWith(root + path.sep)) throw new Error('Asset path escapes public root');
    const real = fs.realpathSync(target);
    if (!real.startsWith(root + path.sep)) throw new Error('Asset symlink escapes public root');
    return real;
  }

  function record(target, deps) {
    const stat = fs.statSync(target, { bigint: true });
    deps.set(target, signature(target, stat));
    return stat;
  }

  function valid(entry) {
    if (!entry) return false;
    // Production source lives in an immutable image and never changes during
    // this process. Mutable development/fixture roots retain full verification.
    if (immutable) return true;
    for (const [target, expected] of entry.deps) {
      try {
        if (signature(target, fs.statSync(target, { bigint: true })) !== expected) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  function merge(target, source) {
    for (const [file, stamp] of source) target.set(file, stamp);
  }

  function canonical(specifier, source) {
    return new URL(specifier, `https://assets.invalid${source}`).pathname;
  }

  function recordMissing(url, deps) {
    let parent = path.dirname(path.resolve(root, '.' + url));
    while (parent.startsWith(root + path.sep) && !fs.existsSync(parent))
      parent = path.dirname(parent);
    record(parent, deps);
  }

  // Examples in comments are not executable imports (some even import their
  // own file). Preserve strings while masking comments at identical offsets.
  function codeMask(source) {
    return source.replace(
      /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
      (part) =>
        part.startsWith('//') || part.startsWith('/*') ? part.replace(/[^\r\n]/g, ' ') : part,
    );
  }

  function rewrite(source, regex, replace, javascript) {
    const mask = javascript ? codeMask(source) : source;
    return source.replace(regex, (...args) =>
      mask[args[args.length - 2]] === ' ' ? args[0] : replace(...args),
    );
  }

  // The bundle owns every file name and byte boundary in its directory, plus
  // source dependencies outside it. The latter matter when a template or CSS
  // reference is rewritten at delivery. Source-graph walking tolerates cycles;
  // no bundle identifier is fed back into its own digest.
  function bundle(moduleId, parentDeps) {
    if (!/^[a-z][a-z0-9_-]*$/.test(moduleId)) throw new Error('Invalid asset module');
    const cached = bundles.get(moduleId);
    if (valid(cached)) {
      merge(parentDeps, cached.deps);
      return cached.version;
    }
    const deps = new Map();
    const files = new Map();
    const directory = `/modules/${moduleId}`;
    function add(url) {
      if (files.has(url)) return;
      const target = locate(url);
      const stat = record(target, deps);
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(target).sort()) add(`${url}/${name}`);
        return;
      }
      const bytes = fs.readFileSync(target);
      files.set(url, bytes);
      if (!/\.(?:js|html|css)$/.test(url)) return;
      const source = url.endsWith('.js')
        ? codeMask(bytes.toString('utf8'))
        : bytes.toString('utf8');
      for (const regex of [IMPORT_RE, TAG_RE, CSS_LITERAL_RE, PROBE_RE, CSS_URL_RE]) {
        for (const match of source.matchAll(regex)) {
          const dependency = canonical(match[2], url);
          try {
            add(dependency);
          } catch (err) {
            if (err.code !== 'ENOENT') throw err;
            recordMissing(dependency, deps);
          }
        }
      }
    }
    add(directory);
    const hash = crypto.createHash('sha256');
    for (const [name, bytes] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
      hash.update(`${name}\0${bytes.length}\0`).update(bytes);
    }
    const version = 'm2-' + hash.digest('hex');
    bundles.set(moduleId, { version, deps });
    merge(parentDeps, deps);
    return version;
  }

  function transform(source, url, deps, visiting) {
    function reference(specifier) {
      const dependency = canonical(specifier, url);
      try {
        return `${dependency}?v=${asset(dependency, deps, visiting).version}`;
      } catch (err) {
        // Missing lazy dependencies retain native 404/import failure semantics.
        // Their containing directory is tracked so adding one invalidates cache.
        if (err.code !== 'ENOENT') throw err;
        recordMissing(dependency, deps);
        return specifier;
      }
    }
    let text = source;
    if (url.endsWith('.html')) {
      text = text.replace(
        TAG_RE,
        (_match, prefix, dependency, quote) => `${prefix}${reference(dependency)}${quote}`,
      );
    }
    if (/\.(?:js|html)$/.test(url)) {
      text = rewrite(
        text,
        IMPORT_RE,
        (_match, prefix, dependency, quote) => `${prefix}${reference(dependency)}${quote}`,
        url.endsWith('.js'),
      );
    }
    if (url.endsWith('.js')) {
      text = rewrite(
        text,
        CSS_LITERAL_RE,
        (_match, quote, dependency) => `${quote}${reference(dependency)}${quote}`,
        true,
      );
      text = rewrite(
        text,
        PROBE_RE,
        (_match, quote, dependency) => `${quote}${reference(dependency)}${quote}`,
        true,
      );
      text = rewrite(text, BUNDLE_RE, (_match, name) => bundle(name.toLowerCase(), deps), true);
    }
    if (url.endsWith('.css')) {
      text = text.replace(
        CSS_URL_RE,
        (_match, prefix, dependency, suffix) => `${prefix}${reference(dependency)}${suffix}`,
      );
    }
    return text;
  }

  function asset(url, parentDeps = new Map(), visiting = new Set()) {
    if (visiting.has(url)) throw new Error(`Cyclic asset version dependency: ${url}`);
    const cached = rendered.get(url);
    if (valid(cached)) {
      merge(parentDeps, cached.deps);
      return cached;
    }
    const deps = new Map();
    const target = locate(url);
    record(target, deps);
    // Track the lexical parent as well as the resolved file (new/removed links).
    record(path.dirname(path.resolve(root, '.' + url)), deps);
    const bytes = fs.readFileSync(target);
    visiting.add(url);
    let body;
    try {
      body = /\.(?:js|html|css)$/.test(url)
        ? Buffer.from(transform(bytes.toString('utf8'), url, deps, visiting))
        : bytes;
    } finally {
      visiting.delete(url);
    }
    const result = { body, version: 'a2-' + digest(body), deps };
    rendered.set(url, result);
    merge(parentDeps, deps);
    return result;
  }

  function cachePolicy(url, requestUrl) {
    const params = new URL(requestUrl, 'https://assets.invalid').searchParams;
    if (!params.has('v')) return { status: 200, headers: { 'Cache-Control': 'no-cache' } };
    const versions = params.getAll('v');
    const token = versions[0];
    const template = /^\/modules\/[a-z][a-z0-9_-]*\/template\.(?:en|uk|ru)\.html$/.test(url);
    const bundleMatch = url.match(
      /^\/modules\/([a-z][a-z0-9_-]*)\/(?:[^/]+\.css|template\.(?:en|uk|ru)\.html)$/,
    );
    // Entry HTML is request-dependent (SEO, embed, runtime configuration); its
    // source digest cannot make that response immutable. Only static templates
    // bypass those per-request transformations in the server.
    let accepted =
      versions.length === 1 &&
      /^a2-[a-f0-9]{64}$/.test(token) &&
      (!url.endsWith('.html') || template) &&
      token === asset(url).version;
    if (!accepted && versions.length === 1 && bundleMatch && /^m2-[a-f0-9]{64}$/.test(token)) {
      accepted = token === bundle(bundleMatch[1], new Map());
    }
    return accepted
      ? { status: 200, headers: { 'Cache-Control': IMMUTABLE } }
      : { status: 409, headers: { ...STALE_HEADERS } };
  }

  return {
    render: (url) => asset(url).body,
    version: (url) => asset(url).version,
    bundleVersion: (moduleId) => bundle(moduleId, new Map()),
    cachePolicy,
    isTemplate: (url) => /^\/modules\/[a-z][a-z0-9_-]*\/template\.(?:en|uk|ru)\.html$/.test(url),
  };
}

module.exports = { createStaticAssets };
