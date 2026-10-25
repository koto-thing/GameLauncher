"""配送無効の専用APIだけへ少量の逐次要求を送り、tailのCPU値だけを保存する"""
from pathlib import Path
import argparse, datetime, hashlib, json, re, subprocess, threading, time, urllib.parse, urllib.request, urllib.error, uuid

from cpu_tail_parser import TailParser, match_event

parser = argparse.ArgumentParser()
parser.add_argument('--label', required=True)
parser.add_argument('--version', required=True)
parser.add_argument('--samples', type=int, default=3, choices=[1,3])
args = parser.parse_args()
assert re.fullmatch(r'[a-z0-9_-]+', args.label)
assert re.fullmatch(r'[0-9a-f-]{36}', args.version)
base = 'https://pandd-lt-api.gotoukenta62.workers.dev'
probe = uuid.uuid4().hex
ready = threading.Event()
records = {}
lock = threading.Lock()
process = subprocess.Popen(['node','node_modules/wrangler/bin/wrangler.js','tail','pandd-lt-api','--format','json'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')

diagnostics = {'parsed':0,'matched':0,'requestEvents':0,'queryEvents':0,'markers':0,'errors':[]}

def capture():
    decoder = TailParser()
    try:
        for line in process.stdout:
            for value in decoder.feed(line):
                diagnostics['parsed'] += 1
                request = (value.get('event') or {}).get('request') or {}
                if request:
                    diagnostics['requestEvents'] += 1
                    if urllib.parse.urlsplit(request.get('url','')).query: diagnostics['queryEvents'] += 1
                if value.get('logs'): diagnostics['markers'] += 1
                selected = match_event(value, probe, args.version)
                if selected is None: continue
                with lock:
                    if selected['sequence'] in records: raise ValueError('Duplicate matching sequence')
                    records[selected['sequence']] = selected
                    diagnostics['matched'] += 1
    except Exception as error:
        diagnostics['errors'].append(type(error).__name__+': '+str(error))

thread = threading.Thread(target=capture, daemon=True)
thread.start()
try:
    # JSON形式は接続完了文を出さない。接続猶予後、全9件の受信で成立を確認する
    time.sleep(8)
    assert process.poll() is None, 'Tail stopped before any synthetic request'
    sequence = 0
    for path, status in [('/api/lt/v1/events',200),('/api/lt/v1/auth/session',501),('/api/lt/v1/operator/events',404)]:
        for _ in range(args.samples):
            sequence += 1
            request = urllib.request.Request(base+path+'?'+urllib.parse.urlencode({'lt_cpu_probe':probe,'lt_cpu_seq':sequence}),headers={'User-Agent':'LT-cpu-preflight/1','X-LT-CPU-Probe':probe,'X-LT-CPU-Sequence':str(sequence)})
            try: response = urllib.request.urlopen(request, timeout=20)
            except urllib.error.HTTPError as error: response = error
            with response:
                body = json.load(response)
                assert response.status == status, (path,response.status)
                if status == 200: assert body['items'] == [], 'Dataset differs from empty baseline'
            time.sleep(.35)
    for _ in range(100):
        with lock: count = len(records)
        if count == args.samples*3: break
        time.sleep(.2)
    with lock: events = [records[key] for key in sorted(records)]
    Path('.wrangler/cpu-collector-diagnostics.json').write_text(json.dumps(diagnostics,indent=2),encoding='utf-8')
    print(json.dumps({'diagnostics':diagnostics,'captured':events}),flush=True)
    assert not diagnostics['errors'], 'Collector rejected malformed event'
    assert len(events) == args.samples*3, 'Incomplete tail sample; do not infer missing CPU'
    assert all(e['version'] == args.version and e['phase'] for e in events), 'Wrong version or missing isolate marker'
    assert all(isinstance(e['cpuTimeMs'], (int,float)) for e in events), 'Missing actual CPU time'
    report = {'label':args.label,'version':args.version,'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
              'sourceDiffSha256':hashlib.sha256(subprocess.check_output(['git','diff'])).hexdigest(),
              'dataset':'empty dedicated LT D1; mail disabled; private gate disabled','timeUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'events':events,'allAtMost10ms':all(e['cpuTimeMs']<=10 for e in events),'requests':args.samples*3,'mailSent':False}
    target = Path('.wrangler')/('cpu-'+args.label+'.json')
    target.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report),flush=True)
finally:
    process.terminate()
    try: process.wait(timeout=5)
    except subprocess.TimeoutExpired: process.kill()
    thread.join(timeout=2)
