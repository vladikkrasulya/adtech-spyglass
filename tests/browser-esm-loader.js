'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, requestInterceptor } = require('jsdom');
const { createResourceAttemptObserver } = require('./blog-dom-assertions');

const PUBLIC_ROOT = path.resolve(__dirname, '..', 'public');
const ROOT_IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\/[^'"\n]+)\2(\s*\))?/gu;

const PARSER_FAILURE_SOURCE = `
const fail = () => { throw new Error('feature003 forced parser failure'); };
export class Marked {
  use() {}
  parse() { return fail(); }
  parser() { return fail(); }
}
export function marked() { return fail(); }
marked.parse = fail;
export default marked;
`;

const SANITIZER_FAILURE_SOURCE = `
const fail = () => { throw new Error('feature003 forced sanitizer failure'); };
function purifier() { return fail(); }
purifier.sanitize = fail;
export const sanitize = fail;
export default purifier;
`;

function throwingModuleSource(label) {
  return `throw new Error(${JSON.stringify(`feature003 forced ${label} failure`)});`;
}

function injectRenderBoundaryFailure(source) {
  const declaration = /(export\s+function\s+renderBlogBody\s*\([\s\S]*?\)\s*\{)/u;
  if (!declaration.test(source)) {
    throw new Error('feature003 renderer contract missing renderBlogBody export');
  }
  return source.replace(declaration, `$1\n  throw new Error('feature003 forced policy failure');`);
}

function failureLoaderOptions(mode) {
  /** @type {Record<string, any>} */
  const substitutions = {};
  /** @type {Record<string, (source: string) => string>} */
  const transforms = {};
  if (mode === 'dependency-load') {
    for (const specifier of [
      '/modules/blog/markdown-renderer.js',
      '/vendor/marked.es.js',
      '/vendor/marked.esm.min.js',
    ]) {
      substitutions[specifier] = throwingModuleSource('dependency-load');
    }
  } else if (mode === 'parser') {
    substitutions['/vendor/marked.es.js'] = PARSER_FAILURE_SOURCE;
    substitutions['/vendor/marked.esm.min.js'] = PARSER_FAILURE_SOURCE;
  } else if (mode === 'sanitizer') {
    substitutions['/vendor/dompurify.es.js'] = SANITIZER_FAILURE_SOURCE;
  } else if (mode === 'policy') {
    transforms['/modules/blog/markdown-renderer.js'] = injectRenderBoundaryFailure;
  }
  return { substitutions, transforms };
}

function canonicalRootSpecifier(specifier) {
  if (typeof specifier !== 'string' || !specifier.startsWith('/')) {
    throw new Error(`browser module specifier must be root-absolute: ${specifier}`);
  }
  const clean = specifier.split(/[?#]/u, 1)[0];
  const decoded = decodeURIComponent(clean);
  const filePath = path.resolve(PUBLIC_ROOT, `.${decoded}`);
  if (filePath !== PUBLIC_ROOT && !filePath.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
    throw new Error(`browser module escapes public root: ${specifier}`);
  }
  if (path.extname(filePath) !== '.js') {
    throw new Error(`browser module is not a JavaScript asset: ${specifier}`);
  }
  return { clean, filePath };
}

function substitutionSource(value, context) {
  if (typeof value === 'function') return String(value(context));
  if (value && typeof value === 'object' && Object.hasOwn(value, 'source')) {
    return String(value.source);
  }
  return String(value);
}

function createBrowserEsmLoader({ realmSalt, substitutions = {}, transforms = {}, delays = {} }) {
  if (!realmSalt || !/^[a-z0-9._-]+$/iu.test(realmSalt)) {
    throw new Error('a deterministic alphanumeric realmSalt is required');
  }

  const built = new Map();
  const building = new Set();

  async function build(specifier) {
    const { clean, filePath } = canonicalRootSpecifier(specifier);
    if (built.has(clean)) return built.get(clean);
    if (building.has(clean)) throw new Error(`browser module cycle is unsupported: ${clean}`);
    building.add(clean);

    let source;
    if (Object.hasOwn(substitutions, clean)) {
      source = substitutionSource(substitutions[clean], { specifier: clean, filePath });
    } else if (!fs.existsSync(filePath)) {
      // Preserve native dynamic-import timing: a missing lazily imported asset
      // rejects only when that import executes, not while the entry graph is
      // rewritten. A missing static dependency still rejects entry evaluation.
      source = throwingModuleSource(`missing browser module ${clean}`);
    } else {
      source = fs.readFileSync(filePath, 'utf8');
    }

    const dependencies = new Set();
    for (const match of source.matchAll(ROOT_IMPORT_RE)) dependencies.add(match[3]);
    const dependencyUrls = new Map();
    for (const dependency of dependencies) {
      dependencyUrls.set(dependency, await build(dependency));
    }

    source = source.replace(
      ROOT_IMPORT_RE,
      (full, prefix, quote, dependency, closingParen = '') =>
        `${prefix}${quote}${dependencyUrls.get(dependency)}${quote}${closingParen}`,
    );

    if (Object.hasOwn(delays, clean)) {
      const gateName = String(delays[clean]);
      source = `await globalThis[${JSON.stringify(gateName)}];\n${source}`;
    }
    if (Object.hasOwn(transforms, clean)) {
      source = String(transforms[clean](source, { specifier: clean, filePath }));
    }

    source += `\n//# sourceURL=feature003:${clean}?realm=${realmSalt}\n`;
    const digest = crypto
      .createHash('sha256')
      .update(realmSalt)
      .update('\0')
      .update(clean)
      .update('\0')
      .update(source)
      .digest('hex');
    const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${digest}`;
    built.set(clean, dataUrl);
    building.delete(clean);
    return dataUrl;
  }

  return {
    async import(specifier) {
      return import(await build(specifier));
    },
    async url(specifier) {
      return build(specifier);
    },
  };
}

/** @returns {{ promise: Promise<any>, resolve: (value?: any) => void, reject: (reason?: any) => void }} */
function deferred() {
  let resolve = (_value) => {};
  let reject = (_reason) => {};
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function installGlobalValues(values) {
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

function printable(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * @param {{
 *   post?: Record<string, any>,
 *   realmSalt: string,
 *   deferResponse?: boolean,
 *   loaderOptions?: {
 *     substitutions?: Record<string, any>,
 *     transforms?: Record<string, Function>,
 *     delays?: Record<string, string>
 *   },
 *   url?: string
 * }} options
 */
async function createBlogMountHarness(options) {
  const {
    post,
    realmSalt,
    deferResponse = false,
    loaderOptions = {},
    url = 'https://ortbtools.test/blog/en/feature003-post',
  } = options;
  const externalAttempts = [];
  const interceptResources = requestInterceptor((request, { element }) => {
    if (element && element.closest && element.closest('.blog-post__body')) {
      externalAttempts.push({
        kind: 'jsdom-resource-loader',
        tag: element.localName,
        url: String(request.url),
      });
    }
    return new Response('', { status: 204 });
  });
  const dom = new JSDOM('<!doctype html><body><main id="app-root"></main></body>', {
    resources: { interceptors: [interceptResources] },
    runScripts: 'outside-only',
    url,
  });
  const { window } = dom;
  const root = window.document.getElementById('app-root');
  const logs = [];
  const reports = [];
  const cleanupCallbacks = [];
  const responseGate = deferred();
  const fetchStartedGate = deferred();
  let fetchStarted = false;

  const consoleSpy = {};
  for (const method of ['debug', 'error', 'info', 'log', 'warn']) {
    consoleSpy[method] = (...args) => logs.push({ method, text: args.map(printable).join(' ') });
  }

  const responseFor = (payload) => ({
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
  });
  const browserFetch = async (input) => {
    const requestUrl = String(input && input.url ? input.url : input);
    if (requestUrl.startsWith('/api/v1/blog/post?')) {
      if (!fetchStarted) {
        fetchStarted = true;
        fetchStartedGate.resolve();
      }
      if (deferResponse) return responseFor(await responseGate.promise);
      return responseFor({ ok: true, post });
    }
    externalAttempts.push({ kind: 'fetch', url: requestUrl });
    throw new Error(`feature003 blocked unexpected fetch: ${requestUrl}`);
  };

  window.fetch = browserFetch;
  window.console = consoleSpy;
  window.Sentry = { captureException: (...args) => reports.push(args.map(printable).join(' ')) };
  window.reportError = (...args) => reports.push(args.map(printable).join(' '));

  const restoreGlobals = installGlobalValues({
    AbortController: window.AbortController,
    AbortSignal: window.AbortSignal,
    CustomEvent: window.CustomEvent,
    DocumentFragment: window.DocumentFragment,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MutationObserver: window.MutationObserver,
    Node: window.Node,
    URL: window.URL,
    URLSearchParams: window.URLSearchParams,
    console: consoleSpy,
    document: window.document,
    fetch: browserFetch,
    location: window.location,
    navigator: window.navigator,
    reportError: window.reportError,
    window,
  });
  const resourceObserver = createResourceAttemptObserver(window, externalAttempts);
  const esmLoader = createBrowserEsmLoader({ realmSalt, ...loaderOptions });
  let blogModule;
  try {
    blogModule = await esmLoader.import('/modules/blog/index.js');
  } catch (error) {
    resourceObserver.close();
    restoreGlobals();
    window.close();
    throw error;
  }
  const controller = new window.AbortController();
  const ctx = {
    addCleanup(callback) {
      cleanupCallbacks.push(callback);
    },
    lang: 'en',
    signal: controller.signal,
  };

  function addScopedRestore(callback) {
    cleanupCallbacks.push(callback);
    return callback;
  }

  return {
    blogModule,
    controller,
    dom,
    esmLoader,
    fetchStarted: fetchStartedGate.promise,
    logs,
    reports,
    resourceObserver,
    root,
    async mount() {
      return blogModule.default.mount(root, ctx);
    },
    resolvePost(nextPost = post) {
      responseGate.resolve({ ok: true, post: nextPost });
    },
    rejectPost(error) {
      responseGate.reject(error);
    },
    abort() {
      controller.abort();
    },
    detachRoot() {
      root.remove();
    },
    replaceRoot() {
      const replacement = window.document.createElement('main');
      replacement.id = 'app-root';
      root.replaceWith(replacement);
      return replacement;
    },
    failFragmentConstruction() {
      const original = window.document.createDocumentFragment;
      window.document.createDocumentFragment = () => {
        throw new Error('feature003 forced fragment failure');
      };
      return addScopedRestore(() => {
        window.document.createDocumentFragment = original;
      });
    },
    failBodyInsertion() {
      const original = window.Element.prototype.replaceChildren;
      window.Element.prototype.replaceChildren = function (...args) {
        if (this.matches && this.matches('.blog-post__body')) {
          throw new Error('feature003 forced insertion failure');
        }
        return original.apply(this, args);
      };
      return addScopedRestore(() => {
        window.Element.prototype.replaceChildren = original;
      });
    },
    async settle() {
      await resourceObserver.flush();
      await new Promise((resolve) => setImmediate(resolve));
      await resourceObserver.flush();
    },
    body() {
      return root.querySelector('.blog-post__body');
    },
    disclosureText() {
      return [...logs.map((entry) => entry.text), ...reports].join('\n');
    },
    async close() {
      for (const callback of cleanupCallbacks.splice(0).reverse()) {
        try {
          callback();
        } catch {}
      }
      resourceObserver.close();
      restoreGlobals();
      window.close();
    },
  };
}

module.exports = {
  PARSER_FAILURE_SOURCE,
  PUBLIC_ROOT,
  SANITIZER_FAILURE_SOURCE,
  createBlogMountHarness,
  createBrowserEsmLoader,
  failureLoaderOptions,
  throwingModuleSource,
};
