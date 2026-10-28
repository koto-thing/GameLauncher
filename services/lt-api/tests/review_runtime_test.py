import unittest,uuid,json
import applicant_runtime_test as applicant
from applicant_runtime_test import sql,request
from operator_runtime_test import operate
class ReviewRuntime(unittest.TestCase):
 def test_return_edit_resubmit_reapprove(self):
  """差し戻し・本人編集・再提出・手動再承認を検証する

  Returns:
      戻り値なし
  """
  event='review-'+uuid.uuid4().hex
  base=json.loads(sql("SELECT dto FROM lt_public_events WHERE event_id='open'")[0]['dto']);base.update(id=event,schedule=[],version=1)
  sql("INSERT INTO lt_events(id,state,public_opens_at) VALUES('"+event+"','scheduled',0); INSERT INTO lt_recruitment(schedule_mode,approval_mode,event_id,opens,closes,capacity) VALUES('manual','manual','"+event+"',0,9999999999999,3); INSERT INTO lt_schedule(event_id) VALUES('"+event+"'); INSERT INTO lt_public_events VALUES('"+event+"','"+json.dumps(base,ensure_ascii=False).replace("'","''")+"')")
  h=applicant.ApplicantRuntime();cookie,_=h.login();p=h.payload();p['eventId']=event;status,dto,_=request('/api/lt/v1/applications',p,cookie);self.assertEqual(status,200);id=dto['id'];path='/api/lt/v1/applications/'+id
  def mutation(version,data={}):return {'expectedVersion':version,'operationId':uuid.uuid4().hex,'data':data}
  self.assertEqual(operate('/applications/'+id+'/approve',mutation(1,{'startsAt':'2026-11-01T01:00:00.000Z','expectedEventVersion':1,'expectedScheduleVersion':1}))[0],200)
  published=request('/api/lt/v1/events/'+event+'/talks/'+id)[1]
  sql("UPDATE lt_events SET state='ended' WHERE id='"+event+"'")
  fixed=request(path,cookie=cookie)[1]['retentionExpiresAt']
  self.assertIsNotNone(fixed)
  self.assertEqual(operate('/applications/'+id+'/return',mutation(2,{'note':'試験差し戻し'}))[0],200)
  self.assertNotIn('operatorNote',request(path,cookie=cookie)[1])
  edit=mutation(3,{'content':p['content']|{'title':'再承認本文'},'materialUrl':p['materialUrl']})
  self.assertEqual(request(path,edit,cookie,'PATCH')[1]['version'],4)
  self.assertEqual(request('/api/lt/v1/events/'+event+'/talks/'+id)[1],published)
  self.assertEqual(request(path+'/resubmit',mutation(4),cookie)[1]['version'],5)
  self.assertEqual(request(path,mutation(5,edit['data']),cookie,'PATCH')[0],409)
  self.assertEqual(operate('/applications/'+id+'/reject',mutation(5))[0],409)
  self.assertEqual(operate('/applications/'+id+'/reapprove',mutation(5,{'expectedEventVersion':999}))[0],409)
  self.assertEqual(operate('/applications/'+id+'/reapprove',mutation(5,{'expectedEventVersion':2}))[0],200)
  new=request('/api/lt/v1/events/'+event+'/talks/'+id)[1];self.assertEqual(new['title'],'再承認本文');self.assertEqual(new['startsAt'],published['startsAt'])
  self.assertEqual(sql("SELECT reserved FROM lt_recruitment WHERE event_id='"+event+"'")[0]['reserved'],1)
  self.assertEqual(request(path,cookie=cookie)[1]['retentionExpiresAt'],fixed)
  sql("UPDATE lt_events SET state='cancelled' WHERE id='"+event+"'")
if __name__=='__main__':unittest.main()
