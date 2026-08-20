'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const CONTROLS = read('public/ortbtools-controls.css');
const DESIGN = read('public/design-system.css');
const SURFACES = [
  'public/index.en.html',
  'public/index.uk.html',
  'public/index.ru.html',
  'public/account.en.html',
  'public/account.uk.html',
  'public/account.ru.html',
  'public/about.en.html',
  'public/about.uk.html',
  'public/about.ru.html',
];

function block(source, selector) {
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, `missing selector ${selector}`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

function hexToken(sourceBlock, name) {
  const found = sourceBlock.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})`, 'iu'));
  assert.ok(found, `missing six-digit ${name}`);
  return found[1];
}

function luminance(hex) {
  const values = hex
    .slice(1)
    .match(/.{2}/gu)
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function blend(foreground, background, alpha) {
  const channels = (hex) =>
    hex
      .slice(1)
      .match(/.{2}/gu)
      .map((part) => Number.parseInt(part, 16));
  const front = channels(foreground);
  const back = channels(background);
  return `#${front
    .map((value, index) => Math.round(value * alpha + back[index] * (1 - alpha)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

test('all nine public shells load the product controls layer after the design system', () => {
  for (const file of SURFACES) {
    const html = read(file);
    const designAt = html.indexOf('/design-system.css?v=13');
    const controlsAt = html.indexOf('/ortbtools-controls.css?v=1');
    assert.ok(designAt >= 0, `${file}: design system link missing`);
    assert.ok(controlsAt > designAt, `${file}: controls must follow the design system`);
    assert.equal(
      html.match(/\/ortbtools-controls\.css\?v=1/gu)?.length,
      1,
      `${file}: controls stylesheet must be linked exactly once`,
    );
  }
});

test('changed classic assets use one current cache key on every locale shell', () => {
  for (const file of SURFACES) {
    const html = read(file);
    assert.equal(
      html.match(/\/lang-switch\.js\?v=3/gu)?.length,
      1,
      `${file}: lang-switch must use v3 exactly once`,
    );
    assert.doesNotMatch(html, /\/lang-switch\.js\?v=(?:1|2)\b/u, `${file}: stale lang-switch`);
  }

  for (const locale of ['en', 'uk', 'ru']) {
    const account = read(`public/account.${locale}.html`);
    assert.equal(account.match(/\/account\.js\?v=7/gu)?.length, 1, `account.${locale}: v7`);

    const index = read(`public/index.${locale}.html`);
    assert.equal(
      index.match(/\/modules\/inspector\/source-nav\.js\?v=2/gu)?.length,
      1,
      `index.${locale}: source-nav v2`,
    );
    assert.equal(
      index.match(/\/modules\/intel\/banner\.js\?v=4/gu)?.length,
      1,
      `index.${locale}: intel banner v4`,
    );
  }
});

test('filled control tokens meet AA in both themes without changing the brand accent', () => {
  const light = block(CONTROLS, ':root');
  const dark = block(CONTROLS, "[data-theme='dark']");
  for (const [theme, tokens] of [
    ['light', light],
    ['dark', dark],
  ]) {
    const foreground = hexToken(tokens, '--control-primary-foreground');
    for (const backgroundName of ['--control-primary-background', '--control-primary-hover']) {
      const background = hexToken(tokens, backgroundName);
      assert.ok(
        contrast(foreground, background) >= 4.5,
        `${theme} ${foreground} on ${background} must meet WCAG AA`,
      );
    }
  }
  assert.match(DESIGN, /--accent:\s+#0284C7/iu, 'the brand accent remains unchanged');
});

test('semantic pill inks meet AA over their 12% tint in both themes', () => {
  const lightControls = block(CONTROLS, ':root');
  const darkControls = block(CONTROLS, "[data-theme='dark']");
  const legacyRootAt = DESIGN.indexOf(':root', DESIGN.indexOf(':root') + 1);
  const lightDesign = block(DESIGN.slice(legacyRootAt), ':root');
  const darkDesign = block(DESIGN, '[data-theme="dark"]');
  const semantics = ['success', 'warning', 'danger'];

  for (const semantic of semantics) {
    const base = hexToken(lightDesign, `--${semantic}`);
    const ink = hexToken(lightControls, `--control-${semantic}-ink`);
    const tint = blend(base, '#ffffff', 0.12);
    assert.ok(contrast(ink, tint) >= 4.5, `light ${semantic} pill must meet WCAG AA`);

    const darkBase = semantic === 'warning' ? base : hexToken(darkDesign, `--${semantic}`);
    const darkTint = blend(darkBase, hexToken(darkDesign, '--bg-elev'), 0.12);
    assert.match(
      darkControls,
      new RegExp(`--control-${semantic}-ink:\\s*var\\(--${semantic}\\)`, 'u'),
    );
    assert.ok(contrast(darkBase, darkTint) >= 4.5, `dark ${semantic} pill must meet WCAG AA`);
  }
});

test('shared buttons cover hierarchy, focus, unavailable, loading, and disclosure states', () => {
  for (const selector of [
    '.btn-primary',
    '.btn-secondary',
    '.btn-danger',
    '.btn:focus-visible',
    ".btn[aria-disabled='true']",
    ".btn[aria-busy='true']",
    '.btn.is-loading',
    ".btn-secondary[aria-expanded='true']",
    '.chip.active',
  ]) {
    assert.ok(CONTROLS.includes(selector), `shared layer must own ${selector}`);
  }
  assert.match(CONTROLS, /--control-radius:\s*6px/iu);
  assert.match(block(CONTROLS, '.btn'), /border-radius:\s*var\(--control-radius\)/u);
});

test('route-specific filled controls consume the shared contrast-safe pair', () => {
  const cases = [
    ['public/modules/admin-blog/admin-blog.css', '.ablog-btn--primary'],
    ['public/modules/library/library.css', '.lib-btn--primary'],
    ['public/modules/behavior/behavior.css', '.bhv-chip.is-active'],
    ['public/modules/behavior/behavior.css', '.bhv-btn--primary'],
    ['public/modules/blog/blog.css', '.blog-chip.is-active'],
    ['public/modules/docs/docs.css', '.docs-chip.is-active'],
    ['public/modules/inspector/inspector.css', '.severity-chip.active'],
    ['public/modules/dialects/dialects.css', '.dlc-ghost:hover'],
  ];
  for (const [file, selector] of cases) {
    const rule = block(read(file), selector);
    assert.match(rule, /var\(--control-primary-background/iu, `${file} ${selector}: background`);
    assert.match(rule, /var\(--control-primary-foreground/iu, `${file} ${selector}: foreground`);
  }
});

test('language disclosures retain native details/link semantics and a closed-state invariant', () => {
  assert.match(CONTROLS, /summary\.kt-lang-toggle:focus-visible/iu);
  assert.match(
    CONTROLS,
    /details\.kt-lang-menu:not\(\[open\]\)\s*>\s*\.kt-lang-menu-list\s*\{[^}]*display:\s*none\s*!important/isu,
  );
  assert.match(CONTROLS, /max-width:\s*calc\(100vw\s*-\s*var\(--space-6\)\)/iu);
  assert.match(
    CONTROLS,
    /\.kt-topnav\s*>\s*\.kt-topnav-inner:has\(\.kt-lang-menu\[open\]\)/iu,
    'the open phone disclosure reserves header space instead of overlaying page content',
  );
  const themeRule = block(CONTROLS, '.kt-topnav .kt-theme-toggle');
  assert.match(themeRule, /position:\s*static/iu);
  assert.match(themeRule, /width:\s*36px/iu);
  assert.match(themeRule, /height:\s*36px/iu);
  assert.match(themeRule, /border-radius:\s*var\(--control-radius\)/iu);
  assert.match(themeRule, /box-shadow:\s*none/iu);

  for (const locale of ['en', 'uk', 'ru']) {
    for (const surface of ['account', 'about']) {
      const file = `public/${surface}.${locale}.html`;
      const html = read(file);
      assert.doesNotMatch(
        html,
        /role="menu(?:item)?"/iu,
        `${file}: disclosure is not an ARIA menu`,
      );
      assert.equal(
        html.match(/class="kt-lang-menu-list"/gu)?.length,
        1,
        `${file}: one native language disclosure`,
      );
      assert.equal(
        html.match(/class="kt-topnav-actions"/gu)?.length,
        1,
        `${file}: one grouped set of topnav actions`,
      );
      assert.equal(
        html.match(/class="kt-theme-toggle"/gu)?.length,
        1,
        `${file}: one theme control`,
      );
      const header = html.slice(
        html.indexOf('<header class="kt-topnav">'),
        html.indexOf('</header>'),
      );
      assert.match(
        header,
        /class="kt-topnav-actions"[\s\S]*class="kt-lang-menu"[\s\S]*class="kt-theme-toggle"/u,
        `${file}: language and theme controls stay inside the header action group`,
      );
      assert.doesNotMatch(html, /kt-lang-menu--start-mobile/u, `${file}: obsolete alignment hook`);
    }
  }

  for (const locale of ['en', 'uk', 'ru']) {
    assert.doesNotMatch(
      read(`public/about.${locale}.html`),
      /\.kt-lang-menu(?:\s|\{)/u,
      `about.${locale} must not reimplement the shared language menu`,
    );
  }
});

test('Account uses valid design tokens and locale-preserving Dialects routes', () => {
  const expected = { en: '/dialects', uk: '/uk/dialects', ru: '/ru/dialects' };
  for (const locale of ['en', 'uk', 'ru']) {
    const file = `public/account.${locale}.html`;
    const html = read(file);
    assert.doesNotMatch(html, /var\(--(?:radius-|fs-xs|success-bg|warning-bg|danger-bg)/u);
    assert.doesNotMatch(html, /\bcab-btn\b/u);
    assert.match(
      html,
      new RegExp(`class="btn btn-secondary btn-sm" href="${expected[locale]}"`, 'u'),
      `${file}: Manage Dialects preserves the locale`,
    );
    assert.match(html, /class="btn btn-ghost btn-sm" id="btnExportDialects"/u);
    for (const semantic of ['success', 'warning', 'danger']) {
      assert.match(html, new RegExp(`color:\\s*var\\(--control-${semantic}-ink\\)`, 'u'));
    }
  }
  assert.match(read('public/account.js'), /class="btn btn-danger btn-sm corpus-delete-btn"/u);
});

test('dense Inspector modules use defined shared button variants', () => {
  const migrate = read('public/modules/migrate/index.js');
  const macros = read('public/modules/macros/index.js');

  assert.match(migrate, /class="btn btn-primary btn-sm" id="migrateApply"/u);
  assert.match(migrate, /class="btn btn-secondary btn-sm" id="migrateUndo"/u);
  for (const action of ['mig-all', 'mig-none', 'mig-refresh']) {
    assert.match(
      migrate,
      new RegExp(`class="btn btn-(?:secondary|ghost) btn-sm" data-action="${action}"`, 'u'),
      `${action} has an explicit shared hierarchy and size`,
    );
  }
  assert.doesNotMatch(migrate, /class="btn primary"/u, 'undefined .primary is not a variant');
  assert.match(macros, /class="btn btn-ghost btn-sm btn-copy-macro-url"/u);
  assert.doesNotMatch(macros, /\bbtn-xs\b/u, 'dense copy action uses the defined small size');
});

test('Behavior cards cannot force a 300px track through a narrower phone viewport', () => {
  const behavior = read('public/modules/behavior/behavior.css');
  assert.match(
    behavior,
    /grid-template-columns:\s*repeat\(auto-fill, minmax\(min\(300px, 100%\), 1fr\)\)/u,
  );
  assert.doesNotMatch(behavior, /minmax\(300px, 1fr\)/u);
});
