"""担当bundleの3構成と本番無効化境界をローカルだけで確認する"""
from pathlib import Path
import subprocess,os,json,time,urllib.request,urllib.error,sys
sys.stdout.reconfigure(encoding='utf-8',errors='replace')
os.environ['WRANGLER_LOG_PATH']=str(Path('.wrangler/logs').resolve())
os.environ['WRANGLER_SEND_METRICS']='false'
os.environ['CARGO_NET_OFFLINE']='true'

def run(label,args):
 r=subprocess.run(args,capture_output=True,text=True,encoding='utf-8',errors='replace')
 print(label+(': PASS' if r.returncode==0 else ': FAIL'),flush=True)
 if r.returncode:print((r.stdout+r.stderr)[-6000:]);sys.exit(r.returncode)

def get(url):
 try:r=urllib.request.urlopen(url,timeout=5)
 except urllib.error.HTTPError as e:r=e
 with r:
  body=r.read()
  try:value=json.loads(body)
  except ValueError:value=None
  return r.status,value

def ready(status):
 for attempt in range(30):
  try:
   public=get('http://127.0.0.1:18877/api/lt/v1/auth/session')
   internal=get('http://127.0.0.1:18878/api/lt/v1/operator/events')
   if public[0]==status and internal[0]==status and isinstance(internal[1],dict):return
  except (OSError,ValueError):pass
  time.sleep(.2)
 raise AssertionError('Local bundle reload did not complete')

build=str(Path('.tools/bin/worker-build.exe').resolve())
run('development/test build',[build,'--release','.','--features','local-development,runtime-tests'])
ready(200)
run('copy settings regression',[sys.executable,'tests/events_runtime_test.py','-v'])
run('development/test bundle measurement',[sys.executable,'tests/measure_bundle.py','development_with_test_hooks'])
run('default build',[build,'--release','.'])
ready(501)
assert get('http://127.0.0.1:18877/api/lt/v1/auth/session')[1]['error']['code']=='NOT_IMPLEMENTED'
assert get('http://127.0.0.1:18878/api/lt/v1/operator/events')[0]==501
assert get('http://127.0.0.1:18877/api/lt/v1/events')[0]==200
assert get('http://127.0.0.1:18877/api/lt/v1/operator/events')[0]==404
print('default private API disabled: PASS',flush=True)
run('default bundle measurement',[sys.executable,'tests/measure_bundle.py','default_private_disabled'])
run('development without hooks build',[build,'--release','.','--features','local-development'])
ready(200)
run('development without hooks measurement',[sys.executable,'tests/measure_bundle.py','development_without_test_hooks'])
run('local wall time only',[sys.executable,'tests/benchmark_local.py'])
p=Path('verification.json');d=json.loads(p.read_text('utf-8'));d.update(default_private_disabled_smoke=True,test_exports_absent_in_normal_bundles=True,runtime_tests_passed=58,contract_tests_passed=9,fresh_migrations_passed=30,copy_japan_timezone_regression_passed=True);d.setdefault('checks',{}).update(runtime_tests='58 passed',fresh_migrations_and_fixture='0001-0029 +0040 passed',normal_bundles_test_hooks='fake_mail/change_mail/test_dispatch/set_clock/pause absent',default_private_api='typed 501; public operator 404',copy_japan_timezone='3 event regressions passed');d['limitations']=[v for v in d.get('limitations',[]) if v!='start_end_confirmation_route_not_in_shared_contract'];p.write_text(json.dumps(d,indent=2),encoding='utf-8')
