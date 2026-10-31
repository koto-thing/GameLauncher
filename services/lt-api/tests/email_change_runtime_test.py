"""実Worker/D1/RPCで対象1件の例外メール変更を検証する"""
import unittest,uuid,json,urllib.request,urllib.error,concurrent.futures
import applicant_runtime_test as applicants
from applicant_runtime_test import sql,request,mail
from schema_assertions import assert_response
from lifecycle_runtime_test import clock

def operate(path,data=None,role='admin',method=None):
 url='http://127.0.0.1:18878/test/role/'+role+'/api/lt/v1/operator'+path
 req=urllib.request.Request(url,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'},method=method)
 try:r=urllib.request.urlopen(req)
 except urllib.error.HTTPError as e:r=e
 with r:
  raw=r.read();value=json.loads(raw) if r.headers.get('Content-Type','').startswith('application/json') else raw.decode()
  assert_response('/api/lt/v1/operator'+path,req.get_method(),r.status,value)
  return r.status,value

def change_token(email):
 req=urllib.request.Request('http://127.0.0.1:18878/test/change-mail',data=email.encode(),method='POST')
 with urllib.request.urlopen(req) as r:return json.load(r)['confirmationUrl'].split('token=')[1]

def mutation(version,data):return {'expectedVersion':version,'operationId':uuid.uuid4().hex,'data':data}
class EmailChangeRuntime(unittest.TestCase):
 def setUp(self):
  """募集期間内の時計でメール変更対象の申請を準備する

  Returns:
      戻り値なし
  """
  clock('2026-10-25T12:00:00.000Z')
  self.addCleanup(clock, 'real')

  sql("UPDATE lt_mail_mode SET mode='fake'");self.helper=applicants.ApplicantRuntime();self.cookie,self.old=self.helper.login();self.body=self.helper.payload()
  status,self.app,_=request('/api/lt/v1/applications',self.body,self.cookie);self.assertEqual(status,200)
  self.path='/applications/'+self.app['id']+'/email-change';self.new=uuid.uuid4().hex+'@example.invalid'
 def target_in_new_event(self):
  """メール変更試験用に別の開催回と本人申請を準備する

  Returns:
      戻り値なし
  """
  event='email-'+uuid.uuid4().hex
  base=json.loads(sql("SELECT dto FROM lt_public_events WHERE event_id='open'")[0]['dto']);base.update(id=event,schedule=[],version=1)
  sql("INSERT INTO lt_events(id,state,public_opens_at) VALUES('"+event+"','scheduled',0);INSERT INTO lt_public_events VALUES('"+event+"','"+json.dumps(base).replace("'","''")+"');INSERT INTO lt_schedule(event_id) VALUES('"+event+"');INSERT INTO lt_recruitment(schedule_mode,approval_mode,event_id,opens,closes,capacity) VALUES('manual','manual','"+event+"',0,9999999999999,20)")
  self.body=self.helper.payload()|{'eventId':event};status,self.app,_=request('/api/lt/v1/applications',self.body,self.cookie);self.assertEqual(status,200);self.path='/applications/'+self.app['id']+'/email-change'
 def login_for(self,email):
  self.assertEqual(request('/api/lt/v1/auth/email',{'email':email})[0],202)
  token=mail(email).split('token=')[1]
  return request('/api/lt/v1/auth/verify',{'token':token})[2]['Set-Cookie'].split(';')[0]
 def investigate(self,email=None,version=1):
  body=mutation(version,{'newEmail':email or self.new,'identityChecked':True,'identityCheckMethod':'対面で手動照合','identityCheckResult':'confirmed'})
  status,dto=operate(self.path+'/investigate',body);self.assertEqual(status,200,(status,dto));return dto,body
 def send(self,dto):
  body=mutation(dto['applicationVersion'],{'requestId':dto['id'],'expectedRequestVersion':dto['version']})
  status,result=operate(self.path+'/send-verification',body);self.assertEqual(status,200,(status,result));return result,body
 def verified(self):
  dto,investigate=self.investigate();dto,sent=self.send(dto);token=change_token(self.new)
  self.assertEqual(request('/api/lt/v1/auth/email-change/verify',{'token':token})[0],200)
  return operate(self.path)[1],token,investigate,sent
 def confirm(self,dto):return mutation(dto['applicationVersion'],{'requestId':dto['id'],'expectedRequestVersion':dto['version']})
 def test_full_flow_scope_old_sessions_receipts_and_current_owner(self):
  # 別開催の所有権は移動しない。旧メールのlogin sessionは共通なので失効する
  """メール変更後の所有者・セッション・再送結果を検証する

  Returns:
      戻り値なし
  """
  event='other-'+uuid.uuid4().hex
  base=json.loads(sql("SELECT dto FROM lt_public_events WHERE event_id='open'")[0]['dto']);base.update(id=event,schedule=[],version=1)
  sql("INSERT INTO lt_events(id,state,public_opens_at) VALUES('"+event+"','scheduled',0);INSERT INTO lt_public_events VALUES('"+event+"','"+json.dumps(base).replace("'","''")+"');INSERT INTO lt_schedule(event_id) VALUES('"+event+"');INSERT INTO lt_recruitment(schedule_mode,approval_mode,event_id,opens,closes,capacity) VALUES('manual','manual','"+event+"',0,9999999999999,20)")
  other=self.helper.payload()|{'eventId':event};other_app=request('/api/lt/v1/applications',other,self.cookie)[1]
  request('/api/lt/v1/auth/email',{'email':self.old});old_link=mail(self.old).split('token=')[1]
  dto,investigate=self.investigate();self.assertEqual(dto['applicationVersion'],2)
  dto,sent=self.send(dto);self.assertEqual(dto['applicationVersion'],3)
  token=change_token(self.new)
  self.assertEqual(request('/auth/email-change?token='+token)[0],200)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_email_change_tokens WHERE used=1 AND request_id='"+dto['id']+"'")[0]['n'],0)
  self.assertEqual(request('/api/lt/v1/auth/verify',{'token':token})[0],400)
  self.assertEqual(request('/api/lt/v1/auth/email-change/verify',{'token':old_link})[0],400)
  self.assertEqual(request('/api/lt/v1/auth/email-change/verify',{'token':token},origin='https://evil.invalid')[0],403)
  status,value,headers=request('/api/lt/v1/auth/email-change/verify',{'token':token});self.assertEqual(status,200);self.assertEqual(value,{'accepted':True});self.assertNotIn('Set-Cookie',headers)
  self.assertEqual(request('/api/lt/v1/auth/email-change/verify',{'token':token})[0],400)
  dto=operate(self.path)[1];self.assertEqual(dto['state'],'verified');self.assertIsNotNone(dto['verifiedAt'])
  body=self.confirm(dto)
  status,confirmed=operate(self.path+'/confirm',body,role='executive');self.assertEqual(status,200);self.assertEqual(confirmed['applicationVersion'],4)
  self.assertEqual(operate(self.path+'/confirm',body)[1],confirmed)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE application_id='"+self.app['id']+"' AND kind='emailChanged'")[0]['n'],2)
  self.assertIsNone(request('/api/lt/v1/auth/session',cookie=self.cookie)[1]);self.assertEqual(request('/api/lt/v1/auth/verify',{'token':old_link})[0],400)
  self.assertEqual(sql("SELECT email FROM lt_applications WHERE id='"+other_app['id']+"'")[0]['email'],self.old)
  old_cookie=self.login_for(self.old);new_cookie=self.login_for(self.new)
  self.assertEqual(request('/api/lt/v1/applications/'+self.app['id'],cookie=old_cookie)[0],404)
  self.assertEqual(request('/api/lt/v1/applications',self.body,old_cookie)[0],409)
  self.assertEqual(request('/api/lt/v1/applications/'+other_app['id'],cookie=old_cookie)[0],200)
  self.assertEqual(request('/api/lt/v1/applications/'+self.app['id'],cookie=new_cookie)[1]['representativeEmail'],self.new)
  self.assertEqual(operate('/applications/'+self.app['id'])[1]['representativeEmail'],self.new)
 def test_roles_manual_identity_and_stale_versions(self):
  self.assertEqual(operate(self.path,role='assistant')[0],403)
  for invalid in [{'identityChecked':False},{'identityCheckMethod':' '},{'identityCheckMethod':'x'*81},{'identityCheckResult':'pending'},{'actor':'forged'}]:
   body=mutation(1,{'newEmail':self.new,'identityChecked':True,'identityCheckMethod':'確認','identityCheckResult':'confirmed'}|invalid)
   self.assertEqual(operate(self.path+'/investigate',body)[0],422)
  dto,body=self.investigate();self.assertEqual(operate(self.path+'/investigate',body,role='assistant')[0],403)
  sent=self.confirm(dto);self.assertEqual(operate(self.path+'/confirm',sent)[0],409)
  wrong=mutation(1,{'requestId':dto['id'],'expectedRequestVersion':dto['version']});self.assertEqual(operate(self.path+'/send-verification',wrong)[0],409)
  self.assertEqual(operate(self.path+'/send-verification',self.confirm(dto),role='assistant')[0],403)
 def test_resend_supersede_and_old_receipt_do_not_reactivate(self):
  dto,first=self.investigate();dto,sent=self.send(dto);old=change_token(self.new)
  dto,resend=self.send(dto);new=change_token(self.new);self.assertTrue(old!=new,'resend must rotate token')
  self.assertEqual(request('/api/lt/v1/auth/email-change/verify',{'token':old})[0],400)
  self.assertEqual(request('/api/lt/v1/auth/email-change/verify',{'token':new})[0],200)
  dto=operate(self.path)[1];replacement=uuid.uuid4().hex+'@example.invalid'
  current,_=self.investigate(replacement,dto['applicationVersion'])
  self.assertEqual(operate(self.path+'/investigate',first)[0],409)
  self.assertEqual(operate(self.path+'/send-verification',sent)[0],409)
  self.assertEqual(operate(self.path+'/confirm',self.confirm(dto))[0],409)
  self.assertEqual(operate(self.path)[1]['id'],current['id'])
 def test_same_event_collision_and_other_application_protection(self):
  other_cookie,_=self.helper.login();other_body=self.helper.payload();other=request('/api/lt/v1/applications',other_body,other_cookie)[1]
  self.assertEqual(operate(self.path+'/investigate',mutation(1,{'newEmail':other['representativeEmail'],'identityChecked':True,'identityCheckMethod':'照合','identityCheckResult':'confirmed'}))[0],409)
  dto,_=self.investigate()
  self.assertEqual(operate('/applications/'+other['id']+'/email-change/send-verification',self.confirm(dto))[0],409)
  self.assertEqual(sql("SELECT version FROM lt_applications WHERE id='"+other['id']+"'")[0]['version'],1)
 def test_parallel_confirm_and_receipt_are_atomic(self):
  dto,token,_,_=self.verified();body=self.confirm(dto)
  with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda _:operate(self.path+'/confirm',body),range(2)))
  self.assertEqual([r[0] for r in results],[200,200]);self.assertEqual(results[0][1],results[1][1])
  self.assertEqual(sql("SELECT version FROM lt_applications WHERE id='"+self.app['id']+"'")[0]['version'],4)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_email_change_audit WHERE application_id='"+self.app['id']+"' AND action='confirm'")[0]['n'],1)
 def test_token_deadline_and_retention_gate(self):
  # 時計境界だけを固定し、他開催の自動進行を避ける
  self.target_in_new_event()
  clock('2026-10-25T12:00:00.000Z')
  try:
   dto,investigate=self.investigate();dto,sent=self.send(dto);token=change_token(self.new)
   clock('2026-10-25T13:00:00.000Z');self.assertEqual(request('/api/lt/v1/auth/email-change/verify',{'token':token})[0],400)
   sql("UPDATE lt_events SET private_expires=1 WHERE id='"+self.app['eventId']+"'")
   self.assertEqual(operate(self.path)[0],410)
   self.assertEqual(operate(self.path+'/investigate',investigate)[0],410)
   self.assertEqual(operate(self.path+'/send-verification',sent)[0],410)
  finally:
   clock('real')
 def test_investigate_races_and_same_operation_idempotency(self):
  body=mutation(1,{'newEmail':self.new,'identityChecked':True,'identityCheckMethod':'確認','identityCheckResult':'confirmed'})
  with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda _:operate(self.path+'/investigate',body),range(2)))
  self.assertEqual([r[0] for r in results],[200,200]);self.assertEqual(results[0][1],results[1][1])
  current=results[0][1];self.assertEqual(current['applicationVersion'],2)
  bodies=[mutation(2,body['data']|{'newEmail':uuid.uuid4().hex+'@example.invalid'}) for _ in range(2)]
  with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda b:operate(self.path+'/investigate',b),bodies))
  self.assertEqual(sorted(r[0] for r in results),[200,409]);self.assertEqual(operate(self.path)[1]['applicationVersion'],3)
  # 次versionを予測した連続操作とも競合させ、成功mutationは常に具体DTOとする
  a=mutation(3,body['data']|{'newEmail':uuid.uuid4().hex+'@example.invalid'});b=mutation(4,body['data']|{'newEmail':uuid.uuid4().hex+'@example.invalid'})
  with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda v:operate(self.path+'/investigate',v),[a,b]))
  for status,value in results:
   self.assertIn(status,[200,409])
   if status==200:self.assertIsInstance(value,dict)

 def test_confirm_races_new_application_same_email(self):
  dto,_,_,_=self.verified();new_cookie=self.login_for(self.new);application=self.helper.payload()
  with concurrent.futures.ThreadPoolExecutor() as pool:
   a=pool.submit(operate,self.path+'/confirm',self.confirm(dto));b=pool.submit(request,'/api/lt/v1/applications',application,new_cookie);a,b=a.result(),b.result()
  self.assertEqual(sorted([a[0],b[0]]),[200,409])
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_applications WHERE event_id='open' AND email='"+self.new+"' AND active=1")[0]['n'],1)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_email_change_audit WHERE application_id='"+self.app['id']+"' AND action='confirm'")[0]['n'],1 if a[0]==200 else 0)
 def test_confirm_races_old_owner_edit(self):
  dto,_,_,_=self.verified();edit=mutation(dto['applicationVersion'],{'content':self.body['content']|{'title':'競合する編集'},'materialUrl':self.body['materialUrl']})
  with concurrent.futures.ThreadPoolExecutor() as pool:
   a=pool.submit(operate,self.path+'/confirm',self.confirm(dto));b=pool.submit(request,'/api/lt/v1/applications/'+self.app['id'],edit,self.cookie,'PATCH');a,b=a.result(),b.result()
  self.assertEqual(sorted([a[0],b[0]]),[200,409]);row=sql("SELECT email,version FROM lt_applications WHERE id='"+self.app['id']+"'")[0]
  self.assertEqual(row['version'],4);self.assertEqual(row['email'],self.new if a[0]==200 else self.old)
 def test_cancel_invalidates_link_and_replay(self):
  self.target_in_new_event();dto,_=self.investigate();dto,sent=self.send(dto);token=change_token(self.new)
  self.assertEqual(operate('/events/'+self.app['eventId']+'/cancel',mutation(1,{}))[0],200)
  self.assertEqual(operate(self.path)[1]['state'],'cancelled')
  self.assertEqual(request('/api/lt/v1/auth/email-change/verify',{'token':token})[0],400)
  self.assertEqual(operate(self.path+'/send-verification',sent)[0],409)
 def test_approved_snapshot_and_operator_receipt_keep_current_owner(self):
  self.target_in_new_event()
  approve=mutation(1,{'startsAt':'2026-11-01T01:00:00.000Z','expectedEventVersion':1,'expectedScheduleVersion':1})
  self.assertEqual(operate('/applications/'+self.app['id']+'/approve',approve)[0],200)
  before=request('/api/lt/v1/events/'+self.app['eventId']+'/talks/'+self.app['id'])[1]
  dto,_=self.investigate(version=2);dto,_=self.send(dto);token=change_token(self.new)
  self.assertEqual(request('/api/lt/v1/auth/email-change/verify',{'token':token})[0],200)
  dto=operate(self.path)[1];self.assertEqual(operate(self.path+'/confirm',self.confirm(dto))[0],200)
  cached=operate('/applications/'+self.app['id']+'/approve',approve)[1]
  self.assertEqual(cached['representativeEmail'],self.new)
  self.assertEqual(request('/api/lt/v1/events/'+self.app['eventId']+'/talks/'+self.app['id'])[1],before)
  self.assertEqual(sql("SELECT reserved FROM lt_recruitment WHERE event_id='"+self.app['eventId']+"'")[0]['reserved'],1)
if __name__=='__main__':unittest.main()
