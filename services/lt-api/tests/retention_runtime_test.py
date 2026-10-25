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
  suffix=uuid.uuid4().hex[:8]
  live='retention-live-'+suffix
  def create(name,opens,closes,start):
   fields={'title':name+suffix,'venue':'Fixture','guidance':'','startsAt':start,'timeZone':'Asia/Tokyo','opensAt':opens,'closesAt':closes,'capacity':2,'talkMinutes':10,'transitionMinutes':1,'operationId':uuid.uuid4().hex}
   status,event=op('/events',fields);self.assertEqual(status,200);return event
  normal=create('normal','2029-12-31T00:00:00.000Z','2030-01-02T00:00:00.000Z','2030-01-30T15:30:00.000Z')
  helper=a.ApplicantRuntime(); cookie,email=helper.login();body=helper.payload();body['eventId']=normal['id'];status,app,_=a.request('/api/lt/v1/applications',body,cookie);self.assertEqual(status,200)
  status,approved=op('/applications/'+app['id']+'/approve',mutation(1,{'startsAt':'2030-01-30T15:30:00.000Z','expectedEventVersion':1,'expectedScheduleVersion':1}));self.assertEqual(status,200)
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
  clock('2030-05-01T00:00:00.000Z')
  url='/test/retention';payload={'eventId':normal['id']}
  self.assertEqual(call(url,payload)[0],200)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_applications WHERE event_id='"+normal['id']+"'")[0]['n'],1)
  # 全statementの直後にCHECK違反を注入。各回同じ私有申請と公開provenanceを維持する
  files=['prepare-archive-proposal.sql','delete-event.sql','delete-expired-orphan-auth.sql','delete-expired-rate.sql']
  from pathlib import Path
  commands=6+sum(len([v for v in '\n'.join(l for l in (Path('retention')/f).read_text(encoding='utf-8-sig').splitlines() if not l.lstrip().startswith('--')).split(';') if v.strip()]) for f in files)
  before=call(url,{'snapshot':True})[1]
  for index in range(commands):
   self.assertEqual(call(url,payload|{'delete':True,'failAfter':index})[0],409,index)
   self.assertEqual(call(url,{'snapshot':True})[1],before,index)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_applications WHERE event_id='"+normal['id']+"'")[0]['n'],1)
  status,result=call(url,payload|{'delete':True});self.assertEqual(status,200);self.assertFalse(result['dryRun'])
  self.assertEqual(a.request('/api/lt/v1/events/'+normal['id']+'/talks/'+app['id'])[0],200)
  self.assertEqual(sql("SELECT approval_operation AS marker FROM lt_public_talks WHERE id='"+app['id']+"'")[0]['marker'],'lt-archive:v1')
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_applications WHERE event_id='"+normal['id']+"'")[0]['n'],0)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_applications WHERE event_id='"+other['id']+"'")[0]['n'],1)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_auth_tokens WHERE hash='"+live+"'")[0]['n'],1)
  clock('2031-01-01T00:00:00.000Z')
  self.assertEqual(call(url,payload|{'delete':True})[0],200)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_auth_tokens WHERE hash='"+live+"'")[0]['n'],0)
  self.assertEqual(call(url,{'eventId':cancelled['id'],'delete':True})[0],200)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_public_events WHERE event_id='"+cancelled['id']+"'")[0]['n'],0)
  # 専用markerのsnapshot不一致は公開に使えない
  sql("DROP TRIGGER lt_archive_marker_immutable; UPDATE lt_archive_markers SET snapshot_json='{}' WHERE talk_id='"+app['id']+"'")
  self.assertEqual(a.request('/api/lt/v1/events/'+normal['id']+'/talks/'+app['id'])[0],404)
  # 未知schemaはdry-runでも拒否し、別開催を保護する
  sql('CREATE TABLE unknown_private(value TEXT)')
  self.assertEqual(call(url,{'eventId':other['id'],'delete':True})[0],409)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_applications WHERE event_id='"+other['id']+"'")[0]['n'],1)
  sql('DROP TABLE unknown_private')
  sql("CREATE TRIGGER lt_archive_marker_immutable BEFORE UPDATE ON lt_archive_markers BEGIN SELECT RAISE(ABORT,'LT_ARCHIVE_MARKER_IMMUTABLE'); END")
  clock('real')
if __name__=='__main__':unittest.main()
