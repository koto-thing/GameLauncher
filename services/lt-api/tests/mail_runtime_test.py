"""実Worker/D1/RPCでメール接続を検証する。外部送信は行わない"""
import unittest,uuid,json,urllib.request,concurrent.futures
from datetime import datetime,timezone
import applicant_runtime_test as applicants
from applicant_runtime_test import sql,request
from lifecycle_runtime_test import clock

def dispatch(outcome=None):
 path='/test/dispatch-fake' if outcome is None else '/test/dispatch-outcome'
 req=urllib.request.Request('http://127.0.0.1:18878'+path,data=None if outcome is None else outcome.encode(),method='GET' if outcome is None else 'POST')
 with urllib.request.urlopen(req) as r:return json.load(r)['delivered']

class MailRuntime(unittest.TestCase):
 def setUp(self):
  self.pending=sql("SELECT id FROM lt_outbox WHERE state='pending'");self.login_pending=sql("SELECT id FROM lt_login_outbox WHERE state='pending'")
  self.mode=sql('SELECT mode FROM lt_mail_mode')[0]['mode']
  sql("UPDATE lt_outbox SET state='sent' WHERE state='pending'; UPDATE lt_login_outbox SET state='sent' WHERE state='pending';UPDATE lt_mail_mode SET mode='fake'")
  clock('2026-10-25T12:00:00.000Z')
  h=applicants.ApplicantRuntime();self.cookie,self.email=h.login();body=h.payload()
  status,self.app,_=request('/api/lt/v1/applications',body,self.cookie);self.assertEqual(status,200)
  self.rows=sql("SELECT id FROM lt_outbox WHERE application_id='"+self.app['id']+"'")
  self.ids=[r['id'] for r in self.rows];self.target='application:'+self.ids[0]
 def tearDown(self):
  commands=["UPDATE lt_outbox SET state='sent',expires=0 WHERE id='"+id+"'" for id in self.ids]
  commands += ["UPDATE lt_outbox SET state='pending' WHERE id='"+r['id']+"'" for r in self.pending]
  commands += ["UPDATE lt_login_outbox SET state='pending' WHERE id='"+r['id']+"'" for r in self.login_pending]
  commands += ["UPDATE lt_mail_mode SET mode='"+self.mode+"'"]
  sql(';'.join(commands));clock('real')
 def job(self,id=None):return sql("SELECT state,attempts,fence,expires,CASE WHEN envelope='{}' THEN '{}' ELSE '[private]' END AS envelope,transport,delivered_at,next_at FROM lt_mail_jobs WHERE id='"+(id or self.target)+"'")[0]
 def test_disabled_and_http_cannot_use_fake_or_send_confirmation(self):
  sql("UPDATE lt_mail_mode SET mode='disabled'");email=uuid.uuid4().hex+'@example.invalid'
  self.assertEqual(request('/api/lt/v1/auth/email',{'email':email})[0],202)
  id=sql("SELECT id FROM lt_login_outbox WHERE recipient='"+email+"'")[0]['id']
  for mode in ['disabled','http']:
   sql("UPDATE lt_mail_mode SET mode='"+mode+"'");self.assertEqual(dispatch(),0)
   self.assertEqual(sql("SELECT count(*) AS n FROM lt_mail_jobs WHERE id='authentication:"+id+"'")[0]['n'],0)
  sql("UPDATE lt_mail_mode SET mode='fake'");dispatch()
  self.assertIsNotNone(self.job('authentication:'+id)['delivered_at'])
  sql("UPDATE lt_auth_tokens SET expires=0 WHERE email='"+email+"'")
 def test_old_and_new_dispatch_share_one_claim(self):
  legacy=sql('SELECT count(*) AS n FROM lt_fake_deliveries')[0]['n']
  with concurrent.futures.ThreadPoolExecutor() as pool:
   a=pool.submit(dispatch);b=pool.submit(dispatch,'accepted');results=[a.result(),b.result()]
  self.assertEqual(sum(results),1);job=self.job();self.assertEqual(job['state'],'sent');self.assertEqual(job['attempts'],1)
  self.assertEqual(job['transport'],'fake');self.assertIsNotNone(job['delivered_at'])
  self.assertEqual(sql('SELECT count(*) AS n FROM lt_fake_deliveries')[0]['n'],legacy)
  self.assertEqual(dispatch(),0)
 def test_temporary_retries_at_boundary(self):
  self.assertEqual(dispatch('temporary'),0);job=self.job();self.assertEqual(job['state'],'pending');self.assertEqual(job['attempts'],1)
  clock('2026-10-25T12:01:59.999Z');self.assertEqual(dispatch('accepted'),0);self.assertEqual(self.job()['attempts'],1)
  clock('2026-10-25T12:02:00.000Z');self.assertEqual(dispatch('accepted'),1);self.assertEqual(self.job()['attempts'],2)
  id='mail-'+uuid.uuid4().hex;self.ids.append(id)
  sql("INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient) VALUES('"+id+"','"+id+"','"+self.app['id']+"','submitted','fixture@example.invalid')")
  for attempt in range(1,6):
   self.assertEqual(dispatch('temporary'),0);job=self.job('application:'+id);self.assertEqual(job['attempts'],attempt)
   if attempt<5:clock(datetime.fromtimestamp(job['next_at'],timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'))
  self.assertEqual(job['state'],'failed');self.assertEqual(dispatch('accepted'),0)
 def test_permanent_and_uncertain_do_not_resend(self):
  self.assertEqual(dispatch('permanent'),0);self.assertEqual(self.job()['state'],'failed');self.assertEqual(dispatch('accepted'),0)
  id='mail-'+uuid.uuid4().hex;self.ids.append(id)
  sql("INSERT INTO lt_outbox(id,operation_id,application_id,kind,recipient) VALUES('"+id+"','"+id+"','"+self.app['id']+"','submitted','fixture@example.invalid')")
  self.assertEqual(dispatch('uncertain'),0);self.assertEqual(self.job('application:'+id)['state'],'uncertain')
  self.assertEqual(dispatch('accepted'),0);self.assertEqual(self.job('application:'+id)['attempts'],1)
 def test_expired_lease_is_uncertain(self):
  dispatch('temporary');sql("UPDATE lt_mail_jobs SET state='leased',lease_until=1 WHERE id='"+self.target+"'")
  self.assertEqual(dispatch('accepted'),0);self.assertEqual(self.job()['state'],'uncertain');self.assertEqual(self.job()['attempts'],1)
 def test_millisecond_expiry_floors_and_scrubs_payload(self):
  now=1792929600000
  sql("UPDATE lt_outbox SET expires="+str(now+1500)+" WHERE id='"+self.ids[0]+"'")
  dispatch('temporary');job=self.job();self.assertEqual(job['expires'],(now+1500)//1000)
  clock('2026-10-25T12:00:01.000Z');request('/api/lt/v1/auth/session')
  self.assertEqual(self.job()['envelope'],'{}');self.assertEqual(self.job()['state'],'expired');self.assertEqual(dispatch(),0)
if __name__=='__main__':unittest.main()
