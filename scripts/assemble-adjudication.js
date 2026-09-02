'use strict';

/**
 * assemble-adjudication — builds the adjudication artifacts from review
 * passes (016 T008). Maintainer-only, never CI.
 *
 * Stage 1 (--pass1 <verdicts.json>): merge pass-1 verdicts with the
 *   evidence pack, derive each resolved entry's exact score mechanically
 *   via the authority oracle (R-04), and write:
 *     specs/016-ext-key-alphabet/adjudication-pass1.json   (machine record)
 *     specs/016-ext-key-alphabet/adjudication-review.md    (the maintainer's
 *       pass-2 worksheet: grouped, quotable, cross-out-what-you-reject)
 *
 * Stage 2 (--finalize <pass2-decisions.json>): apply the maintainer's
 *   decisions, stamp both reviewer records, and write the committed
 *   manifest packages/core/dialects/data/key-role-adjudication.v1.json
 *   (dropping the STAGING marker is a separate, deliberate edit).
 */

const fs = require('node:fs');
const path = require('node:path');
const { deriveScore } = require('../packages/core/dialects/key-role-authority');

const ROOT = path.join(__dirname, '..');
const FEATURE = path.join(ROOT, 'specs', '016-ext-key-alphabet');
const corpus = require('../packages/core/dialects/data/key-role-corpus.v1.json');

/** Build oracle attestations from a corpus entry (see 016 §authority oracle). */
function attestationsFor(entry) {
  const out = [];
  for (const s of entry.schemaEvidence) {
    out.push({
      position: 'schema',
      vendor: s.file.replace(/^.*\//, '').replace('.json', ''),
      semantic: s.described,
      trusted: true,
    });
  }
  for (const a of entry.adapterEvidence) {
    out.push({
      position: 'extension',
      vendor: a.bidder,
      semantic: true,
      trusted: a.status === 'verified' || a.status === 'confirmed-omission',
    });
  }
  return out;
}

function stage1(verdictsFile) {
  /** @type {Array<any>} */
  const verdicts = JSON.parse(fs.readFileSync(verdictsFile, 'utf8'));
  const byName = new Map(corpus.entries.map((e) => [e.name, e]));
  const seen = new Set();
  const records = [];
  for (const v of verdicts) {
    const entry = byName.get(v.name);
    if (!entry) {
      console.error(`REJECT: verdict for unknown name ${v.name}`);
      process.exit(1);
    }
    if (seen.has(v.name)) {
      console.error(`REJECT: duplicate verdict for ${v.name}`);
      process.exit(1);
    }
    seen.add(v.name);
    const rec = {
      name: v.name,
      partition: null,
      state: v.state,
      roleCandidates:
        v.state === 'resolved' ? [v.role] : v.state === 'ambiguous' ? v.roleCandidates : [],
      rationale: v.rationale,
      quote: v.quote || null,
      attestations: attestationsFor(entry),
      reviews: [
        { reviewer: 'agent-claude-016-pass1', decision: v.state, refuteCheck: v.refute || null },
      ],
    };
    if (v.state === 'resolved') {
      const score = deriveScore(rec.attestations, {});
      if (score === null) {
        // The oracle found no semantic support at all — a resolved verdict
        // cannot stand on it; demote loudly rather than invent a floor.
        rec.state = 'abstain';
        rec.roleCandidates = [];
        rec.rationale =
          `oracle: no semantic attestation supports a score; demoted from resolved(${v.role}). ` +
          v.rationale;
      } else {
        rec.score = score;
      }
    }
    records.push(rec);
  }
  if (records.length !== corpus.entries.length) {
    console.error(`REJECT: ${records.length} verdicts for ${corpus.entries.length} corpus names`);
    process.exit(1);
  }
  records.sort((a, b) => (a.name < b.name ? -1 : 1));
  fs.writeFileSync(
    path.join(FEATURE, 'adjudication-pass1.json'),
    JSON.stringify({ generated: '2026-09-02', pass: 1, records }, null, 1) + '\n',
  );

  // ── the maintainer's worksheet ────────────────────────────────────────
  const lines = [
    '# Adjudication pass 2 — the maintainer worksheet (016 T008)',
    '',
    'Pass 1 (agent, adversarially self-checked) proposes the states below. Your pass is the second',
    'of two: **cross out what you reject** by editing the verdict line (change `state:`/`role:` in',
    'place), leave the rest untouched, then run:',
    '',
    '```bash',
    'node scripts/assemble-adjudication.js --finalize',
    '```',
    '',
    'Scores are NOT yours to pick — the authority oracle derives them from evidence (R-04).',
    'An `abstain` costs nothing at runtime (the layer falls through exactly as today).',
    '',
  ];
  const groups = { resolved: [], ambiguous: [], abstain: [] };
  for (const r of records) groups[r.state].push(r);

  lines.push(
    `## Resolved — ${groups.resolved.length} names (each with its quote; reject by editing state/role)`,
    '',
  );
  const byRole = {};
  for (const r of groups.resolved)
    (byRole[r.roleCandidates[0]] = byRole[r.roleCandidates[0]] || []).push(r);
  for (const [role, list] of Object.entries(byRole).sort()) {
    lines.push(`### ${role} — ${list.length}`, '');
    for (const r of list) {
      lines.push(`- \`${r.name}\` @ ${r.score} — "${(r.quote || '').slice(0, 140)}"`);
    }
    lines.push('');
  }
  lines.push(`## Ambiguous — ${groups.ambiguous.length} names`, '');
  for (const r of groups.ambiguous) {
    lines.push(`- \`${r.name}\` → [${r.roleCandidates.join(', ')}] — ${r.rationale.slice(0, 160)}`);
  }
  lines.push(
    '',
    `## Abstain — ${groups.abstain.length} names (cheap by design; listed for completeness)`,
    '',
  );
  lines.push(groups.abstain.map((r) => '`' + r.name + '`').join(' · '));
  lines.push('');
  fs.writeFileSync(path.join(FEATURE, 'adjudication-review.md'), lines.join('\n'));
  console.log(
    `pass1 assembled: resolved=${groups.resolved.length} ambiguous=${groups.ambiguous.length} abstain=${groups.abstain.length}`,
  );
  console.log('worksheet: specs/016-ext-key-alphabet/adjudication-review.md');
}

function finalize() {
  const p1 = JSON.parse(fs.readFileSync(path.join(FEATURE, 'adjudication-pass1.json'), 'utf8'));
  // Pass 2 = the maintainer edited adjudication-pass1.json in place (or left
  // it untouched where they agree). Re-derive every resolved score from the
  // stored attestations so a hand-edited role keeps an honest number.
  const records = p1.records.map((r) => {
    const rec = { ...r };
    if (rec.state === 'resolved') {
      const score = deriveScore(rec.attestations, {});
      if (score === null) {
        console.error(`REJECT: ${rec.name} resolved with no oracle support`);
        process.exit(1);
      }
      rec.score = score;
      rec.roleCandidates = [rec.roleCandidates[0]];
    }
    if (rec.state === 'ambiguous' && (rec.roleCandidates || []).length < 2) {
      console.error(`REJECT: ${rec.name} ambiguous with <2 candidates`);
      process.exit(1);
    }
    if (rec.state === 'abstain') rec.roleCandidates = [];
    rec.reviews = [
      rec.reviews[0],
      {
        reviewer: 'maintainer-vk',
        decision: rec.state,
        date: new Date().toISOString().slice(0, 10),
      },
    ];
    delete rec.quote;
    return rec;
  });
  const out = { version: 1, generated: new Date().toISOString().slice(0, 10), records };
  fs.writeFileSync(
    path.join(ROOT, 'packages', 'core', 'dialects', 'data', 'key-role-adjudication.v1.json'),
    JSON.stringify(out, null, 1) + '\n',
  );
  console.log(
    `finalized: ${records.length} records → packages/core/dialects/data/key-role-adjudication.v1.json`,
  );
  console.log(
    'NEXT: drop the STAGING marker in data/README.md, append matrix slice B, run npm run ci.',
  );
}

const argv = process.argv.slice(2);
if (argv[0] === '--pass1') stage1(argv[1]);
else if (argv[0] === '--finalize') finalize();
else {
  console.error('usage: assemble-adjudication.js --pass1 <verdicts.json> | --finalize');
  process.exit(2);
}
