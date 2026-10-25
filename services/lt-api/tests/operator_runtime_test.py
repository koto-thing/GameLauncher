import unittest,json,uuid,urllib.request,urllib.error,concurrent.futures
from applicant_runtime_test import sql,request
from schema_assertions import assert_response
import applicant_runtime_test as applicants

def operate(path,data=None,method=None):
 req=urllib.request.Request('http://127.0.0.1:18878/api/lt/v1/operator'+path,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'},method=method)
 try:r=urllib.request.urlopen(req)
 except urllib.error.HTTPError as e:r=e
 raw=r.read();value=json.loads(raw) if r.headers.get('Content-Type','').startswith('application/json') else raw.decode()
 r.close()
 assert_response('/api/lt/v1/operator'+path,req.get_method(),r.status,value)
 return r.status,value
class OperatorRuntime(unittest.TestCase):
 def test_approval_last_slot_and_archive(self):
  event='race-'+uuid.uuid4().hex
  base=json.loads(sql("SELECT dto FROM lt_public_events WHERE event_id='open'")[0]['dto']);base.update(id=event,schedule=[],version=1)
  sql("INSERT INTO lt_events(id,state,public_opens_at) VALUES('"+event+"','scheduled',0); INSERT INTO lt_recruitment(event_id,opens,closes,capacity) VALUES('"+event+"',0,9999999999999,1); INSERT INTO lt_schedule(event_id) VALUES('"+event+"'); INSERT INTO lt_public_events VALUES('"+event+"','"+json.dumps(base,ensure_ascii=False).replace("'","''")+"')")
  ids=[];cookies=[]
  for _ in range(2):
   helper=applicants.ApplicantRuntime();cookie,_=helper.login();p=helper.payload();p['eventId']=event
   status,dto,_=request('/api/lt/v1/applications',p,cookie);self.assertEqual(status,200);ids.append(dto['id']);cookies.append(cookie)
  self.assertEqual(request('/api/lt/v1/events/'+event+'/talks/'+ids[0])[0],404)
  payloads=[{'expectedVersion':1,'operationId':uuid.uuid4().hex,'data':{'startsAt':'2026-11-01T01:00:00.000Z','expectedEventVersion':1,'expectedScheduleVersion':1}} for _ in ids]
  with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(lambda args:operate('/applications/'+args[0]+'/approve',args[1]),zip(ids,payloads)))
  self.assertEqual(sorted(r[0] for r in results),[200,409])
  winner=next(i for i,r in enumerate(results) if r[0]==200);loser=1-winner
  self.assertEqual(operate('/applications/'+ids[winner]+'/approve',payloads[winner])[0],200)
  self.assertEqual(sql("SELECT reserved FROM lt_recruitment WHERE event_id='"+event+"'")[0]['reserved'],1)
  for table in ['lt_audit','lt_approval_receipts']:
   self.assertEqual(sql("SELECT count(*) AS n FROM "+table+" WHERE application_id='"+ids[winner]+"'")[0]['n'],1)
   self.assertEqual(sql("SELECT count(*) AS n FROM "+table+" WHERE application_id='"+ids[loser]+"'")[0]['n'],0)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE kind='approved' AND application_id='"+ids[winner]+"'")[0]['n'],1)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE kind='approved' AND application_id='"+ids[loser]+"'")[0]['n'],0)
  self.assertEqual(request('/api/lt/v1/events/'+event+'/talks/'+ids[winner])[0],200)
  self.assertEqual(request('/api/lt/v1/events/'+event+'/talks/'+ids[loser])[0],404)
  self.assertEqual(operate('/events/'+event+'/timetable')[1]['version'],2)
  saved=sql("SELECT dto FROM lt_public_talks WHERE id='"+ids[winner]+"'")[0]['dto']
  bad=json.loads(saved);bad['speakers'][0]['profile']={'materialUrl':'PRIVATE_SENTINEL'}
  badsql=json.dumps(bad,ensure_ascii=False).replace("'","''")
  sql("UPDATE lt_applications SET dto=json_set(dto,'$.published',json('"+badsql+"')) WHERE id='"+ids[winner]+"'; UPDATE lt_public_talks SET dto='"+badsql+"' WHERE id='"+ids[winner]+"'")
  self.assertEqual(request('/api/lt/v1/events/'+event+'/talks/'+ids[winner])[0],404)
  saved_sql=saved.replace("'","''")
  sql("UPDATE lt_applications SET dto=json_set(dto,'$.published',json('"+saved_sql+"')) WHERE id='"+ids[winner]+"'; UPDATE lt_public_talks SET dto='"+saved_sql+"' WHERE id='"+ids[winner]+"'")
  sql("UPDATE lt_events SET state='ended' WHERE id='"+event+"'")
  self.assertEqual(request('/api/lt/v1/events/'+event+'/talks/'+ids[winner])[0],200)
  # 私有情報の期限変更でも公開アーカイブが消えない
  sql("UPDATE lt_applications SET dto=json_set(dto,'$.retentionExpiresAt','2000-01-01T00:00:00.000Z') WHERE id='"+ids[winner]+"'")
  self.assertEqual(request('/api/lt/v1/events/'+event+'/talks/'+ids[winner])[0],200)
  sql("UPDATE lt_events SET state='cancelled' WHERE id='"+event+"'")
  self.assertEqual(request('/api/lt/v1/events/'+event)[0],404)
  self.assertEqual(request('/api/lt/v1/events/'+event+'/talks/'+ids[winner])[0],404)
 def test_unapproved_snapshot_sql_rejected(self):
  with self.assertRaises(Exception):sql("INSERT INTO lt_public_talks(id,event_id,dto,approval_operation) VALUES('unapproved','open','{}','forged')")
 def test_public_operator_header_cannot_authorize(self):
  req=urllib.request.Request('http://127.0.0.1:18877/api/lt/v1/operator/events/open/timetable',headers={'X-Actor-Role':'admin','X-LT-Operator-Context':'{"actorId":"x","role":"admin","requestId":"x"}'})
  with self.assertRaises(urllib.error.HTTPError) as ctx:urllib.request.urlopen(req)
  self.assertEqual(ctx.exception.code,404);ctx.exception.close()
if __name__=='__main__':unittest.main()
