'use strict';

/**
 * The verdict line must report everything that needs action, not the loudest
 * severity only.
 *
 * `public/ortbtools.app.js` carries a comment that has been true of its intent
 * and false of its output for a while: "Outcome-first: status pill leads with
 * an icon and the counts of findings, so the reader gets the verdict before
 * format metadata." The chain under it stopped at the first match:
 *
 *     } else if (errCount) { statusText = errCount + ' error(s)'; }
 *     else if (warnCount)  { statusText = warnCount + ' warning(s)'; }
 *
 * so a payload with 1 error and 4 warnings rendered "✗ 1 error" and the four
 * warnings never reached the top-level answer. The one line whose entire job
 * is "what did you find" reported a fifth of it. That is also why the other
 * counters on screen felt like they were competing with it: they were the only
 * place the rest of the findings appeared, so the reader had to treat them as
 * rival verdicts instead of detail.
 *
 * Errors and warnings only, deliberately. Info and questions are real and are
 * one click away in their own chips; a verdict carrying four numbers stops
 * being a verdict. This guard therefore checks that the two actionable
 * severities are composed together, and does NOT demand the other two.
 *
 * Static, in the house style of tests/inspector-reentrant.test.js: guard the
 * specific line that makes the behaviour possible, in the file where a careless
 * edit would drop it. Rendered behaviour was verified separately against a
 * locally served build in all three locales — "✗ 1 error · 4 warnings",
 * "✗ 1 помилка · 4 попередження", "✗ 1 ошибка · 4 предупреждения", each fitting
 * its pill, with a clean payload still reading "✓ clean".
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public/ortbtools.app.js'), 'utf8');

test('the verdict composes both actionable counts rather than stopping at errors', () => {
  assert.match(
    APP,
    /statusText = warnText \? errText \+ ' · ' \+ warnText : errText;/,
    'with errors present the verdict must still name the warnings — a payload with ' +
      '1 error and 4 warnings previously reported only the error',
  );
});

test('both count strings are built before the branch that chooses between them', () => {
  // If either were built inside its own branch, restoring the early-exit shape
  // would be a one-line edit that reads as a tidy-up.
  const errIdx = APP.indexOf('const errText = errCount');
  const warnIdx = APP.indexOf('const warnText = warnCount');
  const branchIdx = APP.indexOf("if (status === 'clean')");
  assert.ok(errIdx > -1 && warnIdx > -1, 'errText and warnText must be named values');
  assert.ok(
    errIdx < branchIdx && warnIdx < branchIdx,
    'both counts must be computed before the status branch, not inside it',
  );
});

test('the verdict stays to the two severities a reader must act on', () => {
  // A guard against the opposite drift: someone "completing" the verdict by
  // appending info and question counts, which is how it becomes four numbers
  // again — the exact thing this change exists to undo.
  const region = APP.slice(
    APP.indexOf('const errText = errCount'),
    APP.indexOf('pillStatus.dataset.status'),
  );
  assert.ok(region.length > 0 && region.length < 1400, 'verdict region not located as expected');
  for (const forbidden of ['infoCount', 'questionCount']) {
    assert.ok(
      !region.includes(forbidden),
      `the verdict must not fold ${forbidden} into the status line — info and questions ` +
        'belong in their chips, and a four-number verdict is not a verdict',
    );
  }
});
