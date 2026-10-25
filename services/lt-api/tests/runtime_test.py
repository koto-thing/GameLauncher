import json, urllib.request, urllib.error, unittest
BASE='http://127.0.0.1:8787/api/lt/v1'
class PublicRuntime(unittest.TestCase):
 def get(self,path,status=200):
  try: r=urllib.request.urlopen(BASE+path)
  except urllib.error.HTTPError as e: r=e
  self.assertEqual(r.status,status)
  text=r.read().decode(); self.assertNotIn('PRIVATE_SENTINEL',text)
  self.assertEqual(r.headers['Cache-Control'],'no-store')
  return json.loads(text) if status==200 else None
 def test_list(self): self.assertEqual([x['id'] for x in self.get('/events')['items']],['open'])
 def test_detail_timetable(self): self.assertEqual(self.get('/events/open')['schedule'][0]['id'],'slot')
 def test_talk(self): self.assertEqual(self.get('/events/open/talks/open-talk')['speakers'][0]['displayName'],'試験者')
 def test_hidden_cancelled_missing(self):
  for id in ['hidden','cancelled','missing']:
   self.get('/events/'+id,404); self.get('/events/'+id+'/talks/'+id+'-talk',404)
 def test_cross_event(self): self.get('/events/open/talks/hidden-talk',404)
 def test_forged_operator(self):
  req=urllib.request.Request(BASE+'/operator/events',headers={'X-Actor-Role':'admin'})
  with self.assertRaises(urllib.error.HTTPError) as ctx: urllib.request.urlopen(req)
  self.assertEqual(ctx.exception.code,404)
if __name__=='__main__': unittest.main()
