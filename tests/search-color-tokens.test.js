'use strict';

/**
 * Search badges used to carry fourteen theme-specific hex colours in their
 * component stylesheet. This pins both halves of the replacement: semantic
 * token use at the call site and readable token values in both themes.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SEARCH_RAW = fs.readFileSync(path.join(ROOT, 'public/modules/search/search.css'), 'utf8');
const TOKENS_RAW = fs.readFileSync(path.join(ROOT, 'public/ortbtools-v2.css'), 'utf8');
const DESIGN_RAW = fs.readFileSync(path.join(ROOT, 'public/design-system.css'), 'utf8');
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//gu, '');
const SEARCH = stripComments(SEARCH_RAW);
const TOKENS = stripComments(TOKENS_RAW);
const DESIGN = stripComments(DESIGN_RAW);

const BADGES = {
  sample: '--badge-warning-ink',
  behavior: '--badge-danger-ink',
  'finding-error': '--badge-danger-ink',
  'finding-warning': '--badge-warning-ink',
  'finding-info': '--badge-info-ink',
  blog: '--badge-success-ink',
  landing: '--badge-reference-ink',
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function ruleBodies(source, selector) {
  return [
    ...source.matchAll(new RegExp(`(?:^|\\n)\\s*${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, 'gu')),
  ].map((match) => match[1]);
}

function ruleBody(source, selector) {
  const bodies = ruleBodies(source, selector);
  assert.ok(bodies.length, `missing CSS rule: ${selector}`);
  return bodies[0];
}

function declaration(body, property) {
  const match = new RegExp(`\\b${escapeRegExp(property)}\\s*:\\s*([^;]+);`, 'u').exec(body);
  assert.ok(match, `missing declaration: ${property}`);
  return match[1].trim();
}

function scopedTokenValue(source, selector, name) {
  const values = [];
  const pattern = new RegExp(`${escapeRegExp(name)}\\s*:\\s*(#[0-9a-f]{6});`, 'iu');
  for (const body of ruleBodies(source, selector)) {
    const match = pattern.exec(body);
    if (match) values.push(match[1]);
  }
  assert.equal(values.length, 1, `${name} must be defined once in ${selector}`);
  return values[0];
}

function hexRgb(value) {
  return [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16));
}

function rgba(value) {
  const match = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/u.exec(value);
  assert.ok(match, `expected rgba(), got: ${value}`);
  return { rgb: match.slice(1, 4).map(Number), alpha: Number(match[4]) };
}

function composite(foreground, alpha, background) {
  return foreground.map((channel, index) => channel * alpha + background[index] * (1 - alpha));
}

function luminance(rgb) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test('search.css contains no hardcoded hex colours and badges use semantic ink tokens', () => {
  assert.doesNotMatch(SEARCH_RAW, /#[0-9a-f]{3,8}\b/iu);

  for (const [modifier, token] of Object.entries(BADGES)) {
    const body = ruleBody(SEARCH, `.sg-badge--${modifier}`);
    assert.equal(declaration(body, 'color'), `var(${token})`, modifier);
  }
});

test('every badge ink token is theme-scoped and clears AA over the theme surfaces', () => {
  const themes = [
    {
      name: 'light',
      prefix: '',
      tokenSelector: '.kt-shell',
      designSelector: ':root',
    },
    {
      name: 'dark',
      prefix: "[data-theme='dark'] ",
      tokenSelector: "[data-theme='dark'] .kt-shell",
      designSelector: '[data-theme="dark"]',
    },
  ];

  for (const theme of themes) {
    const dropdown = rgba(
      declaration(ruleBody(SEARCH, `${theme.prefix}.sg-search-dropdown`), 'background'),
    );
    const underlays = [
      scopedTokenValue(TOKENS, theme.tokenSelector, '--bg'),
      scopedTokenValue(DESIGN, theme.designSelector, '--surface'),
      scopedTokenValue(DESIGN, theme.designSelector, '--bg-elev'),
    ].map(hexRgb);

    for (const [modifier, token] of Object.entries(BADGES)) {
      const ink = scopedTokenValue(TOKENS, theme.tokenSelector, token);
      const badge = rgba(
        declaration(ruleBody(SEARCH, `${theme.prefix}.sg-badge--${modifier}`), 'background'),
      );
      for (const underlay of underlays) {
        const dropdownSurface = composite(dropdown.rgb, dropdown.alpha, underlay);
        const badgeSurface = composite(badge.rgb, badge.alpha, dropdownSurface);
        const ratio = contrast(hexRgb(ink), badgeSurface);
        assert.ok(ratio >= 4.5, `${theme.name} ${modifier} contrast is ${ratio.toFixed(2)}:1`);
      }
    }
  }
});
