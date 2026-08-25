'use strict';

/**
 * tests/creative-preview-seal.test.js — the gate that was missing.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * On 2026-08-12, commit `adfaccd` — titled "feat: add inert OpenRTB macro
 * evaluator" — began injecting a content policy into every creative `srcdoc`.
 * `img-src data: blob:`, with no `https:`, blanks every creative whose art is
 * on a CDN. The preview stopped showing creatives that day and the suite said
 * nothing, because the only assertion anywhere near this behaviour was
 * `tests/macro-evaluator-browser.test.js`'s `trapRequests === 0` — which
 * checks the OPPOSITE property, that the creative reaches no network.
 *
 * ── What kind of test this is ─────────────────────────────────────────────
 * A CHARACTERISATION test, deliberately. Its value is not that today's
 * answer is right — that is an open product decision. Its value is that
 * changing the answer becomes something a person has to do on purpose, in a
 * commit that says so, instead of a side effect of a commit about something
 * else.
 *
 * It fails if the policy is WIDENED (a creative's images would start loading
 * from the analyst's browser) and it fails if the policy is NARROWED. Both
 * directions matter: one is a privacy change, the other silently removes more
 * of what the panel can show.
 *
 * If you are here because this test failed: that is the test working. Decide
 * the change, record it in the feature package, and update the constant here
 * in the same commit.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'public/ortbtools.app.js');

/**
 * The policy as shipped, byte for byte. Not a regex, not a set of
 * sub-assertions: the whole string, so that any edit at all — a new
 * directive, a widened source list, a removed directive — lands here.
 */
const SEALED_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' data:; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none';";

function appSource() {
  return fs.readFileSync(APP, 'utf8');
}

/** The policy string as it appears inside buildProbedSrcdoc. */
function shippedPolicy() {
  const src = appSource();
  const m = /content=\\"([^"]*?)\\"/.exec(src);
  assert.ok(m, 'could not find the injected content policy in buildProbedSrcdoc');
  return m[1];
}

test('the creative frame ships the sealed policy, unchanged — intentionally', () => {
  assert.equal(
    shippedPolicy(),
    SEALED_POLICY,
    'The creative preview policy changed. This is a deliberate product decision, not a refactor: ' +
      'record it in specs/012-creative-preview-repair (or its successor) and update SEALED_POLICY ' +
      'in the same commit.',
  );
});

test('a creative carrying an https image does not get to load it — the current, intended outcome', () => {
  const policy = shippedPolicy();
  const imgSrc = /img-src ([^;]+)/.exec(policy);
  assert.ok(imgSrc, 'img-src directive missing entirely');
  const sources = imgSrc[1].trim().split(/\s+/);
  assert.deepEqual(
    sources,
    ['data:', 'blob:'],
    'img-src changed. Widening it to https: means every tracking pixel in an attacker-supplied ' +
      "creative fires from the analyst's machine; narrowing it removes the last thing the " +
      'preview can still draw. Either way, decide it on purpose.',
  );
  assert.ok(!sources.includes('https:'), 'https: images must not be loadable inside the frame');
  assert.ok(!sources.includes('*'), 'a wildcard img-src would defeat the seal entirely');
});

test('the frame stays sandboxed without allow-same-origin', () => {
  const src = appSource();
  const attrs = [...src.matchAll(/setAttribute\('sandbox',\s*'([^']*)'\)/g)].map((m) => m[1]);
  assert.ok(attrs.length >= 2, 'expected the banner and native branches to both set sandbox');
  for (const a of attrs) {
    assert.equal(
      a,
      'allow-scripts',
      'sandbox must stay exactly `allow-scripts`. `allow-same-origin` is forbidden by ' +
        '.specify/memory/constitution.md:106 — with it, the frame could reach the parent origin.',
    );
  }
});

test('every directive that seals a channel is still present', () => {
  const policy = shippedPolicy();
  for (const directive of [
    "default-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    'font-src data:',
  ]) {
    assert.ok(
      policy.includes(directive),
      `${directive} is gone from the frame policy — that is a channel opening, not a cleanup`,
    );
  }
});

test('the classifier reaches no network, and neither does the refusal path', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  const classifier = strip(
    fs.readFileSync(path.join(ROOT, 'public/modules/inspector/creative-classify.js'), 'utf8'),
  );
  /** @type {Array<{re: RegExp, why: string}>} */
  const forbidden = [
    { re: /\bfetch\s*\(/, why: 'fetch()' },
    { re: /\bXMLHttpRequest\b/, why: 'XMLHttpRequest' },
    { re: /\bnew\s+Image\s*\(/, why: 'new Image()' },
    { re: /\bsendBeacon\s*\(/, why: 'sendBeacon()' },
  ];
  for (const { re, why } of forbidden) {
    assert.doesNotMatch(classifier, re, `the classifier must not use ${why}`);
  }
});

test('refusals travel on their own message type and never enter the behaviour buffer', () => {
  const src = appSource();
  // The receiver must handle the refusal type and return before the
  // behaviour buffer. That buffer is capped and drops its oldest entries, so
  // a creative emitting more refusals than the cap would evict the
  // navigation and frame-bust evidence it is being measured for.
  const receiver = src.slice(src.indexOf("d.type !== 'ortbtools-probe'"));
  const refusalAt = receiver.indexOf("d.type === 'ortbtools-preview-refusal'");
  const pushAt = receiver.indexOf('pushBehaviorEvent(d)');
  assert.ok(refusalAt > -1, 'the parent receiver must handle ortbtools-preview-refusal');
  assert.ok(pushAt > -1, 'the parent receiver must still record behaviour events');
  assert.ok(
    refusalAt < pushAt,
    'refusals must be handled BEFORE pushBehaviorEvent, and must return — otherwise a creative ' +
      'can evict its own behaviour evidence by emitting violations',
  );
  const between = receiver.slice(refusalAt, pushAt);
  assert.match(between, /\breturn;/, 'the refusal branch must return, not fall through');

  const probe = fs.readFileSync(path.join(ROOT, 'public/creative-probe.js'), 'utf8');
  assert.match(
    probe,
    /securitypolicyviolation/,
    'the probe must listen for content-policy violations — that is where they are observable',
  );
  assert.match(
    probe,
    /'securitypolicyviolation',[\s\S]{0,2000}?\btrue,\s*\)/,
    'the listener must be registered in the capture phase: document.open() detaches ' +
      'document-level listeners on precisely the creatives worth counting',
  );
  // Scope the check to the refusal machinery itself. Slicing to end-of-file
  // would sweep in the `probe_ready` send that closes the module, which is a
  // legitimate behaviour event and has nothing to do with refusals.
  const refusalStart = probe.indexOf('const REFUSAL_CAP');
  const refusalEnd = probe.indexOf("send({ kind: 'probe_ready'");
  assert.ok(
    refusalStart > -1 && refusalEnd > refusalStart,
    'could not locate the refusal machinery in the probe',
  );
  const refusalCode = probe.slice(refusalStart, refusalEnd);
  assert.doesNotMatch(
    refusalCode,
    /\bsend\(/,
    'refusals must not go through send(), which is the behaviour-event channel',
  );
  assert.match(
    refusalCode,
    /type: 'ortbtools-preview-refusal'/,
    'the refusal batch must carry its own message type',
  );
});
