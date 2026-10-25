"""CIの架空DBで実Worker・認証proxy・ブラウザー・保持処理を順番に検証する"""
from pathlib import Path
import json, os, re, signal, subprocess, sys, time, urllib.request

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / 'services/lt-api'
ADMIN = ROOT / 'apps/admin-web'
WEB = ROOT / 'apps/lt-web'

if os.environ.get('CI') != 'true':
    raise SystemExit('CI-only generated fixture runner; use documented isolated local steps')

processes = []
streams = []
process_info = {}
os.environ['LT_TEST_BRIDGE_URL'] = 'http://127.0.0.1:18879'
os.environ['WRANGLER_SEND_METRICS'] = 'false'

def run(args, cwd=API):
    # 確認URLを含み得る生ログはCIの公開stdoutに出さない
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Local verification step failed: ' + ' '.join(args[:3]))
    print('PASS: ' + ' '.join(args[:2]), flush=True)

def start(args, cwd, label, port):
    target = API / '.wrangler' / ('ci-' + label + '.log')
    target.parent.mkdir(exist_ok=True)
    stream = target.open('w', encoding='utf-8')
    streams.append(stream)
    process = subprocess.Popen(args, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
    processes.append(process)
    process_info[process.pid] = {'label':label,'port':port,'log':target}


def exit_classification(path, code):
    # 分類だけを出し、ログ行や例外本文を公開しない。原因確定の代わりにはしない
    text = path.read_text(encoding='utf-8', errors='replace').lower() if path.exists() else ''
    if re.search(r'eaddrinuse|address already in use', text):
        return 'address_in_use'
    if re.search(r'could not find service|couldn.t resolve service|entrypoint.+does not exist', text):
        return 'binding_missing'
    if code < 0 or re.search(r'fatal error|segmentation fault|javascript heap out of memory|worker runtime.+crash', text):
        return 'runtime_crash'
    return 'other'


def stopped_fixtures():
    # 生ログは公開せず、停止したプロセスの固定識別子と終了コードだけを出す
    stopped = []
    for process in processes:
        code = process.poll()
        if code is not None:
            info = process_info[process.pid]
            stopped.append({'label':info['label'],'port':info['port'],'exitCode':code,'classification':exit_classification(info['log'],code)})
    if stopped:
        print('FIXTURE_EXIT '+json.dumps(stopped,sort_keys=True),flush=True)
    return stopped


def worker(config, port, label):
    start(['node', 'node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', config,
           '--ip', '127.0.0.1', '--port', str(port), '--inspector-port', str(port+1000)], API, label, port)

def ready(url, data=None):
    for _ in range(120):
        if stopped_fixtures():
            raise RuntimeError('Local fixture process stopped; raw logs stay private to runner')
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers={'Content-Type':'application/json'}), timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(.25)
    raise RuntimeError('Local fixture did not become ready')

try:
    run(['node', 'node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'lt-local', '--local'])
    run(['node', 'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'lt-local', '--local', '--file', 'tests/fixture.sql'])
    worker('wrangler.toml', 18877, 'api')
    ready('http://127.0.0.1:18877/api/lt/v1/auth/session')
    worker('tests/proxy.toml', 18878, 'proxy')
    worker('tests/integration-bridge.toml', 18879, 'bridge')
    ready('http://127.0.0.1:18878/api/lt/v1/operator/events')
    run([sys.executable, 'tests/run_runtime.py'])
    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:18878/test/clock', data=b'real', method='POST')) as response:
        assert response.status == 200
    ready('http://127.0.0.1:18878/api/lt/v1/operator/events')
    # 元の実Rust結合テストを明示runnerで必ず実行。環境なしなら失敗する
    ready('http://127.0.0.1:18879', json.dumps({'context':{'actorId':'ci-readiness','role':'assistant','requestId':'ci-readiness'},'path':'/api/lt/v1/operator/events','method':'GET','body':None}).encode())
    run(['npm', 'run', 'test:lt-worker'], ADMIN)
    start(['node', 'tests/lt-route-browser/server.mjs'], ADMIN, 'admin', 18920)
    start(['node', 'e2e/live-server.mjs'], WEB, 'web', 18880)
    ready('http://127.0.0.1:18920')
    ready('http://127.0.0.1:18880')
    run(['npx', '--no-install', 'playwright', 'test', '--config', 'playwright.live.config.ts'], WEB)
    run(['node', 'node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'lt-local', '--local', '--config', 'retention-local.toml'])
    worker('retention-local.toml', 18897, 'retention')
    ready('http://127.0.0.1:18897/api/lt/v1/auth/session')
    worker('tests/retention-proxy.toml', 18898, 'retention-proxy')
    ready('http://127.0.0.1:18898/api/lt/v1/operator/events')
    run([sys.executable, 'tests/retention_runtime_test.py', '-v'])
finally:
    for process in reversed(processes):
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    for process in processes:
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    for stream in streams:
        stream.close()
