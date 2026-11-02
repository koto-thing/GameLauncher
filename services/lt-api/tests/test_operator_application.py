"""本番の申請編集SQLとDBトリガーで公開・排他・監査の境界を検証する"""
import copy
import json
import re
import unittest

import test_presentation

ROOT = test_presentation.ROOT


class OperatorApplicationTests(unittest.TestCase):
    def setUp(self):
        """共有fixtureで承認済みの架空申請を用意する

        Returns:
            なし
        """
        test_presentation.PresentationTests.setUp(self)

    def save(self, version=1):
        """現在の原稿を編集し本番と同じSQLで保存する

        Args:
            version: 更新前の申請版
        Returns:
            更新した申請件数
        """
        dto = json.loads(self.db.execute("SELECT dto FROM lt_applications").fetchone()[0])
        dto['content'] = {'title': '更新後', 'abstract': '概要', 'speakers': [
            {'displayName': '登壇者A', 'affiliation': '所属', 'profile': '紹介'},
            {'displayName': '登壇者B', 'links': [{'label': 'Web', 'url': 'https://example.invalid'}]},
        ]}
        dto.update(version=version+1, materialUrl='https://example.invalid/new', materialReviewedUrl='')
        if dto['published']:
            dto['published'] = dto['content'] | {key: dto['published'][key] for key in ['id', 'eventId', 'startsAt', 'endsAt', 'cancelled']} | {'version': version+1}
            # 読取後に時間割が変わっても、古い時刻を保存しない
            dto['published']['startsAt'] = '2000-01-01T00:00:00.000Z'
        statements = re.findall(r'db.prepare\("([^"]+)"\)', (ROOT/'src/operator_application.rs').read_text(encoding='utf-8'))
        with self.db:
            changed = self.db.execute((ROOT/'src/operator_application.sql').read_text(encoding='utf-8'),
                (json.dumps(dto), 'edit', 'hash', 'operator', dto['id'], version)).rowcount
            self.db.execute(statements[-1], (dto['id'], 'operator', 'edit', 'hash', version+1))
        return changed

    def test_complete_edit(self):
        """登壇者全体を公開反映し、時間割・審査・代表者を維持する

        Returns:
            なし
        """
        self.assertEqual(self.save(), 1)
        saved = json.loads(self.db.execute('SELECT dto FROM lt_applications').fetchone()[0])
        public = json.loads(self.db.execute('SELECT dto FROM lt_public_talks').fetchone()[0])
        self.assertEqual(saved['content']['speakers'], public['speakers'])
        self.assertEqual(public['startsAt'], self.original['published']['startsAt'])
        self.assertNotIn('description', public)
        self.assertNotIn('session', public)
        self.assertNotIn('materialUrl', public)
        for key in ['review', 'withdrawal', 'representativeEmail', 'retentionExpiresAt', 'slotReserved']:
            self.assertEqual(saved[key], self.original[key])
        self.assertEqual(self.db.execute('SELECT count(*) FROM lt_operator_operations').fetchone()[0], 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM lt_audit').fetchone()[0], 1)
        self.assertEqual(self.save(), 0)

    def test_unpublished_and_no_notification(self):
        """未承認の編集は公開せず審査通知を再送しない

        Returns:
            なし
        """
        self.db.execute('DELETE FROM lt_public_talks')
        self.db.execute("UPDATE lt_applications SET dto=json_set(dto,'$.published',NULL,'$.review','returned')")
        self.assertEqual(self.save(), 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM lt_public_talks').fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM lt_outbox WHERE kind='returned'").fetchone()[0], 0)

    def test_invalid_states_and_versions(self):
        """古い版・辞退・見送り・中止・保持期限切れでは保存しない

        Returns:
            なし
        """
        self.assertEqual(self.save(version=2), 0)
        for key, value in [('review', 'rejected'), ('review', 'withdrawn'), ('withdrawal', 'confirmed'), ('retentionExpiresAt', '2000-01-01T00:00:00.000Z')]:
            dto = copy.deepcopy(self.original)
            dto[key] = value
            self.db.execute('UPDATE lt_applications SET dto=?', (json.dumps(dto),))
            self.assertEqual(self.save(), 0)
        self.db.execute('UPDATE lt_applications SET dto=?', (json.dumps(self.original),))
        self.db.execute("UPDATE lt_events SET state='cancelled'")
        self.assertEqual(self.save(), 0)


if __name__ == '__main__':
    unittest.main()
