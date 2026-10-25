"""実Worker/D1/RPCで時計境界と親状態を検証する"""
import unittest,json,uuid,urllib.request,concurrent.futures
from applicant_runtime_test import sql,request,mail
import applicant_runtime_test as applicants
from operator_runtime_test import operate

def clock(value):
 req=urllib.request.Request('http://127.0.0.1:18878/test/clock',data=value.encode(),method='POST')
 with urllib.request.urlopen(req) as r: assert r.status==200

class LifecycleRuntime(unittest.TestCase):
 def setUp(self):
  self.flags=sql('SELECT id,publish_enabled FROM lt_events');sql('UPDATE lt_events SET publish_enabled=0')
  self.periods=sql('SELECT event_id,opens,closes FROM lt_recruitment');sql('UPDATE lt_recruitment SET opens=0,closes=1')
  self.created=[];clock('2030-01-01T12:00:00.000Z')
 def tearDown(self):
  clock('real')
  commands=["UPDATE lt_events SET publish_enabled=0 WHERE id='"+id+"'" for id in self.created]
  commands += ["UPDATE lt_events SET publish_enabled="+str(row['publish_enabled'])+" WHERE id='"+row['id']+"'" for row in self.flags]
  commands += ["UPDATE lt_recruitment SET opens="+str(row['opens'])+",closes="+str(row['closes'])+" WHERE event_id='"+row['event_id']+"'" for row in self.periods]
  if commands:sql(';'.join(commands))

 def create(self):
  self.fields={'title':'状態境界','venue':'架空会場','guidance':'','startsAt':'2030-01-02T01:00:00.000Z','timeZone':'UTC','opensAt':'2030-01-01T00:00:00.000Z','closesAt':'2030-01-02T00:00:00.000Z','capacity':2,'talkMinutes':10,'transitionMinutes':5}
  status,event=operate('/events',self.fields|{'operationId':uuid.uuid4().hex});self.assertEqual(status,200);self.created.append(event['id']);return event
 def application(self,event):
  h=applicants.ApplicantRuntime();cookie,email=h.login();body=h.payload()|{'eventId':event['id']}
  status,app,_=request('/api/lt/v1/applications',body,cookie);self.assertEqual(status,200)
  approve={'expectedVersion':1,'operationId':uuid.uuid4().hex,'data':{'startsAt':self.fields['startsAt'],'expectedEventVersion':event['version'],'expectedScheduleVersion':1}}
  self.assertEqual(operate('/applications/'+app['id']+'/approve',approve)[0],200)
  return cookie,email,body,app,approve
 def current(self,id):return sql("SELECT state,version,ended_at,cancelled_at,private_expires FROM lt_events WHERE id='"+id+"'")[0]
 def login_for(self,email):
  self.assertEqual(request('/api/lt/v1/auth/email',{'email':email})[0],202)
  token=mail(email).split('token=')[1]
  return request('/api/lt/v1/auth/verify',{'token':token})[2]['Set-Cookie'].split(';')[0]
 def test_start_end_last_closing_and_immutable_deadline(self):
  event=self.create();id=event['id'];cookie,email,body,app,approve=self.application(event)
  blocks=operate('/events/'+id+'/timetable')[1]['blocks'];blocks.append({'id':'closing','kind':'closing','startsAt':'2030-01-02T01:15:00.000Z','endsAt':'2030-01-02T01:20:00.000Z'})
  payload={'expectedVersion':2,'operationId':uuid.uuid4().hex,'data':{'expectedEventVersion':2,'blocks':blocks}}
  self.assertEqual(operate('/events/'+id+'/timetable',payload,'PUT')[0],200)
  for instant,state in [('2030-01-02T00:59:59.999Z','scheduled'),('2030-01-02T01:00:00.000Z','started'),('2030-01-02T01:19:59.999Z','started'),('2030-01-02T01:20:00.000Z','ended')]:
   clock(instant)
   if instant=='2030-01-02T01:00:00.000Z':
    with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda _:request('/api/lt/v1/applications/'+app['id'],cookie=cookie)[1],range(2)))
    self.assertEqual([v['eventState'] for v in results],['started','started'])
   dto=request('/api/lt/v1/applications/'+app['id'],cookie=cookie)[1];self.assertEqual(dto['eventState'],state);self.assertIsNone(dto['eventCancelledAt']);self.assertEqual(operate('/events/'+id)[1]['state'],state)
  marker=self.current(id);self.assertEqual(marker['version'],4);self.assertEqual(marker['ended_at'],'2030-01-02T01:20:00.000Z')
  self.assertEqual(marker['private_expires'],1901323200000) # 2030-04-02 01:20 UTC
  blocks[-1]['endsAt']='2030-01-02T02:00:00.000Z'
  self.assertEqual(operate('/events/'+id+'/timetable',{'expectedVersion':3,'operationId':uuid.uuid4().hex,'data':{'expectedEventVersion':marker['version'],'blocks':blocks}},'PUT')[0],200)
  self.assertEqual(operate('/applications/'+app['id']+'/approve',approve)[1]['eventState'],'ended')
  self.assertEqual(self.current(id),marker)
 def test_delayed_reconcile_blocks_expired_private_and_preserves_archive(self):
  event=self.create();id=event['id'];cookie,email,body,app,approve=self.application(event)
  clock('2030-05-01T12:00:00.000Z')
  self.assertEqual(request('/api/lt/v1/events/'+id+'/talks/'+app['id'])[0],200)
  marker=self.current(id);self.assertEqual(marker['state'],'ended');self.assertEqual(marker['ended_at'],'2030-01-02T01:15:00.000Z')
  cookie=self.login_for(email)
  self.assertEqual(request('/api/lt/v1/applications/'+app['id'],cookie=cookie)[0],410)
  self.assertEqual(request('/api/lt/v1/applications',cookie=cookie)[1]['items'],[])
  self.assertEqual(request('/api/lt/v1/applications',body,cookie)[0],410)
  self.assertEqual(operate('/applications/'+app['id'])[0],410)
  self.assertEqual(operate('/applications/'+app['id']+'/approve',approve)[0],410)
  self.assertEqual(operate('/events/'+id)[0],404)
  # 遅延によって期限後outboxが配送されない
  with urllib.request.urlopen('http://127.0.0.1:18878/test/dispatch-fake') as r:json.load(r)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_mail_jobs f JOIN lt_outbox o ON f.id='application:'||o.id WHERE f.delivered_at IS NOT NULL AND o.application_id='"+app['id']+"'")[0]['n'],0)
 def test_retention_exact_boundary_uses_planned_end(self):
  event=self.create();id=event['id'];cookie,email,body,app,approve=self.application(event)
  clock('2030-04-02T01:14:59.999Z');cookie=self.login_for(email)
  self.assertEqual(request('/api/lt/v1/applications/'+app['id'],cookie=cookie)[0],200)
  self.assertEqual(operate('/applications/'+app['id']+'/approve',approve)[1]['eventState'],'ended')
  clock('2030-04-02T01:15:00.000Z')
  self.assertEqual(request('/api/lt/v1/applications/'+app['id'],cookie=cookie)[0],410)
  self.assertEqual(operate('/applications/'+app['id']+'/approve',approve)[0],410)
  self.assertEqual(request('/api/lt/v1/events/'+id+'/talks/'+app['id'])[0],200)
 def test_cancel_current_parent_in_every_receipt_and_list(self):
  event=self.create();id=event['id'];cookie,email,body,app,approve=self.application(event)
  cancel={'expectedVersion':2,'operationId':uuid.uuid4().hex,'data':{}}
  self.assertEqual(operate('/events/'+id+'/cancel',cancel)[0],200)
  cancelled=self.current(id);self.assertIsNotNone(cancelled['cancelled_at'])
  values=[request('/api/lt/v1/applications/'+app['id'],cookie=cookie)[1],request('/api/lt/v1/applications',cookie=cookie)[1]['items'][0],request('/api/lt/v1/applications',body,cookie)[1],operate('/applications/'+app['id'])[1],operate('/events/'+id+'/applications')[1]['items'][0],operate('/applications/'+app['id']+'/approve',approve)[1]]
  for value in values:self.assertEqual(value['eventState'],'cancelled');self.assertEqual(value['eventCancelledAt'],cancelled['cancelled_at'])
  self.assertFalse(operate('/events/'+id+'/cancel',cancel)[1]['publishEnabled'])
  bad=json.loads(json.dumps(approve));bad['data']['startsAt']='2030-01-02T02:00:00.000Z';self.assertEqual(operate('/applications/'+app['id']+'/approve',bad)[0],409)
  clock('2030-02-01T12:00:00.000Z');self.assertEqual(request('/api/lt/v1/events/'+id)[0],404);self.assertEqual(self.current(id),cancelled)
 def test_tokyo_calendar_month_end_and_cancelled_public_dry_run(self):
  event=self.create();id=event['id']
  fields=self.fields|{'startsAt':'2030-02-01T01:00:00.000Z','closesAt':'2030-01-31T00:00:00.000Z'}
  self.assertEqual(operate('/events/'+id,{'expectedVersion':1,'operationId':uuid.uuid4().hex,'data':fields},'PATCH')[0],200)
  clock('2030-01-30T15:30:00.000Z') # 日本時間1/31 00:30 →4/30 00:30
  cancel={'expectedVersion':2,'operationId':uuid.uuid4().hex,'data':{}}
  self.assertEqual(operate('/events/'+id+'/cancel',cancel)[0],200)
  marker=self.current(id)
  self.assertEqual(sql("SELECT strftime('%Y-%m-%dT%H:%M:%fZ',private_expires/1000.0,'unixepoch') AS deadline FROM lt_events WHERE id='"+id+"'")[0]['deadline'],'2030-04-29T15:30:00.000Z')
  clock('2030-04-29T15:30:00.000Z')
  self.assertEqual(request('/api/lt/v1/events/'+id)[0],404)
  self.assertEqual(operate('/events/'+id+'/cancel',cancel)[0],410)
  self.assertEqual(self.current(id),marker)
  # dry-runだけを行い旧snapshotが物理的に残ることも確認する
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_public_events p JOIN lt_events e ON e.id=p.event_id WHERE e.id='"+id+"' AND e.state='cancelled' AND e.private_expires<=(SELECT now_ms FROM lt_clock WHERE id=1)")[0]['n'],1)
 def test_empty_schedule_ends_at_start_copy_stays_private(self):
  event=self.create();id=event['id']
  status,copy=operate('/events/'+id+'/copy',{'expectedVersion':1,'operationId':uuid.uuid4().hex,'data':{}});self.assertEqual(status,200);self.created.append(copy['id']);self.assertFalse(copy['publishEnabled'])
  clock('2030-01-02T00:59:59.999Z');self.assertEqual(operate('/events/'+id)[1]['state'],'scheduled')
  clock('2030-01-02T01:00:00.000Z');self.assertEqual(operate('/events/'+id)[1]['state'],'ended');self.assertEqual(self.current(id)['ended_at'],self.fields['startsAt'])
  clock('2030-03-01T12:00:00.000Z');self.assertEqual(operate('/events/'+copy['id'])[1]['state'],'scheduled');self.assertEqual(request('/api/lt/v1/events/'+copy['id'])[0],404)
if __name__=='__main__':unittest.main()
