'use strict';

/**
 * scripts/label-calibration.js — calibration bench for the labeller persona.
 *
 * NOT a unit test, and deliberately not under tests/: it needs a live model on
 * the host, so it cannot run in CI and must never gate a deploy. Run it by hand
 * whenever you edit lib/label-persona.js:
 *
 *   node scripts/label-calibration.js            # both sets
 *   node scripts/label-calibration.js --set=tune # just the tuning set
 *
 * ── Why a label check alone is not enough ────────────────────────────────
 * Every case carries the labels we accept AND the confidence band the persona's
 * own scale implies, because a right label at a wrong confidence is still a
 * defect: the number is what a user reads to decide whether to check the answer
 * themselves. The bench that produced the current persona found 18/19 labels
 * correct and seven answers at exactly 1.0 — including on an empty value, which
 * the persona's own text caps at 0.3.
 *
 * ── Read the deviation, not the pass count ───────────────────────────────
 * `in-band` is a blunt instrument: it scores 0.4-against-a-0.35-ceiling the same
 * as 1.0-against-it. The number to watch is mean deviation, printed per set.
 *
 * ── The hold-out set is the honest one ───────────────────────────────────
 * The tuning set is where the persona was developed, so it flatters. HOLDOUT was
 * written after the persona was frozen and informed no edit; a change that helps
 * TUNE and not HOLDOUT is overfitting to these examples. Current persona:
 *
 *            labels    mean deviation   answers at exactly 1.0
 *   tune     19/19     0.011            0     (was 18/19, 0.195, 7)
 *   holdout   9/10     0.005            0     (was  8/10, 0.065, 1)
 *
 * Cases the deterministic lexicon resolves are skipped — they never reach the
 * model, so scoring the persona on them measures nothing.
 */

const { resolveSignal } = require('../packages/core/dialects/signal-lexicon');
const { PERSONA } = require('../lib/label-persona');
const { LABELS, DEFAULT_URL, DEFAULT_MODEL } = require('../lib/ollama');

const TUNE = [
  {
    n: 'preroll+video',
    p: 'imp[0].ext.slot_kind',
    v: 'preroll_video',
    sk: [],
    imp: { video: { w: 640, h: 480, startdelay: 0, mimes: ['video/mp4'] } },
    want: ['video'],
    band: [0.8, 1.0],
    why: 'names itself AND imp confirms',
  },
  {
    n: 'popunder+flags',
    p: 'imp[0].ext.win_mode',
    v: 'popunder',
    sk: ['allowMT', 'viewOnClick'],
    imp: { banner: { w: 1, h: 1 }, bidfloor: 0.0002 },
    want: ['pop'],
    band: [0.8, 1.0],
    why: 'names itself AND imp confirms',
  },
  {
    n: 'audio-ad',
    p: 'imp[0].ext.placement_kind',
    v: 'audio_ad',
    sk: [],
    imp: { audio: { present: true, mimeCount: 2 } },
    want: ['audio'],
    band: [0.8, 1.0],
    why: 'names itself AND imp confirms',
  },

  // ── B. format word, context silent or contradicting → middle ──────────
  {
    n: 'video-word-no-video',
    p: 'imp[0].ext.unit',
    v: 'video_slider',
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['video', 'banner', 'custom'],
    band: [0.3, 0.8],
    why: 'word vs contradicting imp',
  },
  {
    n: 'native-word-silent',
    p: 'imp[0].ext.unit_kind',
    v: 'native_feed',
    sk: [],
    imp: null,
    want: ['native', 'custom'],
    band: [0.4, 0.8],
    why: 'names itself, context silent',
  },
  {
    n: 'interstitial-word',
    p: 'imp[0].ext.view',
    v: 'fullscreen',
    sk: [],
    imp: { banner: { w: 320, h: 480 }, instl: 1 },
    want: ['interstitial-banner'],
    band: [0.6, 1.0],
    why: 'word + instl=1 confirms',
  },

  // ── C. numeric vendor codes → custom, hard ceiling 0.3 ────────────────
  {
    n: 'adtype-8',
    p: 'imp[0].ext.adtype',
    v: 8,
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['custom'],
    band: [0, 0.3],
    why: 'IRON RULE: numeric code',
  },
  {
    n: 'ad_type-70',
    p: 'imp[0].ext.ad_type',
    v: 70,
    sk: ['limit'],
    imp: { video: { w: 640, h: 480, mimes: ['video/mp4'] } },
    want: ['custom'],
    band: [0, 0.3],
    why: 'IRON RULE: numeric code',
  },
  {
    n: 'format-12',
    p: 'imp[0].ext.format',
    v: 12,
    sk: [],
    imp: { banner: { w: 728, h: 90 } },
    want: ['custom'],
    band: [0, 0.3],
    why: 'IRON RULE: numeric code',
  },
  {
    n: 'num+popctx',
    p: 'imp[0].ext.adtype',
    v: 8,
    sk: ['allowMT', 'allowShock', 'viewOnClick'],
    imp: { banner: { w: 1, h: 1 }, bidfloor: 0.0002 },
    want: ['custom', 'pop'],
    band: [0, 0.5],
    why: 'numeric, but siblings hint',
  },

  // ── D. bookkeeping / trace → ignore. Obvious key may be confident;
  //       ambiguous key must NOT be. This is where 1.0 kept leaking. ─────
  {
    n: 'dsp_trace',
    p: 'imp[0].ext.dsp_trace',
    v: 'a8f3c1e0-9b22-4d',
    sk: ['rid'],
    imp: { banner: { w: 300, h: 250 } },
    want: ['ignore'],
    band: [0.6, 0.95],
    why: 'key names itself, but never a perfect 1.0',
  },
  {
    n: 'request_uuid',
    p: 'imp[0].ext.request_uuid',
    v: '7c1e-44a0',
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['ignore'],
    band: [0.6, 0.95],
    why: 'key names itself',
  },
  {
    n: 'limit-1',
    p: 'imp[0].ext.limit',
    v: 1,
    sk: ['ad_type'],
    imp: { video: { w: 640, h: 480, mimes: ['video/mp4'] } },
    want: ['ignore', 'informational', 'custom'],
    band: [0, 0.5],
    why: 'AMBIGUOUS key: cap? bid limit? no ground',
  },
  {
    n: 'flag-1',
    p: 'imp[0].ext.flag',
    v: 1,
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['ignore', 'custom'],
    band: [0, 0.5],
    why: 'AMBIGUOUS key + numeric',
  },
  {
    n: 'mode-2',
    p: 'imp[0].ext.mode',
    v: 2,
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['custom', 'ignore'],
    band: [0, 0.3],
    why: 'numeric AND ambiguous key',
  },

  // ── E. metadata / versions → informational ────────────────────────────
  {
    n: 'sdk_ver',
    p: 'imp[0].ext.sdk_ver',
    v: '1.2.4',
    sk: ['sdk'],
    imp: { banner: { w: 320, h: 50 } },
    want: ['informational'],
    band: [0.7, 0.95],
    why: 'clearly a version',
  },
  {
    n: 'partner-name',
    p: 'imp[0].ext.ssp',
    v: 'richaudience',
    sk: ['bidder'],
    imp: { banner: { w: 728, h: 90 } },
    want: ['informational', 'ignore'],
    band: [0.5, 0.95],
    why: 'partner name, not a format',
  },
  {
    n: 'counter',
    p: 'imp[0].ext.imp_count',
    v: 3,
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['informational', 'ignore'],
    band: [0.4, 0.9],
    why: 'counter; numeric but key is clear',
  },

  // ── F. no ground at all → ceiling 0.3 ─────────────────────────────────
  {
    n: 'empty-string',
    p: 'imp[0].ext.gg',
    v: '',
    sk: ['x'],
    imp: null,
    want: ['custom', 'ignore'],
    band: [0, 0.3],
    why: 'EXPLICIT: empty value',
  },
  {
    n: 'opaque-abbr',
    p: 'imp[0].ext.zx',
    v: 'qq',
    sk: [],
    imp: null,
    want: ['custom', 'ignore'],
    band: [0, 0.3],
    why: 'EXPLICIT: unreadable abbreviation',
  },
  {
    n: 'null-value',
    p: 'imp[0].ext.slot',
    v: null,
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['custom', 'ignore'],
    band: [0, 0.3],
    why: 'no ground',
  },
  {
    n: 'abbrev-ipp',
    p: 'imp[0].ext.fmt',
    v: 'ipp',
    sk: [],
    imp: { banner: { w: 300, h: 100 } },
    want: ['in-page-push', 'custom'],
    band: [0, 0.6],
    why: 'abbreviation, guessable at best',
  },

  // ── G. pop shape evidence without a format word ───────────────────────
  {
    n: 'allowShock',
    p: 'imp[0].ext.allowShock',
    v: true,
    sk: ['allowMT', 'popup', 'sizeID'],
    imp: { banner: { w: 1, h: 1 }, bidfloor: 0.0001 },
    want: ['pop'],
    band: [0.6, 1.0],
    why: 'sibling flags + 1x1 are strong evidence',
  },
  {
    n: 'newtab',
    p: 'imp[0].ext.slotType',
    v: 'newtab',
    sk: ['directLink'],
    imp: { banner: { w: 1, h: 1 } },
    want: ['pop'],
    band: [0.7, 1.0],
    why: 'word + shape',
  },
  {
    n: 'push-widget',
    p: 'imp[0].ext.render',
    v: 'inpage_push',
    sk: [],
    imp: { banner: { w: 300, h: 100 } },
    want: ['in-page-push'],
    band: [0.7, 1.0],
    why: 'names itself',
  },
  {
    n: 'bare-flag-true',
    p: 'imp[0].ext.enabled',
    v: true,
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['ignore', 'custom'],
    band: [0, 0.4],
    why: 'boolean with meaningless key',
  },
];

const HOLDOUT = [
  {
    n: 'ho-rewarded',
    p: 'imp[0].ext.reward_kind',
    v: 'rewarded_video',
    sk: [],
    imp: { video: { w: 640, h: 480, mimes: ['video/mp4'] }, rwdd: 1 },
    want: ['video'],
    band: [0.7, 0.95],
    why: 'names itself + rwdd + video',
  },
  {
    n: 'ho-clickunder',
    p: 'imp[0].ext.open_mode',
    v: 'clickunder',
    sk: ['directLink'],
    imp: { banner: { w: 1, h: 1 }, bidfloor: 0.0003 },
    want: ['pop'],
    band: [0.7, 0.95],
    why: 'names itself + 1x1 + microfloor',
  },
  {
    n: 'ho-sticky',
    p: 'imp[0].ext.pos_kind',
    v: 'sticky_bottom',
    sk: [],
    imp: { banner: { w: 320, h: 50 } },
    want: ['banner', 'custom'],
    band: [0.3, 0.8],
    why: 'placement word, not a family',
  },
  {
    n: 'ho-code-3',
    p: 'imp[0].ext.creative_type',
    v: 3,
    sk: [],
    imp: { banner: { w: 300, h: 600 } },
    want: ['custom'],
    band: [0, 0.3],
    why: 'numeric code',
  },
  {
    n: 'ho-code-str',
    p: 'imp[0].ext.unit_code',
    v: 'A7',
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['custom', 'ignore'],
    band: [0, 0.35],
    why: 'opaque code',
  },
  {
    n: 'ho-ttl',
    p: 'imp[0].ext.ttl',
    v: 300,
    sk: [],
    imp: { banner: { w: 728, h: 90 } },
    want: ['ignore', 'informational'],
    band: [0, 0.7],
    why: 'technical param, numeric',
  },
  {
    n: 'ho-seller',
    p: 'imp[0].ext.seller_name',
    v: 'AdKernel',
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['informational'],
    band: [0.6, 0.95],
    why: 'clearly a partner name',
  },
  {
    n: 'ho-buildno',
    p: 'imp[0].ext.build',
    v: '20260812',
    sk: ['sdk_name'],
    imp: { banner: { w: 320, h: 50 } },
    want: ['informational', 'ignore'],
    band: [0.4, 0.95],
    why: 'build number = metadata',
  },
  {
    n: 'ho-t',
    p: 'imp[0].ext.t',
    v: 1,
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['custom', 'ignore'],
    band: [0, 0.35],
    why: 'one-letter key AND numeric: two ceilings',
  },
  {
    n: 'ho-splash',
    p: 'imp[0].ext.render_as',
    v: 'splash',
    sk: [],
    imp: { banner: { w: 320, h: 480 }, instl: 1 },
    want: ['interstitial-banner', 'custom'],
    band: [0.4, 0.95],
    why: 'word + instl confirms',
  },
  {
    n: 'ho-empty-arr',
    p: 'imp[0].ext.tags',
    v: [],
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['ignore', 'custom', 'informational'],
    band: [0, 0.35],
    why: 'empty value',
  },
  {
    n: 'ho-notif',
    p: 'imp[0].ext.delivery',
    v: 'browser_notification',
    sk: [],
    imp: null,
    want: ['push', 'in-page-push', 'custom'],
    band: [0.5, 0.95],
    why: 'names itself, context silent',
  },
];

const SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', enum: LABELS },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['label', 'confidence', 'reason'],
};

/** Mirrors lib/ollama.js classifySignal — keep the two in step. */
function buildPrompt(c) {
  const lines = [`Шлях: ${c.p}`, `Значення: ${JSON.stringify(c.v)}`];
  if (c.sk && c.sk.length) lines.push(`Сусідні ключі в тому самому ext: ${c.sk.join(', ')}`);
  lines.push(
    c.imp
      ? `Структура impression: ${JSON.stringify(c.imp)}`
      : 'Сигнал на рівні запиту — impression відсутній.',
  );
  return lines.join('\n');
}

function reachesModel(c) {
  const ext = Object.fromEntries((c.sk || []).map((k) => [k, 1]));
  return !resolveSignal({ signalPath: c.p, signalValue: c.v, imp: { ...(c.imp || {}), ext } });
}

async function runSet(name, cases) {
  const rows = [];
  for (const c of cases.filter(reachesModel)) {
    const resp = await fetch(DEFAULT_URL + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No num_ctx: a runner-parameter change would reload the shared model.
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        system: PERSONA,
        prompt: buildPrompt(c),
        stream: false,
        think: false,
        format: SCHEMA,
        options: { temperature: 0 },
      }),
    });
    const json = await resp.json();
    let out;
    try {
      out = JSON.parse(json.response);
    } catch (_) {
      out = { label: '<unparseable>', confidence: null };
    }
    const conf = out.confidence;
    const deviation =
      conf == null ? 1 : conf < c.band[0] ? c.band[0] - conf : Math.max(0, conf - c.band[1]);
    rows.push({ ...c, label: out.label, conf, deviation, okLabel: c.want.includes(out.label) });
  }
  const mean = rows.reduce((s, r) => s + r.deviation, 0) / (rows.length || 1);
  console.log(`\n── ${name} (${rows.length} reach the model) ──`);
  console.log(
    `labels ${rows.filter((r) => r.okLabel).length}/${rows.length}` +
      `  mean deviation ${mean.toFixed(3)}` +
      `  answers at exactly 1.0: ${rows.filter((r) => r.conf === 1).length}`,
  );
  for (const r of rows.filter((x) => !x.okLabel || x.deviation > 0)) {
    console.log(
      `  ${r.n.padEnd(20)} ${String(r.label).padEnd(20)} conf=${String(r.conf).padEnd(5)}` +
        ` want ${r.want.join('|')} @ [${r.band}]  (${r.why})`,
    );
  }
  return rows;
}

(async () => {
  const only = (process.argv.find((a) => a.startsWith('--set=')) || '').slice(6);
  if (only !== 'holdout') await runSet('TUNE', TUNE);
  if (only !== 'tune') await runSet('HOLDOUT', HOLDOUT);
})();
