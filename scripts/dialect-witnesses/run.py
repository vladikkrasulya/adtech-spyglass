"""Execute one immutable witness attempt in an owned prepared PBS directory.

Usage: python3 run.py OWNED_ROOT ATTEMPT_NUMBER
Dependency preparation is separate. This runner always disables networking,
pins the prepared image, mounts source read-only, and retains failed attempts.
"""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import time

root = pathlib.Path(sys.argv[1]).resolve()
attempt = int(sys.argv[2])
if not root.name.startswith('ortbtools-dialect033-') or attempt < 1:
    raise SystemExit('expected owned disposable directory and positive attempt number')
manifest = json.loads((root / 'harness/witness-manifest.json').read_text())
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root / 'source', text=True).strip()
if revision != manifest['source_revision']:
    raise SystemExit('pinned adapter revision changed')
subprocess.run(['git', 'diff', '--exit-code', 'HEAD', '--'], cwd=root / 'source', check=True, stdout=subprocess.DEVNULL)
cases = json.loads((root / 'source/ortbtools033/cases.json').read_text())['cases']
if {c['id'] for c in cases} != {c['id'] for c in manifest['records']} or len(cases) != 19:
    raise SystemExit('frozen witness membership changed')
source_hashes = {}
for adapter in sorted({c['adapter'] for c in cases}):
    relative = f'adapters/{adapter}/' + ('facebook.go' if adapter == 'audienceNetwork' else adapter + '.go')
    source_hashes[relative] = hashlib.sha256((root / 'source' / relative).read_bytes()).hexdigest()
directory = root / 'evidence' / f'attempt{attempt:03}'
directory.mkdir()
files = [root / 'source/ortbtools033/witness_test.go', root / 'source/ortbtools033/cases.json',
         root / 'harness/generate.py', root / 'harness/witness-manifest.json', pathlib.Path(__file__)]
for source in files:
    shutil.copyfile(source, directory / source.name)
hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.iterdir() if p.is_file()}
(directory / 'frozen-inputs.json').write_text(json.dumps({'attempt': attempt, 'sourceRevision': revision,
    'trackedSourceClean': True, 'sourceFiles': source_hashes, 'files': hashes}, indent=2) + '\n')
base = json.loads((root / 'evidence/offline-module-verification.json').read_text())['command']
command = ['docker', 'create'] + base[3:-2]
mount = command.index('--tmpfs') + 1
command[mount] = '/tmp:rw,exec,nosuid,size=1g'
name = f'ortbtools-dialect033-{root.name.rsplit("-", 1)[-1]}-{attempt:03}'
at = command.index('--workdir')
command[at:at] = ['--name', name, '--mount', f'type=bind,src={directory},dst=/evidence',
                 '--env', 'ORTBTOOLS_WITNESS_OUTPUT=/evidence/observations.json', '--env', 'GOMAXPROCS=2']
command += ['test', '-count=1', '-p', '2', '-run', '^TestFrozenWitnesses$', '-v', './ortbtools033']
(directory / 'command.json').write_text(json.dumps({'command': command, 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, indent=2) + '\n')
subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
container = json.loads(subprocess.check_output(['docker', 'inspect', name], text=True))[0]
isolation = {'image': container['Image'], 'networkMode': container['HostConfig']['NetworkMode'],
             'readonlyRootfs': container['HostConfig']['ReadonlyRootfs'], 'user': container['Config']['User'],
             'capDrop': container['HostConfig']['CapDrop'], 'tmpfs': container['HostConfig']['Tmpfs']}
(directory / 'isolation.json').write_text(json.dumps(isolation, indent=2) + '\n')
if isolation['networkMode'] != 'none' or not isolation['readonlyRootfs'] or isolation['user'] != '1000:1000':
    raise SystemExit('unexpected isolation; stopped owned container retained for inspection')
with (directory / 'execution.log').open('w') as log:
    process = subprocess.Popen(['docker', 'start', '-a', name], stdout=log, stderr=subprocess.STDOUT)
    print(json.dumps({'pid': process.pid, 'attemptPath': str(directory), 'container': name}), flush=True)
    code = process.wait()
state = json.loads(subprocess.check_output(['docker', 'inspect', name], text=True))[0]['State']
result = {'exitCode': code, 'containerExitCode': state['ExitCode'], 'oomKilled': state['OOMKilled'],
          'finishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
          'logSha256': hashlib.sha256((directory / 'execution.log').read_bytes()).hexdigest()}
(directory / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
if not state['Running']:
    subprocess.run(['docker', 'rm', name], check=True, stdout=subprocess.DEVNULL)
print(json.dumps(result), flush=True)
