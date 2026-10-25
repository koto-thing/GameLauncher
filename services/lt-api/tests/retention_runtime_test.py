"""生成した架空データ専用DBでD1 atomic batchを検証する"""
import json,uuid,subprocess,urllib.request,urllib.error,unittest
import applicant_runtime_test as a
BASE='http://127.0.0.1:18897'; PROXY='http://127.0.0.1:18898'
a.BASE=BASE
a.request.__defaults__=(*a.request.__defaults__[:-1],BASE)

def sql(command):
 r=subprocess.run(['node','node_modules/wrangler/bin/wrangler.js','d1','execute','lt-local','--local','--config','retention-local.toml','--command',command,'--json'],capture_output=True,text=True,encoding='utf-8',check=True,timeout=30)
 return json.loads(r.stdout)[0]['results']
a.sql=sql

def call(path,data=None,method=None):
 req=urllib.request.Request(PROXY+path,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'},method=method)
 try:r=urllib.request.urlopen(req,timeout=15)
 except urllib.error.HTTPError as e:r=e
 with r:return r.status,json.loads(r.read())

def mail(email):return call('/test/fake-mail',email)[1]
# fake-mailはJSONではなくtextを受ける。秘密URLをstdoutへ出さない

def read_mail(email):
 req=urllib.request.Request(PROXY+'/test/fake-mail',data=email.encode(),method='POST')
 with urllib.request.urlopen(req) as r:return json.load(r)['confirmationUrl']
a.mail=read_mail

def clock(value):
 req=urllib.request.Request(PROXY+'/test/clock',data=value.encode(),method='POST')
 with urllib.request.urlopen(req) as r: assert r.status==200

def op(path,data=None,method=None):return call('/api/lt/v1/operator'+path,data,method)
def mutation(v,data=None):return {'expectedVersion':v,'operationId':uuid.uuid4().hex,'data':data or {}}

class RetentionD1(unittest.TestCase):
 def test_atomic_retention(self):
  sql("UPDATE lt_events SET state='cancelled',publish_enabled=0 WHERE state!='cancelled'")
  clock('2030-01-01T00:00:00.000Z')
  sql("UPDATE lt_mail_mode SET mode='fake'")
  suffix=uuid.uuid4().hex[:8]
  live='retention-live-'+suffix
  def create(name,opens,closes,start):
   fields={'title':name+suffix,'venue':'Fixture','guidance':'','startsAt':start,'timeZone':'Asia/Tokyo','opensAt':opens,'closesAt':closes,'capacity':2,'talkMinutes':10,'transitionMinutes':1,'operationId':uuid.uuid4().hex}
   status,event=op('/events',fields);self.assertEqual(status,200);return event
  normal=create('normal','2029-12-31T00:00:00.000Z','2030-01-02T00:00:00.000Z','2030-01-30T15:30:00.000Z')
  helper=a.ApplicantRuntime(); cookie,email=helper.login();body=helper.payload();body['eventId']=normal['id'];status,app,_=a.request('/api/lt/v1/applications',body,cookie);self.assertEqual(status,200)
  status,approved=op('/applications/'+app['id']+'/approve',mutation(1,{'startsAt':'2030-01-30T15:30:00.000Z','expectedEventVersion':1,'expectedScheduleVersion':1}));self.assertEqual(status,200)
  self.assertEqual(call('/test/dispatch-fake')[0],200)
  self.assertGreater(sql('SELECT count(*) AS n FROM lt_mail_jobs')[0]['n'],0)
  other=create('other','2030-01-02T00:00:00.000Z','2030-01-03T00:00:00.000Z','2030-01-04T00:00:00.000Z')
  clock('2030-01-02T12:00:00.000Z');cookie2,email2=helper.login();body2=helper.payload();body2['eventId']=other['id'];status,otherapp,_=a.request('/api/lt/v1/applications',body2,cookie2);self.assertEqual(status,200)
  clock('2030-01-30T15:41:00.000Z');self.assertEqual(a.request('/api/lt/v1/events/'+normal['id'])[0],200)
  parent=sql("SELECT private_expires FROM lt_events WHERE id='"+normal['id']+"'")[0];expiry=parent['private_expires']
  self.assertEqual(sql("SELECT strftime('%Y-%m-%dT%H:%M:%fZ',"+str(expiry)+"/1000.0,'unixepoch') AS value")[0]['value'],'2030-04-29T15:41:00.000Z')
  # 中止回も実APIで生成して確定する
  clock('2030-02-01T00:00:00.000Z');cancelled=create('cancel','2030-02-01T00:00:00.000Z','2030-02-02T00:00:00.000Z','2030-02-03T00:00:00.000Z')
  ck,em=helper.login();b=helper.payload();b['eventId']=cancelled['id'];self.assertEqual(a.request('/api/lt/v1/applications',b,ck)[0],200);self.assertEqual(op('/events/'+cancelled['id']+'/cancel',mutation(1))[0],200)
  # 生きている孤立sessionは初回削除で残し、後のsweepで期限後に掃除する
  sql("INSERT INTO lt_auth_tokens(hash,email,purpose,expires,session_hash,session_expires) VALUES('"+live+"','"+email+"','login',0,'retention-session-"+suffix+"',1903824001000)")
  # 各私有子を架空データで作り、全失敗点と別開催保護を実D1で確認する
  for target,event_id in [(app,normal['id']),(otherapp,other['id'])]:
   aid=target['id'];rid='change-'+aid;token='change-token-'+aid
   sql("INSERT INTO lt_email_changes(id,application_id,event_id,state,current,old_email,new_email,actor,identity_method,identity_result,checked_at,expires) VALUES('"+rid+"','"+aid+"','"+event_id+"','verificationPending',1,'old@example.invalid','new@example.invalid','fixture','fixture','confirmed','2030-01-01T00:00:00.000Z',"+str(expiry)+");INSERT INTO lt_email_change_tokens VALUES('"+token+"','"+rid+"','email_change',"+str(expiry)+",0);INSERT INTO lt_email_change_payloads SELECT id,'"+token+"','https://example.invalid/auth/email-change/verify?token=fixture' FROM lt_outbox WHERE application_id='"+aid+"' LIMIT 1;INSERT INTO lt_email_change_operations VALUES('fixture','"+rid+"','fixture','"+aid+"','"+rid+"',"+str(expiry)+");INSERT INTO lt_email_change_audit VALUES('"+rid+"','"+rid+"','"+aid+"','"+event_id+"','fixture','fixture','2030-01-01T00:00:00.000Z',"+str(expiry)+")")
  from datetime import datetime,timezone
  as_instant=lambda ms:datetime.fromtimestamp(ms/1000,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
  clock(as_instant(expiry-1))
  self.assertEqual(call('/test/retention',{'eventId':normal['id'],'delete':True})[0],409)
  clock(as_instant(expiry))
  self.assertEqual(call('/test/retention',{'eventId':normal['id']})[0],200)
  self.assertEqual(op('/applications/'+app['id'])[0],410)
  clock('2030-05-01T00:00:00.000Z')
  url='/test/retention';payload={'eventId':normal['id']}
  self.assertEqual(call(url,payload)[0],200)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_applications WHERE event_id='"+normal['id']+"'")[0]['n'],1)
  # 全statementの直後にCHECK違反を注入。各回同じ私有申請と公開provenanceを維持する
  files=['prepare-archive-proposal.sql','delete-email-change.sql','delete-event.sql','d1-mail-cleanup.sql','delete-expired-orphan-auth.sql','delete-expired-rate.sql']
  from pathlib import Path
  commands=6+sum(len([v for v in '\n'.join(l for l in (Path('retention')/f).read_text(encoding='utf-8-sig').splitlines() if not l.lstrip().startswith('--')).split(';') if v.strip()]) for f in files)
  before=call(url,{'snapshot':True})[1]
  for index in range(commands):
   self.assertEqual(call(url,payload|{'delete':True,'failAfter':index})[0],409,index)
   self.assertEqual(call(url,{'snapshot':True})[1],before,index)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_applications WHERE event_id='"+normal['id']+"'")[0]['n'],1)
  status,result=call(url,payload|{'delete':True});self.assertEqual(status,200);self.assertFalse(result['dryRun']);self.assertEqual(result['statements'],commands)
  self.assertEqual(a.request('/api/lt/v1/events/'+normal['id']+'/talks/'+app['id'])[0],200)
  # 募集設定の削除後も終了済み公開アーカイブの受付状態は一覧・詳細ともclosed
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_recruitment WHERE event_id='"+normal['id']+"'")[0]['n'],0)
  status,detail,_=a.request('/api/lt/v1/events/'+normal['id'])
  self.assertEqual(status,200);self.assertEqual(detail['recruitment'],'closed')
  status,listing,_=a.request('/api/lt/v1/events')
  self.assertEqual(status,200)
  self.assertEqual(next(item for item in listing['items'] if item['id']==normal['id'])['recruitment'],'closed')
  self.assertEqual(sql("SELECT approval_operation AS marker FROM lt_public_talks WHERE id='"+app['id']+"'")[0]['marker'],'lt-archive:v1')
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_applications WHERE event_id='"+normal['id']+"'")[0]['n'],0)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_mail_jobs WHERE id IN (SELECT 'application:'||id FROM lt_outbox WHERE application_id='"+app['id']+"')")[0]['n'],0)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_login_outbox WHERE expires<=1903824000000")[0]['n'],0)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_applications WHERE event_id='"+other['id']+"'")[0]['n'],1)
  for table in ['lt_email_changes','lt_email_change_operations','lt_email_change_audit']:
   self.assertEqual(sql("SELECT count(*) AS n FROM "+table+" WHERE application_id='"+app['id']+"'")[0]['n'],0)
   self.assertEqual(sql("SELECT count(*) AS n FROM "+table+" WHERE application_id='"+otherapp['id']+"'")[0]['n'],1)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_email_change_tokens WHERE request_id='change-"+app['id']+"'")[0]['n'],0)

  self.assertEqual(sql("SELECT count(*) AS n FROM lt_auth_tokens WHERE hash='"+live+"'")[0]['n'],1)
  # 送信待ちjobへ複製された確認URLも短期期限で消す
  sql("INSERT OR REPLACE INTO lt_mail_jobs(id,envelope,state,transport,attempts,next_at,expires) SELECT 'application:'||outbox_id,'{\"fixturePrivate\":\"confirmation-url-copy\"}','pending','fake',0,0,9999999999 FROM lt_email_change_payloads WHERE token_hash='change-token-"+otherapp['id']+"'")
  clock('2031-01-01T00:00:00.000Z')
  before_auth=call(url,{'snapshot':True})[1]
  for index in range(10):
   self.assertEqual(call(url,{'authOnly':True,'delete':True,'failAfter':index})[0],409)
   self.assertEqual(call(url,{'snapshot':True})[1],before_auth,index)
  self.assertEqual(call(url,{'authOnly':True,'delete':True})[0],200)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_mail_jobs WHERE envelope LIKE '%confirmation-url-copy%'")[0]['n'],0)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_auth_tokens WHERE hash='"+live+"'")[0]['n'],0)
  self.assertEqual(call(url,{'eventId':cancelled['id'],'delete':True})[0],200)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_public_events WHERE event_id='"+cancelled['id']+"'")[0]['n'],0)
  # 専用markerのsnapshot不一致は公開に使えない
  sql("DROP TRIGGER lt_archive_marker_immutable; UPDATE lt_archive_markers SET snapshot_json='{}' WHERE talk_id='"+app['id']+"'")
  self.assertEqual(a.request('/api/lt/v1/events/'+normal['id']+'/talks/'+app['id'])[0],404)
  # 未知schemaはdry-runでも拒否し、別開催を保護する
  sql('ALTER TABLE lt_mail_jobs ADD COLUMN fixture_private_extra TEXT')
  self.assertEqual(call(url,{'eventId':other['id'],'delete':True})[0],409)
  sql('ALTER TABLE lt_mail_jobs DROP COLUMN fixture_private_extra')
  sql('CREATE VIEW fixture_unknown_view AS SELECT id FROM lt_applications')
  self.assertEqual(call(url,{'eventId':other['id'],'delete':True})[0],409)
  sql('DROP VIEW fixture_unknown_view')
  sql('CREATE TABLE unknown_private(value TEXT)')
  self.assertEqual(call(url,{'eventId':other['id'],'delete':True})[0],409)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_applications WHERE event_id='"+other['id']+"'")[0]['n'],1)
  sql('DROP TABLE unknown_private')
  sql("CREATE TRIGGER lt_archive_marker_immutable BEFORE UPDATE ON lt_archive_markers BEGIN SELECT RAISE(ABORT,'LT_ARCHIVE_MARKER_IMMUTABLE'); END")
  clock('real')
if __name__=='__main__':unittest.main()
