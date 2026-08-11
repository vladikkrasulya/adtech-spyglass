'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Fixed synthetic denominators for feature 003.
 *
 * Keep these fixtures free of production content, real destinations, and
 * credentials. Their stable IDs are part of the regression evidence.
 */

const SECURITY_CLASS_IDS = Object.freeze([
  'active-script-element',
  'inline-event-attribute',
  'generic-mixedcase-event-attribute',
  'svg-namespace',
  'mathml-namespace',
  'embedded-iframe',
  'embedded-object',
  'embedded-embed',
  'form-control',
  'document-base-policy',
  'automatic-refresh-navigation',
  'style-element',
  'style-attribute',
  'resource-src',
  'resource-srcset',
  'unsafe-url-scheme',
  'entity-decoding',
  'repeated-decoding',
  'mixed-case-whitespace-control',
  'nested-malformed-markup',
]);

const SECURITY_FIXTURES = Object.freeze([
  {
    id: 'SEC-script-raw-001',
    classId: 'active-script-element',
    markdown: '<script>feature003 script marker</script>',
    expectedText: 'feature003 script marker',
  },
  {
    id: 'SEC-event-onerror-001',
    classId: 'inline-event-attribute',
    markdown:
      '<img src="https://resource.invalid/event.png" onerror="void 0" alt="feature003 event marker">',
    expectedText: 'feature003 event marker',
  },
  {
    id: 'SEC-event-mixedcase-001',
    classId: 'generic-mixedcase-event-attribute',
    markdown: '<p oNcLiCk="void 0">feature003 generic event marker</p>',
    expectedText: 'feature003 generic event marker',
  },
  {
    id: 'SEC-svg-001',
    classId: 'svg-namespace',
    markdown: '<svg><a href="javascript:feature003">feature003 svg marker</a></svg>',
    expectedText: 'feature003 svg marker',
  },
  {
    id: 'SEC-mathml-001',
    classId: 'mathml-namespace',
    markdown: '<math><mtext>feature003 math marker</mtext></math>',
    expectedText: 'feature003 math marker',
  },
  {
    id: 'SEC-iframe-001',
    classId: 'embedded-iframe',
    markdown: '<iframe src="https://resource.invalid/frame">feature003 iframe marker</iframe>',
    expectedText: 'feature003 iframe marker',
  },
  {
    id: 'SEC-object-001',
    classId: 'embedded-object',
    markdown: '<object data="https://resource.invalid/object">feature003 object marker</object>',
    expectedText: 'feature003 object marker',
  },
  {
    id: 'SEC-embed-001',
    classId: 'embedded-embed',
    markdown: '<embed src="https://resource.invalid/embed" title="feature003 embed marker">',
    expectedText: 'feature003 embed marker',
  },
  {
    id: 'SEC-form-001',
    classId: 'form-control',
    markdown:
      '<form action="https://resource.invalid/form"><button formaction="https://resource.invalid/button">feature003 form marker</button></form>',
    expectedText: 'feature003 form marker',
  },
  {
    id: 'SEC-base-001',
    classId: 'document-base-policy',
    markdown: '<base href="https://resource.invalid/base/"><p>feature003 base marker</p>',
    expectedText: 'feature003 base marker',
  },
  {
    id: 'SEC-refresh-001',
    classId: 'automatic-refresh-navigation',
    markdown:
      '<meta http-equiv="refresh" content="0;url=https://resource.invalid/refresh"><p>feature003 refresh marker</p>',
    expectedText: 'feature003 refresh marker',
  },
  {
    id: 'SEC-style-element-001',
    classId: 'style-element',
    markdown:
      '<style>.feature003{background:url(https://resource.invalid/style)}</style><p>feature003 style element marker</p>',
    expectedText: 'feature003 style element marker',
  },
  {
    id: 'SEC-style-attribute-001',
    classId: 'style-attribute',
    markdown:
      '<p style="background:url(https://resource.invalid/style-attribute)">feature003 style attribute marker</p>',
    expectedText: 'feature003 style attribute marker',
  },
  {
    id: 'SEC-resource-src-001',
    classId: 'resource-src',
    markdown: '![feature003 image marker](https://resource.invalid/image.png)',
    expectedText: 'feature003 image marker',
  },
  {
    id: 'SEC-resource-srcset-001',
    classId: 'resource-srcset',
    markdown:
      '<picture><source srcset="https://resource.invalid/a.png 1x"><img src="https://resource.invalid/b.png" alt="feature003 srcset marker"></picture>',
    expectedText: 'feature003 srcset marker',
  },
  {
    id: 'SEC-url-script-001',
    classId: 'unsafe-url-scheme',
    markdown: '[feature003 unsafe scheme marker](javascript:feature003)',
    expectedText: 'feature003 unsafe scheme marker',
  },
  {
    id: 'SEC-entity-onload-001',
    classId: 'entity-decoding',
    markdown:
      '&lt;img src=&quot;https://resource.invalid/entity.png&quot; onload=&quot;void 0&quot; alt=&quot;feature003 entity marker&quot;&gt;',
    expectedText: 'feature003 entity marker',
  },
  {
    id: 'SEC-repeated-decode-001',
    classId: 'repeated-decoding',
    markdown: '&amp;lt;script&amp;gt;feature003 repeated marker&amp;lt;/script&amp;gt;',
    expectedText: 'feature003 repeated marker',
  },
  {
    id: 'SEC-mixed-control-001',
    classId: 'mixed-case-whitespace-control',
    markdown: '<A HREF=" java&#x0A;script:feature003" ONFOCUS="void 0">feature003 mixed marker</A>',
    expectedText: 'feature003 mixed marker',
  },
  {
    id: 'SEC-malformed-nested-001',
    classId: 'nested-malformed-markup',
    markdown:
      '> nested feature003 malformed marker\n>\n> <scr<script>ipt><img src="https://resource.invalid/malformed">',
    expectedText: 'feature003 malformed marker',
  },
]);

const URL_FIXTURES = Object.freeze([
  {
    id: 'URL-safe-https-001',
    href: 'https://example.invalid/editorial',
    label: 'feature003 safe https',
    allowed: true,
  },
  {
    id: 'URL-safe-http-001',
    href: 'http://example.invalid/editorial',
    label: 'feature003 safe http',
    allowed: true,
  },
  {
    id: 'URL-safe-relative-001',
    href: '/docs/findings',
    label: 'feature003 safe relative',
    allowed: true,
  },
  {
    id: 'URL-safe-fragment-001',
    href: '#feature003-fragment',
    label: 'feature003 safe fragment',
    allowed: true,
  },
  {
    id: 'URL-safe-escaped-ampersand-001',
    href: 'https://example.invalid/editorial?a=1&amp;b=2',
    expectedHref: 'https://example.invalid/editorial?a=1&b=2',
    label: 'feature003 safe escaped ampersand',
    allowed: true,
  },
  {
    id: 'URL-safe-named-entity-literal-001',
    href: 'https://example.invalid/editorial?symbol=&copy;',
    label: 'feature003 safe named entity literal',
    allowed: true,
  },
  {
    id: 'URL-unsafe-javascript-001',
    href: 'javascript:feature003',
    label: 'feature003 unsafe javascript',
    allowed: false,
  },
  {
    id: 'URL-unsafe-data-001',
    href: 'data:text/html,feature003',
    label: 'feature003 unsafe data',
    allowed: false,
  },
  {
    id: 'URL-unsafe-vbscript-001',
    href: 'vbscript:feature003',
    label: 'feature003 unsafe vbscript',
    allowed: false,
  },
  {
    id: 'URL-unsafe-boundary-space-001',
    href: ' javascript:feature003',
    label: 'feature003 unsafe boundary space',
    allowed: false,
  },
  {
    id: 'URL-unsafe-control-001',
    href: 'java\u0009script:feature003',
    label: 'feature003 unsafe control',
    allowed: false,
  },
  {
    id: 'URL-unsafe-backslash-001',
    href: 'https:\\example.invalid\\feature003',
    label: 'feature003 unsafe backslash',
    allowed: false,
  },
  {
    id: 'URL-unsafe-entity-001',
    href: 'jav&#x61;script:feature003',
    label: 'feature003 unsafe entity',
    allowed: false,
  },
  {
    id: 'URL-unsafe-repeated-entity-001',
    href: 'java&#x26;#x73;cript:feature003',
    label: 'feature003 unsafe repeated entity',
    allowed: false,
  },
]);

const SOURCE_FIXTURES = Object.freeze([
  { id: 'SRC-markdown-001', source: 'markdown' },
  { id: 'SRC-db-001', source: 'db' },
  { id: 'SRC-unknown-001', source: 'future-source' },
  { id: 'SRC-missing-001', source: undefined },
]);

const FAILURE_MODES = Object.freeze([
  'dependency-load',
  'parser',
  'sanitizer',
  'policy',
  'fragment',
  'insertion',
]);

const SENTINEL_BODY =
  'feature003-body-nondisclosure-sentinel <script>feature003 failure marker</script>';

const LONG_TEXT_BODY = `${'feature003 long text '.repeat(7000)}feature003 long tail`.slice(
  0,
  128 * 1024,
);

const COMPATIBILITY_FIXTURES = Object.freeze([
  { id: 'COMP-empty-001', markdown: '', expectedText: '', expectedElements: [] },
  {
    id: 'COMP-paragraph-001',
    markdown: 'feature003 paragraph marker',
    expectedText: 'feature003 paragraph marker',
    expectedElements: ['p'],
  },
  {
    id: 'COMP-heading-001',
    markdown: '# feature003 heading marker',
    expectedText: 'feature003 heading marker',
    expectedElements: ['h1'],
  },
  {
    id: 'COMP-emphasis-001',
    markdown: '*feature003 emphasis marker*',
    expectedText: 'feature003 emphasis marker',
    expectedElements: ['em'],
  },
  {
    id: 'COMP-strong-001',
    markdown: '**feature003 strong marker**',
    expectedText: 'feature003 strong marker',
    expectedElements: ['strong'],
  },
  {
    id: 'COMP-unordered-list-001',
    markdown: '- feature003 unordered marker\n- second item',
    expectedText: 'feature003 unordered marker',
    expectedElements: ['ul', 'li'],
  },
  {
    id: 'COMP-ordered-list-001',
    markdown: '3. feature003 ordered marker\n4. second item',
    expectedText: 'feature003 ordered marker',
    expectedElements: ['ol', 'li'],
    expectedAttributes: [{ selector: 'ol', name: 'start', value: '3' }],
  },
  {
    id: 'COMP-blockquote-001',
    markdown: '> feature003 blockquote marker',
    expectedText: 'feature003 blockquote marker',
    expectedElements: ['blockquote'],
  },
  {
    id: 'COMP-inline-code-001',
    markdown: '`feature003 inline code marker`',
    expectedText: 'feature003 inline code marker',
    expectedElements: ['code'],
  },
  {
    id: 'COMP-fenced-code-001',
    markdown: '```text\nfeature003 fenced code marker\n```',
    expectedText: 'feature003 fenced code marker',
    expectedElements: ['pre', 'code'],
  },
  {
    id: 'COMP-table-001',
    markdown: '| feature003 table marker | value |\n| :--- | ---: |\n| row | cell |',
    expectedText: 'feature003 table marker',
    expectedElements: ['table', 'thead', 'tbody', 'tr', 'th', 'td'],
    expectedAttributes: [
      { selector: 'thead th:first-child', name: 'align', value: 'left' },
      { selector: 'thead th:last-child', name: 'align', value: 'right' },
      { selector: 'tbody td:first-child', name: 'align', value: 'left' },
      { selector: 'tbody td:last-child', name: 'align', value: 'right' },
    ],
  },
  {
    id: 'COMP-line-break-001',
    markdown: 'feature003 line marker  \nsecond line',
    expectedText: 'feature003 line marker',
    expectedElements: ['br'],
  },
  {
    id: 'COMP-thematic-break-001',
    markdown: 'feature003 before rule\n\n---\n\nfeature003 after rule',
    expectedText: 'feature003 before rule',
    expectedElements: ['hr'],
  },
  {
    id: 'COMP-strikethrough-001',
    markdown: '~~feature003 deleted marker~~',
    expectedText: 'feature003 deleted marker',
    expectedElements: ['del'],
  },
  {
    id: 'COMP-task-list-001',
    markdown: '- [x] feature003 checked marker\n- [ ] feature003 unchecked marker',
    expectedText: 'feature003 checked marker',
    expectedElements: ['ul', 'li'],
  },
  {
    id: 'COMP-safe-link-001',
    markdown: '[feature003 safe link marker](/docs "feature003 editorial link title")',
    expectedText: 'feature003 safe link marker',
    expectedElements: ['a'],
    expectedLink: {
      href: '/docs',
      rel: 'nofollow noopener',
      title: 'feature003 editorial link title',
    },
  },
  {
    id: 'COMP-raw-html-001',
    markdown: '<mark>feature003 raw html marker</mark>',
    expectedText: 'feature003 raw html marker',
    expectedElements: [],
    expectedNormalizedText: '<mark>feature003 raw html marker</mark>',
  },
  {
    id: 'COMP-image-alt-001',
    markdown: '![feature003 image alt marker](https://resource.invalid/compat.png)',
    expectedText: 'feature003 image alt marker',
    expectedElements: [],
  },
  {
    id: 'COMP-long-text-001',
    markdown: LONG_TEXT_BODY,
    expectedText: 'feature003 long text',
    expectedElements: ['p'],
    expectedUtf8Bytes: 128 * 1024,
    expectExactNormalizedText: true,
  },
  {
    id: 'COMP-lone-surrogate-001',
    markdown: 'feature003 lone surrogate \ud800 marker',
    expectedText: 'feature003 lone surrogate',
    expectedElements: ['p'],
  },
]);

function readableMarkerForMarkdown(markdown) {
  for (const rawLine of String(markdown).split(/\r?\n/u)) {
    const line = rawLine
      .trim()
      .replace(/^#{1,6}\s+/u, '')
      .replace(/^(?:>|[-+*]|\d+\.)\s+/u, '')
      .replace(/^\[[ xX]\]\s+/u, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/[*_~`]/gu, '')
      .replace(/<[^>]+>/gu, '')
      .trim();
    if (line && line !== '---' && !/^\|?\s*:?-+/u.test(line)) return line;
  }
  return '';
}

function loadTrackedMarkdownFixtures(contentRoot = path.join(__dirname, '..', 'content', 'posts')) {
  const fixtures = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const raw = fs.readFileSync(absolute, 'utf8');
        const frontmatter = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/u);
        const markdown = frontmatter ? frontmatter[1] : raw;
        const relativePath = path.relative(contentRoot, absolute).split(path.sep).join('/');
        fixtures.push({
          id: `TRACKED-${relativePath}`,
          kind: 'tracked',
          markdown,
          path: relativePath,
          expectedElements: [],
          expectedText: readableMarkerForMarkdown(markdown),
        });
      }
    }
  }
  walk(contentRoot);
  return fixtures.sort((a, b) => a.path.localeCompare(b.path));
}

function loadCompatibilityFixtures(contentRoot) {
  return [...COMPATIBILITY_FIXTURES, ...loadTrackedMarkdownFixtures(contentRoot)];
}

function assertFixedFixtureDenominators() {
  const classIds = SECURITY_FIXTURES.map((fixture) => fixture.classId);
  const fixtureIds = [
    ...SECURITY_FIXTURES.map((fixture) => fixture.id),
    ...URL_FIXTURES.map((fixture) => fixture.id),
    ...SOURCE_FIXTURES.map((fixture) => fixture.id),
  ];

  if (new Set(fixtureIds).size !== fixtureIds.length) {
    throw new Error('feature 003 fixture IDs must be globally unique');
  }
  if (new Set(classIds).size !== classIds.length) {
    throw new Error('feature 003 security classes must map one-to-one to fixtures');
  }
  if (
    classIds.length !== SECURITY_CLASS_IDS.length ||
    !SECURITY_CLASS_IDS.every((classId) => classIds.includes(classId))
  ) {
    throw new Error('feature 003 security class denominator drifted');
  }
  if (URL_FIXTURES.filter((fixture) => fixture.allowed).length !== 6) {
    throw new Error('feature 003 safe URL denominator drifted');
  }
  if (URL_FIXTURES.filter((fixture) => !fixture.allowed).length !== 8) {
    throw new Error('feature 003 unsafe URL denominator drifted');
  }
}

module.exports = {
  COMPATIBILITY_FIXTURES,
  FAILURE_MODES,
  LONG_TEXT_BODY,
  SECURITY_CLASS_IDS,
  SECURITY_FIXTURES,
  SENTINEL_BODY,
  SOURCE_FIXTURES,
  URL_FIXTURES,
  assertFixedFixtureDenominators,
  loadCompatibilityFixtures,
  loadTrackedMarkdownFixtures,
  readableMarkerForMarkdown,
};
