'use strict';

const assert = require('node:assert/strict');

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

const ALLOWED_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]);

const ALLOWED_ATTRIBUTES = Object.freeze({
  a: new Set(['href', 'title', 'rel']),
  ol: new Set(['start']),
  td: new Set(['align']),
  th: new Set(['align']),
});

const RESOURCE_ATTRIBUTES = Object.freeze({
  a: ['ping'],
  audio: ['src'],
  body: ['background'],
  button: ['formaction'],
  embed: ['src'],
  form: ['action'],
  iframe: ['src'],
  img: ['src', 'srcset'],
  input: ['src', 'formaction'],
  link: ['href'],
  object: ['data'],
  script: ['src'],
  source: ['src', 'srcset'],
  track: ['src'],
  video: ['src', 'poster'],
});

const BOUNDARY_WHITESPACE_RE = /^\s|\s$/u;

function containsControlCharacter(value) {
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function normalizeReadableText(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/gu, ' ')
    .trim();
}

function inspectBlogBody(body, { resourceAttempts = [], expectedText = '' } = {}) {
  const violations = [];
  if (!body || !body.matches || !body.matches('.blog-post__body')) {
    return { violations: ['missing final .blog-post__body'], text: '' };
  }

  for (const element of body.querySelectorAll('*')) {
    const tag = element.localName.toLowerCase();
    if (element.namespaceURI !== HTML_NAMESPACE) {
      violations.push(`prohibited namespace ${element.namespaceURI || 'null'} for <${tag}>`);
    }
    if (!ALLOWED_TAGS.has(tag)) violations.push(`prohibited element <${tag}>`);

    const allowedForElement = ALLOWED_ATTRIBUTES[tag] || new Set();
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        violations.push(`event attribute ${tag}[${name}]`);
      }
      if (!allowedForElement.has(name)) {
        violations.push(`prohibited attribute ${tag}[${name}]`);
      }
    }

    if (tag === 'a' && element.hasAttribute('href')) {
      const rawHref = element.getAttribute('href');
      if (
        !rawHref ||
        containsControlCharacter(rawHref) ||
        BOUNDARY_WHITESPACE_RE.test(rawHref) ||
        rawHref.includes('\\')
      ) {
        violations.push(`ambiguous link href ${JSON.stringify(rawHref)}`);
      } else {
        try {
          const resolved = new body.ownerDocument.defaultView.URL(
            rawHref,
            body.ownerDocument.baseURI,
          );
          if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
            violations.push(`unsafe link protocol ${resolved.protocol}`);
          }
        } catch {
          violations.push(`malformed link href ${JSON.stringify(rawHref)}`);
        }
      }

      const rel = new Set(
        String(element.getAttribute('rel') || '')
          .toLowerCase()
          .split(/\s+/u)
          .filter(Boolean),
      );
      if (rel.size !== 2 || !rel.has('nofollow') || !rel.has('noopener')) {
        violations.push('retained link lacks exact nofollow noopener rel');
      }
    }
  }

  const text = normalizeReadableText(body.textContent);
  const expected = normalizeReadableText(expectedText);
  if (expected && !text.includes(expected)) {
    violations.push(`readable marker missing: ${JSON.stringify(expected)}`);
  }
  if (resourceAttempts.length) {
    violations.push(`body resource/fetch attempts: ${resourceAttempts.length}`);
  }

  return { violations: [...new Set(violations)], text };
}

function assertInertBlogBody(body, options) {
  const result = inspectBlogBody(body, options);
  assert.deepEqual(result.violations, []);
  return result;
}

function resourceCapabilitiesIn(body) {
  if (!body) return [];
  const capabilities = [];
  const elements = [body, ...body.querySelectorAll('*')];
  for (const element of elements) {
    const tag = element.localName && element.localName.toLowerCase();
    if (!tag) continue;
    for (const attribute of RESOURCE_ATTRIBUTES[tag] || []) {
      if (element.hasAttribute(attribute)) {
        capabilities.push({
          kind: 'dom-resource-capability',
          tag,
          attribute,
          value: element.getAttribute(attribute),
        });
      }
    }
    if (
      (element.hasAttribute('style') &&
        /(?:url\s*\(|@import)/iu.test(element.getAttribute('style'))) ||
      (tag === 'style' && /(?:url\s*\(|@import)/iu.test(element.textContent || ''))
    ) {
      capabilities.push({ kind: 'style-resource-capability', tag });
    }
  }
  return capabilities;
}

function createResourceAttemptObserver(window, externalAttempts = []) {
  const mutationAttempts = [];
  const seen = new Set();

  function recordMany(attempts) {
    for (const attempt of attempts) {
      const key = JSON.stringify(attempt);
      if (!seen.has(key)) {
        seen.add(key);
        mutationAttempts.push(attempt);
      }
    }
  }

  const observer = new window.MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== window.Node.ELEMENT_NODE) continue;
        if (node.matches('.blog-post__body')) recordMany(resourceCapabilitiesIn(node));
        for (const body of node.querySelectorAll('.blog-post__body')) {
          recordMany(resourceCapabilitiesIn(body));
        }
        const owningBody = node.closest('.blog-post__body');
        if (owningBody) recordMany(resourceCapabilitiesIn(owningBody));
      }
      if (
        record.type === 'attributes' &&
        record.target.closest &&
        record.target.closest('.blog-post__body')
      ) {
        recordMany(resourceCapabilitiesIn(record.target.closest('.blog-post__body')));
      }
    }
  });
  observer.observe(window.document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  return {
    record(attempt) {
      externalAttempts.push(attempt);
    },
    async flush() {
      await Promise.resolve();
      await Promise.resolve();
      recordMany(resourceCapabilitiesIn(window.document.querySelector('.blog-post__body')));
      return this.attempts;
    },
    get attempts() {
      return [...externalAttempts, ...mutationAttempts];
    },
    close() {
      observer.disconnect();
    },
  };
}

module.exports = {
  ALLOWED_ATTRIBUTES,
  ALLOWED_TAGS,
  HTML_NAMESPACE,
  assertInertBlogBody,
  createResourceAttemptObserver,
  inspectBlogBody,
  normalizeReadableText,
  resourceCapabilitiesIn,
};
