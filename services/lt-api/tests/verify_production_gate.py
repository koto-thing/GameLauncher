"""production featureを空のローカルD1で検証する。固定contextはlocalhost試験専用。"""
from pathlib import Path
import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request
import tempfile


def main():
    # 長いworkspaceパスのSQLite補助ファイルを避ける
    root = Path(tempfile.mkdtemp(prefix='lt-prod-gate-')).resolve()
    commands = ['node','node_modules/wrangler/bin/wrangler.js']
    processes, streams = [], []
    env = dict(os.environ, WRANGLER_LOG_PATH=str(root/'logs'), WRANGLER_SEND_METRICS='false')
    try:
        result = subprocess.run(commands+['d1','migrations','apply','lt-production-gate-local','--local',
            '--config','tests/production-gate.toml','--persist-to',str(root/'state')],capture_output=True,env=env)
        assert result.returncode == 0, 'Local production gate migrations failed'
        for config,port in [('tests/production-gate.toml',18987),('tests/production-gate-proxy.toml',18988)]:
            stream=(root/(str(port)+'.log')).open('w',encoding='utf-8');streams.append(stream)
            processes.append(subprocess.Popen(commands+['dev','--local','--config',config,'--port',str(port),
                '--ip','127.0.0.1','--inspector-port',str(port+1000),'--persist-to',str(root/'state')],
                stdout=stream,stderr=subprocess.STDOUT,env=env,start_new_session=os.name!='nt'))
            if port == 18987:
                # APIの実ready後にbinding callerを起動し、registry/SQLite起動を競合させない
                for _ in range(160):
                    assert processes[0].poll() is None, 'Local API fixture stopped'
                    try:
                        with urllib.request.urlopen('http://127.0.0.1:18987/api/lt/v1/events',timeout=2) as ready:
                            ready.read(); break
                    except OSError:time.sleep(.25)
                else:raise AssertionError('Local API fixture did not become ready')
        def request(port,path,method='GET'):
            req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,method=method)
            try:r=urllib.request.urlopen(req,timeout=3)
            except urllib.error.HTTPError as error:r=error
            with r:
                body=r.read()
                value=json.loads(body) if r.headers.get('Content-Type','').startswith('application/json') else None
                return r.status,value,dict(r.headers)
        for _ in range(160):
            assert all(process.poll() is None for process in processes), 'Local production gate process stopped'
            try:
                if request(18988,'/api/lt/v1/operator/events')[0]==200:break
            except OSError:pass
            time.sleep(.25)
        else:raise AssertionError('Local production gate did not become ready')
        assert request(18988,'/api/lt/v1/operator/events')[1]['items']==[]
        for path in ['/api/lt/v1/auth/session','/api/lt/v1/applications','/auth/verify']:
            status,body,headers=request(18987,path)
            assert status==501 and body['error']['code']=='NOT_IMPLEMENTED'
            assert headers.get('Cache-Control')=='no-store' and headers.get('Referrer-Policy')=='no-referrer'
        assert request(18987,'/api/lt/v1/auth/email','POST')[0]==501
        assert request(18987,'/api/lt/v1/operator/events')[0]==404
        status,body,_=request(18987,'/api/lt/v1/retention')
        assert status==501 and body['error']['code']=='NOT_IMPLEMENTED'
        assert request(18988,'/api/lt/v1/operator/retention')[0]==501
        result=subprocess.run(commands+['d1','execute','lt-production-gate-local','--local','--config',
            'tests/production-gate.toml','--persist-to',str(root/'state'),'--command',
            'SELECT (SELECT count(*) FROM lt_auth_tokens) AS tokens,(SELECT count(*) FROM lt_login_outbox) AS outbox,(SELECT count(*) FROM lt_mail_jobs) AS jobs;','--json'],
            capture_output=True,text=True,env=env)
        assert result.returncode==0
        assert json.loads(result.stdout)[0]['results']==[{'tokens':0,'outbox':0,'jobs':0}]
        print('Production-only operator RPC 200; applicant HTTP 501; operator HTTP 404; no auth/outbox/job writes')
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                if os.name=='nt':process.terminate()
                else:os.killpg(process.pid,signal.SIGTERM)
        for process in processes:
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                if os.name=='nt':process.kill()
                else:os.killpg(process.pid,signal.SIGKILL)
        for stream in streams:stream.close()


if __name__=='__main__':main()
