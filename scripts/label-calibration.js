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
 *   tune     19/19     0.000            0     (015 line: 19/19, 0.011, 0)
 *   holdout  15/15     0.000            0     (016: bands revised deliberately
 *                                             for the claim-aware ceiling and the
 *                                             nine roles — see bench-evidence.md —
 *                                             and five post-change cases added)
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
    band: [0.3, 0.85],
    why: '016 claim-aware: custom rates the KEY role; prod resolves this deterministically',
  },
  {
    n: 'ad_type-70',
    p: 'imp[0].ext.ad_type',
    v: 70,
    sk: ['limit'],
    imp: { video: { w: 640, h: 480, mimes: ['video/mp4'] } },
    want: ['custom'],
    band: [0.3, 0.85],
    why: '016 claim-aware: strong key name, unknown code; prod is deterministic',
  },
  {
    n: 'format-12',
    p: 'imp[0].ext.format',
    v: 12,
    sk: [],
    imp: { banner: { w: 728, h: 90 } },
    want: ['custom'],
    band: [0.3, 0.5],
    why: "016: generic 'format' name caps at 0.5; prod resolves via corpus adjudication",
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
    want: ['ignore', 'identifier'],
    band: [0.6, 0.95],
    why: 'key names itself, but never a perfect 1.0; 016 adds the identifier role',
  },
  {
    n: 'request_uuid',
    p: 'imp[0].ext.request_uuid',
    v: '7c1e-44a0',
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['ignore', 'identifier'],
    band: [0.6, 0.95],
    why: 'key names itself; 016 adds the identifier role',
  },
  {
    n: 'limit-1',
    p: 'imp[0].ext.limit',
    v: 1,
    sk: ['ad_type'],
    imp: { video: { w: 640, h: 480, mimes: ['video/mp4'] } },
    want: ['ignore', 'informational', 'custom', 'delivery-control', 'pricing'],
    band: [0, 0.6],
    why: '016: the spec itself adjudicates limit ambiguous over these very roles',
  },
  {
    n: 'flag-1',
    p: 'imp[0].ext.flag',
    v: 1,
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['ignore', 'custom', 'delivery-control'],
    band: [0, 0.5],
    why: 'AMBIGUOUS key + numeric; 016 adds the delivery-control candidate',
  },
  {
    n: 'mode-2',
    p: 'imp[0].ext.mode',
    v: 2,
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['custom', 'ignore'],
    band: [0, 0.5],
    why: '016: generic short name caps at 0.5, not 0.3 — the claim is about the key',
  },

  // ── E. metadata / versions → informational ────────────────────────────
  {
    n: 'sdk_ver',
    p: 'imp[0].ext.sdk_ver',
    v: '1.2.4',
    sk: ['sdk'],
    imp: { banner: { w: 320, h: 50 } },
    want: ['informational', 'metadata'],
    band: [0.7, 0.95],
    why: 'clearly a version; 016 adds the metadata role',
  },
  {
    n: 'partner-name',
    p: 'imp[0].ext.ssp',
    v: 'richaudience',
    sk: ['bidder'],
    imp: { banner: { w: 728, h: 90 } },
    want: ['informational', 'metadata', 'ignore'],
    band: [0.5, 0.95],
    why: 'partner name, not a format; 016 adds the metadata role',
  },
  {
    n: 'counter',
    p: 'imp[0].ext.imp_count',
    v: 3,
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['measurement', 'metadata', 'informational'],
    band: [0.4, 0.9],
    why: '016: the role vocabulary names this measurement; prod resolves it deterministically',
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
    band: [0.3, 0.85],
    why: '016 claim-aware: creative_type names its role; prod is deterministic',
  },
  {
    n: 'ho-code-str',
    p: 'imp[0].ext.unit_code',
    v: 'A7',
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['custom', 'ignore', 'identifier'],
    band: [0, 0.6],
    why: "opaque code; 016: 'unit_code' is a partially transparent name (cap 0.6)",
  },
  {
    n: 'ho-ttl',
    p: 'imp[0].ext.ttl',
    v: 300,
    sk: [],
    imp: { banner: { w: 728, h: 90 } },
    want: ['ignore', 'informational', 'delivery-control', 'measurement', 'metadata'],
    band: [0, 0.7],
    why: 'technical param; 016 roles apply — prod resolves ttl deterministically',
  },
  {
    n: 'ho-seller',
    p: 'imp[0].ext.seller_name',
    v: 'AdKernel',
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['informational', 'metadata'],
    band: [0.6, 0.95],
    why: 'clearly a partner name; 016 adds the metadata role',
  },
  {
    n: 'ho-buildno',
    p: 'imp[0].ext.build',
    v: '20260812',
    sk: ['sdk_name'],
    imp: { banner: { w: 320, h: 50 } },
    want: ['metadata', 'informational', 'ignore'],
    band: [0.4, 0.95],
    why: 'build number = metadata — 016 made that a first-class role',
  },
  {
    n: 'ho-t',
    p: 'imp[0].ext.t',
    v: 1,
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['custom', 'ignore'],
    band: [0, 0.5],
    why: 'one-letter key: the 0.5 short-name cap governs; prod abstains to the model',
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
  // ── 016 post-change additions (T039): authored AFTER the persona edit,
  //    so the hold-out keeps measuring generalisation, not the change itself.
  {
    n: 'ho2-price',
    p: 'imp[0].ext.floor_cpm',
    v: 0.5,
    sk: ['currency'],
    imp: { banner: { w: 300, h: 250 } },
    want: ['pricing', 'informational'],
    band: [0.4, 0.85],
    why: '016 role: a floor is pricing, and the name says so',
  },
  {
    n: 'ho2-consent',
    p: 'ext.consent_string',
    v: 'CPcqBIAPcqBIAAcABBENC0CoAP_AAH_AAAqIJNNd_H_',
    sk: ['gdpr'],
    imp: null,
    want: ['privacy-consent', 'ignore'],
    band: [0.4, 0.9],
    why: '016 role: TCF-shaped consent payload',
  },
  {
    n: 'ho2-target',
    p: 'imp[0].ext.audience_segment',
    v: 'auto-intenders',
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['targeting', 'informational'],
    band: [0.4, 0.85],
    why: '016 role: audience selection is targeting',
  },
  {
    n: 'ho2-retry',
    p: 'imp[0].ext.retry_count',
    v: 2,
    sk: [],
    imp: { banner: { w: 300, h: 250 } },
    want: ['measurement', 'delivery-control', 'ignore'],
    band: [0.3, 0.7],
    why: '016 roles: counter or control; numeric value does not clamp the role claim',
  },
  {
    n: 'ho2-format-alive',
    p: 'imp[0].ext.render_mode',
    v: 'floating_video',
    sk: [],
    imp: { video: { w: 640, h: 480, mimes: ['video/mp4'] } },
    want: ['video', 'custom'],
    band: [0.4, 0.95],
    why: 'format words must survive the role vocabulary: text + imp.video is still video',
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
