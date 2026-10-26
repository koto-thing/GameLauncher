"""Rustが使用するSQLをSQLiteで実行しclaimとfenceを検証する"""
import json,re,sqlite3,unittest,tempfile,threading,concurrent.futures
from pathlib import Path
ROOT=Path(__file__).parents[1]
class ClaimTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute("CREATE TABLE lt_outbox(id TEXT PRIMARY KEY,recipient TEXT,kind TEXT,state TEXT,expires INTEGER,created_at INTEGER)")
  self.db.execute("CREATE TABLE lt_login_outbox(id TEXT PRIMARY KEY,recipient TEXT,kind TEXT,state TEXT,expires INTEGER,created_at INTEGER,action_url TEXT)")
  self.db.executescript((ROOT/'proposals/outbox-dispatch.sql').read_text(encoding='utf-8'))
  self.db.execute("INSERT INTO lt_outbox VALUES('a','fixture@example.invalid','approved','pending',999000,0)")
  self.db.execute("INSERT INTO lt_mail_jobs(id,envelope,expires) VALUES('application:a','{}',999)")
  self.claim=next(q for q in re.findall(r'"([^"\n]+)"',(ROOT/"src/runtime.rs").read_text(encoding="utf-8")) if q.startswith("UPDATE lt_mail_jobs SET state=") and "RETURNING envelope" in q)
 def tearDown(self): self.db.close()
 def test_disabled(self):self.assertEqual(self.db.execute(self.claim,('one',1,'http')).fetchall(),[])
 def test_two_calls_one_claim(self):
  self.db.execute("UPDATE lt_mail_mode SET mode='fake'")
  self.assertEqual(len(self.db.execute(self.claim,('one',1,'fake')).fetchall()),1)
  self.assertEqual(self.db.execute(self.claim,('two',1,'fake')).fetchall(),[])
 def test_concurrent_claim(self):
  self.db.execute("UPDATE lt_mail_mode SET mode='fake'")
  self.db.commit()
  (ROOT/'target').mkdir(exist_ok=True)
  with tempfile.TemporaryDirectory(dir=ROOT/"target") as tmp:
   path=str(Path(tmp)/'mail.sqlite')
   copy=sqlite3.connect(path); self.db.backup(copy); copy.close()
   barrier=threading.Barrier(2)
   def claim(fence):
    db=sqlite3.connect(path,timeout=5,isolation_level=None)
    try:
     barrier.wait()
     return len(db.execute(self.claim,(fence,1,'fake')).fetchall())
    finally: db.close()
   with concurrent.futures.ThreadPoolExecutor(2) as pool:
    self.assertEqual(sum(pool.map(claim,['one','two'])),1)
 def test_wrong_transport(self):
  self.db.execute("UPDATE lt_mail_mode SET mode='http'")
  self.assertEqual(self.db.execute(self.claim,('one',1,'fake')).fetchall(),[])
 def test_expired(self):
  self.db.execute("UPDATE lt_mail_mode SET mode='fake'")
  self.assertEqual(self.db.execute(self.claim,('one',999,'fake')).fetchall(),[])
 def test_wrong_fence(self):
  self.db.execute("UPDATE lt_mail_mode SET mode='fake'")
  self.db.execute(self.claim,('one',1,'fake')).fetchall()
  self.assertEqual(self.db.execute("UPDATE lt_mail_jobs SET state='sent' WHERE id='application:a' AND fence='two' AND state='leased'").rowcount,0)
 def test_retention_shortens_and_delete_cascades(self):
  self.db.execute("UPDATE lt_outbox SET expires=500000")
  self.assertEqual(self.db.execute('SELECT expires FROM lt_mail_jobs').fetchone()[0],500)
  self.db.execute('DELETE FROM lt_outbox')
  self.assertEqual(self.db.execute('SELECT count(*) FROM lt_mail_jobs').fetchone()[0],0)
 def test_same_worker_delayed_after_claim_does_not_send(self):
  source=(ROOT/'src/runtime.rs').read_text(encoding='utf-8')
  latest=next(q for q in re.findall(r'"([^"\n]+)"',source) if q.startswith('SELECT MIN(j.expires'))
  isolate=next(q for q in re.findall(r'"([^"\n]+)"',source) if q.startswith("UPDATE lt_mail_jobs SET state='uncertain',lease_until=NULL"))
  # 同じworkerがclaimして停止し、別dispatchのlease掃除を一切呼ばずに再開する
  for send_now in [121,122,500]:
   with self.subTest(send_now=send_now):
    self.db.execute("UPDATE lt_mail_jobs SET state='pending',fence=NULL,lease_until=NULL")
    self.db.execute("UPDATE lt_mail_mode SET mode='fake'")
    self.db.execute(self.claim,('one',1,'fake')).fetchall()
    expiry,lease_until=self.db.execute(latest,('application:a','one','fake')).fetchone()
    sent=[]
    if lease_until is None or lease_until<=send_now:
     self.db.execute(isolate,('application:a','one',send_now))
    else:sent.append('fake-send')
    self.assertEqual(sent,[])
    self.assertEqual(self.db.execute('SELECT state,lease_until FROM lt_mail_jobs').fetchone(),('uncertain',None))
  # 実装がclaim時刻nowではなく再照会後のclock.now()を使用することも確認する
  self.assertLess(source.index('let latest='),source.index('let send_now = clock.now();'))
  self.assertLess(source.index('until <= send_now'),source.index('let outcome = match t'))
 def test_before_lease_boundary_remains_sendable_and_other_fence_is_safe(self):
  source=(ROOT/'src/runtime.rs').read_text(encoding='utf-8')
  isolate=next(q for q in re.findall(r'"([^"\n]+)"',source) if q.startswith("UPDATE lt_mail_jobs SET state='uncertain',lease_until=NULL"))
  self.db.execute("UPDATE lt_mail_mode SET mode='fake'")
  self.db.execute(self.claim,('one',1,'fake')).fetchall()
  self.assertEqual(self.db.execute(isolate,('application:a','one',120)).rowcount,0)
  self.assertEqual(self.db.execute(isolate,('application:a','other',121)).rowcount,0)
  self.assertEqual(self.db.execute('SELECT state FROM lt_mail_jobs').fetchone()[0],'leased')
if __name__=='__main__':unittest.main()
