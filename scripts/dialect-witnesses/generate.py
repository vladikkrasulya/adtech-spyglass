"""Generate synthetic 033 witnesses from preserved synthetic audit controls.

Usage: python3 generate.py ARCHIVE_DIR FROZEN_MANIFEST OUTPUT
No adapter executes here. The manifest fixes membership; cases and oracle
expectations are hashed before each network-none execution generation.
"""
import copy
import hashlib
import hmac
import json
import pathlib
import sys

archive, manifest_path, output = map(pathlib.Path, sys.argv[1:])
manifest = json.loads(manifest_path.read_text())
clone = copy.deepcopy


def normalized(value, adapter):
    value = clone(value)
    for imp in value.get('imp', []):
        ext = imp.setdefault('ext', {})
        if adapter in ext:
            ext['bidder'] = ext.pop(adapter)
        if adapter == 'huaweiads':
            ext['bidder']['isTestAuthorization'] = 'true'
    return value


def base(adapter):
    control = archive / 'controls' / (adapter + '.json')
    if control.exists():
        value = normalized(json.loads(control.read_text())['request'], adapter)
        value['id'] = 'synthetic-control-' + adapter
        return value
    params = {'logan': {'type': 'synthetic-input'}, 'sovrn': {'tagid': 'synthetic-tag'},
              'insticator': {'adUnitId': 'synthetic-unit', 'publisherId': 'synthetic-publisher'}}[adapter]
    return {'id': 'synthetic-control-' + adapter, 'test': 1,
            'site': {'domain': 'publisher.example', 'page': 'https://publisher.example/page'},
            'imp': [{'id': 'control-imp', 'banner': {'w': 300, 'h': 250}, 'ext': {'bidder': params}}]}


def check(path, value=None, op='eq', other=None):
    return {'path': path, 'op': op, **({'otherVariant': other[0], 'otherPath': other[1]} if other else {'value': value})}


def variant(name, value, checks=None):
    return {'name': name, 'input': clone(value), 'checks': checks if checks is not None else positive()}


def positive():
    return [check('/requestCount', 1, 'atLeast'), check('/errorCount', 0)]


def reject(fragment):
    return [check('/requestCount', 0), check('/errors', fragment, 'contains')]


def video(value):
    value = clone(value)
    value['imp'] = [value['imp'][0]]
    value['imp'][0].pop('banner', None)
    value['imp'][0]['video'] = {'w': 640, 'h': 360, 'mimes': ['video/mp4'], 'maxduration': 30, 'protocols': [2]}
    return value


def single(value, imp):
    value = clone(value)
    value['imp'] = [clone(imp)]
    return value


cases = []
for row in manifest['records']:
    id = row['id']
    adapter = id.split('-')[2]
    # Case IDs spell the historical adapter exactly, including capitalization.
    if id.startswith('b2-'):
        adapter = id.split('-')[1]
    control = base(adapter)
    variants = [variant('control', control)]
    oracle = 'same-adapter condition pair with an independent positive execution control'

    if id in ['b1-001-huaweiads-imp.audio-forbidden', 'b1-002-telaria-imp.banner-forbidden',
              'b1-003-adnuntius-imp.video-forbidden', 'b1-005-gamma-imp.native-forbidden',
              'b1-006-audienceNetwork-site-forbidden', 'b1-008-unicorn-regs.ext.gdpr-forbidden']:
        old = json.loads((archive / 'cases' / (id + '.json')).read_text())
        trigger = normalized(old['triggeringInput'], adapter)
        contrast = normalized(old['minimalPair'], adapter)
        fragment = next(item['value'] for item in old['expected'] if item['surface'] == 'pbs-error')
        variants += [variant('trigger', trigger, reject(fragment)), variant('contrast', contrast)]
        if adapter == 'huaweiads':
            mixed = clone(contrast)
            mixed['imp'][0]['audio'] = {'mimes': ['audio/mp4']}
            variants.append(variant('supported-media-priority', mixed))

    elif adapter == 'logan':
        trigger = clone(control); trigger['imp'][0]['ext']['bidder']['type'] = 'synthetic-A'
        contrast = clone(trigger); contrast['imp'][0]['ext']['bidder']['type'] = 'synthetic-B'
        missing = clone(trigger); del missing['imp'][0]['ext']['bidder']['type']
        expected = positive() + [check('/requests/0/body/imp/0/ext/bidder/type', 'publisher')]
        variants += [variant('trigger', trigger, expected), variant('contrast', contrast, expected), variant('missing-type', missing, expected)]
        oracle = 'constant overwrite: two distinct supplied values and absent-field control all become publisher'

    elif adapter == 'sovrn':
        contrast = video(control); trigger = clone(contrast); del trigger['imp'][0]['video']['mimes']
        empty = clone(contrast); empty['imp'][0]['video']['mimes'] = []
        variants += [variant('trigger', trigger, reject('Missing required video parameter')), variant('contrast', contrast), variant('empty-list-boundary', empty)]

    elif adapter == 'insticator' and ('-004-' in id or '-005-' in id):
        context = 'site' if '-004-' in id else 'app'
        trigger = clone(control); trigger.pop('site', None); trigger.pop('app', None)
        trigger[context] = {'publisher': {'id': 'synthetic-original'}, **({'bundle': 'com.synthetic.app'} if context == 'app' else {'domain': 'publisher.example'})}
        first = clone(trigger['imp'][0]); first['id'] = 'first'; first['ext']['bidder']['publisherId'] = 'synthetic-A'
        second = clone(first); second['id'] = 'second'; second['ext']['bidder']['publisherId'] = 'synthetic-B'
        trigger['imp'] = [first, second]
        contrast = clone(trigger); contrast['imp'].reverse()
        path = '/requests/0/body/' + context + '/publisher/id'
        variants += [variant('trigger', trigger, positive() + [check(path, 'synthetic-A')]), variant('contrast', contrast, positive() + [check(path, 'synthetic-B')])]
        absent = clone(trigger); del absent[context]['publisher']
        variants.append(variant('absent-destination', absent, positive() + [check(path, 'synthetic-A')]))
        invalid = clone(trigger); invalid['imp'][0]['ext']['bidder'] = 'not-an-object'
        variants.append(variant('first-unparsable', invalid, [check('/requestCount', 1), check('/errorCount', 1), check(path, 'synthetic-B')]))
        oracle = 'first parsed impression source identity: reordered inputs and absent/existing destination controls'

    elif adapter == 'insticator':
        field = 'w' if '-008-' in id else 'h' if '-009-' in id else 'mimes'
        contrast = video(control); trigger = clone(contrast); del trigger['imp'][0]['video'][field]
        boundary = clone(contrast); boundary['imp'][0]['video'][field] = [] if field == 'mimes' else 0
        variants += [variant('trigger', trigger, reject('invalid or missing video field')), variant('contrast', contrast),
                     variant('boundary', boundary, positive() if field == 'mimes' else reject('invalid or missing video field'))]

    elif adapter == 'lockerdome':
        contrast = clone(control); first = clone(contrast['imp'][0]); first['id'] = 'first'
        second = clone(first); second['id'] = 'second'; contrast['imp'] = [first, second]
        trigger = clone(contrast); del trigger['imp'][0]['banner']; trigger['imp'][0]['video'] = {'mimes': ['video/mp4']}
        variants += [variant('trigger', trigger, positive() + [check('/requests/0/impIDs', ['first']), check('/bodyImpIDsByID/' + trigger['id'], ['first'])]),
                     variant('contrast', contrast, positive() + [check('/requests/0/impIDs', ['first', 'second'])])]
        oracle = 'survivor identity: the pinned defect retains the first original imp after filtering the later valid index'

    elif adapter in ['smartyads', 'huaweiads']:
        trigger = clone(control); first = clone(trigger['imp'][0]); first['id'] = 'first'
        second = clone(first); second['id'] = 'second'
        for letter, imp in [('A', first), ('B', second)]:
            if adapter == 'smartyads':
                imp['ext']['bidder'] = {'host': 'synthetic-' + letter, 'sourceid': 'source-' + letter, 'accountid': 'account-' + letter}
            else:
                imp['ext']['bidder'].update({'publisherid': 'synthetic-' + letter, 'keyid': 'synthetic-key-' + letter, 'signkey': 'synthetic-sign-' + letter})
        trigger['imp'] = [first, second]; contrast = clone(trigger); contrast['imp'].reverse()
        last_only = single(trigger, second)
        path = '/requests/0/uri' if adapter == 'smartyads' else '/requests/0/headers/Authorization/0'
        def expected(letter):
            if adapter == 'smartyads': return 'http://mock.invalid/smartyads/synthetic-' + letter + '?source=source-' + letter + '&account=account-' + letter
            nonce = '1629473330823'; publisher = 'synthetic-' + letter
            signature = hmac.new((publisher + ':ppsadx/getResult:synthetic-sign-' + letter).encode(), (nonce + ':POST:/ppsadx/getResult').encode(), hashlib.sha256).hexdigest()
            return 'Digest username=' + publisher + ',realm=ppsadx/getResult,nonce=' + nonce + ',response=' + signature + ',algorithm=HmacSHA256,usertype=1,keyid=synthetic-key-' + letter
        variants += [variant('trigger', trigger, positive() + [check(path, expected('B')), check(path, other=('last-only', path))]),
                     variant('contrast', contrast, positive() + [check(path, expected('A'))]), variant('last-only', last_only, positive() + [check(path, expected('B'))])]
        oracle = 'last-impression identity: exact URI/header function, reordered pair and isolated final-impression control'

    elif adapter == 'alliance_gravity':
        trigger = clone(control); trigger['imp'][0]['ext']['bidder']['srid'] = 'synthetic-A'
        contrast = clone(trigger); contrast['imp'][0]['ext']['bidder']['srid'] = 'synthetic-B'
        empty_path = '/requests/0/body/imp/0/ext/bidder'; stored_path = '/requests/0/body/imp/0/ext/prebid/storedrequest/id'
        variants += [variant('trigger', trigger, positive() + [check(empty_path, {}), check(stored_path, 'synthetic-A'), check(empty_path, other=('contrast', empty_path))]),
                     variant('contrast', contrast, positive() + [check(empty_path, {}), check(stored_path, 'synthetic-B')])]
        oracle = 'projection collapse plus source-to-destination identity: bidder becomes empty while srid moves'

    elif adapter in ['limelightDigital', 'goldbach']:
        trigger = clone(control); trigger['id'] = 'synthetic-request-A'
        first = clone(trigger['imp'][0]); first['id'] = 'first'; second = clone(first); second['id'] = 'second'
        if adapter == 'goldbach':
            first['ext']['bidder']['publisherId'] = 'publisher-A'; second['ext']['bidder']['publisherId'] = 'publisher-B'
        trigger['imp'] = [first, second]
        contrast = clone(trigger); contrast['id'] = 'synthetic-request-B'
        def expectations(stem):
            suffixes = ['-first', '-second'] if adapter == 'limelightDigital' else ['_publisher-A', '_publisher-B']
            return positive() + [check('/requestCount', 2), check('/bodyIDs', [stem + x for x in suffixes]),
                check('/bodyImpIDsByID/' + stem + suffixes[0], ['first']), check('/bodyImpIDsByID/' + stem + suffixes[1], ['second'])]
        variants += [variant('trigger', trigger, expectations(trigger['id'])), variant('contrast', contrast, expectations(contrast['id']))]
        oracle = 'identity-based fanout transformation: exact request-ID function and group-to-impression correspondence'
    else:
        raise ValueError('unhandled frozen witness ' + id)
    cases.append({'id': id, 'adapter': adapter, 'oracle': oracle, 'synthetic': True, 'variants': variants})

assert {c['id'] for c in cases} == {c['id'] for c in manifest['records']}
output.write_text(json.dumps({'revision': manifest['source_revision'], 'cases': cases}, indent=2) + '\n')
print(json.dumps({'cases': len(cases), 'variants': sum(len(c['variants']) for c in cases), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
