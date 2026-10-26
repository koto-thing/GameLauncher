"""通常production bundleのscheduled削除を架空専用D1で検証する。外部送信しない。"""
from pathlib import Path
import json
import os
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request


def main():
    """専用local D1だけで運用gateのON/OFFと期限削除を検証する"""
    # WindowsのSQLite補助ファイルが長いworkspaceパスを超えない専用一時領域
    root = Path(tempfile.mkdtemp(prefix='lt-ret-')).resolve()
    command = ['node', 'node_modules/wrangler/bin/wrangler.js']
    child_env = dict(os.environ, WRANGLER_LOG_PATH=str(root/'logs'), WRANGLER_SEND_METRICS='false')
    config = root/'worker.json'
    settings = dict(name='lt-retention-scheduled-fixture', main=str(Path('production-entry.mjs').resolve()),
        compatibility_date='2026-10-25', workers_dev=False, preview_urls=False,
        d1_databases=[dict(binding='DB', database_name='retention-scheduled-fixture',
            database_id='00000000-0000-0000-0000-000000000057', migrations_dir=str(Path('migrations').resolve()))],
        vars=dict(APP_ORIGIN='https://example.invalid', LT_PRIVATE_API_ENABLED='false',
            LT_OPERATOR_API_ENABLED='false', LT_MAINTENANCE_ENABLED='false', LT_RETENTION_ENABLED='false'))
    config.write_text(json.dumps(settings), encoding='utf-8')

    def cli(args):
        """ローカルCLIの終了を確認し、生の出力は公開しない"""
        result = subprocess.run(command+args, capture_output=True, text=True, encoding='utf-8', env=child_env, timeout=60)
        if result.returncode:
            (root/'fixture-cli.log').write_text(result.stdout+'\n'+result.stderr,encoding='utf-8')
        assert result.returncode == 0, 'Fixture CLI failed; raw logs remain local'
        return result.stdout

    def sql(text):
        """同じfixture設定とDBへ限定してSQLを実行する"""
        return json.loads(cli(['d1','execute','retention-scheduled-fixture','--local','--config',str(config),
            '--persist-to',str(root/'state'),'--command',text,'--json']))

    def counts():
        """私有・公開・認証・配送の件数だけを照合する"""
        return sql("SELECT (SELECT count(*) FROM lt_event_configs) AS private,(SELECT count(*) FROM lt_public_events) AS public,(SELECT count(*) FROM lt_auth_tokens) AS auth,(SELECT count(*) FROM lt_mail_jobs) AS jobs")[0]['results'][0]

    cli(['d1','migrations','apply','retention-scheduled-fixture','--local','--config',str(config),'--persist-to',str(root/'state')])
    for name, year, state in [('normal',2020,'ended'),('cancelled',2021,'cancelled'),('protected',2099,'scheduled')]:
        dto=dict(title='Fixture '+name, venue='example.invalid', guidance='', startsAt=f'{year}-01-03T00:00:00.000Z',
            timeZone='Asia/Tokyo', opensAt=f'{year}-01-01T00:00:00.000Z', closesAt=f'{year}-01-02T00:00:00.000Z', capacity=1, talkMinutes=10, transitionMinutes=1)
        quoted=json.dumps(dto).replace("'","''")
        sql(f"INSERT INTO lt_event_configs(id,dto,actor,operation_id,payload_hash) VALUES('{name}','{quoted}','fixture','{name}','fixture')")
        if state != 'scheduled':
            field='ended_at' if state=='ended' else 'cancelled_at'
            sql(f"UPDATE lt_events SET state='{state}',{field}='{year}-01-03T00:00:00.000Z',publish_enabled={1 if state=='ended' else 0} WHERE id='{name}'")
    sql("INSERT INTO lt_auth_tokens(hash,email,purpose,expires) VALUES('expired-fixture','nobody@example.invalid','login',0)")
    process = stream = None

    def stop():
        """このfixtureが起動したプロセスだけを終了する"""
        nonlocal process, stream
        if process and process.poll() is None:
            if os.name=='nt': subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],capture_output=True)
            else: os.killpg(process.pid,signal.SIGTERM)
            process.wait(timeout=15)
        if stream: stream.close()
        process=stream=None

    def start(enabled):
        """新しいlocalhostポートで独立gateの設定を切り替える"""
        nonlocal process, stream
        stop()
        settings['vars']['LT_RETENTION_ENABLED']='true' if enabled else 'false'
        config.write_text(json.dumps(settings),encoding='utf-8')
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0)); port=listener.getsockname()[1]
        stream=(root/('on.log' if enabled else 'off.log')).open('w',encoding='utf-8')
        process=subprocess.Popen(command+['dev','--local','--config',str(config),'--persist-to',str(root/'state'),
            '--ip','127.0.0.1','--port',str(port),'--test-scheduled','--inspector-port','0'],stdout=stream,stderr=subprocess.STDOUT,
            env=child_env,start_new_session=os.name!='nt')
        for _ in range(160):
            assert process.poll() is None, 'Fixture Worker stopped'
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/api/lt/v1/events',timeout=2).close()
                return port
            except OSError: time.sleep(.25)
        raise AssertionError('Fixture Worker not ready')

    def tick(port):
        """ローカル開発サーバーのscheduledイベントを一度発火する"""
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/__scheduled',timeout=30) as response:
            response.read(); assert response.status==200

    try:
        off=start(False); before=counts(); tick(off); assert counts()==before
        on=start(True); tick(on)
        assert counts()==dict(private=2,public=3,auth=0,jobs=0)
        tick(on); assert counts()==dict(private=1,public=2,auth=0,jobs=0)
        tick(on); assert counts()==dict(private=1,public=2,auth=0,jobs=0)
        sql("CREATE TABLE unexpected_private(value TEXT);INSERT INTO lt_auth_tokens(hash,email,purpose,expires) VALUES('later','later@example.invalid','login',0)")
        before=counts();tick(on);assert counts()==before
        sql('DROP TABLE unexpected_private');tick(on);assert counts()['auth']==0
        assert sql("SELECT state FROM lt_events WHERE id='protected'")[0]['results']==[{'state':'scheduled'}]
        print('Production scheduled D1: default OFF unchanged; independent ON expires normal/cancelled/auth; archive/other event protected; unknown schema stops. Relay intentionally unconfigured/fails closed; no mail')
    finally:
        stop()


if __name__=='__main__':
    main()
