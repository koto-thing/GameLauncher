import unittest,json,uuid,concurrent.futures
from applicant_runtime_test import sql,request
import applicant_runtime_test as applicants
from operator_runtime_test import operate
class EventRuntime(unittest.TestCase):
 def test_settings_copy_timetable_and_versions(self):
  """開催設定のコピー・時間割・更新版を検証する

  Returns:
      戻り値なし
  """
  periods=sql('SELECT event_id,opens,closes FROM lt_recruitment')
  sql('UPDATE lt_recruitment SET opens=0,closes=1')
  created=[]
  try:
   fields={'title':'架空設定','venue':'試験会場','guidance':'','startsAt':'2026-11-01T01:00:00.000Z','timeZone':'Asia/Tokyo','opensAt':'2026-10-25T00:00:00.000Z','closesAt':'2026-10-31T00:00:00.000Z','capacity':2,'talkMinutes':10,'transitionMinutes':5, "approvalMode": "manual"}
   for invalid in [{'capacity':0},{'talkMinutes':0},{'transitionMinutes':-1},{'timeZone':'invalid/timezone'},{'closesAt':fields['opensAt']}]:
    self.assertEqual(operate('/events',fields|invalid|{'operationId':uuid.uuid4().hex})[0],422)
   payload=fields|{'operationId':uuid.uuid4().hex}
   status,event=operate('/events',payload);self.assertEqual(status,200);id=event['id'];created.append(id)
   self.assertEqual(operate('/events/'+id)[1],event)
   self.assertIn(id,[x['id'] for x in operate('/events')[1]['items']])
   self.assertEqual(operate('/events',payload)[1],event)
   self.assertEqual(operate('/events',fields|{'operationId':uuid.uuid4().hex})[0],409)
   patch={'expectedVersion':1,'operationId':uuid.uuid4().hex,'data':fields|{'venue':'更新会場'}}
   status,updated=operate('/events/'+id,patch,'PATCH');self.assertEqual(status,200);self.assertEqual(updated['version'],2)
   patch['operationId']=uuid.uuid4().hex;self.assertEqual(operate('/events/'+id,patch,'PATCH')[0],409)
   status,copy=operate('/events/'+id+'/copy',{'expectedVersion':2,'operationId':uuid.uuid4().hex,'data':{}});self.assertEqual(status,200);created.append(copy['id'])
   for key in ['venue','capacity','talkMinutes','transitionMinutes']:self.assertEqual(copy[key],updated[key])
   self.assertEqual(copy['timeZone'],'Asia/Tokyo');self.assertFalse(copy['publishEnabled'])
   self.assertNotEqual(copy['id'],id);self.assertNotEqual(copy['title'],updated['title']);self.assertEqual(sql("SELECT count(*) AS n FROM lt_applications WHERE event_id='"+copy['id']+"'")[0]['n'],0)
   h=applicants.ApplicantRuntime();cookie,_=h.login();p=h.payload();p['eventId']=id
   status,app,_=request('/api/lt/v1/applications',p,cookie);self.assertEqual(status,200);talk=app['id']
   self.assertEqual(operate('/applications/'+talk+'/approve',{'expectedVersion':1,'operationId':uuid.uuid4().hex,'data':{'startsAt':fields['startsAt'],'expectedEventVersion':2,'expectedScheduleVersion':1}})[0],200)
   def block(id,kind,start,end,talkid=None):
    b={'id':id,'kind':kind,'startsAt':'2026-11-01T01:'+start+':00.000Z','endsAt':'2026-11-01T01:'+end+':00.000Z'}
    if talkid:b['talkId']=talkid
    return b
   blocks=[block('opening','opening','00','02'),block('talk','talk','02','12',talk),block('transition','transition','12','17'),block('break','break','17','20'),block('closing','closing','20','25')]
   save={'expectedVersion':2,'operationId':uuid.uuid4().hex,'data':{'expectedEventVersion':3,'blocks':blocks}}
   status,table=operate('/events/'+id+'/timetable',save,'PUT');self.assertEqual(status,200);self.assertEqual(table['version'],3)
   published=request('/api/lt/v1/events/'+id+'/talks/'+talk)[1];self.assertEqual(published['title'],p['content']['title']);self.assertEqual(published['startsAt'],blocks[1]['startsAt'])
   self.assertEqual(request('/api/lt/v1/events/'+id)[1]['endsAt'],blocks[-1]['endsAt'])
   self.assertEqual(operate('/events/'+id+'/timetable',save,'PUT')[1],table)
   save['operationId']=uuid.uuid4().hex;self.assertEqual(operate('/events/'+id+'/timetable',save,'PUT')[0],409)
   save['expectedVersion']=3;save['operationId']=uuid.uuid4().hex
   with concurrent.futures.ThreadPoolExecutor() as pool:responses=list(pool.map(lambda _:operate('/events/'+id+'/timetable',save,'PUT'),range(2)))
   self.assertEqual([r[0] for r in responses],[200,200]);self.assertEqual(responses[0][1],responses[1][1]);table=responses[0][1];self.assertEqual(table['version'],4)
   bad=save|{'expectedVersion':4,'operationId':uuid.uuid4().hex,'data':{'expectedEventVersion':3,'blocks':[b for b in blocks if b['kind']!='transition']}};self.assertEqual(operate('/events/'+id+'/timetable',bad,'PUT')[0],422)
   nullblocks=json.loads(json.dumps(blocks));nullblocks[2]['talkId']=None
   self.assertEqual(operate('/events/'+id+'/timetable',save|{'expectedVersion':4,'operationId':uuid.uuid4().hex,'data':{'expectedEventVersion':3,'blocks':nullblocks}},'PUT')[0],422)
   # 本文差し戻しと再承認が最新の時刻を戻さない
   self.assertEqual(operate('/applications/'+talk+'/return',{'expectedVersion':2,'operationId':uuid.uuid4().hex,'data':{}})[0],200)
   self.assertEqual(request('/api/lt/v1/applications/'+talk+'/resubmit',{'expectedVersion':3,'operationId':uuid.uuid4().hex,'data':{}},cookie)[0],200)
   self.assertEqual(operate('/applications/'+talk+'/reapprove',{'expectedVersion':4,'operationId':uuid.uuid4().hex,'data':{'expectedEventVersion':3}})[0],200)
   self.assertEqual(request('/api/lt/v1/events/'+id+'/talks/'+talk)[1]['startsAt'],blocks[1]['startsAt'])
  finally:
   for id in created:sql("UPDATE lt_events SET state='cancelled' WHERE id='"+id+"'")
   sql(";".join("UPDATE lt_recruitment SET opens="+str(row['opens'])+",closes="+str(row['closes'])+" WHERE event_id='"+row['event_id']+"'" for row in periods))
 def test_concurrent_recruitment_create(self):
  """募集期間が重なる開催回の同時作成を検証する

  Returns:
      戻り値なし
  """
  periods=sql('SELECT event_id,opens,closes FROM lt_recruitment');sql('UPDATE lt_recruitment SET opens=0,closes=1');winner=None
  try:
   fields={'title':'競合試験','venue':'試験','guidance':'','startsAt':'2030-01-01T01:00:00.000Z','timeZone':'UTC','opensAt':'2029-12-01T00:00:00.000Z','closesAt':'2029-12-31T00:00:00.000Z','capacity':1,'talkMinutes':10,'transitionMinutes':5, "approvalMode": "manual"}
   payloads=[fields|{'operationId':uuid.uuid4().hex} for _ in range(2)]
   # HTTPだけを並行送信し、D1管理CLIは併走させない
   with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda body:operate('/events',body),payloads))
   self.assertEqual(sorted(r[0] for r in results),[200,409]);winner=next(r[1]['id'] for r in results if r[0]==200)
  finally:
   if winner:sql("UPDATE lt_events SET state='cancelled' WHERE id='"+winner+"'")
   sql(";".join("UPDATE lt_recruitment SET opens="+str(row['opens'])+",closes="+str(row['closes'])+" WHERE event_id='"+row['event_id']+"'" for row in periods))
 def test_two_approvals_have_transitions_and_capacity_guards(self):
  """手動承認の転換枠と定員制約を検証する

  Returns:
      戻り値なし
  """
  periods=sql('SELECT event_id,opens,closes FROM lt_recruitment');sql('UPDATE lt_recruitment SET opens=0,closes=1');event=None
  try:
   fields={'title':'二枠試験','venue':'試験','guidance':'','startsAt':'2026-11-01T01:00:00.000Z','timeZone':'UTC','opensAt':'2026-10-25T00:00:00.000Z','closesAt':'2026-10-31T00:00:00.000Z','capacity':2,'talkMinutes':10,'transitionMinutes':5, "approvalMode": "manual"}
   status,dto=operate('/events',fields|{'operationId':uuid.uuid4().hex});self.assertEqual(status,200);event=dto['id']
   for index,start in enumerate(['00','15']):
    helper=applicants.ApplicantRuntime();cookie,_=helper.login();payload=helper.payload();payload['eventId']=event
    status,app,_=request('/api/lt/v1/applications',payload,cookie);self.assertEqual(status,200)
    status,_=operate('/applications/'+app['id']+'/approve',{'expectedVersion':1,'operationId':uuid.uuid4().hex,'data':{'startsAt':'2026-11-01T01:'+start+':00.000Z','expectedEventVersion':index+1,'expectedScheduleVersion':index+1}});self.assertEqual(status,200)
   table=operate('/events/'+event+'/timetable')[1]
   self.assertEqual([b['kind'] for b in table['blocks']],['talk','transition','talk','transition'])
   self.assertEqual(request('/api/lt/v1/events/'+event)[1]['endsAt'],'2026-11-01T01:30:00.000Z')
   for changes in [{'capacity':1},{'talkMinutes':20},{'transitionMinutes':6, "approvalMode": "manual"}]:
    self.assertEqual(operate('/events/'+event,{'expectedVersion':3,'operationId':uuid.uuid4().hex,'data':fields|changes},'PATCH')[0],409)
  finally:
   if event:sql("UPDATE lt_events SET state='cancelled' WHERE id='"+event+"'")
   sql(";".join("UPDATE lt_recruitment SET opens="+str(row['opens'])+",closes="+str(row['closes'])+" WHERE event_id='"+row['event_id']+"'" for row in periods))
if __name__=='__main__':unittest.main()
