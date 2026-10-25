import json, urllib.request, urllib.error, unittest
from schema_assertions import assert_response
BASE='http://127.0.0.1:8787/api/lt/v1'
class PublicRuntime(unittest.TestCase):
 def get(self,path,status=200):
  try: r=urllib.request.urlopen(BASE+path)
  except urllib.error.HTTPError as e: r=e
  self.assertEqual(r.status,status)
  text=r.read().decode();r.close(); self.assertNotIn('PRIVATE_SENTINEL',text)
  self.assertEqual(r.headers['Cache-Control'],'no-store')
  value=json.loads(text) if status==200 else None
  if status==200:assert_response('/api/lt/v1'+path,'GET',status,value)
  return value
 def test_list(self): self.assertIn('open',[x['id'] for x in self.get('/events')['items']])
 def test_detail_timetable(self): self.assertEqual(self.get('/events/open')['schedule'],[])
 def test_talk(self): self.get('/events/open/talks/open-talk',404)  # 承認証跡のない旧fixtureは非公開
 def test_hidden_cancelled_missing(self):
  for id in ['hidden','cancelled','missing']:
   self.get('/events/'+id,404); self.get('/events/'+id+'/talks/'+id+'-talk',404)
 def test_cross_event(self): self.get('/events/open/talks/hidden-talk',404)
 def test_forged_operator(self):
  req=urllib.request.Request(BASE+'/operator/events',headers={'X-Actor-Role':'admin'})
  with self.assertRaises(urllib.error.HTTPError) as ctx: urllib.request.urlopen(req)
  self.assertEqual(ctx.exception.code,404)
if __name__=='__main__': unittest.main()
