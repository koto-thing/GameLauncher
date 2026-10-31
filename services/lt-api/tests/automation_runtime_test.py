"""実Workerで資料・相対締切・通知・キャンセル待ちを検証する"""
import unittest
import uuid
import urllib.request
import applicant_runtime_test as applicants
from applicant_runtime_test import request, sql, OPERATOR_BASE
from operator_runtime_test import operate
from operations_runtime_test import Fixture, mutation, prepared
import schedule_rules_runtime_test as schedules
from lifecycle_runtime_test import clock


class AutomationRuntime(unittest.TestCase):
    """運営自動化の原子的な更新と本人境界を検証する"""

    def setUp(self):
        """各試験の時計をfixtureの募集期間内に戻す

        Returns:
            戻り値なし
        """
        clock('2026-10-25T12:00:00.000Z')
        self.addCleanup(clock, 'real')

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
            sql("UPDATE lt_applications SET dto=json_set(dto,'$.retentionExpiresAt','2000-01-01T00:00:00.000Z') WHERE id='" + app['id'] + "'")
            self.assertEqual(request(path, mutation(changed['version'], {'materialUrl': ''}), cookie)[0], 410)
            self.assertEqual(sql("SELECT version FROM lt_applications WHERE id='" + app['id'] + "'")[0]['version'], changed['version'])


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
            first, first_cookie, _ = fixture.submit(event['id'])
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
            # 辞退確定後も待機を維持し、運営承認だけで繰り上げる
            status, withdrawn, _ = request('/api/lt/v1/applications/' + first['id'] + '/request-withdrawal', mutation(first['version']), first_cookie)
            self.assertEqual(status, 200)
            self.assertEqual(operate('/applications/' + first['id'] + '/confirm-withdrawal', mutation(withdrawn['version']))[0], 200)
            current = operate('/applications/' + waiting['id'])[1]
            self.assertTrue(current['waitlisted'])
            table = operate('/events/' + event['id'] + '/timetable')[1]
            payload = mutation(current['version'], {'startsAt': event['startsAt'], 'expectedEventVersion': table['eventVersion'], 'expectedScheduleVersion': table['version']})
            status, promoted = operate('/applications/' + waiting['id'] + '/approve', payload)
            self.assertEqual(status, 200, promoted)
            self.assertFalse(promoted['waitlisted'])
            self.assertTrue(promoted['slotReserved'])
            self.assertEqual(operate('/applications/' + waiting['id'] + '/approve', payload)[1], promoted)
            self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE application_id='" + waiting['id'] + "' AND kind='approved'")[0]['n'], 1)


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
            current = operate('/events/' + event['id'])[1]
            fields = {key: value for key, value in current.items() if key not in ['id', 'version', 'state', 'publishEnabled']}
            fields['startsAt'] = '2026-11-01T01:01:00.000Z'
            payload = mutation(current['version'], fields) | {'expectedScheduleVersion': saved['version']}
            status, changed = operate('/events/' + event['id'], payload, 'PATCH')
            self.assertEqual(status, 200, changed)
            self.assertEqual(operate('/events/' + event['id'], payload, 'PATCH')[1], changed)
            self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE operation_id='" + payload['operationId'] + "' AND kind='scheduleChanged'")[0]['n'], 2)


    def test_fixed_closing_and_atomic_conflict(self):
        """固定閉会前への追加と衝突時の全体ロールバックを検証する"""
        with Fixture() as fixture:
            event, fields = schedules.ScheduleRulesRuntime().create(fixture)
            path = '/events/' + event['id']
            table = operate(path + '/timetable')[1]
            blocks = table['blocks']
            blocks[-1].update(startsAt='2026-11-01T01:30:00.000Z', endsAt='2026-11-01T01:35:00.000Z', locked=True)
            status, table = operate(path + '/timetable', mutation(table['version'], {'expectedEventVersion': table['eventVersion'], 'blocks': blocks}), 'PUT')
            self.assertEqual(status, 200, table)
            for _ in range(2): fixture.submit(event['id'])
            table = operate(path + '/timetable')[1]
            self.assertEqual(table['blocks'][-1]['startsAt'], '2026-11-01T01:30:00.000Z')
            public = request('/api/lt/v1/events/' + event['id'])[1]
            self.assertNotIn('locked', public['schedule'][-1])
            helper = applicants.ApplicantRuntime()
            cookie, _ = helper.login()
            status, failure, _ = request('/api/lt/v1/applications', helper.payload() | {'eventId': event['id']}, cookie)
            self.assertEqual((status, failure['error']['code']), (409, 'FIXED_CONFLICT'))
            self.assertEqual(operate(path + '/timetable')[1], table)
            self.assertEqual(sql("SELECT reserved FROM lt_recruitment WHERE event_id='" + event['id'] + "'")[0]['reserved'], 2)
            current = operate(path)[1]
            payload = mutation(current['version'], fields | {'talkMinutes': 20})
            status, failure = operate(path, payload, 'PATCH')
            self.assertEqual((status, failure['error']['code']), (409, 'FIXED_CONFLICT'))
            self.assertEqual(operate(path)[1], current)
            # 確認中に別の時間割保存があれば設定の確定を拒否する
            payload = mutation(current['version'], fields) | {'expectedScheduleVersion': table['version'] - 1}
            self.assertEqual(operate(path, payload, 'PATCH')[0], 409)
            # 手動方式へ切り替えても固定閉会と重なる承認は拒否する
            status, manual = operate(path, mutation(current['version'], fields | {'scheduleMode': 'manual'}), 'PATCH')
            self.assertEqual(status, 200, manual)
            helper = applicants.ApplicantRuntime()
            cookie, _ = helper.login()
            status, failure, _ = request('/api/lt/v1/applications', helper.payload() | {'eventId': event['id']}, cookie)
            self.assertEqual((status, failure['error']['code']), (409, 'FIXED_CONFLICT'))


    def test_fixed_talk_survives_withdrawal_and_notifies(self):
        """辞退で空き時間が生まれても固定発表を維持する"""
        with Fixture() as fixture:
            event, apps, blocks = prepared(fixture)
            path = '/events/' + event['id']
            table = operate(path + '/timetable')[1]
            blocks[3]['locked'] = True
            status, saved = operate(path + '/timetable', mutation(table['version'], {'expectedEventVersion': table['eventVersion'], 'blocks': blocks}), 'PUT')
            self.assertEqual(status, 200, saved)
            first, cookie = apps[0]
            current = operate('/applications/' + first['id'])[1]
            status, pending, _ = request('/api/lt/v1/applications/' + first['id'] + '/request-withdrawal', mutation(current['version']), cookie)
            self.assertEqual(status, 200)
            op = mutation(pending['version'])
            self.assertEqual(operate('/applications/' + first['id'] + '/confirm-withdrawal', op)[0], 200)
            table = operate(path + '/timetable')[1]
            self.assertEqual(table['blocks'][1]['startsAt'], blocks[3]['startsAt'])
            self.assertTrue(table['blocks'][1]['locked'])
            self.assertEqual(sql("SELECT count(*) AS n FROM lt_outbox WHERE kind='scheduleChanged' AND operation_id='" + op['operationId'] + "'")[0]['n'], 0)

    def test_fixed_break_survives_rule_change(self):
        """自動休憩の周期を変更しても固定した休憩は残す"""
        with Fixture() as fixture:
            event, fields = schedules.ScheduleRulesRuntime().create(fixture)
            for _ in range(5): fixture.submit(event['id'])
            path = '/events/' + event['id']
            table = operate(path + '/timetable')[1]
            rest = next(block for block in table['blocks'] if block['kind'] == 'break')
            rest['locked'] = True
            status, saved = operate(path + '/timetable', mutation(table['version'], {'expectedEventVersion': table['eventVersion'], 'blocks': table['blocks']}), 'PUT')
            self.assertEqual(status, 200, saved)
            current = operate(path)[1]
            status, changed = operate(path, mutation(current['version'], fields | {'breakEvery': 5, 'openingMinutes': 0}), 'PATCH')
            self.assertEqual(status, 200, changed)
            result = operate(path + '/timetable')[1]
            self.assertEqual(next(block for block in result['blocks'] if block['id'] == rest['id']), rest)


if __name__ == '__main__':
    unittest.main()
