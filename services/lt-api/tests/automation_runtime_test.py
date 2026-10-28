"""実Workerで資料・相対締切・通知・キャンセル待ちを検証する"""
import unittest
import uuid
import urllib.request
import applicant_runtime_test as applicants
from applicant_runtime_test import request, sql, OPERATOR_BASE
from operator_runtime_test import operate
from operations_runtime_test import Fixture, mutation, prepared


class AutomationRuntime(unittest.TestCase):
    """運営自動化の原子的な更新と本人境界を検証する"""

    @classmethod
    def setUpClass(cls):
        """実メールを送らないローカル配送を有効にする

        Returns:
            戻り値なし
        """
        sql("UPDATE lt_mail_mode SET mode='fake' WHERE id=1")

    def test_material_owner_review_and_replay(self):
        """未提出受付、所有者制限、確認後の差し替えと再送を検証する

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, _ = fixture.create()
            helper = applicants.ApplicantRuntime()
            cookie, _ = helper.login()
            other, _ = helper.login()
            body = helper.payload() | {'eventId': event['id'], 'materialUrl': ''}
            status, app, _ = request('/api/lt/v1/applications', body, cookie)
            self.assertEqual(status, 200)
            path = '/api/lt/v1/applications/' + app['id'] + '/material'
            payload = mutation(app['version'], {'materialUrl': 'https://example.invalid/material-v1'})
            self.assertEqual(request(path, payload, other)[0], 404)
            status, submitted, _ = request(path, payload, cookie)
            self.assertEqual(status, 200)
            self.assertFalse(submitted['materialReviewed'])
            self.assertEqual(request(path, payload, cookie)[1], submitted)
            check = mutation(submitted['version'], {'materialUrl': submitted['materialUrl']})
            status, checked = operate('/applications/' + app['id'] + '/material', check)
            self.assertEqual(status, 200)
            self.assertTrue(checked['materialReviewed'])
            self.assertEqual(operate('/applications/' + app['id'] + '/material', check)[1], checked)
            status, changed, _ = request(path, mutation(checked['version'], {'materialUrl': 'https://example.invalid/material-v2'}), cookie)
            self.assertEqual(status, 200)
            self.assertFalse(changed['materialReviewed'])
            self.assertEqual(request(path, mutation(changed['version'], {'materialUrl': 'javascript:alert(1)'}), cookie)[0], 422)

    def test_relative_deadlines_copy_and_reminder_once(self):
        """相対設定の保存・コピーと対象限定リマインドの重複防止を確認する

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, fields = fixture.create()
            plan = {'relativeRecruitment': True, 'opensDaysBefore': 28, 'closesDaysBefore': 0, 'materialDaysBefore': 3, 'reminderDaysBefore': 1}
            status, event = operate('/events/' + event['id'], mutation(event['version'], fields | {'planning': plan}), 'PATCH')
            self.assertEqual(status, 200)
            self.assertEqual(event['opensAt'], '2026-10-04T01:00:00.000Z')
            self.assertEqual(event['closesAt'], event['startsAt'])
            app, cookie, _ = fixture.submit(event['id'])
            status, copied = operate('/events/' + event['id'] + '/copy', mutation(event['version']))
            self.assertEqual(status, 200)
            fixture.ids.append(copied['id'])
            self.assertEqual(copied['planning'], plan)
            self.assertFalse(copied['publishEnabled'])
            with urllib.request.urlopen(urllib.request.Request(OPERATOR_BASE + '/test/clock', data=b'2026-10-28T02:00:00.000Z', method='POST')):
                pass
            try:
                request('/api/lt/v1/applications', cookie=cookie)
                request('/api/lt/v1/applications', cookie=cookie)
                rows = sql("SELECT id FROM lt_outbox WHERE application_id='" + app['id'] + "' AND kind='materialReminder'")
                self.assertEqual(len(rows), 1)
                current = operate('/applications/' + app['id'])[1]
                self.assertEqual(operate('/applications/' + app['id'] + '/material', mutation(current['version'], {'materialUrl': current['materialUrl']}))[0], 200)
                request('/api/lt/v1/applications', cookie=cookie)
                rows = sql("SELECT count(*) AS n FROM lt_outbox WHERE application_id='" + app['id'] + "' AND kind='materialReminder' AND expires>(SELECT now_ms FROM lt_clock WHERE id=1)")
                self.assertEqual(rows[0]['n'], 0)
            finally:
                with urllib.request.urlopen(urllib.request.Request(OPERATOR_BASE + '/test/clock', data=b'real', method='POST')):
                    pass

    def test_waitlist_requires_opt_in_and_does_not_reserve(self):
        """満枠で明示登録した申請だけを待機させ、枠と公開版を増やさない

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, fields = fixture.create(1)
            status, event = operate('/events/' + event['id'], mutation(event['version'], fields | {'approvalMode': 'automatic'}), 'PATCH')
            self.assertEqual(status, 200)
            first, _, _ = fixture.submit(event['id'])
            helper = applicants.ApplicantRuntime()
            cookie, _ = helper.login()
            body = helper.payload() | {'eventId': event['id']}
            self.assertEqual(request('/api/lt/v1/applications', body, cookie)[0], 409)
            body |= {'operationId': uuid.uuid4().hex, 'joinWaitlist': True}
            status, waiting, _ = request('/api/lt/v1/applications', body, cookie)
            self.assertEqual(status, 200)
            self.assertTrue(waiting['waitlisted'])
            self.assertFalse(waiting['slotReserved'])
            self.assertIsNone(waiting['published'])
            self.assertEqual(request('/api/lt/v1/applications', body, cookie)[1], waiting)
            self.assertEqual(sql("SELECT reserved FROM lt_recruitment WHERE event_id='" + event['id'] + "'")[0]['reserved'], 1)
            self.assertEqual(operate('/events/' + event['id'] + '/timetable')[1]['blocks'][0]['talkId'], first['id'])

    def test_schedule_notifications_are_changed_only_and_idempotent(self):
        """時刻が変わる申請だけに確定単位で通知する

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, apps, blocks = prepared(fixture)
            notices = sql("SELECT count(*) AS n FROM lt_outbox WHERE kind='scheduleChanged' AND application_id IN (SELECT id FROM lt_applications WHERE event_id='" + event['id'] + "')")
            self.assertEqual(notices[0]['n'], 2)
            table = operate('/events/' + event['id'] + '/timetable')[1]
            # 閉会だけを延長しても発表者の時刻変更通知は発生しない
            extended = [dict(block) for block in blocks]
            extended[-1]['endsAt'] = '2026-11-01T01:45:00.000Z'
            payload = mutation(table['version'], {'expectedEventVersion': table['eventVersion'], 'blocks': extended})
            status, saved = operate('/events/' + event['id'] + '/timetable', payload, 'PUT')
            self.assertEqual(status, 200)
            self.assertEqual(operate('/events/' + event['id'] + '/timetable', payload, 'PUT')[1], saved)
            self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE operation_id='" + payload['operationId'] + "' AND kind='scheduleChanged'")[0]['n'], 0)


if __name__ == '__main__':
    unittest.main()
