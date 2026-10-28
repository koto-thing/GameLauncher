"""実WorkerとD1で自動承認の公開・競合・手動切替を検証する"""
import concurrent.futures
import unittest

import applicant_runtime_test as applicants
from applicant_runtime_test import request, sql
from operator_runtime_test import operate
from operations_runtime_test import Fixture, mutation, block


class AutomaticApprovalRuntime(unittest.TestCase):
    """自動承認を通常の本人APIから検証する"""

    def create(self, fixture, capacity=4):
        """開催回を自動承認へ設定する

        Args:
            fixture: 後処理を担当する開催fixture
            capacity: 募集可能な発表数
        Returns:
            更新済み開催回と設定値
        """
        event, fields = fixture.create(capacity)
        fields['approvalMode'] = 'automatic'
        status, event = operate('/events/' + event['id'], mutation(event['version'], fields), 'PATCH')
        self.assertEqual(status, 200)
        return event, fields

    def test_publish_once_and_keep_resubmission_manual(self):
        """初回公開と再送を確認し、再提出は運営確認待ちに保つ

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, _ = self.create(fixture)
            app, cookie, body = fixture.submit(event['id'])
            self.assertEqual(app['review'], 'approved')
            self.assertTrue(app['everApproved'])
            self.assertTrue(app['slotReserved'])
            self.assertEqual(app['published']['startsAt'], event['startsAt'])
            self.assertEqual(request('/api/lt/v1/applications', body, cookie)[1], app)
            public_path = '/api/lt/v1/events/' + event['id'] + '/talks/' + app['id']
            self.assertEqual(request(public_path)[1], app['published'])
            notices = sql("SELECT kind FROM lt_outbox WHERE application_id='" + app['id'] + "'")
            self.assertEqual(notices, [{'kind': 'approved'}])

            # 公開後の直接編集は拒否し、差し戻し後だけ編集と再提出を許す
            path = '/api/lt/v1/applications/' + app['id']
            edit = {'content': body['content'] | {'title': '再確認する内容'}, 'materialUrl': body['materialUrl']}
            self.assertEqual(request(path, mutation(app['version'], edit), cookie, 'PATCH')[0], 409)
            status, returned = operate('/applications/' + app['id'] + '/return', mutation(app['version']))
            self.assertEqual(status, 200)
            edited = request(path, mutation(returned['version'], edit), cookie, 'PATCH')[1]
            submitted = request(path + '/resubmit', mutation(edited['version']), cookie)[1]
            self.assertEqual(submitted['review'], 'resubmitted')
            self.assertEqual(request(public_path)[1], app['published'])

    def test_insert_before_closing_and_preserve_duration(self):
        """閉会前へ連続配置し、閉会時間と公開時間割を一致させる

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, _ = self.create(fixture)
            blocks = [block('opening', 'opening', '00', '05'), block('closing', 'closing', '05', '10')]
            self.assertEqual(operate('/events/' + event['id'] + '/timetable', mutation(1, {'expectedEventVersion': event['version'], 'blocks': blocks}), 'PUT')[0], 200)
            first, _, _ = fixture.submit(event['id'])
            second, _, _ = fixture.submit(event['id'])
            self.assertEqual(first['published']['startsAt'], '2026-11-01T01:05:00.000Z')
            self.assertEqual(second['published']['startsAt'], '2026-11-01T01:20:00.000Z')
            table = operate('/events/' + event['id'] + '/timetable')[1]['blocks']
            self.assertEqual([b['kind'] for b in table], ['opening', 'talk', 'transition', 'talk', 'transition', 'closing'])
            self.assertEqual(table[-1]['startsAt'], '2026-11-01T01:35:00.000Z')
            self.assertEqual(table[-1]['endsAt'], '2026-11-01T01:40:00.000Z')
            self.assertEqual(request('/api/lt/v1/events/' + event['id'])[1]['schedule'], table)

    def test_last_slot_race_and_same_operation(self):
        """最後の枠への競合と同一操作の再送で副作用を一度に抑える

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, _ = self.create(fixture, 1)
            helper = applicants.ApplicantRuntime()
            cookies = [helper.login()[0] for _ in range(2)]
            bodies = [helper.payload() | {'eventId': event['id']} for _ in cookies]
            with concurrent.futures.ThreadPoolExecutor() as pool:
                futures = [pool.submit(request, '/api/lt/v1/applications', body, cookie) for body, cookie in zip(bodies, cookies)]
                results = [future.result() for future in futures]
            self.assertEqual(sorted(r[0] for r in results), [200, 409])
            winner = next(i for i, result in enumerate(results) if result[0] == 200)
            app = results[winner][1]
            with concurrent.futures.ThreadPoolExecutor() as pool:
                futures = [pool.submit(request, '/api/lt/v1/applications', bodies[winner], cookies[winner]) for _ in range(2)]
                self.assertTrue(all(f.result()[1] == app for f in futures))
            self.assertEqual(sql("SELECT reserved FROM lt_recruitment WHERE event_id='" + event['id'] + "'")[0]['reserved'], 1)
            for table in ['lt_applications', 'lt_public_talks', 'lt_approval_receipts']:
                self.assertEqual(sql("SELECT count(*) AS n FROM " + table + " WHERE event_id='" + event['id'] + "'")[0]['n'], 1)
            self.assertEqual(sql("SELECT count(*) AS n FROM lt_audit WHERE application_id='" + app['id'] + "'")[0]['n'], 1)

    def test_switch_does_not_publish_waiting_applications(self):
        """切替前の審査待ちと切替後の自動承認を区別する

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, fields = fixture.create()
            pending, _, _ = fixture.submit(event['id'])
            self.assertEqual(pending['review'], 'pending')
            fields['approvalMode'] = 'automatic'
            self.assertEqual(operate('/events/' + event['id'], mutation(event['version'], fields), 'PATCH')[0], 200)
            approved, _, _ = fixture.submit(event['id'])
            self.assertEqual(approved['review'], 'approved')
            self.assertEqual(operate('/applications/' + pending['id'])[1]['review'], 'pending')

    def test_concurrent_first_submission_with_zero_transition(self):
        """同時初回送信を一度だけ承認し、0分転換も保存する

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, fields = self.create(fixture)
            fields['transitionMinutes'] = 0
            self.assertEqual(operate('/events/' + event['id'], mutation(event['version'], fields), 'PATCH')[0], 200)
            helper = applicants.ApplicantRuntime()
            cookie, _ = helper.login()
            body = helper.payload() | {'eventId': event['id']}
            with concurrent.futures.ThreadPoolExecutor() as pool:
                futures = [pool.submit(request, '/api/lt/v1/applications', body, cookie) for _ in range(2)]
                results = [future.result() for future in futures]
            self.assertEqual([r[0] for r in results], [200, 200])
            self.assertEqual(results[0][1], results[1][1])
            table = operate('/events/' + event['id'] + '/timetable')[1]['blocks']
            self.assertEqual(len(table), 2)
            self.assertEqual(table[1]['startsAt'], table[1]['endsAt'])
            self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE application_id='" + results[0][1]['id'] + "'")[0]['n'], 1)


if __name__ == '__main__':
    unittest.main()
