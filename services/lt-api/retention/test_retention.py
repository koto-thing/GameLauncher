import importlib.util
import json
import sqlite3
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(__file__).parent
spec=importlib.util.spec_from_file_location('local_reference', ROOT/'local_reference.py')
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
JST=timezone(timedelta(hours=9))

def instant(text):
    return int(datetime.fromisoformat(text).timestamp()*1000)

class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.addCleanup(self.db.close)
        for path in sorted((ROOT.parent/'migrations').glob('*.sql')):
            if path.name[:4] > '0024': continue  # 独立成果の旧schema回帰。現行schemaはD1 runtimeで検証
            self.db.executescript(path.read_text(encoding='utf-8-sig'))
        self.db.executescript((ROOT/'archive-marker-schema-proposal.sql').read_text(encoding='utf-8-sig'))
        # 業務APIの代わりに架空fixtureを直接構築し、削除前には全triggerを復元する
        self.triggers=list(self.db.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger'"))
        for name,_ in self.triggers: self.db.execute('DROP TRIGGER '+name)
        self.terminal=instant('2024-01-31T23:30:00.123+09:00')
        self.expiry=module.calendar_expiry(self.terminal)
        for event_id,kind,expiry in [('normal','ended',self.expiry),('cancel','cancelled',self.expiry),('other','scheduled',None)]:
            self.db.execute('INSERT INTO lt_events(id,state,private_expires) VALUES(?,?,?)',(event_id,kind,expiry))
            self.db.execute('INSERT INTO lt_public_events VALUES(?,?)',(event_id,json.dumps({'id':event_id,'title':'public'})))
            self.db.execute('INSERT INTO lt_public_talks(id,event_id,dto,approval_operation) VALUES(?,?,?,?)',(event_id,event_id,'{"cancelled":true}','operation'))
            self.db.execute('INSERT INTO lt_recruitment(event_id,opens,closes,capacity) VALUES(?,0,9999999999999,10)',(event_id,))
            self.db.execute('INSERT INTO lt_schedule(event_id) VALUES(?)',(event_id,))
            self.db.execute('INSERT INTO lt_event_configs(id,dto,actor,operation_id,payload_hash) VALUES(?,\'{}\',\'actor\',?,\'hash\')',(event_id,event_id))
            self.db.execute('INSERT INTO lt_applications(id,event_id,email,version,dto,operation_id,payload_hash) VALUES(?,?,?,1,?, ?,\'hash\')',(event_id,event_id,'shared@example.invalid' if event_id!='cancel' else 'orphan@example.invalid','{"materialUrl":"https://example.invalid/private","representativeEmail":"private@example.invalid","everApproved":true,"published":{"cancelled":true}}',event_id))
            for table in ['lt_applicant_operations','lt_operator_operations']:
                self.db.execute(f'INSERT INTO {table}(actor,operation_id,application_id,payload_hash,result) VALUES(\'actor\',?,?,\'hash\',\'{{}}\')',(event_id,event_id))
            for table in ['lt_event_operations','lt_schedule_operations','lt_event_cancellations']:
                self.db.execute(f'INSERT INTO {table}(actor,operation_id,event_id,payload_hash,result) VALUES(\'actor\',?,?,\'hash\',\'{{}}\')',(event_id,event_id))
            self.db.execute('INSERT INTO lt_approval_receipts VALUES(?,?,?,1,\'actor\',\'hash\',?)',(event_id,event_id,event_id,expiry))
            self.db.execute('INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient) VALUES(?,?,?,\'approved\',\'private@example.invalid\')',(event_id,event_id,event_id))
            self.db.execute('INSERT INTO lt_audit(id,operation_id,actor_id,action,application_id) VALUES(?,?,\'actor\',\'approved\',?)',(event_id,event_id,event_id))
            self.db.execute('INSERT INTO lt_fake_deliveries(id,recipient,kind,delivered_at) VALUES(?,\'private@example.invalid\',\'approved\',0)',(event_id,))
        for event_id in ['normal','cancel','other']: self.db.execute("INSERT INTO lt_audit(id,operation_id,actor_id,action,application_id) VALUES(?,?,'actor','eventCancelled',?)",(event_id+':cancel-audit',event_id,event_id))
        self.db.execute('CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT)')
        self.db.execute("INSERT INTO users VALUES('account','orphan@example.invalid')")
        for key,email,expires in [('shared','shared@example.invalid',0),('orphan','orphan@example.invalid',0),('fresh','orphan@example.invalid',self.expiry+1000)]:
            self.db.execute('INSERT INTO lt_auth_tokens(hash,email,purpose,expires) VALUES(?,?,\'login\',?)',(key,email,expires))
            self.db.execute('INSERT INTO lt_fake_mail VALUES(?,?,\'https://example.invalid/verify\',?)',(key,email,expires))
        self.db.execute("INSERT INTO lt_auth_tokens(hash,email,purpose,expires,session_expires) VALUES('live-session','orphan@example.invalid','login',0,?)",(self.expiry+1000,))
        self.db.execute('CREATE TEMP TABLE fixed_anchors(event_id TEXT PRIMARY KEY,kind TEXT,terminal_ms INTEGER,expiry_ms INTEGER)')
        for event_id,kind in [('normal','ended'),('cancel','cancelled')]: self.db.execute('INSERT INTO fixed_anchors VALUES(?,?,?,?)',(event_id,kind,self.terminal,self.expiry))
        self.db.execute("CREATE TEMP TRIGGER immutable_anchor BEFORE UPDATE ON fixed_anchors BEGIN SELECT RAISE(ABORT,'immutable'); END")
        for _,sql in self.triggers: self.db.execute(sql)
        self.db.commit()

    def anchors(self): return list(self.db.execute('SELECT * FROM fixed_anchors'))
    def run_sweep(self,**kwargs): return module.sweep_fixture(self.db,self.anchors,self.expiry,**kwargs)
    def snapshot(self): return list(self.db.iterdump())

    def test_boundary_dry_run_and_delay(self):
        before=self.snapshot()
        self.assertEqual(module.sweep_fixture(self.db,self.anchors,self.expiry-1)['events'],0)
        self.assertEqual(self.run_sweep()['applications'],2)
        self.assertEqual(before,self.snapshot())
        self.assertEqual(module.sweep_fixture(self.db,self.anchors,self.expiry+999999,dry_run=False)['applications'],2)

    def test_archives_other_event_and_account_protected(self):
        self.run_sweep(dry_run=False)
        self.assertEqual(list(self.db.execute('SELECT event_id FROM lt_public_events ORDER BY event_id')),[('normal',),('other',)])
        self.assertEqual(self.db.execute("SELECT dto,approval_operation FROM lt_public_talks WHERE id='normal'").fetchone(),('{"cancelled":true}','lt-archive:v1'))
        self.assertEqual(list(self.db.execute('SELECT id FROM lt_applications')),[('other',)])
        self.assertEqual(self.db.execute('SELECT count(*) FROM users').fetchone()[0],1)
        for table in ['lt_outbox','lt_audit','lt_fake_deliveries','lt_operator_operations','lt_applicant_operations','lt_approval_receipts','lt_event_configs','lt_event_operations','lt_schedule_operations','lt_event_cancellations']:
            self.assertEqual(self.db.execute('SELECT count(*) FROM '+table).fetchone()[0],2 if table=='lt_audit' else 1,table)

    def test_orphan_auth_only_expired_and_no_other_event(self):
        self.run_sweep(dry_run=False)
        self.assertEqual(set(self.db.execute('SELECT hash FROM lt_auth_tokens')),{('shared',),('fresh',),('live-session',)})
        self.assertEqual(set(self.db.execute('SELECT id FROM lt_fake_mail')),{('shared',),('fresh',)})

    def test_rollback_retry_and_replay(self):
        before=self.snapshot()
        commands=sum((module.statements(ROOT/path) for path in ["prepare-archive-proposal.sql","delete-event.sql","delete-expired-orphan-auth.sql","delete-expired-rate.sql"]),[])
        for index in range(len(commands)):
            with self.assertRaises(RuntimeError): self.run_sweep(dry_run=False,inject_failure_after=index)
            self.assertEqual(self.snapshot(),before)
        self.run_sweep(dry_run=False)
        after=self.snapshot()
        self.assertEqual(self.run_sweep(dry_run=False)['applications'],0)
        self.assertEqual(after,self.snapshot())

    def test_unknown_table_and_column_fail_closed(self):
        self.db.execute('CREATE TABLE lt_future_private(id TEXT)'); self.db.commit()
        with self.assertRaises(ValueError): self.run_sweep(dry_run=False)
        self.db.execute('DROP TABLE lt_future_private'); self.db.execute('ALTER TABLE lt_outbox ADD COLUMN future_private TEXT'); self.db.commit()
        with self.assertRaises(ValueError): self.run_sweep(dry_run=False)
        self.assertEqual(self.db.execute('SELECT count(*) FROM lt_applications').fetchone()[0],3)

    def test_anchor_immutable_and_wrong_expiry_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError): self.db.execute('UPDATE fixed_anchors SET expiry_ms=expiry_ms+1')
        self.db.rollback()
        with self.assertRaises(ValueError): module.sweep_fixture(self.db,lambda:[('normal','ended',self.terminal,self.expiry+1)],self.expiry,dry_run=False)

    def test_calendar_month_end_and_japan_time(self):
        cases=[('2024-01-31T23:30:00.123+09:00','2024-04-30T23:30:00.123+09:00'),('2023-11-30T00:00:00+09:00','2024-02-29T00:00:00+09:00'),('2024-11-30T00:00:00+09:00','2025-02-28T00:00:00+09:00'),('2024-12-31T00:05:00+09:00','2025-03-31T00:05:00+09:00')]
        for source,target in cases: self.assertEqual(module.calendar_expiry(instant(source)),instant(target))

    def test_later_expiry_cleaned_without_application_candidates(self):
        self.run_sweep(dry_run=False)
        self.assertIsNotNone(self.db.execute("SELECT hash FROM lt_auth_tokens WHERE hash='live-session'").fetchone())
        module.clean_auth_fixture(self.db,self.expiry+1000)
        self.assertEqual(list(self.db.execute('SELECT hash FROM lt_auth_tokens')),[('shared',)])
        self.assertEqual(list(self.db.execute('SELECT id FROM lt_fake_mail')),[('shared',)])

    def test_rate_bucket_boundary_and_current_bucket_protected(self):
        self.db.executemany('INSERT INTO lt_auth_rate VALUES(?,?,1)',[('not-anonymous-email-hash',0),('not-anonymous-email-hash',1)])
        self.db.commit()
        module.clean_auth_fixture(self.db,3599999)
        self.assertEqual(self.db.execute('SELECT count(*) FROM lt_auth_rate').fetchone()[0],2)
        module.clean_auth_fixture(self.db,3600000)
        self.assertEqual(list(self.db.execute('SELECT bucket FROM lt_auth_rate')),[(1,)])

    def test_private_operation_id_removed_and_marker_requires_approval(self):
        # 既存guardを通せる正規承認済みsnapshotのoperationIdに私有値を入れる
        self.db.execute("UPDATE lt_public_talks SET approval_operation='private-person@example.invalid' WHERE id='normal'")
        self.db.commit()
        self.run_sweep(dry_run=False)
        self.assertEqual(self.db.execute("SELECT approval_operation FROM lt_public_talks WHERE id='normal'").fetchone()[0],'lt-archive:v1')
        self.assertEqual(self.db.execute('SELECT count(*) FROM lt_archive_markers').fetchone()[0],1)
        self.assertNotIn('private-person@example.invalid', '\n'.join(self.snapshot()))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO lt_archive_markers VALUES('forged','other','{}')")
        self.db.rollback()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE lt_public_talks SET dto='{}' WHERE id='normal'")
        self.db.rollback()

class D1SchemaGuardTests(unittest.TestCase):
    """既知のD1管理表だけを除外し、アプリの未知schemaを拒否する"""

    def setUp(self):
        """全migrationを架空のメモリDBへ適用する"""
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        for migration in sorted((ROOT.parent / 'migrations').glob('*.sql')):
            self.db.executescript(migration.read_text(encoding='utf-8-sig'))
        # compound viewの推論型はSQLite版に依存するため、この単体fixtureだけD1の実測契約へ固定する
        # migrationと実viewの検証は実Worker/D1回帰で行い、本番guardの型検査は変更しない
        inventory = json.loads((ROOT / 'd1-inventory.json').read_text(encoding='utf-8'))
        self.db.execute('DROP VIEW lt_mail_outbox')
        columns = ', '.join('"' + name + '" ' + kind for name, kind in inventory['lt_mail_outbox'])
        self.db.execute('CREATE TABLE lt_mail_outbox (' + columns + ')')
        self.guard = (ROOT / 'd1-schema-guard.sql').read_text(encoding='utf-8')

    def matches(self):
        """製品が読み込むSQLそのものでschemaを照合する"""
        return self.db.execute('SELECT (' + self.guard + ')').fetchone()[0]

    def schema_context(self):
        """実行環境とschemaの差分だけを失敗時の診断に添える"""
        expected = json.loads((ROOT / 'd1-inventory.json').read_text(encoding='utf-8'))
        differences = []
        for name, columns in expected.items():
            actual = [[row[1], row[2]] for row in self.db.execute('PRAGMA table_info("' + name + '")')]
            if actual != columns:
                differences.append({'name': name, 'expected': columns, 'actual': actual})
        objects = list(self.db.execute("SELECT name,type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'"))
        return json.dumps({'sqliteVersion': sqlite3.sqlite_version, 'columnDifferences': differences, 'objects': objects}, ensure_ascii=True)

    def test_known_schema_without_cf_kv(self):
        """管理表がないローカル環境も受理する"""
        self.assertEqual(self.matches(), 1, self.schema_context())

    def test_cf_kv_table_is_allowed_without_reading_its_columns(self):
        """既知管理表はtable種別だけを確認し内部列を参照しない"""
        self.db.execute('CREATE TABLE _cf_KV(fixture_metadata BLOB)')
        self.assertEqual(self.matches(), 1, self.schema_context())

    def test_cf_kv_view_is_rejected(self):
        """同名viewを管理表として許可しない"""
        self.db.execute('CREATE VIEW _cf_KV AS SELECT 1 AS fixture_metadata')
        self.assertEqual(self.matches(), 0)

    def test_unknown_application_table_is_rejected(self):
        """未知の私有表を無視しない"""
        self.db.execute('CREATE TABLE _cf_KV(fixture_metadata BLOB)')
        self.db.execute('CREATE TABLE lt_unknown_private(value TEXT)')
        self.assertEqual(self.matches(), 0)

    def test_unknown_cf_prefixed_table_is_rejected(self):
        """Cloudflare風の名前だけでは除外しない"""
        self.db.execute('CREATE TABLE _cf_KV(fixture_metadata BLOB)')
        self.db.execute('CREATE TABLE _cf_unknown_private(value TEXT)')
        self.assertEqual(self.matches(), 0)

    def test_extra_lt_column_is_rejected(self):
        """LT表に追加された未知の列を拒否する"""
        self.db.execute('ALTER TABLE lt_clock ADD COLUMN private_extra TEXT')
        self.assertEqual(self.matches(), 0)

    def test_renamed_lt_column_is_rejected(self):
        """既知LT列の名前が変わった場合も拒否する"""
        self.db.execute('ALTER TABLE lt_clock RENAME COLUMN now_ms TO changed_clock')
        self.assertEqual(self.matches(), 0)

    def test_changed_mail_action_url_type_is_rejected(self):
        """D1契約に固定したメールURL列も型差異を拒否する"""
        self.db.execute('DROP TABLE lt_mail_outbox')
        self.db.execute('CREATE TABLE lt_mail_outbox(id, recipient TEXT, kind TEXT, state TEXT, expires INTEGER, created_at INTEGER, action_url TEXT)')
        self.assertEqual(self.matches(), 0)

    def test_changed_lt_column_type_is_rejected(self):
        """表件数が同じでもLT列の型差異を拒否する"""
        self.db.execute('DROP TABLE lt_clock')
        self.db.execute('CREATE TABLE lt_clock(id INTEGER PRIMARY KEY, now_ms TEXT)')
        self.assertEqual(self.matches(), 0)

if __name__=='__main__': unittest.main()
