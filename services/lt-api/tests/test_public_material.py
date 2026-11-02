"""公開発表の実SQLで資料の表示・差し替え・非公開境界を検証する"""
import json
import unittest

import test_presentation


class PublicMaterialTests(unittest.TestCase):
    def setUp(self):
        """承認済み発表と固定時刻を用意する

        Returns:
            なし
        """
        test_presentation.PresentationTests.setUp(self)
        self.db.execute("UPDATE lt_events SET publish_enabled=1")
        self.db.execute("UPDATE lt_clock SET now_ms=1793491200000 WHERE id=1")
        self.db.execute("UPDATE lt_applications SET dto=json_set(dto,'$.review','approved','$.withdrawal','none','$.retentionExpiresAt',NULL,'$.materialUrl','https://example.com/first')")
        self.query = (test_presentation.ROOT / 'src/public_talk.sql').read_text(encoding='utf-8')

    def read(self):
        """実装と同じSQLで対象の公開発表と資料を取得する

        Returns:
            公開原稿と資料URLの行、非公開ならNone
        """
        return self.db.execute(self.query, ('event-demo', self.original['id'])).fetchone()

    def test_replace_and_remove(self):
        """差し替えと削除を次の公開取得へ反映する

        Returns:
            なし
        """
        self.assertEqual(self.read()[1], 'https://example.com/first')
        self.assertNotIn('representativeEmail', json.loads(self.read()[0]))
        for url in ['https://example.com/replaced', '']:
            self.db.execute("UPDATE lt_applications SET dto=json_set(dto,'$.materialUrl',?)", (url,))
            self.assertEqual(self.read()[1], url)

    def test_private_states(self):
        """未承認・辞退・期限切れ資料と非公開開催を一般向けに返さない

        Returns:
            なし
        """
        for field, value in [('review', 'returned'), ('withdrawal', 'confirmed'), ('retentionExpiresAt', '2000-01-01T00:00:00.000Z')]:
            with self.subTest(field=field):
                self.db.execute('SAVEPOINT boundary')
                self.db.execute("UPDATE lt_applications SET dto=json_set(dto,?,?)", ('$.' + field, value))
                self.assertIsNone(self.read()[1])
                self.db.execute('ROLLBACK TO boundary')
                self.db.execute('RELEASE boundary')
        self.db.execute('UPDATE lt_events SET private_expires=1')
        self.assertIsNone(self.read()[1])
        self.db.execute('UPDATE lt_events SET publish_enabled=0')
        self.assertIsNone(self.read())


if __name__ == '__main__':
    unittest.main()
