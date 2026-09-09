"""Create a new derived generation from measured witnesses; never edit 008.

Usage: python3 amend.py ARCHIVE_ROOT OWNED_ROOT SUCCESSFUL_ATTEMPT
"""
import copy
import hashlib
import json
import pathlib
import sys

archive, root = map(pathlib.Path, sys.argv[1:3])
attempt = root / 'evidence' / f'attempt{int(sys.argv[3]):03}'
source = archive / 'derived/adapter-rules-2026-08-20.json'
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
if source_hash != '73d067fa6ea9689b09167104db7bb1a72ff950446db8275b41bd54e32193598b':
    raise SystemExit('original corpus digest changed')
data = json.loads(source.read_text())
original = copy.deepcopy(data)
adjudication = json.loads((archive / 'audit/adjudication-b2.json').read_text())
records = {r['candidateId']: r for r in adjudication['records']}
manifest = json.loads((root / 'harness/witness-manifest.json').read_text())
measured = json.loads((attempt / 'observations.json').read_text())
observed = {r['id']: r for r in measured['records']}
if set(observed) != {r['id'] for r in manifest['records']} or any(r['outcome'] != 'pass' for r in observed.values()):
    raise SystemExit('all nineteen frozen IDs must have measured passes before amendment')
if json.loads((attempt / 'result.json').read_text())['exitCode'] != 0:
    raise SystemExit('successful process receipt required')
bidder_by_id = {b['bidder']: b for b in data['bidders']}
original_by_id = {b['bidder']: b for b in original['bidders']}
changed = {}
result_rows = []
for frozen in manifest['records']:
    id = frozen['id']
    witness = observed[id]
    adapter = witness['adapter']
    if frozen['group'] == 'disagreement':
        record = records[id]
        match = record['matchedFrozenCorpusRepresentations'][0]
        action = record['proposedCorpusAction']
    else:
        record = json.loads((archive / 'audit/cases' / (id + '.json')).read_text())
        match = record['rule']
        action = {'action': 'retain-classification', 'proposedRule': None}
    candidates = [i for i, row in enumerate(original_by_id[adapter]['rules'])
                  if row['field'] == match['field'] and row['disposition'] == match['disposition']
                  and row['evidence'] == match['evidence']]
    if len(candidates) != 1:
        raise SystemExit(f'exact original rule identity not unique: {id}: {candidates}')
    index = candidates[0]
    before = original_by_id[adapter]['rules'][index]
    row = bidder_by_id[adapter]['rules'][index]
    if action['proposedRule']:
        row.update(copy.deepcopy(action['proposedRule']))
    row['status'] = 'verified'
    proof = row.setdefault('witness033', {'generation': '033-direct-adapters', 'ids': []})
    proof['ids'].append(id)
    proof['observationsSha256'] = hashlib.sha256((attempt / 'observations.json').read_bytes()).hexdigest()
    if id == 'b2-sovrn-010-7a928c161a6a':
        row['detail'] = 'When video is present, a missing (nil) mimes list rejects the impression. Empty and nonempty supplied lists are accepted when the other video fields are valid.'
    if id in ['b2-insticator-008-2ee091eb630c', 'b2-insticator-009-c777667bcc8b', 'b2-insticator-010-f05d495a0537']:
        row['detail'] = 'When video is present, w and h must be supplied and nonzero, and mimes must be supplied (not nil). A supplied empty mimes list is accepted by this pinned adapter.'
    if id == 'b1-001-huaweiads-imp.audio-forbidden':
        row['detail'] = 'An audio-only impression is rejected as unsupported. A supported banner, Native or video object takes precedence when also supplied.'
    changed[(adapter, index)] = row
    result_rows.append({'id': id, 'group': frozen['group'], 'adapter': adapter, 'outcome': 'pass',
                        'oracle': witness['oracle'], 'variantCount': len(witness['observations']),
                        'assertions': witness['assertions'], 'corpusIndex': index,
                        'before': copy.deepcopy(before), 'action': action['action']})

for result in result_rows:
    result['after'] = copy.deepcopy(bidder_by_id[result['adapter']]['rules'][result['corpusIndex']])
data['audit']['scope'] += ' This is retained historical 008 evidence; current follow-up closure is recorded separately in audit033.'
disposition_changes = sum(original_by_id[adapter]['rules'][index]['disposition'] != row['disposition'] for (adapter, index), row in changed.items())
assert disposition_changes == 4
assert sum(len(b['rules']) for b in data['bidders']) == sum(len(b['rules']) for b in original['bidders'])
data['audit033'] = {'generation': '033-direct-adapters', 'sourceRevision': manifest['source_revision'],
                    'parentCorpusSha256': source_hash, 'network': 'none', 'cases': 19, 'passed': 19,
                    'ruleCountUnchanged': sum(len(b['rules']) for b in data['bidders']),
                    'dispositionChanges': disposition_changes, 'uniqueRulesWithEvidence': len(changed),
                    'historicalB1': {'pass': 36, 'inconclusive': 12},
                    'resolvedFollowUpIds': [r['id'] for r in result_rows]}
derived = root / 'derived'; derived.mkdir(exist_ok=True)
destination = derived / 'adapter-rules-033.json'
destination.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
report = {'schemaVersion': 1, 'generation': '033-direct-adapters', 'sourceRevision': manifest['source_revision'],
          'scope': 'Nineteen bounded direct-adapter witnesses; declared-profile relevance, no actual-traffic or corpus-wide accuracy claim.',
          'oldCorpusSha256': source_hash, 'newCorpusSha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
          'newCorpusPath': str(destination), 'historicalAuditTreeSha256': manifest['audit_tree_sha256'],
          'historicalB1': {'pass': 36, 'fail': 0, 'inconclusive': 12},
          'successfulAttempt': int(sys.argv[3]), 'attemptPath': str(attempt),
          'frozenInputs': json.loads((attempt / 'frozen-inputs.json').read_text()),
          'execution': json.loads((attempt / 'result.json').read_text()),
          'isolation': json.loads((attempt / 'isolation.json').read_text()),
          'observationsSha256': hashlib.sha256((attempt / 'observations.json').read_bytes()).hexdigest(),
          'totals': {'cases': 19, 'pass': 19, 'fail': 0, 'variants': sum(r['variantCount'] for r in result_rows),
                     'assertions': sum(r['assertions'] for r in result_rows), 'dispositionChanges': disposition_changes,
                     'uniqueRulesWithEvidence': len(changed)}, 'records': result_rows}
report['attempts'] = []
for retained in sorted((root / 'evidence').glob('attempt*')):
    receipt = json.loads((retained / 'result.json').read_text())
    observations = retained / 'observations.json'
    outcomes = json.loads(observations.read_text())['records'] if observations.exists() else []
    report['attempts'].append({'attempt': int(retained.name.removeprefix('attempt')), 'path': str(retained),
                              'exitCode': receipt['exitCode'], 'logSha256': receipt['logSha256'],
                              'caseCount': len(outcomes), 'failedCaseIds': [r['id'] for r in outcomes if r['outcome'] != 'pass']})
report['amendmentScriptSha256'] = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
(root / 'evidence/witness-results.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
if hashlib.sha256(source.read_bytes()).hexdigest() != source_hash:
    raise SystemExit('original corpus changed unexpectedly')
print(json.dumps({'totals': report['totals'], 'newCorpusSha256': report['newCorpusSha256']}))
