"""PHP relayとreceiptの期限/競合をlocalhostとmail stubだけで検証する。"""
from pathlib import Path
import concurrent.futures
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def main():
    """実PHPとmail stubを使い、外部送信せずreceiptを検証する"""
    php=shutil.which('php')
    assert php, 'PHP CLI required; no fallback'
    relay=Path(__file__).resolve().parents[1]/'relay'
    subprocess.run([php,'-l',str(relay/'receipt_cleanup.php')],check=True)
    with tempfile.TemporaryDirectory(prefix='lt-php-receipt-') as folder:
        root=Path(folder);private=root/'private';private.mkdir()
        config=root/'config.php';sent=root/'sent';router=root/'router.php'
        bearer='fixture-not-a-credential-'*3
        def configure(send=True,cleanup=False):
            """架空secretのローカル設定で配送と掃除のgateを分離する"""
            config.write_text("<?php return "+"['enabled'=>"+str(send).lower()+",'retention_enabled'=>"+str(cleanup).lower()+",'bearer'=>"+json.dumps(bearer)+",'from'=>'fixture@example.invalid','public_origin'=>'https://lt.example.invalid','private_dir'=>"+json.dumps(str(private).replace('\\','/'))+"];",encoding='utf-8')
        # namespace内のmailだけをstub化し、実組込みmailには到達させない
        router.write_text("<?php namespace PandDLtMail; function unlink($path) {if (is_file("+json.dumps(str(root/'deny-delete').replace('\\','/'))+")) return false; return call_user_func('unlink',$path);} function mail(...$args) {file_put_contents("+json.dumps(str(sent).replace('\\','/'))+",'sent\\n',FILE_APPEND);usleep(100000);return true;} $_SERVER['HTTPS']='on'; require "+json.dumps(str(relay/'relay.php').replace('\\','/'))+";",encoding='utf-8')
        configure()
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
        env=dict(os.environ,LT_MAIL_PRIVATE_CONFIG=str(config))
        # Linux CIでは独立PHP workerで本物のflock競合を起こす
        if os.name!='nt':env['PHP_CLI_SERVER_WORKERS']='2'
        process=subprocess.Popen([php,'-S',f'127.0.0.1:{port}',str(router)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env,start_new_session=os.name!='nt')
        def request(payload,auth=True,header='X-LT-Mail-Auth',credential=bearer):
            """localhostのPHPだけへJSONを送って応答を読み切る"""
            headers={'Content-Type':'application/json'}
            if auth:headers[header]='Bearer '+credential
            req=urllib.request.Request(f'http://127.0.0.1:{port}/relay',data=json.dumps(payload).encode(),headers=headers,method='POST')
            try:r=urllib.request.urlopen(req,timeout=10)
            except urllib.error.HTTPError as e:r=e
            with r:return r.status,json.load(r)
        try:
            for _ in range(100):
                assert process.poll() is None
                try:
                    if request({'operation':'cleanup'},False)[0]==401:break
                except OSError:time.sleep(.05)
            else:raise AssertionError('PHP fixture not ready')
            assert request({'operation':'cleanup'},header='Authorization')[0]==401
            assert request({'operation':'cleanup'},credential='wrong-fixture')[0]==401
            assert request({'operation':'cleanup'})==(503,{'result':'temporary'})
            assert not sent.exists()
            payload=dict(id='fixture-delivery',recipient='nobody@example.invalid',kind='approved',expires=int(time.time())+60,action_url='https://lt.example.invalid/applications')
            with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda _:request(payload),range(2)))
            assert results==[(200,{'result':'accepted'})]*2
            assert sent.read_text().count('sent')==1
            assert request(payload|{'recipient':'other@example.invalid'})[0]==409
            assert request(payload|{'expires':int(time.time())})[0]==410
            # 送信と同じlock下で期限済みだけを消し、未来/uncertainは保持
            future='a'*64+'.json';expired='b'*64+'.json';boundary='c'*64+'.json'
            value=dict(hash='d'*64,state='uncertain',expires=int(time.time())+300)
            (private/future).write_text(json.dumps(value))
            (private/expired).write_text(json.dumps(value|{'expires':0}))
            (private/boundary).write_text(json.dumps(value|{'expires':int(time.time())}))
            configure(send=False,cleanup=True)
            status,body=request({'operation':'cleanup'});assert status==200 and body==dict(result='accepted',deleted=2,more=False)
            assert (private/future).exists() and not (private/expired).exists() and not (private/boundary).exists()
            assert request(payload)[0]==503 and sent.read_text().count('sent')==1
            assert request({'operation':'cleanup','path':'arbitrary'})[0]==503
            # 破損や未知fileがある場合は候補があっても削除前に止める
            (private/expired).write_text(json.dumps(value|{'expires':0}));unknown=private/'unknown.txt';unknown.write_text('fixture')
            assert request({'operation':'cleanup'})[0]==503 and (private/expired).exists();unknown.unlink()
            corrupt=private/('e'*64+'.json');corrupt.write_text('{}')
            assert request({'operation':'cleanup'})[0]==503 and (private/expired).exists();corrupt.unlink()
            if os.name!='nt':
                link=private/('f'*64+'.json');link.symlink_to(private/future)
                assert request({'operation':'cleanup'})[0]==503 and (private/expired).exists();link.unlink()
            (root/'deny-delete').write_text('fixture')
            assert request({'operation':'cleanup'})[0]==503 and (private/expired).exists()
            (root/'deny-delete').unlink()
            assert request({'operation':'cleanup'})[0]==200
            # 元payload期限後はreceiptがなくても410。再送のため期限を延長しない
            old=payload|{'id':'expired-delivery','expires':0}
            assert request(old)[0]==503  # 送信gateは独立してOFF
            configure(send=True,cleanup=True)
            assert request(old)[0]==410
            active=payload|{'id':'concurrent-send','expires':int(time.time())+60}
            with concurrent.futures.ThreadPoolExecutor() as pool:
                results=list(pool.map(lambda p:request(p),[active,{'operation':'cleanup'}]))
            assert all(result[0]==200 for result in results) and sent.read_text().count('sent')==2
            # cleanupを二重実行しても未来receiptや送信数に影響しない
            with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda _:request({'operation':'cleanup'}),range(2)))
            assert all(result[0]==200 for result in results) and sent.read_text().count('sent')==2
            print('PHP receipt: default OFF, auth, deadline, double send, altered payload, unknown/corrupt/symlink, cleanup/send lock concurrency; external mail calls 0')
        finally:
            if os.name!='nt':
                import signal
                os.killpg(process.pid,signal.SIGTERM)
            else:process.terminate()
            process.wait(timeout=10)


if __name__=='__main__':
    main()
