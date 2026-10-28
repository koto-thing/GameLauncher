"""実WorkerとD1で時間割生成・再配置・終了上限の原子性を検証する"""
import unittest
import uuid

import applicant_runtime_test as applicants
from applicant_runtime_test import request, sql
from operator_runtime_test import operate
from operations_runtime_test import Fixture, mutation


class ScheduleRulesRuntime(unittest.TestCase):
    """開催設定から公開時間割までを通して検証する"""

    def create(self, fixture, **changes):
        """自動承認と自動時間割の開催回を作る

        Args:
            fixture: 後処理を担当する開催fixture
            changes: 初期値を上書きする設定
        Returns:
            作成した開催回と設定
        """
        _, fields = fixture.create()
        sql("UPDATE lt_events SET state='cancelled' WHERE id='" + fixture.ids[-1] + "'")
        fields.update(approvalMode='automatic', scheduleMode='automatic', capacity=9,
                      transitionMinutes=1, openingMinutes=5, closingMinutes=5,
                      breakEvery=4, breakMinutes=10)
        fields.update(changes)
        status, event = operate('/events', fields | {'operationId': uuid.uuid4().hex})
        self.assertEqual(status, 200, event)
        fixture.ids.append(event['id'])
        return event, fields

    def test_break_limit_reorder_withdrawal_and_replay(self):
        """休憩境界と終了上限を守り、並び替えと取り下げを公開へ反映する

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, fields = self.create(fixture, endsBy='2026-11-01T02:15:00.000Z')
            path = '/events/' + event['id']
            self.assertEqual(event['capacity'], 5)
            initial = operate(path + '/timetable')[1]
            self.assertEqual([b['kind'] for b in initial['blocks']], ['opening', 'closing'])
            apps = [fixture.submit(event['id']) for _ in range(5)]
            table = operate(path + '/timetable')[1]
            self.assertEqual(table['blocks'][-1]['endsAt'], fields['endsBy'])
            self.assertEqual([b['kind'] for b in table['blocks']].count('break'), 1)
            self.assertEqual(apps[-1][0]['published']['startsAt'], '2026-11-01T01:59:00.000Z')

            # 定員超過と設定短縮は、公開・設定・申請のどれも途中反映しない
            helper = applicants.ApplicantRuntime()
            cookie, _ = helper.login()
            body = helper.payload() | {'eventId': event['id']}
            status, failure, _ = request('/api/lt/v1/applications', body, cookie)
            self.assertEqual((status, failure['error']['code']), (409, 'SCHEDULE_FULL'))
            current = operate(path)[1]
            for changes in [{'endsBy': '2026-11-01T02:14:59.999Z'}, {'talkMinutes': 11}]:
                status, failure = operate(path, mutation(current['version'], fields | changes), 'PATCH')
                self.assertEqual((status, failure['error']['code']), (409, 'SCHEDULE_FULL'))
                self.assertEqual(operate(path)[1], current)
                self.assertEqual(operate(path + '/timetable')[1], table)

            # 枠の時刻は保ったまま発表の対応を逆順にする
            blocks = [dict(b) for b in table['blocks']]
            reversed_talks = list(reversed([dict(b) for b in blocks if b['kind'] == 'talk']))
            for b, source in zip([b for b in blocks if b['kind'] == 'talk'], reversed_talks):
                b['talkId'] = source['talkId']
            op = mutation(table['version'], {'expectedEventVersion': current['version'], 'blocks': blocks})
            status, saved = operate(path + '/timetable', op, 'PUT')
            self.assertEqual(status, 200, saved)
            self.assertEqual(operate(path + '/timetable', op, 'PUT')[1], saved)
            self.assertEqual(operate(path + '/timetable')[1], saved)
            self.assertEqual(request('/api/lt/v1/events/' + event['id'])[1]['schedule'], saved['blocks'])
            first, cookie, _ = apps[-1]
            self.assertEqual(request('/api/lt/v1/events/' + event['id'] + '/talks/' + first['id'])[1]['startsAt'], '2026-11-01T01:05:00.000Z')

            # 5件から4件へ減ると休憩も消え、閉会まで再配置する
            status, pending, _ = request('/api/lt/v1/applications/' + first['id'] + '/request-withdrawal', mutation(first['version']), cookie)
            self.assertEqual(status, 200, pending)
            status, withdrawn = operate('/applications/' + first['id'] + '/confirm-withdrawal', mutation(pending['version']))
            self.assertEqual(status, 200, withdrawn)
            final = operate(path + '/timetable')[1]
            self.assertNotIn('break', [b['kind'] for b in final['blocks']])
            self.assertEqual(final['blocks'][-1]['endsAt'], '2026-11-01T01:54:00.000Z')

    def test_settings_reflow_copy_and_started_guard(self):
        """設定変更を公開時刻へ反映し、コピーと開始後の制約を保つ

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, fields = self.create(fixture)
            app, _, _ = fixture.submit(event['id'])
            path = '/events/' + event['id']
            current = operate(path)[1]
            fields.update(startsAt='2026-11-01T02:00:00.000Z', talkMinutes=20,
                          transitionMinutes=0, openingMinutes=3, closingMinutes=7)
            op = mutation(current['version'], fields)
            status, updated = operate(path, op, 'PATCH')
            self.assertEqual(status, 200, updated)
            self.assertEqual(operate(path, op, 'PATCH')[1], updated)
            table = operate(path + '/timetable')[1]
            self.assertEqual(table['blocks'][1]['startsAt'], '2026-11-01T02:03:00.000Z')
            self.assertEqual(table['blocks'][-1]['endsAt'], '2026-11-01T02:30:00.000Z')
            public = request('/api/lt/v1/events/' + event['id'] + '/talks/' + app['id'])[1]
            self.assertEqual(public['startsAt'], table['blocks'][1]['startsAt'])
            self.assertEqual(public['endsAt'], table['blocks'][1]['endsAt'])
            status, copy = operate(path + '/copy', mutation(updated['version']))
            self.assertEqual(status, 200, copy)
            fixture.ids.append(copy['id'])
            for key in ['scheduleMode', 'openingMinutes', 'breakEvery', 'breakMinutes', 'closingMinutes']:
                self.assertEqual(copy[key], fields[key])
            sql("UPDATE lt_events SET state='started' WHERE id='" + event['id'] + "'")
            self.assertEqual(operate(path, mutation(updated['version'], fields | {'openingMinutes': 4}), 'PATCH')[0], 409)
            self.assertEqual(operate(path + '/timetable')[1], table)

    def test_manual_approval_uses_closing_slot_and_final_receipt(self):
        """手動承認でも閉会前へ配置し、休憩追加後の時刻を応答へ記録する

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, _ = self.create(fixture, approvalMode='manual', breakEvery=1)
            path = '/events/' + event['id']
            for _ in range(2):
                app, _, _ = fixture.submit(event['id'])
                table = operate(path + '/timetable')[1]
                op = mutation(app['version'], {
                    'startsAt': table['blocks'][-1]['startsAt'],
                    'expectedEventVersion': table['eventVersion'],
                    'expectedScheduleVersion': table['version']})
                status, approved = operate('/applications/' + app['id'] + '/approve', op)
                self.assertEqual(status, 200, approved)
                self.assertEqual(operate('/applications/' + app['id'] + '/approve', op)[1], approved)
                public = request('/api/lt/v1/events/' + event['id'] + '/talks/' + app['id'])[1]
                self.assertEqual(approved['published'], public)
            self.assertEqual(approved['published']['startsAt'], '2026-11-01T01:26:00.000Z')


if __name__ == '__main__':
    unittest.main()
