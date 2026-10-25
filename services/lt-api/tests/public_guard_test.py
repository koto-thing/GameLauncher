import unittest,json
from applicant_runtime_test import sql,request
class PublicGuard(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  sql("UPDATE lt_events SET public_opens_at=0; UPDATE lt_public_events SET dto=json_remove(dto,'$.representativeEmail','$.schedule[0].operatorNote'); UPDATE lt_public_talks SET dto=json_remove(dto,'$.materialUrl','$.speakers[0].email')")
 def test_future_gate_all_routes(self):
  sql("UPDATE lt_events SET public_opens_at=9999999999999 WHERE id='open'")
  try:
   self.assertEqual(request('/api/lt/v1/events')[1]['items'],[])
   for p in ['/events/open','/events/open/talks/open-talk']:self.assertEqual(request('/api/lt/v1'+p)[0],404)
  finally:sql("UPDATE lt_events SET public_opens_at=0 WHERE id='open'")
 def test_object_canary_and_missing_required(self):
  saved=sql("SELECT dto FROM lt_public_events WHERE event_id='open'")[0]['dto']
  for change in ["json_set(dto,'$.title',json('{\"representativeEmail\":\"PRIVATE_SENTINEL\"}'))","json_remove(dto,'$.title')"]:
   sql("UPDATE lt_public_events SET dto="+change+" WHERE event_id='open'")
   try:
    self.assertEqual(request('/api/lt/v1/events/open')[0],404)
    self.assertNotIn('PRIVATE_SENTINEL',json.dumps(request('/api/lt/v1/events')[1]))
   finally:sql("UPDATE lt_public_events SET dto='"+saved.replace("'","''")+"' WHERE event_id='open'")
 def test_nested_profile_canary(self):
  saved=sql("SELECT dto FROM lt_public_talks WHERE id='open-talk'")[0]['dto']
  sql("UPDATE lt_public_talks SET dto=json_set(dto,'$.speakers[0].profile',json('{\"materialUrl\":\"PRIVATE_SENTINEL\"}')) WHERE id='open-talk'")
  try:self.assertEqual(request('/api/lt/v1/events/open/talks/open-talk')[0],404)
  finally:sql("UPDATE lt_public_talks SET dto='"+saved.replace("'","''")+"' WHERE id='open-talk'")
if __name__=='__main__':unittest.main()
