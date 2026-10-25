import unittest,uuid,json
import applicant_runtime_test as applicants
from applicant_runtime_test import sql,request
from operator_runtime_test import operate
class PrivacyRuntime(unittest.TestCase):
 def test_private_canary_and_expired_replays(self):
  h=applicants.ApplicantRuntime();cookie,_=h.login();p=h.payload();status,dto,_=request('/api/lt/v1/applications',p,cookie);self.assertEqual(status,200);id=dto['id'];path='/api/lt/v1/applications/'+id
  sql("UPDATE lt_applications SET dto=json_set(dto,'$.operatorNote','PRIVATE_CANARY','$.content.secret','PRIVATE_CANARY','$.content.speakers[0].email','PRIVATE_CANARY') WHERE id='"+id+"'")
  for route in [path,'/api/lt/v1/applications']:
   self.assertNotIn('PRIVATE_CANARY',json.dumps(request(route,cookie=cookie)[1]))
  op={'expectedVersion':1,'operationId':uuid.uuid4().hex,'data':{'note':'保存されたメモ'}}
  self.assertEqual(operate('/applications/'+id+'/hold',op)[0],200)
  self.assertEqual(operate('/applications/'+id)[1]['operatorNote'],'保存されたメモ')
  self.assertEqual(operate('/applications/'+id+'/hold',op)[1]['operatorNote'],'保存されたメモ')
  # dry-runで行が残っていても現行申請の期限を再照合する
  sql("UPDATE lt_applications SET dto=json_set(dto,'$.retentionExpiresAt','2000-01-01T00:00:00.000Z') WHERE id='"+id+"'")
  self.assertEqual(request(path,cookie=cookie)[0],410)
  self.assertNotIn(id,json.dumps(request('/api/lt/v1/applications',cookie=cookie)[1]))
  status,value,_=request('/api/lt/v1/applications',p,cookie);self.assertNotEqual(status,200);self.assertNotIn('PRIVATE_CANARY',json.dumps(value))
  self.assertEqual(operate('/applications/'+id)[0],410)
  self.assertEqual(operate('/applications/'+id+'/hold',op)[0],410)
if __name__=='__main__':unittest.main()
