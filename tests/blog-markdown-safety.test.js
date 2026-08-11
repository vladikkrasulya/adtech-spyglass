'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  FAILURE_MODES,
  SECURITY_CLASS_IDS,
  SECURITY_FIXTURES,
  SENTINEL_BODY,
  SOURCE_FIXTURES,
  URL_FIXTURES,
  assertFixedFixtureDenominators,
  loadCompatibilityFixtures,
} = require('./blog-markdown-fixtures');
const {
  assertInertBlogBody,
  inspectBlogBody,
  normalizeReadableText,
} = require('./blog-dom-assertions');
const {
  createBlogMountHarness,
  createBrowserEsmLoader,
  failureLoaderOptions,
} = require('./browser-esm-loader');

function makePost(body, source = 'markdown') {
  const post = {
    body,
    category: 'guide',
    lang: 'en',
    published_at: '2026-08-11T00:00:00Z',
    slug: 'feature003-post',
    summary: 'Synthetic feature 003 fixture',
    title: 'Feature 003 synthetic post',
    url: null,
  };
  if (source !== undefined) post.source = source;
  return post;
}

async function mountedHarness(options) {
  const harness = await createBlogMountHarness(options);
  await harness.mount();
  await harness.settle();
  return harness;
}

test('feature 003 fixture denominator and salted repository loader are deterministic', async () => {
  assert.doesNotThrow(assertFixedFixtureDenominators);
  assert.equal(SECURITY_FIXTURES.length, 20);
  assert.equal(SECURITY_CLASS_IDS.length, 20);
  assert.equal(URL_FIXTURES.length, 14);
  assert.equal(SOURCE_FIXTURES.length, 4);
  assert.equal(FAILURE_MODES.length, 6);

  const first = createBrowserEsmLoader({ realmSalt: 'loader-selftest-a' });
  const same = createBrowserEsmLoader({ realmSalt: 'loader-selftest-a' });
  const other = createBrowserEsmLoader({ realmSalt: 'loader-selftest-b' });
  assert.equal(await first.url('/core/utils.js'), await same.url('/core/utils.js'));
  assert.notEqual(await first.url('/core/utils.js'), await other.url('/core/utils.js'));
  await assert.rejects(() => first.url('/../server.js'), /escapes public root/u);
  await assert.rejects(() => first.url('/modules/blog/blog.css'), /not a JavaScript asset/u);

  const observerHarness = await createBlogMountHarness({
    post: makePost('observer self-test', 'db'),
    realmSalt: 'observer-selftest',
  });
  try {
    const namespaceBody = observerHarness.dom.window.document.createElement('div');
    namespaceBody.className = 'blog-post__body';
    const svgAnchor = observerHarness.dom.window.document.createElementNS(
      'http://www.w3.org/2000/svg',
      'a',
    );
    svgAnchor.textContent = 'feature003 SVG namespace marker';
    namespaceBody.appendChild(svgAnchor);
    observerHarness.root.replaceChildren(namespaceBody);
    assert.deepEqual(
      inspectBlogBody(namespaceBody, { expectedText: 'feature003 SVG namespace marker' })
        .violations,
      ['prohibited namespace http://www.w3.org/2000/svg for <a>'],
      'an allowed localName in the SVG namespace must still be rejected',
    );

    observerHarness.root.innerHTML =
      '<div class="blog-post__body"><img src="https://resource.invalid/observer.png"></div>';
    await assert.rejects(
      () => observerHarness.dom.window.fetch('https://fetch.invalid/observer'),
      /blocked unexpected fetch/u,
    );
    await observerHarness.resourceObserver.flush();
    assert.equal(
      observerHarness.resourceObserver.attempts.some(
        (attempt) => attempt.kind === 'dom-resource-capability',
      ),
      true,
      'observer must detect a body resource-capability attempt',
    );
    assert.equal(
      observerHarness.resourceObserver.attempts.some((attempt) => attempt.kind === 'fetch'),
      true,
      'observer must detect a fetch attempt',
    );
  } finally {
    await observerHarness.close();
  }
});

test('actual Blog mount applies one inert boundary to every source classification', async (t) => {
  const body = '<script>feature003 source marker</script>';
  for (const fixture of SOURCE_FIXTURES) {
    await t.test(`${fixture.id}: ${fixture.source || 'missing'}`, async () => {
      const harness = await mountedHarness({
        post: makePost(body, fixture.source),
        realmSalt: fixture.id.toLowerCase(),
      });
      try {
        assertInertBlogBody(harness.body(), {
          expectedText: 'feature003 source marker',
          resourceAttempts: harness.resourceObserver.attempts,
        });
      } finally {
        await harness.close();
      }
    });
  }
});

test('actual Blog mount closes the exact FR-013 final-DOM/resource denominator', async (t) => {
  for (const fixture of SECURITY_FIXTURES) {
    await t.test(`${fixture.id}: ${fixture.classId}`, async () => {
      const harness = await mountedHarness({
        post: makePost(fixture.markdown),
        realmSalt: fixture.id.toLowerCase(),
      });
      try {
        assertInertBlogBody(harness.body(), {
          expectedText: fixture.expectedText,
          resourceAttempts: harness.resourceObserver.attempts,
        });
      } finally {
        await harness.close();
      }
    });
  }
});

test('actual Blog mount preserves only the exact safe editorial URL set', async (t) => {
  for (const fixture of URL_FIXTURES) {
    await t.test(fixture.id, async () => {
      const markdown = `[${fixture.label}](${fixture.href})`;
      const harness = await mountedHarness({
        post: makePost(markdown),
        realmSalt: fixture.id.toLowerCase(),
      });
      try {
        const body = harness.body();
        assertInertBlogBody(body, {
          expectedText: fixture.label,
          resourceAttempts: harness.resourceObserver.attempts,
        });
        const link = [...body.querySelectorAll('a')].find(
          (candidate) => normalizeReadableText(candidate.textContent) === fixture.label,
        );
        if (fixture.allowed) {
          assert.ok(link, `${fixture.id} must retain a link`);
          assert.equal(
            link.href,
            new URL(fixture.expectedHref || fixture.href, body.ownerDocument.baseURI).href,
            `${fixture.id} must resolve against exact document.baseURI`,
          );
        } else {
          assert.equal(link, undefined, `${fixture.id} must retain text without navigation`);
        }
      } finally {
        await harness.close();
      }
    });
  }
});

test('every forced rendering failure fails to inert text without body disclosure', async (t) => {
  for (const mode of FAILURE_MODES) {
    await t.test(mode, async () => {
      const harness = await createBlogMountHarness({
        loaderOptions: failureLoaderOptions(mode),
        post: makePost(SENTINEL_BODY),
        realmSalt: `failure-${mode}`,
      });
      try {
        if (mode === 'fragment') harness.failFragmentConstruction();
        if (mode === 'insertion') harness.failBodyInsertion();
        await harness.mount();
        await harness.settle();

        assertInertBlogBody(harness.body(), {
          expectedText: 'feature003-body-nondisclosure-sentinel',
          resourceAttempts: harness.resourceObserver.attempts,
        });
        assert.equal(
          harness.body().childElementCount,
          0,
          `${mode} must use the exact text-only fallback`,
        );
        assert.equal(
          harness.body().textContent,
          SENTINEL_BODY,
          `${mode} must preserve the original body as text`,
        );
        assert.equal(
          harness.disclosureText().includes(SENTINEL_BODY),
          false,
          `${mode} must not disclose the body through console/reporting`,
        );
      } finally {
        await harness.close();
      }
    });
  }
});

test('abort while the post request is pending prevents a stale body paint', async () => {
  const harness = await createBlogMountHarness({
    deferResponse: true,
    post: makePost(SENTINEL_BODY),
    realmSalt: 'lifecycle-abort',
  });
  try {
    const mounting = harness.mount();
    await harness.fetchStarted;
    harness.abort();
    harness.resolvePost();
    await mounting;
    await harness.settle();
    assert.equal(harness.root.textContent.includes('feature003 failure marker'), false);
    assert.equal(harness.body(), null);
  } finally {
    await harness.close();
  }
});

test('aborted post mount cannot overwrite a reused root after a deferred non-AbortError rejection', async () => {
  /** @type {(value?: any) => void} */
  let markFetchStarted = () => {};
  /** @type {(reason?: any) => void} */
  let rejectFetch = () => {};
  const fetchStarted = new Promise((resolve) => {
    markFetchStarted = resolve;
  });
  const deferredResponse = new Promise((_resolve, reject) => {
    rejectFetch = reject;
  });
  let fetchCalls = 0;
  const deferredFetch = () => {
    fetchCalls += 1;
    markFetchStarted();
    return deferredResponse;
  };

  const harness = await createBlogMountHarness({
    post: makePost(SENTINEL_BODY),
    realmSalt: 'lifecycle-reused-root-rejection',
  });
  try {
    harness.dom.window.fetch = /** @type {any} */ (deferredFetch);
    globalThis.fetch = /** @type {any} */ (deferredFetch);
    const mounting = harness.mount();
    await fetchStarted;
    assert.equal(fetchCalls, 1);

    harness.abort();
    const newOwner = harness.dom.window.document.createElement('section');
    newOwner.dataset.feature003Owner = 'new';
    newOwner.textContent = 'feature003 new root owner';
    harness.root.replaceChildren(newOwner);

    rejectFetch(new Error('feature003 deferred transport failure'));
    await mounting;
    assert.equal(
      harness.root.firstElementChild,
      newOwner,
      'the aborted mount must not replace the new root owner after a late rejection',
    );
  } finally {
    await harness.close();
  }
});

test('aborted post mount cannot overwrite a reused root after a deferred 404 response', async () => {
  /** @type {(value?: any) => void} */
  let markFetchStarted = () => {};
  /** @type {(value: any) => void} */
  let resolveFetch = () => {};
  const fetchStarted = new Promise((resolve) => {
    markFetchStarted = resolve;
  });
  const deferredResponse = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  let fetchCalls = 0;
  const deferredFetch = () => {
    fetchCalls += 1;
    markFetchStarted();
    return deferredResponse;
  };

  const harness = await createBlogMountHarness({
    post: makePost(SENTINEL_BODY),
    realmSalt: 'lifecycle-reused-root-404',
  });
  try {
    harness.dom.window.fetch = /** @type {any} */ (deferredFetch);
    globalThis.fetch = /** @type {any} */ (deferredFetch);
    const mounting = harness.mount();
    await fetchStarted;
    assert.equal(fetchCalls, 1);

    harness.abort();
    const newOwner = harness.dom.window.document.createElement('section');
    newOwner.dataset.feature003Owner = 'new';
    newOwner.textContent = 'feature003 new root owner';
    harness.root.replaceChildren(newOwner);

    resolveFetch({ ok: false, status: 404 });
    await mounting;
    assert.equal(
      harness.root.firstElementChild,
      newOwner,
      'the aborted mount must not replace the new root owner after a late 404',
    );
  } finally {
    await harness.close();
  }
});

test('a delayed renderer cannot paint into a stale detached root', async () => {
  const gateName = '__feature003DelayedRenderer';
  /** @type {(value?: any) => void} */
  let releaseGate = () => {};
  globalThis[gateName] = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const harness = await createBlogMountHarness({
    loaderOptions: {
      delays: {
        '/modules/blog/markdown-renderer.js': gateName,
        '/vendor/marked.esm.min.js': gateName,
      },
    },
    post: makePost(SENTINEL_BODY),
    realmSalt: 'lifecycle-stale-root',
  });
  try {
    const mounting = harness.mount();
    await harness.fetchStarted;
    await new Promise((resolve) => setImmediate(resolve));
    harness.detachRoot();
    releaseGate();
    await mounting;
    await harness.settle();
    assert.equal(
      harness.root.textContent.includes('feature003 failure marker'),
      false,
      'detached root must not receive the delayed body',
    );
  } finally {
    delete globalThis[gateName];
    await harness.close();
  }
});

test('the DB characterization is independently inert before renderer hardening', async () => {
  const harness = await mountedHarness({
    post: makePost(
      '<img src="https://resource.invalid/db.png" onload="void 0" alt="db marker">',
      'db',
    ),
    realmSalt: 'safe-db-characterization',
  });
  try {
    const result = inspectBlogBody(harness.body(), {
      expectedText: 'db marker',
      resourceAttempts: harness.resourceObserver.attempts,
    });
    assert.deepEqual(result.violations, []);
  } finally {
    await harness.close();
  }
});

test('actual Blog mount preserves the complete tracked and synthetic compatibility corpus', async (t) => {
  const fixtures = loadCompatibilityFixtures();
  assert.equal(fixtures.length, 23, '20 fixed constructs plus three tracked localized posts');

  for (const fixture of fixtures) {
    await t.test(fixture.id, async () => {
      const harness = await mountedHarness({
        post: makePost(fixture.markdown),
        realmSalt: `compat-${fixture.id.toLowerCase().replace(/[^a-z0-9._-]/gu, '-')}`,
      });
      try {
        const body = harness.body();
        const expectations = /** @type {any} */ (fixture);
        assertInertBlogBody(body, {
          expectedText: fixture.expectedText,
          resourceAttempts: harness.resourceObserver.attempts,
        });
        for (const selector of fixture.expectedElements) {
          assert.ok(body.querySelector(selector), `${fixture.id} must preserve <${selector}>`);
        }
        for (const attribute of expectations.expectedAttributes || []) {
          const element = body.querySelector(attribute.selector);
          assert.ok(element, `${fixture.id} must preserve ${attribute.selector}`);
          assert.equal(
            element.getAttribute(attribute.name),
            attribute.value,
            `${fixture.id} must preserve ${attribute.selector}[${attribute.name}]`,
          );
        }
        if (expectations.expectedLink) {
          const link = body.querySelector('a');
          assert.ok(link, `${fixture.id} must preserve its editorial link`);
          assert.equal(
            link.getAttribute('href'),
            new URL(expectations.expectedLink.href, body.ownerDocument.baseURI).href,
            `${fixture.id} must preserve exact resolved href`,
          );
          assert.equal(
            link.getAttribute('rel'),
            expectations.expectedLink.rel,
            `${fixture.id} must preserve exact rel`,
          );
          assert.equal(
            link.getAttribute('title'),
            expectations.expectedLink.title,
            `${fixture.id} must preserve link title`,
          );
        }
        if (expectations.expectedNormalizedText !== undefined) {
          assert.equal(
            normalizeReadableText(body.textContent),
            expectations.expectedNormalizedText,
            `${fixture.id} must preserve literal raw-HTML delimiters as text`,
          );
        }
        if (expectations.expectedUtf8Bytes !== undefined) {
          assert.equal(
            Buffer.byteLength(fixture.markdown, 'utf8'),
            expectations.expectedUtf8Bytes,
            `${fixture.id} must retain the fixed 128 KiB input denominator`,
          );
        }
        if (expectations.expectExactNormalizedText) {
          const expectedNormalized = normalizeReadableText(fixture.markdown);
          const actualNormalized = normalizeReadableText(body.textContent);
          assert.equal(
            actualNormalized,
            expectedNormalized,
            `${fixture.id} must not truncate normalized browser text`,
          );
          assert.equal(
            actualNormalized.length,
            expectedNormalized.length,
            `${fixture.id} must preserve the complete normalized text length`,
          );
        }
        assert.equal(
          body.querySelector('img,input'),
          null,
          `${fixture.id} must create no resource/control`,
        );
      } finally {
        await harness.close();
      }
    });
  }
});
