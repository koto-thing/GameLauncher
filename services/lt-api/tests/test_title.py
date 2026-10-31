"""実際の保存SQLと全DBトリガーでタイトル変更の境界を検証する"""
import json
from pathlib import Path
import re
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]


class TitleTests(unittest.TestCase):
    def setUp(self):
        """全スキーマと承認済みの架空申請を用意する

        Returns:
            なし
        """
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        for path in sorted((ROOT / "migrations").glob("*.sql")):
            self.db.executescript(path.read_text(encoding="utf-8"))
        self.db.execute("INSERT INTO lt_events(id,state,public_opens_at) VALUES('event-demo','scheduled',0)")
        self.original = json.loads((ROOT.parents[1] / "contracts/lt/application.fixture.json").read_text(encoding="utf-8"))
        self.original["published"]["id"] = self.original["id"]
        self.db.execute("INSERT INTO lt_applications(id,event_id,email,version,dto,operation_id,payload_hash) VALUES(?,?,?,?,?,?,?)",
                        (self.original["id"], "event-demo", "speaker@example.invalid", 1, json.dumps(self.original), "initial", "initial"))
        self.db.execute("INSERT INTO lt_approval_receipts VALUES('approved','application-demo','event-demo',1,'operator','hash',NULL)")
        self.db.execute("INSERT INTO lt_public_talks(id,event_id,dto,approval_operation) VALUES(?,?,?,?)",
                        (self.original["id"], "event-demo", json.dumps(self.original["published"]), "approved"))
        self.db.commit()

    def save(self, operator=False, version=1, owner="speaker@example.invalid"):
        """本番と同じSQLで原稿と公開版を更新する

        Args:
            operator: 運営操作の場合はTrue
            version: 更新前の申請版
            owner: 認証済み本人メール
        Returns:
            変更された申請件数
        """
        source = (ROOT / "src/title.rs").read_text(encoding="utf-8")
        statements = re.findall(r'db.prepare\("([^"]+)"\)', source)
        with self.db:
            changed = self.db.execute((ROOT / "src/title.sql").read_text(encoding="utf-8"),
                ("変更後", "application-demo", version, "change", "hash", "operator" if operator else None, None if operator else owner)).rowcount
            self.db.execute(statements[-2], ("application-demo", "change", "hash"))
            self.db.execute(statements[-1], ("application-demo", "change"))
        return changed

    def test_owner_and_operator_update_only_title(self):
        """両権限で公開タイトルを同期し未承認原稿と審査状態を維持する

        Returns:
            なし
        """
        self.assertEqual(self.save(), 1)
        self.assertEqual(self.save(operator=True, version=2), 1)
        saved = json.loads(self.db.execute("SELECT dto FROM lt_applications").fetchone()[0])
        public = json.loads(self.db.execute("SELECT dto FROM lt_public_talks").fetchone()[0])
        expected = self.original | {"version": 3}
        expected["content"] = expected["content"] | {"title": "変更後"}
        expected["published"] = expected["published"] | {"title": "変更後", "version": 3}
        self.assertEqual(saved, expected)
        self.assertEqual(public, expected["published"])
        self.assertEqual(self.db.execute("SELECT count(*) FROM lt_outbox WHERE kind='returned'").fetchone()[0], 0)

    def test_operator_audit_and_receipt(self):
        """変更を審査通知なしで監査記録と再送用記録へ保存する

        Returns:
            なし
        """
        self.assertEqual(self.save(operator=True), 1)
        self.assertEqual(self.db.execute("SELECT action FROM lt_audit").fetchone()[0], "titleChanged")
        self.assertEqual(self.db.execute("SELECT count(*) FROM lt_operator_operations").fetchone()[0], 1)

    def test_wrong_owner_and_stale_version(self):
        """他人の申請と古い版の更新を拒否する

        Returns:
            なし
        """
        self.assertEqual(self.save(owner="other@example.invalid"), 0)
        self.assertEqual(self.save(version=2), 0)
        self.assertEqual(self.save(), 1)
        self.assertEqual(self.save(), 0)

    def test_cancelled_and_expired_event(self):
        """開催中止と保持期限切れの変更を拒否する

        Returns:
            なし
        """
        self.db.execute("UPDATE lt_events SET state='cancelled'")
        self.assertEqual(self.save(), 0)
        self.db.execute("UPDATE lt_events SET state='ended',private_expires=1")
        self.assertEqual(self.save(), 0)

    def test_terminal_application(self):
        """見送りと取り下げ済みの変更を拒否する

        Returns:
            なし
        """
        for state in ["rejected", "withdrawn"]:
            self.db.execute("UPDATE lt_applications SET dto=json_set(dto,'$.review',?)", (state,))
            self.assertEqual(self.save(), 0)


if __name__ == "__main__":
    unittest.main()
