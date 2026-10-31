"""実Workerで本人と運営のタイトル・概要変更を検証する"""
import unittest

from applicant_runtime_test import request
from operator_runtime_test import operate
from operations_runtime_test import Fixture, mutation
from lifecycle_runtime_test import clock
import applicant_runtime_test as applicants


class PresentationRuntime(unittest.TestCase):
    def test_owner_and_operator_presentation(self):
        """承認後の概要変更・再送・版競合・所有権・公開反映を確認する

        Returns:
            なし
        """
        clock('2026-10-25T12:00:00.000Z')
        self.addCleanup(clock, 'real')
        with Fixture() as fixture:
            event, fields = fixture.create()
            fields['approvalMode'] = 'automatic'
            status, event = operate('/events/' + event['id'], mutation(event['version'], fields), 'PATCH')
            self.assertEqual(status, 200)
            app, cookie, _ = fixture.submit(event['id'])
            self.assertEqual(app['review'], 'approved')
            path = '/api/lt/v1/applications/' + app['id'] + '/presentation'
            public_path = '/api/lt/v1/events/' + event['id'] + '/talks/' + app['id']

            # 概要だけの変更でもタイトルと時間割を維持し、再送で版を増やさない
            payload = mutation(app['version'], {'title': app['content']['title'], 'abstract': '本人が変更した概要\n2行目'})
            other_cookie, _ = applicants.ApplicantRuntime().login()
            self.assertEqual(request(path, payload, other_cookie)[0], 404)
            status, saved, _ = request(path, payload, cookie)
            self.assertEqual(status, 200)
            self.assertEqual(request(path, payload, cookie)[1], saved)
            self.assertEqual(saved['review'], 'approved')
            self.assertEqual(saved['published']['startsAt'], app['published']['startsAt'])
            self.assertEqual(request(public_path)[1]['title'], payload['data']['title'])
            self.assertEqual(request(public_path)[1]['abstract'], payload['data']['abstract'])
            self.assertEqual(request(path, mutation(app['version'], payload['data'] | {'abstract': '競合'}), cookie)[0], 409)
            for invalid in [{'title': '  ', 'abstract': '概要'}, {'title': 'タイトル', 'abstract': ' \n '}, {'title': '概要なし'}]:
                self.assertEqual(request(path, mutation(saved['version'], invalid), cookie)[0], 422)

            # 運営側の変更後も本人の取得結果と公開版が一致する
            payload = mutation(saved['version'], {'title': '運営が変更したタイトル', 'abstract': '運営が変更した概要\n2行目'})
            status, updated = operate('/applications/' + app['id'] + '/presentation', payload)
            self.assertEqual(status, 200)
            self.assertEqual(operate('/applications/' + app['id'] + '/presentation', payload)[1], updated)
            self.assertEqual(request(public_path)[1]['title'], payload['data']['title'])
            self.assertEqual(request(public_path)[1]['abstract'], payload['data']['abstract'])
            self.assertEqual(request('/api/lt/v1/applications/' + app['id'], cookie=cookie)[1]['content']['title'], payload['data']['title'])
            self.assertEqual(request('/api/lt/v1/applications/' + app['id'], cookie=cookie)[1]['content']['abstract'], payload['data']['abstract'])


if __name__ == '__main__':
    unittest.main()
