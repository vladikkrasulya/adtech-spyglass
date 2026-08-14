'use strict';

/**
 * The reveal control must not offer a creative that is not there.
 *
 * `.preview-safe-overlay` covers the whole preview box at z-index 5 and invites
 * "Show creative". It was rendered unconditionally, so on an empty page and on
 * any request-only analysis it sat on top of a box with no creative in it:
 * clicking lifted the blur off an empty rectangle, which reads as a broken
 * tool. Measured on production — with nothing pasted, and with a request and no
 * response, the iframe had no `srcdoc` at all and the overlay was still
 * inviting the click.
 *
 * The tool was also covering its own instructions. Underneath the overlay the
 * template already carries "waiting for adm — paste BidResponse", and
 * `setAdPreview` renders `preview.no_adm` when a response arrives with nothing
 * renderable in it. Both messages are exactly right and neither could be seen,
 * because something was painted over them. Creatives live in the BidResponse,
 * and the panel had been saying so all along.
 *
 * `data-has-creative` already carried the answer — setAdPreview sets it on
 * every render, '1' with dimensions and '0' without. Nothing asked it.
 *
 * Verified rendered against a served build, all three states: empty page →
 * no overlay, "waiting for adm — paste BidResponse"; request only → no overlay,
 * "No renderable creative (adm/iurl) in response"; request + response → overlay
 * present over a real creative, which is the screenshot-safety gate doing its
 * job and is deliberately unchanged.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public/modules/inspector/inspector.css'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');
const LOCALES = ['en', 'uk', 'ru'];

test('the overlay is hidden unless a creative is actually present', () => {
  assert.match(
    CSS,
    /\.preview-safe:not\(\[data-has-creative='1'\]\)\s+\.preview-safe-overlay\s*\{[^}]*display:\s*none/,
    'inspector.css must hide .preview-safe-overlay when data-has-creative is not "1", or the ' +
      'tool offers to reveal an empty box and covers its own "paste BidResponse" message doing it',
  );
});

test('the flag the gate depends on is still written on every render', () => {
  // The rule above is inert if setAdPreview stops maintaining the attribute,
  // and inert-but-passing is the failure mode worth guarding against.
  assert.match(
    APP,
    /safeWrap\.dataset\.hasCreative = '1'/,
    'setAdPreview must mark the wrapper when a creative has dimensions',
  );
  assert.match(
    APP,
    /safeWrap\.dataset\.hasCreative = '0'/,
    'setAdPreview must clear the mark when there is nothing to show',
  );
});

test('both empty states still say what to do, in every locale', () => {
  for (const locale of LOCALES) {
    const template = fs.readFileSync(
      path.join(ROOT, `public/modules/inspector/template.${locale}.html`),
      'utf8',
    );
    const placeholder = /<div class="preview-placeholder">([^<]+)<\/div>/.exec(template);
    assert.ok(
      placeholder && placeholder[1].trim().length > 0,
      `template.${locale}.html must keep a non-empty .preview-placeholder — it is what the ` +
        'reader sees before the first analysis, and it was previously covered by the overlay',
    );
  }
  const i18n = fs.readFileSync(path.join(ROOT, 'public/i18n.js'), 'utf8');
  for (const locale of LOCALES) {
    assert.match(
      i18n,
      new RegExp(`I18N\\.${locale}\\['preview\\.no_adm'\\]\\s*=\\s*'[^']+'`),
      `preview.no_adm must exist for ${locale} — it is the message shown once a response has ` +
        'been analysed and carries nothing renderable',
    );
  }
});
