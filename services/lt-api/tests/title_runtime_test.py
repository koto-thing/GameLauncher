"""実Workerで本人と運営のタイトル変更を検証する"""
import unittest

from applicant_runtime_test import request
from operator_runtime_test import operate
from operations_runtime_test import Fixture, mutation


class TitleRuntime(unittest.TestCase):
    def test_owner_and_operator_title(self):
        """承認後のタイトル変更・再送・版競合・公開反映を確認する

        Returns:
            なし
        """
        with Fixture() as fixture:
            event, fields = fixture.create()
            fields['approvalMode'] = 'automatic'
            status, event = operate('/events/' + event['id'], mutation(event['version'], fields), 'PATCH')
            self.assertEqual(status, 200)
            app, cookie, _ = fixture.submit(event['id'])
            self.assertEqual(app['review'], 'approved')
            path = '/api/lt/v1/applications/' + app['id'] + '/title'
            public_path = '/api/lt/v1/events/' + event['id'] + '/talks/' + app['id']

            # 本人の変更はタイトルだけを公開版へ反映し、再送で版を増やさない
            payload = mutation(app['version'], {'title': '本人が変更したタイトル'})
            status, saved, _ = request(path, payload, cookie)
            self.assertEqual(status, 200)
            self.assertEqual(request(path, payload, cookie)[1], saved)
            self.assertEqual(saved['review'], 'approved')
            self.assertEqual(saved['published']['startsAt'], app['published']['startsAt'])
            self.assertEqual(request(public_path)[1]['title'], payload['data']['title'])
            self.assertEqual(request(path, mutation(app['version'], {'title': '競合'}), cookie)[0], 409)
            self.assertEqual(request(path, mutation(saved['version'], {'title': '  '}), cookie)[0], 422)

            # 運営側の変更後も本人の取得結果と公開版が一致する
            payload = mutation(saved['version'], {'title': '運営が変更したタイトル'})
            status, updated = operate('/applications/' + app['id'] + '/title', payload)
            self.assertEqual(status, 200)
            self.assertEqual(operate('/applications/' + app['id'] + '/title', payload)[1], updated)
            self.assertEqual(request(public_path)[1]['title'], payload['data']['title'])
            self.assertEqual(request('/api/lt/v1/applications/' + app['id'], cookie=cookie)[1]['content']['title'], payload['data']['title'])


if __name__ == '__main__':
    unittest.main()
