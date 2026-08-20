# Quickstart: Validate Public Control Language

Run from the repository root with Node.js 22 and Chrome/Chromium available.

## 1. Static and DOM contracts

```bash
node --test \
  tests/account-preferences.test.js \
  tests/inspector-disclosure-contract.test.js \
  tests/intel-banner-accessibility.test.js \
  tests/intel-builder-accessibility.test.js \
  tests/lang-menu-disclosure.test.js \
  tests/modal-control-labels.test.js \
  tests/product-controls.test.js \
  tests/site-chrome.test.js \
  tests/site-stream.test.js \
  tests/source-nav.test.js \
  tests/type-scale.test.js \
  tests/version-consistency.test.js \
  tests/changelog-completeness.test.js
```

Expected: all tests pass; shared states, labels, locale parity, and version surfaces agree.

## 2. Serial real-browser acceptance

```bash
node --test tests/product-controls-browser.test.js
node --test tests/mobile-inspector-browser.test.js
node --test tests/diff-tab-browser.test.js
node --test tests/migrate-tab-browser.test.js
```

Run these serially. Expected: Account/About and Inspector controls keep focus/open-state geometry;
phones pass the 320–414 px matrix; 800×600 More actions win hit-testing; Diff and Migrate open.

## 3. Complete repository and release gates

```bash
npm run ci
bash scripts/npm-pack-smoke.sh
bash scripts/ci-docker-smoke.sh
git diff --check
```

Expected: format, lint, type checking, non-browser tests, every serial browser file, package install,
and isolated production image smoke pass. Test output is the count authority.

## 4. Production release boundary

After an authorized commit, push, green hosted CI, and the separate backup gate, deploy only through:

```bash
./scripts/deploy.sh
```

Expected: exact candidate SHA reaches `ACTIVE`, production smoke passes, and restart policy is
`always`; failure auto-rolls back to the recorded prior image.
