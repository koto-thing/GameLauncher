"""Rustが使用するSQLをSQLiteで実行しclaimとfenceを検証する"""
import json,re,sqlite3,unittest,tempfile,threading,concurrent.futures
from pathlib import Path
ROOT=Path(__file__).parents[1]
class ClaimTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute("CREATE TABLE lt_outbox(id TEXT PRIMARY KEY,recipient TEXT,kind TEXT,state TEXT,expires INTEGER)")
  self.db.executescript((ROOT/'proposals/outbox-dispatch.sql').read_text(encoding='utf-8'))
  self.db.execute("INSERT INTO lt_outbox VALUES('a','fixture@example.invalid','approved','pending',999000)")
  self.db.execute("INSERT INTO lt_mail_jobs(id,envelope,expires) VALUES('a','{}',999)")
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
  self.assertEqual(self.db.execute("UPDATE lt_mail_jobs SET state='sent' WHERE id='a' AND fence='two' AND state='leased'").rowcount,0)
 def test_retention_shortens_and_delete_cascades(self):
  self.db.execute("UPDATE lt_outbox SET expires=500000")
  self.assertEqual(self.db.execute('SELECT expires FROM lt_mail_jobs').fetchone()[0],500)
  self.db.execute('DELETE FROM lt_outbox')
  self.assertEqual(self.db.execute('SELECT count(*) FROM lt_mail_jobs').fetchone()[0],0)
if __name__=='__main__':unittest.main()
