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
import urllib.error


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
    for name, year, state in [('normal',2020,'scheduled'),('cancelled',2021,'cancelled'),('started',2022,'started'),('protected',2099,'scheduled')]:
        dto=dict(title='Fixture '+name, venue='example.invalid', guidance='', startsAt=f'{year}-01-03T00:00:00.000Z',
            timeZone='Asia/Tokyo', opensAt=f'{year}-01-01T00:00:00.000Z', closesAt=f'{year}-01-02T00:00:00.000Z', capacity=1, talkMinutes=10, transitionMinutes=1)
        quoted=json.dumps(dto).replace("'","''")
        sql(f"INSERT INTO lt_event_configs(id,dto,actor,operation_id,payload_hash) VALUES('{name}','{quoted}','fixture','{name}','fixture')")
        if state == 'started':
            sql(f"UPDATE lt_events SET state='started' WHERE id='{name}'")
        elif state != 'scheduled':
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
                urllib.request.urlopen(f'http://127.0.0.1:{port}/api/lt/v1/operator/events',timeout=2).close()
                raise AssertionError('Operator HTTP must reject before lifecycle')
            except urllib.error.HTTPError as error:
                error.read()
                assert error.code == 404
                return port
            except OSError: time.sleep(.25)
        raise AssertionError('Fixture Worker not ready')

    def tick(port):
        """ローカル開発サーバーのscheduledイベントを一度発火する"""
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/__scheduled',timeout=30) as response:
            response.read(); assert response.status==200

    try:
        # ready確認もOFF tickもlifecycleを進めない
        off=start(False); before=counts(); tick(off); assert counts()==before
        assert sql("SELECT outcome FROM lt_maintenance_status")[0]["results"] == [{"outcome": "never"}]
        initial=sql("SELECT id,state,ended_at,private_expires FROM lt_events WHERE id IN ('normal','started') ORDER BY id")[0]['results']
        assert initial==[dict(id='normal',state='scheduled',ended_at=None,private_expires=None),dict(id='started',state='started',ended_at=None,private_expires=None)]

        # relay未設定の失敗があっても、元の予定終了日で終了・削除が成立する
        on=start(True); tick(on)
        heartbeat = sql("SELECT started_at,completed_at,outcome FROM lt_maintenance_status")[0]["results"][0]
        assert heartbeat["started_at"] > 0 and heartbeat["completed_at"] >= heartbeat["started_at"]
        assert heartbeat["outcome"] == "failed"
        anchors=sql("SELECT id,state,ended_at,datetime(private_expires/1000,'unixepoch') AS expiry FROM lt_events WHERE id IN ('normal','started') ORDER BY id")[0]['results']
        assert anchors==[dict(id='normal',state='ended',ended_at='2020-01-03T00:00:00.000Z',expiry='2020-04-03 00:00:00'),dict(id='started',state='ended',ended_at='2022-01-03T00:00:00.000Z',expiry='2022-04-03 00:00:00')]
        assert counts()==dict(private=3,public=4,auth=0,jobs=0)
        tick(on); assert counts()==dict(private=2,public=3,auth=0,jobs=0)
        tick(on); assert counts()==dict(private=1,public=3,auth=0,jobs=0)
        assert sql("SELECT id,state,ended_at,datetime(private_expires/1000,'unixepoch') AS expiry FROM lt_events WHERE id IN ('normal','started') ORDER BY id")[0]['results']==anchors

        # 未知schemaは終了確定・clock更新・認証掃除より前に停止する
        dto=dict(title='Unvisited',venue='example.invalid',guidance='',startsAt='2023-01-03T00:00:00.000Z',timeZone='Asia/Tokyo',opensAt='2023-01-01T00:00:00.000Z',closesAt='2023-01-02T00:00:00.000Z',capacity=1,talkMinutes=10,transitionMinutes=1)
        quoted=json.dumps(dto).replace("'","''")
        sql(f"INSERT INTO lt_event_configs(id,dto,actor,operation_id,payload_hash) VALUES('unknown-guard','{quoted}','fixture','unknown-guard','fixture')")
        sql("CREATE TABLE unexpected_private(value TEXT);UPDATE lt_clock SET now_ms=0;INSERT INTO lt_auth_tokens(hash,email,purpose,expires) VALUES('later','later@example.invalid','login',0)")
        before=counts();tick(on);assert counts()==before
        assert sql("SELECT state,ended_at,private_expires FROM lt_events WHERE id='unknown-guard'")[0]['results']==[dict(state='scheduled',ended_at=None,private_expires=None)]
        assert sql('SELECT now_ms FROM lt_clock')[0]['results']==[dict(now_ms=0)]
        sql('DROP TABLE unexpected_private');tick(on);assert counts()==dict(private=1,public=4,auth=0,jobs=0)
        assert sql("SELECT state,ended_at,datetime(private_expires/1000,'unixepoch') AS expiry FROM lt_events WHERE id='unknown-guard'")[0]['results']==[dict(state='ended',ended_at='2023-01-03T00:00:00.000Z',expiry='2023-04-03 00:00:00')]
        assert sql("SELECT state FROM lt_events WHERE id='protected'")[0]['results']==[{'state':'scheduled'}]
        stop()
        assert 'LT maintenance failed' in (root/'on.log').read_text(encoding='utf-8')
        print('Production scheduled D1: OFF unchanged; unvisited scheduled/started finalized at original end; independent retention survives relay failure; immutable anchors; unknown schema prevents all updates; archive/other event protected; no mail')

    finally:
        stop()


if __name__=='__main__':
    main()
