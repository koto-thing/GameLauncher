import unittest,uuid,json,concurrent.futures,time,urllib.request,urllib.error
import applicant_runtime_test as applicants
from applicant_runtime_test import sql,request
from operator_runtime_test import operate
class Fixture:
 def __enter__(self):
  self.periods=sql('SELECT event_id,opens,closes FROM lt_recruitment');sql('UPDATE lt_recruitment SET opens=0,closes=1');self.ids=[];return self
 def __exit__(self,*args):
  for id in self.ids:sql("UPDATE lt_events SET state='cancelled' WHERE id='"+id+"'")
  if self.periods:sql(';'.join("UPDATE lt_recruitment SET opens="+str(r['opens'])+",closes="+str(r['closes'])+" WHERE event_id='"+r['event_id']+"'" for r in self.periods))
 def create(self,capacity=4):
  """手動承認方式の試験用開催回を作成する

  Args:
      capacity: 募集可能な発表数

  Returns:
      作成した開催回と試験に使う設定
  """
  fields={'title':'運営完了試験','venue':'試験会場','guidance':'','startsAt':'2026-11-01T01:00:00.000Z','timeZone':'UTC','opensAt':'2026-10-25T00:00:00.000Z','closesAt':'2026-10-31T00:00:00.000Z','capacity':capacity,'talkMinutes':10,'transitionMinutes':5, "approvalMode": "manual"}
  status,event=operate('/events',fields|{'operationId':uuid.uuid4().hex});assert status==200,(status,event);self.ids.append(event['id']);return event,fields
 def submit(self,event):
  h=applicants.ApplicantRuntime();cookie,email=h.login();body=h.payload();body['eventId']=event
  status,dto,_=request('/api/lt/v1/applications',body,cookie);assert status==200,(status,dto);return dto,cookie,body

def mutation(version,data=None):return {'expectedVersion':version,'operationId':uuid.uuid4().hex,'data':{} if data is None else data}
def block(id,kind,start,end,talk=None):
 value={'id':id,'kind':kind,'startsAt':'2026-11-01T01:'+start+':00.000Z','endsAt':'2026-11-01T01:'+end+':00.000Z'}
 if talk:value['talkId']=talk
 return value

def prepared(f):
 event,_=f.create();apps=[]
 for index,start in enumerate(['00','15']):
  app,cookie,_=f.submit(event['id']);apps.append((app,cookie))
  status,_=operate('/applications/'+app['id']+'/approve',mutation(1,{'startsAt':'2026-11-01T01:'+start+':00.000Z','expectedEventVersion':index+1,'expectedScheduleVersion':index+1}));assert status==200
 first,second=[a[0]['id'] for a in apps]
 blocks=[block('opening','opening','00','02'),block('first','talk','02','12',first),block('first-transition','transition','12','17'),block('second','talk','17','27',second),block('second-transition','transition','27','32'),block('break','break','32','35'),block('closing','closing','35','40')]
 assert operate('/events/'+event['id']+'/timetable',mutation(3,{'expectedEventVersion':3,'blocks':blocks}),'PUT')[0]==200
 return event,apps,blocks

class OperationsRuntime(unittest.TestCase):
 def test_list_hold_reject_cancel_once(self):
  with Fixture() as f:
   event,_=f.create();id=event['id'];apps=[f.submit(id) for _ in range(4)]
   self.assertEqual(operate('/applications/'+apps[0][0]['id']+'/approve',mutation(1,{'startsAt':'2026-11-01T01:00:00.000Z','expectedEventVersion':1,'expectedScheduleVersion':1}))[0],200)
   self.assertEqual(operate('/applications/'+apps[1][0]['id']+'/hold',mutation(1,{'note':'運営メモ'}))[0],200)
   self.assertEqual(operate('/applications/'+apps[2][0]['id']+'/reject',mutation(1))[0],200)
   self.assertEqual(request('/api/lt/v1/applications/'+apps[3][0]['id']+'/withdraw',mutation(1),apps[3][1])[0],200)
   sql("UPDATE lt_applications SET dto=json_set(dto,'$.secret','PRIVATE_CANARY') WHERE event_id='"+id+"'")
   status,page=operate('/events/'+id+'/applications?limit=1');self.assertEqual(status,200,str(page)[:1200]);self.assertEqual(page['items'][0]['id'],apps[0][0]['id']);self.assertNotIn('PRIVATE_CANARY',json.dumps(page))
   page2=operate('/events/'+id+'/applications?limit=1&cursor='+page['nextCursor'])[1];self.assertEqual(page2['items'][0]['id'],apps[1][0]['id']);self.assertEqual(page2['items'][0]['operatorNote'],'運営メモ')
   held=operate('/events/'+id+'/applications?review=held')[1];self.assertEqual(len(held['items']),1)
   self.assertEqual(operate('/events/'+id+'/applications?limit=0')[0],422)
   self.assertEqual(operate('/applications/'+apps[0][0]['id']+'/email-change/investigate',mutation(2,{'newEmail':'new@example.invalid'}))[0],403)
   status,approved=operate('/applications/'+apps[1][0]['id']+'/approve',mutation(2,{'startsAt':'2026-11-01T01:15:00.000Z','expectedEventVersion':2,'expectedScheduleVersion':2}));self.assertEqual(status,200);self.assertEqual(approved['operatorNote'],'運営メモ')
   op=mutation(3);status,cancelled=operate('/events/'+id+'/cancel',op);self.assertEqual(status,200);self.assertEqual(cancelled['state'],'cancelled')
   self.assertEqual(operate('/events/'+id+'/cancel',op)[1],cancelled)
   self.assertEqual(operate('/events/'+id+'/cancel',mutation(2))[0],409);self.assertEqual(operate('/events/'+id+'/cancel',mutation(3))[0],409)
   outbox=sql("SELECT application_id,expires FROM lt_outbox WHERE kind='eventCancelled' AND application_id IN (SELECT id FROM lt_applications WHERE event_id='"+id+"')")
   self.assertEqual({r['application_id'] for r in outbox},{apps[0][0]['id'],apps[1][0]['id']});self.assertTrue(all(r['expires'] is not None for r in outbox))
   self.assertEqual(request('/api/lt/v1/events/'+id)[0],404);self.assertEqual(request('/api/lt/v1/events/'+id+'/talks/'+apps[0][0]['id'])[0],404);self.assertNotIn(id,[e['id'] for e in request('/api/lt/v1/events')[1]['items']])
   self.assertEqual(request('/api/lt/v1/applications',apps[2][2]|{'operationId':uuid.uuid4().hex},apps[2][1])[0],409)
 def test_withdraw_before_start_shifts_all_following_blocks(self):
  with Fixture() as f:
   event,apps,blocks=prepared(f);id=event['id'];first=apps[0][0]['id'];second=apps[1][0]['id'];cookie=apps[0][1]
   self.assertEqual(request('/api/lt/v1/applications/'+first+'/request-withdrawal',mutation(2),cookie)[0],200)
   op=mutation(3);status,dto=operate('/applications/'+first+'/confirm-withdrawal',op);self.assertEqual(status,200);self.assertEqual(dto['withdrawal'],'confirmed');self.assertFalse(dto['slotReserved'])
   self.assertEqual(operate('/applications/'+first+'/confirm-withdrawal',op)[1],dto)
   table=operate('/events/'+id+'/timetable')[1];self.assertEqual([b['kind'] for b in table['blocks']],['opening','talk','transition','break','closing']);self.assertEqual(table['blocks'][1]['talkId'],second);self.assertEqual(table['blocks'][1]['startsAt'],'2026-11-01T01:02:00.000Z');self.assertEqual(table['blocks'][-1]['endsAt'],'2026-11-01T01:25:00.000Z')
   self.assertEqual(request('/api/lt/v1/events/'+id+'/talks/'+second)[1]['startsAt'],table['blocks'][1]['startsAt']);self.assertTrue(request('/api/lt/v1/events/'+id+'/talks/'+first)[1]['cancelled'])
   self.assertEqual(sql("SELECT reserved FROM lt_recruitment WHERE event_id='"+id+"'")[0]['reserved'],1)
   self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE application_id='"+first+"' AND kind='withdrawalConfirmed'")[0]['n'],1)
 def test_withdraw_started_keeps_plan_and_cancel_request_race(self):
  with Fixture() as f:
   event,apps,blocks=prepared(f);id=event['id'];first=apps[0][0]['id'];cookie=apps[0][1]
   sql("UPDATE lt_events SET state='started' WHERE id='"+id+"'")
   self.assertEqual(request('/api/lt/v1/applications/'+first+'/request-withdrawal',mutation(2),cookie)[0],200)
   # HTTPだけを並行にする。管理CLIは両応答の後に実行する
   with concurrent.futures.ThreadPoolExecutor() as pool:
    cancel=pool.submit(request,'/api/lt/v1/applications/'+first+'/cancel-withdrawal',mutation(3),cookie)
    confirm=pool.submit(operate,'/applications/'+first+'/confirm-withdrawal',mutation(3))
    a,b=cancel.result(),confirm.result()
   self.assertEqual(sorted([a[0],b[0]]),[200,409]);self.assertEqual(operate('/events/'+id+'/timetable')[1]['blocks'],blocks)
   dto=operate('/applications/'+first)[1]
   if b[0]==200:self.assertEqual(dto['withdrawal'],'confirmed');self.assertTrue(request('/api/lt/v1/events/'+id+'/talks/'+first)[1]['cancelled'])
   else:
    self.assertEqual(dto['withdrawal'],'none');self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE application_id='"+first+"' AND kind='withdrawalConfirmed'")[0]['n'],0)
    self.assertEqual(request('/api/lt/v1/applications/'+first+'/request-withdrawal',mutation(4),cookie)[0],200)
    self.assertEqual(operate('/applications/'+first+'/confirm-withdrawal',mutation(5))[0],200)
   self.assertEqual(operate('/events/'+id+'/timetable')[1]['blocks'],blocks)
   self.assertTrue(request('/api/lt/v1/events/'+id+'/talks/'+first)[1]['cancelled'])

 def test_copy_stays_private_until_dates_confirmed(self):
  with Fixture() as f:
   source,fields=f.create();status,copy=operate('/events/'+source['id']+'/copy',mutation(1));self.assertEqual(status,200);f.ids.append(copy['id']);id=copy['id']
   # 提案日時の到来をDBで模擬しても、公開/受付gateは閉じたまま
   sql("UPDATE lt_events SET public_opens_at=0 WHERE id='"+id+"'; UPDATE lt_recruitment SET opens=0,closes=9999999999999 WHERE event_id='"+id+"'")
   self.assertEqual(request('/api/lt/v1/events/'+id)[0],404);self.assertNotIn(id,[e['id'] for e in request('/api/lt/v1/events')[1]['items']])
   helper=applicants.ApplicantRuntime();cookie,_=helper.login();body=helper.payload();body['eventId']=id;self.assertEqual(request('/api/lt/v1/applications',body,cookie)[0],409)
   settings={key:copy[key] for key in fields};self.assertEqual(operate('/events/'+id,mutation(1,settings),'PATCH')[0],409)
   self.assertEqual(operate('/events/'+source['id']+'/cancel',mutation(1))[0],200)
   settings.update(opensAt=fields['opensAt'],closesAt=fields['closesAt']);self.assertEqual(operate('/events/'+id,mutation(1,settings),'PATCH')[0],200)
   self.assertEqual(request('/api/lt/v1/events/'+id)[0],200)
 def test_cancel_races_approval_without_partial_effects(self):
  with Fixture() as f:
   event,_=f.create(1);id=event['id'];app,_,_=f.submit(id);talk=app['id']
   with concurrent.futures.ThreadPoolExecutor() as pool:
    approve=pool.submit(operate,'/applications/'+talk+'/approve',mutation(1,{'startsAt':'2026-11-01T01:00:00.000Z','expectedEventVersion':1,'expectedScheduleVersion':1}))
    cancel=pool.submit(operate,'/events/'+id+'/cancel',mutation(1))
    a,b=approve.result(),cancel.result()
   self.assertEqual(sorted([a[0],b[0]]),[200,409])
   if b[0]==200:
    self.assertEqual(sql("SELECT reserved FROM lt_recruitment WHERE event_id='"+id+"'")[0]['reserved'],0)
    self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE kind='approved' AND application_id='"+talk+"'")[0]['n'],0)
   else:self.assertEqual(operate('/events/'+id+'/cancel',mutation(2))[0],200)
   self.assertEqual(request('/api/lt/v1/events/'+id)[0],404);self.assertEqual(request('/api/lt/v1/events/'+id+'/talks/'+talk)[0],404)
   self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE kind='eventCancelled' AND application_id='"+talk+"'")[0]['n'],1)
 def test_rejected_application_cannot_return_but_new_id_is_allowed(self):
  with Fixture() as f:
   event,_=f.create(1);app,cookie,body=f.submit(event['id']);old=app['id']
   self.assertEqual(operate('/applications/'+old+'/reject',mutation(1))[0],200)
   self.assertEqual(operate('/applications/'+old+'/hold',mutation(2))[0],409)
   self.assertEqual(request('/api/lt/v1/applications/'+old+'/resubmit',mutation(2),cookie)[0],409)
   status,new,_=request('/api/lt/v1/applications',body|{'operationId':uuid.uuid4().hex},cookie)
   self.assertEqual(status,200);self.assertNotEqual(new['id'],old)
 def test_same_approval_operation_concurrent_replay(self):
  with Fixture() as f:
   event,_=f.create(1);app,_,_=f.submit(event['id']);id=app['id'];body=mutation(1,{'startsAt':'2026-11-01T01:00:00.000Z','expectedEventVersion':1,'expectedScheduleVersion':1})
   with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda _:operate('/applications/'+id+'/approve',body),range(2)))
   self.assertEqual([r[0] for r in results],[200,200]);self.assertEqual(results[0][1],results[1][1])
   self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE kind='approved' AND application_id='"+id+"'")[0]['n'],1)
   self.assertEqual(sql("SELECT reserved FROM lt_recruitment WHERE event_id='"+event['id']+"'")[0]['reserved'],1)
 def test_same_withdrawal_operation_does_not_reuse_old_winner(self):
  with Fixture() as f:
   event,apps,blocks=prepared(f);id=event['id'];first=apps[0][0]['id'];cookie=apps[0][1]
   self.assertEqual(request('/api/lt/v1/applications/'+first+'/request-withdrawal',mutation(2),cookie)[0],200)
   body=mutation(3)
   with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda _:operate('/applications/'+first+'/confirm-withdrawal',body),range(2)))
   self.assertEqual([r[0] for r in results],[200,200]);self.assertEqual(results[0][1],results[1][1])
   table=operate('/events/'+id+'/timetable')[1];self.assertEqual(table['version'],5);self.assertEqual(table['blocks'][-1]['endsAt'],'2026-11-01T01:25:00.000Z')
   self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE kind='withdrawalConfirmed' AND application_id='"+first+"'")[0]['n'],1)
if __name__=='__main__':unittest.main()
