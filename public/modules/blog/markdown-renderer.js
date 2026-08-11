/* ============================================================
   public/modules/blog/markdown-renderer.js — one final Blog-body boundary.

   Every body is untrusted. Editorial Markdown keeps the supported Marked
   grammar through controlled renderers; the existing escape-first news HTML
   enters through `limitedHtml`. Both paths leave this module only as a closed,
   sanitized DocumentFragment.
   ============================================================ */
'use strict';

import DOMPurify from '/vendor/dompurify.es.js';
import { Marked } from '/vendor/marked.es.js';

const ALLOWED_TAGS = Object.freeze([
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

const ALLOWED_ATTRIBUTES = Object.freeze(['href', 'title', 'rel', 'start', 'align']);
const HTML_ENTITY_RE = /&(?:#[0-9]+|#x[0-9a-f]+|amp|apos|gt|lt|quot);/iu;
const HTML_ENTITY_GLOBAL_RE = /&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/giu;
const SAFE_NAMED_ENTITIES = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
});

const SANITIZER_CONFIG = Object.freeze({
  ALLOWED_TAGS,
  ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  RETURN_DOM_FRAGMENT: true,
});

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasControlOrBoundaryWhitespace(value) {
  if (/^\s|\s$/u.test(value)) return true;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function decodeUrlEntitiesOnce(value) {
  let invalid = false;
  const decoded = value.replace(HTML_ENTITY_GLOBAL_RE, (entity) => {
    const body = entity.slice(1, -1);
    if (body.startsWith('#')) {
      const hexadecimal = body[1]?.toLowerCase() === 'x';
      const digits = body.slice(hexadecimal ? 2 : 1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (
        !Number.isInteger(codePoint) ||
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        invalid = true;
        return entity;
      }
      return String.fromCodePoint(codePoint);
    }

    const named = SAFE_NAMED_ENTITIES[body.toLowerCase()];
    if (named === undefined) {
      // Unknown named references stay literal. `escapeHtml()` adds one more
      // layer before the controlled anchor HTML is parsed, so they cannot
      // become a hidden delimiter or protocol on insertion.
      return entity;
    }
    return named;
  });

  // One decode preserves ordinary escaped query separators while refusing
  // repeated/unknown entity ambiguity before URL parsing.
  if (invalid || HTML_ENTITY_RE.test(decoded)) return null;
  return decoded;
}

function safeLinkHref(value, baseUrl) {
  const href = String(value == null ? '' : value);
  if (!href) return null;
  const normalized = decodeUrlEntitiesOnce(href);
  if (
    normalized == null ||
    hasControlOrBoundaryWhitespace(normalized) ||
    normalized.includes('\\')
  ) {
    return null;
  }

  let resolved;
  try {
    resolved = new URL(normalized, baseUrl);
  } catch {
    return null;
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
  return resolved.href;
}

function editorialHtml(markdown, baseUrl) {
  const renderer = {
    html({ text }) {
      return escapeHtml(text);
    },
    image({ text }) {
      return escapeHtml(text);
    },
    checkbox({ checked }) {
      return checked ? '☒' : '☐';
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const safeHref = safeLinkHref(href, baseUrl);
      if (!safeHref) return label;
      const safeTitle = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(safeHref)}"${safeTitle} rel="nofollow noopener">${label}</a>`;
    },
  };

  const parser = new Marked({ gfm: true, renderer });
  const html = parser.parse(String(markdown == null ? '' : markdown));
  if (typeof html !== 'string') throw new TypeError('Blog Markdown parser returned a non-string');
  return html;
}

function purifier() {
  if (DOMPurify && typeof DOMPurify.sanitize === 'function') return DOMPurify;
  if (typeof DOMPurify === 'function') {
    const instance = DOMPurify(window);
    if (instance && typeof instance.sanitize === 'function') return instance;
  }
  throw new TypeError('Blog sanitizer is unavailable');
}

/**
 * Render a Blog body to a main-document fragment.
 *
 * `limitedHtml` must be the existing escape-first representation used for
 * non-editorial/unknown sources. It still crosses the same final sanitizer.
 */
export function renderBlogBody(
  body,
  { source, limitedHtml = '', baseUrl = document.baseURI } = {},
) {
  const original = String(body == null ? '' : body);
  const candidate =
    source === 'markdown' ? editorialHtml(original, baseUrl) : String(limitedHtml || '');
  const sanitized = purifier().sanitize(candidate, SANITIZER_CONFIG);

  if (!sanitized || sanitized.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    throw new TypeError('Blog sanitizer did not return a DocumentFragment');
  }

  // Keep the insertion fragment owned by the active document. Moving already
  // sanitized nodes is a DOM operation, not an HTML reparse.
  const fragment = document.createDocumentFragment();
  while (sanitized.firstChild) fragment.appendChild(sanitized.firstChild);
  return fragment;
}

export { ALLOWED_ATTRIBUTES, ALLOWED_TAGS, SANITIZER_CONFIG, safeLinkHref };
