"""追加情報の申請・編集・承認・公開を隔離したローカルD1で検証する"""
from pathlib import Path
import hashlib, json, os, subprocess, tempfile, time, urllib.request, urllib.error, uuid

ROOT = Path(__file__).resolve().parents[1]
CLI = os.environ.get('LT_WRANGLER_CLI', str(ROOT.parents[1] / 'apps/admin-web/node_modules/wrangler/bin/wrangler.js'))
STATE = Path(tempfile.mkdtemp(prefix='lt-session-test-'))
ENV = dict(os.environ, WRANGLER_SEND_METRICS='false', WRANGLER_LOG_PATH=str(STATE/'logs'), WRANGLER_REGISTRY_PATH=str(STATE/'registry'))
CONFIG = 'tests/production-gate.toml'
PROCESSES = []
STREAMS = []

# ローカルD1だけに試験値を入れる
def cli(args):
    result = subprocess.run(['node', CLI] + args, cwd=ROOT, env=ENV, capture_output=True, encoding='utf-8', errors='replace')
    assert result.returncode == 0, result.stderr[-1500:]
    return result.stdout

# 本番と同じ型のHTTP要求をローカルWorkerへ送る
def request(path, data=None, method=None, operator=False, cookie=None, status=200, role=None):
    """隔離Workerへ要求し応答のステータスを検証する

    Args:
        path: APIの相対パス
        data: 送信するJSON
        method: HTTPメソッド
        operator: 運営側Workerを使うか
        cookie: 本人認証Cookie
        status: 期待するHTTPステータス
        role: ローカル内部RPCの検証用役割
    Returns:
        応答のJSON
    """
    headers = {'Content-Type':'application/json', 'Origin':'https://example.invalid', 'X-LT-CSRF':'1'}
    if cookie: headers['Cookie'] = cookie
    prefix = f'/test/role/{role}/api/lt/v1' if role else '/api/lt/v1'
    req = urllib.request.Request(f'http://127.0.0.1:{18988 if operator else 18987}' + prefix + path, data=None if data is None else json.dumps(data).encode(), headers=headers, method=method)
    try: response = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as error: response = error
    with response:
        value = json.loads(response.read())
        assert response.status == status, (path, response.status, value)
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
    settings = {'operationId':uuid.uuid4().hex,'title':'Metadata test','venue':'Local','guidance':'Local only','startsAt':'2030-11-03T04:00:00.000Z','timeZone':'Asia/Tokyo','opensAt':'2020-01-01T00:00:00.000Z','closesAt':'2030-11-01T14:59:00.000Z','capacity':10,'talkMinutes':10,'transitionMinutes':5, "approvalMode": "manual", "scheduleMode": "manual", "openingMinutes": 0, "breakEvery": 4, "breakMinutes": 0, "closingMinutes": 0, "endsBy": None}
    event = request('/operator/events',settings,operator=True)
    # ポスターの保存・変更・削除とURL検証を実DB経路で確認する
    base = {k:v for k,v in settings.items() if k != 'operationId'}
    for url in ['https://example.com/one.png', 'https://example.com/two.png', None]:
        data = dict(base)
        if url: data['posterUrl'] = url
        event = request('/operator/events/' + event['id'], {'expectedVersion':event['version'],'operationId':uuid.uuid4().hex,'data':data}, operator=True, method='PATCH')
        assert event.get('posterUrl') == url
        public = request('/events/' + event['id'])
        assert public.get('posterUrl') == url
    request('/operator/events/' + event['id'], {'expectedVersion':event['version'],'operationId':uuid.uuid4().hex,'data':dict(base,posterUrl='javascript:alert(1)')}, operator=True, method='PATCH', status=422)
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
    assert 'representativeEmail' not in published and published['materialUrl'] == 'https://example.com/slides'
    # メール・資料・追加情報がない手動受付済み発表と同じ状態を再現する
    sql.write_text("UPDATE lt_applications SET registration_source='manual',email='',dto=json_set(json_remove(dto,'$.content.session','$.content.speakers[0].links','$.published.session','$.published.speakers[0].links'),'$.representativeEmail','','$.materialUrl','') WHERE id='"+app['id']+"'; UPDATE lt_public_talks SET dto=(SELECT json_extract(dto,'$.published') FROM lt_applications WHERE id='"+app['id']+"') WHERE id='"+app['id']+"';",encoding='utf-8')
    cli(['d1','execute','lt-production-gate-local','--local','--config',CONFIG,'--persist-to',str(STATE/'state'),'--file',str(sql)])
    metadata['difficulty']='easy'
    edit={'expectedVersion':app['version'],'operationId':uuid.uuid4().hex,'data':{'session':metadata,'speakerLinks':[[{'label':'GitHub','url':'https://github.com/example'}]]}}
    path='/operator/applications/'+app['id']+'/metadata'
    saved=request(path,edit,operator=True)
    assert saved['representativeEmail']=='' and saved['materialUrl']=='' and saved['review']=='approved'
    assert saved['content']['session']==metadata and saved['published']['session']==metadata
    assert request(path,edit,operator=True)['version']==saved['version']
    request(path,edit|{'operationId':uuid.uuid4().hex},operator=True,status=409)
    request(path,edit|{'expectedVersion':saved['version'],'operationId':uuid.uuid4().hex,'data':{'session':metadata,'speakerLinks':[[{'label':'Bad','url':'javascript:alert(1)'}]]}},operator=True,status=422)
    public=request('/events/'+event['id']+'/talks/'+app['id'])
    assert public['session']==metadata and public['speakers'][0]['links']==edit['data']['speakerLinks'][0]
    assert public['startsAt']==published['startsAt'] and public['title']==published['title']
    # 管理者・幹部の編集と補佐の拒否を実際の内部RPCで検証する
    path = '/operator/applications/' + app['id']
    for role in ['admin', 'executive', 'assistant']:
        permissions = request('/operator/permissions', operator=True, role=role)
        assert permissions['canEditApplications'] == (role != 'assistant')
    changed_content = {'title':'編集したタイトル', 'abstract':'編集した概要', 'description':'詳細',
        'speakers':[{'displayName':'更新した登壇者','affiliation':'所属','profile':'紹介'},
                    {'displayName':'共同登壇者','links':[{'label':'Web','url':'https://example.com'}]}], 'session':metadata}
    edit = {'expectedVersion':saved['version'],'operationId':uuid.uuid4().hex,
            'data':{'content':changed_content,'materialUrl':'https://example.com/new-slides'}}
    request(path, edit, method='PATCH', operator=True, role='assistant', status=403)
    saved = request(path, edit, method='PATCH', operator=True, role='admin')
    assert saved['content'] == changed_content and saved['review'] == 'approved'
    assert saved['materialUrl'] == edit['data']['materialUrl'] and not saved['materialReviewed']
    assert request(path, edit, method='PATCH', operator=True, role='admin')['version'] == saved['version']
    request(path, edit | {'operationId':uuid.uuid4().hex}, method='PATCH', operator=True, role='admin', status=409)
    published = request('/events/'+event['id']+'/talks/'+app['id'])
    assert published['speakers'] == changed_content['speakers'] and published['description'] == '詳細'
    assert published['startsAt'] == public['startsAt'] and published['materialUrl'] == 'https://example.com/new-slides'

    # 任意項目の削除と資料確認済み状態の解除を検証する
    saved = request(path+'/material', {'expectedVersion':saved['version'],'operationId':uuid.uuid4().hex,
        'data':{'materialUrl':saved['materialUrl']}}, operator=True)
    assert saved['materialReviewed']
    del changed_content['description']
    del changed_content['session']
    edit = {'expectedVersion':saved['version'],'operationId':uuid.uuid4().hex,
            'data':{'content':changed_content,'materialUrl':''}}
    saved = request(path, edit, method='PATCH', operator=True, role='executive')
    published = request('/events/'+event['id']+'/talks/'+app['id'])
    assert 'description' not in published and 'session' not in published and 'materialUrl' not in published and not saved['materialReviewed']
    assert published['speakers'] == changed_content['speakers']

    # 不正な入力や所有者・承認状態の書き換えを拒否する
    for data in [edit['data'] | {'review':'approved'}, edit['data'] | {'representativeEmail':'other@example.invalid'},
                 edit['data'] | {'materialUrl':'javascript:alert(1)'},
                 edit['data'] | {'content':changed_content | {'speakers':[]}},
                 edit['data'] | {'content':changed_content | {'title':' '}}]:
        request(path, {'expectedVersion':saved['version'],'operationId':uuid.uuid4().hex,'data':data},
                method='PATCH', operator=True, role='admin', status=422)
    print('PASS: session metadata; admin/executive editing; role denial; publication; replay; conflicts; validation; material review reset')
finally:
    for process in reversed(PROCESSES):
        if os.name=='nt': subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
        else: process.terminate()
    for stream in STREAMS: stream.close()
