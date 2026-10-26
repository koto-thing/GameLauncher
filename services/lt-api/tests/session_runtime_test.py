"""追加情報の申請・編集・承認・公開を隔離したローカルD1で検証する"""
from pathlib import Path
import hashlib, json, os, subprocess, tempfile, time, urllib.request, urllib.error, uuid

ROOT = Path(__file__).resolve().parents[1]
CLI = os.environ.get('LT_WRANGLER_CLI', str(ROOT.parents[1] / 'apps/admin-web/node_modules/wrangler/bin/wrangler.js'))
STATE = Path(tempfile.mkdtemp(prefix='lt-session-test-'))
ENV = dict(os.environ, WRANGLER_SEND_METRICS='false', WRANGLER_LOG_PATH=str(STATE/'logs'))
CONFIG = 'tests/production-gate.toml'
PROCESSES = []
STREAMS = []

# ローカルD1だけに試験値を入れる
def cli(args):
    result = subprocess.run(['node', CLI] + args, cwd=ROOT, env=ENV, capture_output=True, encoding='utf-8', errors='replace')
    assert result.returncode == 0, result.stderr[-1500:]
    return result.stdout

# 本番と同じ型のHTTP要求をローカルWorkerへ送る
def request(path, data=None, method=None, operator=False, cookie=None):
    headers = {'Content-Type':'application/json', 'Origin':'https://example.invalid', 'X-LT-CSRF':'1'}
    if cookie: headers['Cookie'] = cookie
    req = urllib.request.Request(f'http://127.0.0.1:{18988 if operator else 18987}/api/lt/v1' + path, data=None if data is None else json.dumps(data).encode(), headers=headers, method=method)
    try: response = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as error: response = error
    with response:
        value = json.loads(response.read())
        assert response.status == 200, (path, response.status, value)
        return value

try:
    cli(['d1','migrations','apply','lt-production-gate-local','--local','--config',CONFIG,'--persist-to',str(STATE/'state')])
    for config, port in [(CONFIG,18987),('tests/production-gate-proxy.toml',18988)]:
        stream = (STATE/f'{port}.log').open('w',encoding='utf-8'); STREAMS.append(stream)
        args = ['node',CLI,'dev','--local','--config',config,'--port',str(port),'--ip','127.0.0.1','--inspector-port',str(port+1000),'--persist-to',str(STATE/'state')]
        if port == 18987: args += ['--var','LT_PRIVATE_API_ENABLED:true']
        PROCESSES.append(subprocess.Popen(args,cwd=ROOT,env=ENV,stdout=stream,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0))
        for attempt in range(100):
            assert PROCESSES[-1].poll() is None, (STATE/f'{port}.log').read_text(encoding='utf-8')[-1500:]
            try:
                request('/operator/events' if port==18988 else '/auth/session',operator=port==18988)
                break
            except Exception:
                if attempt == 99: raise
                time.sleep(.3)
    settings = {'operationId':uuid.uuid4().hex,'title':'Metadata test','venue':'Local','guidance':'Local only','startsAt':'2030-11-03T04:00:00.000Z','timeZone':'Asia/Tokyo','opensAt':'2020-01-01T00:00:00.000Z','closesAt':'2030-11-01T14:59:00.000Z','capacity':10,'talkMinutes':10,'transitionMinutes':5}
    event = request('/operator/events',settings,operator=True)
    token = uuid.uuid4().hex
    hashed = hashlib.sha256(token.encode()).hexdigest()
    sql = STATE/'session.sql'
    sql.write_text(f"INSERT INTO lt_auth_tokens(hash,email,purpose,expires,session_hash,session_expires) VALUES('{uuid.uuid4().hex}','metadata@example.invalid','login',9999999999999,'{hashed}',9999999999999);",encoding='utf-8')
    cli(['d1','execute','lt-production-gate-local','--local','--config',CONFIG,'--persist-to',str(STATE/'state'),'--file',str(sql)])
    cookie = '__Host-lt_session=' + token
    metadata = {'field':'programming','relatedFields':['ENG','GD'],'keywords':['Unity','Shader'],'platforms':['PC','Web'],'difficulty':'normal','prerequisites':'Unityの基本操作\nC#の基礎','takeaways':'描画の仕組み\n実装の方法'}
    speaker = {'displayName':'Test speaker','links':[{'label':'Portfolio','url':'https://example.com/portfolio'}]}
    content = {'title':'Session test','abstract':'Abstract','speakers':[speaker],'session':metadata}
    app = request('/applications',{'eventId':event['id'],'operationId':uuid.uuid4().hex,'content':content,'materialUrl':'https://example.com/slides'},cookie=cookie)
    assert app['content']['session']==metadata and app['content']['speakers']==[speaker]
    metadata['takeaways'] = '編集後の知見'
    app = request('/applications/'+app['id'],{'expectedVersion':app['version'],'operationId':uuid.uuid4().hex,'data':{'content':content,'materialUrl':'https://example.com/slides'}},method='PATCH',cookie=cookie)
    assert request('/applications/'+app['id'],cookie=cookie)['content']['session']==metadata
    schedule = request('/operator/events/'+event['id']+'/timetable',operator=True)
    app = request('/operator/applications/'+app['id']+'/approve',{'expectedVersion':app['version'],'operationId':uuid.uuid4().hex,'data':{'startsAt':settings['startsAt'],'expectedEventVersion':event['version'],'expectedScheduleVersion':schedule['version']}},operator=True)
    published = request('/events/'+event['id']+'/talks/'+app['id'])
    assert published['session']==metadata and published['speakers']==[speaker]
    assert 'representativeEmail' not in published and 'materialUrl' not in published
    print('PASS: submit, edit, reload, approve and public metadata/link round trip (local only, mail disabled)')
finally:
    for process in reversed(PROCESSES):
        if os.name=='nt': subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
        else: process.terminate()
    for stream in STREAMS: stream.close()


