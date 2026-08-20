'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public/modules');

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('save and edit sample modal labels explicitly own their controls', () => {
  for (const file of ['save-sample/index.js', 'edit-sample/index.js']) {
    const raw = source(file);
    for (const id of ['mTitle', 'mPartner', 'mNotes']) {
      assert.match(raw, new RegExp(`<label for=["']${id}["']>`), `${file}: label for ${id}`);
      assert.match(
        raw,
        new RegExp(`<(?:input|select|textarea) id=["']${id}["']`),
        `${file}: #${id}`,
      );
    }
  }
});

test('embed modal labels explicitly own its select and readonly snippet', () => {
  const raw = source('embed/index.js');
  for (const id of ['embedHeight', 'embedSnippet']) {
    assert.match(raw, new RegExp(`<label for=["']${id}["']>`), `embed: label for ${id}`);
    assert.match(raw, new RegExp(`<(?:select|textarea) id=["']${id}["']`), `embed: #${id}`);
  }
});

test('account and password modals explicitly associate labels with their inputs', () => {
  const cases = [
    ['auth/index.js', ['authEmailInput', 'authPasswordInput']],
    ['unlock/index.js', ['unlockPwInput']],
    [
      'password-reset/index.js',
      ['forgotEmailInput', 'resetNewPwInput', 'resetOldPwInput', 'resetRecoveryInput'],
    ],
    ['partners/index.js', ['pName']],
  ];

  for (const [file, ids] of cases) {
    const raw = source(file);
    for (const id of ids) {
      assert.match(raw, new RegExp(`<label for=["']${id}["']>`), `${file}: label for ${id}`);
      assert.match(raw, new RegExp(`<input id=["']${id}["']`), `${file}: #${id}`);
    }
  }
});

test('corpus and mirror modal fields and radio groups have explicit accessible names', () => {
  const corpus = source('corpus-save/index.js');
  assert.match(corpus, /<label for="corpusNotes">/u);
  assert.match(corpus, /<textarea id="corpusNotes"/u);
  assert.match(corpus, /<label id="corpusLabelLegend">/u);
  assert.match(
    corpus,
    /class="kt-corpus-labels" role="radiogroup" aria-labelledby="corpusLabelLegend"/u,
  );

  const mirror = source('mirror/index.js');
  assert.match(mirror, /<label for="mMirrorOutput">/u);
  assert.match(mirror, /<textarea id="mMirrorOutput"/u);
  assert.match(mirror, /<label id="mMirrorModeLabel">/u);
  assert.match(
    mirror,
    /class="kt-mirror-modes" role="radiogroup" aria-labelledby="mMirrorModeLabel"/u,
  );
});
