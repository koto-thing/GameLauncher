import unittest,uuid,time,json,concurrent.futures,urllib.request,urllib.error
from operations_runtime_test import Fixture,mutation,block
from applicant_runtime_test import request
from operator_runtime_test import operate

def paused(path,data,cookie=None,method='POST'):
 headers={'Content-Type':'application/json','X-LT-Test-Pause':'after-read','Origin':'http://127.0.0.1:18877','X-LT-CSRF':'1'}
 if cookie:headers['Cookie']=cookie
 base='http://127.0.0.1:18878' if path.startswith('/api/lt/v1/operator/') else 'http://127.0.0.1:18877'
 req=urllib.request.Request(base+path,data=json.dumps(data).encode(),headers=headers,method=method)
 try:r=urllib.request.urlopen(req)
 except urllib.error.HTTPError as e:r=e
 raw=r.read();return r.status,json.loads(raw) if r.headers.get('Content-Type','').startswith('application/json') else raw.decode(),r.headers

def timetable(talk,offset):
 n=int(offset);s=f'{n:02d}';end=f'{n+10:02d}';transition=f'{n+15:02d}';closing=f'{n+20:02d}'
 return [block('opening','opening','00',s),block('talk','talk',s,end,talk),block('transition','transition',end,transition),block('closing','closing',transition,closing)]

class MixedRaceRuntime(unittest.TestCase):
 def test_old_read_timetable_write_then_reapprove_edit_resubmit_write(self):
  with Fixture() as f:
   event,_=f.create(1);id=event['id'];app,cookie,payload=f.submit(id);talk=app['id'];path='/api/lt/v1/applications/'+talk
   self.assertEqual(operate('/applications/'+talk+'/approve',mutation(1,{'startsAt':'2026-11-01T01:00:00.000Z','expectedEventVersion':1,'expectedScheduleVersion':1}))[0],200)
   self.assertEqual(operate('/applications/'+talk+'/return',mutation(2))[0],200)
   self.assertEqual(request(path,mutation(3,{'content':payload['content']|{'title':'新本文'},'materialUrl':payload['materialUrl']}),cookie,'PATCH')[0],200)
   self.assertEqual(request(path+'/resubmit',mutation(4),cookie)[0],200)
   def race(route,body,method,owner,schedule,offset,observed):
    with concurrent.futures.ThreadPoolExecutor() as pool:
     future=pool.submit(paused,route,body,owner,method)
     time.sleep(0.12)
     status,_=operate('/events/'+id+'/timetable',mutation(schedule,{'expectedEventVersion':2,'blocks':timetable(talk,offset)}),'PUT')
     self.assertEqual(status,200);self.assertFalse(future.done(),'遅延した書込より先に時間割保存が完了する必要がある')
     result=future.result()
    self.assertEqual(result[0],200,str(result[1])[:500]);self.assertEqual(result[2].get('X-LT-Test-Observed-Start'),'2026-11-01T01:'+observed+':00.000Z')
    self.assertEqual(result[1]['published']['startsAt'],'2026-11-01T01:'+offset+':00.000Z')
    current=request('/api/lt/v1/events/'+id+'/talks/'+talk)[1];self.assertEqual(current['startsAt'],'2026-11-01T01:'+offset+':00.000Z')
   race('/api/lt/v1/operator/applications/'+talk+'/reapprove',mutation(5,{'expectedEventVersion':2}),'POST',None,2,'05','00')
   self.assertEqual(request('/api/lt/v1/events/'+id+'/talks/'+talk)[1]['title'],'新本文')
   self.assertEqual(operate('/applications/'+talk+'/return',mutation(6))[0],200)
   race(path,mutation(7,{'content':payload['content']|{'title':'次の本文'},'materialUrl':payload['materialUrl']}),'PATCH',cookie,3,'06','05')
   race(path+'/resubmit',mutation(8),'POST',cookie,4,'07','06')
if __name__=='__main__':unittest.main()
