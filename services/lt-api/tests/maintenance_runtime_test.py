import unittest,json,urllib.request,subprocess
from applicant_runtime_test import sql
class MaintenanceRuntime(unittest.TestCase):
 def test_fake_delivery_deduplicated(self):
  def dispatch():
   with urllib.request.urlopen('http://127.0.0.1:18878/test/dispatch-fake') as r:return json.load(r)
  dispatch();before=sql("SELECT count(*) AS n FROM lt_mail_jobs WHERE transport='fake' AND delivered_at IS NOT NULL")[0]['n']
  self.assertEqual(dispatch()['delivered'],0)
  self.assertEqual(sql("SELECT count(*) AS n FROM lt_mail_jobs WHERE transport='fake' AND delivered_at IS NOT NULL")[0]['n'],before)
 def test_retention_is_read_only_and_archive_excluded(self):
  before=sql('SELECT count(*) AS n FROM lt_applications')[0]['n']
  public_before=sql('SELECT (SELECT count(*) FROM lt_public_events)+(SELECT count(*) FROM lt_public_talks) AS n')[0]['n']
  r=subprocess.run(['node','node_modules/wrangler/bin/wrangler.js','d1','execute','lt-local','--local','--file','retention-dry-run.sql','--json'],capture_output=True,encoding='utf-8',check=True)
  values=json.loads(r.stdout)
  self.assertEqual(sql('SELECT count(*) AS n FROM lt_applications')[0]['n'],before)
  self.assertEqual(sql('SELECT (SELECT count(*) FROM lt_public_events)+(SELECT count(*) FROM lt_public_talks) AS n')[0]['n'],public_before)
  resources={row.get('resource','') for result in values for row in result['results']}
  self.assertEqual({name for name in resources if 'public' in name},{'cancelled_public_events','cancelled_public_talks'})
  self.assertTrue(values[0]['success'])
if __name__=='__main__':unittest.main()
