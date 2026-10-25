import unittest,json,urllib.request,subprocess
from applicant_runtime_test import sql
class MaintenanceRuntime(unittest.TestCase):
 def test_fake_delivery_deduplicated(self):
  def dispatch():
   with urllib.request.urlopen('http://127.0.0.1:8788/test/dispatch-fake') as r:return json.load(r)
  dispatch();before=sql('SELECT count(*) AS n FROM lt_fake_deliveries')[0]['n']
  self.assertEqual(dispatch()['delivered'],0)
  self.assertEqual(sql('SELECT count(*) AS n FROM lt_fake_deliveries')[0]['n'],before)
 def test_retention_is_read_only_and_archive_excluded(self):
  before=sql('SELECT count(*) AS n FROM lt_applications')[0]['n']
  r=subprocess.run(['node','node_modules/wrangler/bin/wrangler.js','d1','execute','lt-local','--local','--file','retention-dry-run.sql','--json'],capture_output=True,encoding='utf-8',check=True)
  values=json.loads(r.stdout)
  self.assertEqual(sql('SELECT count(*) AS n FROM lt_applications')[0]['n'],before)
  self.assertNotIn('public',r.stdout)
  self.assertTrue(values[0]['success'])
if __name__=='__main__':unittest.main()
