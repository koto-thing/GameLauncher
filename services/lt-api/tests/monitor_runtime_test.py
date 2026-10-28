"""実Workerの要対応判定と非公開境界を確認する"""
import json
import unittest
from applicant_runtime_test import request, sql
from operator_runtime_test import operate
from operations_runtime_test import Fixture, mutation


class MonitorRuntime(unittest.TestCase):
    """対応済み除外とheartbeatの読み取り専用性を検証する"""

    def test_material_deadline_and_read_only_heartbeat(self):
        """期限超過だけを表示し、資料確認後に消えることを確かめる

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, fields = fixture.create()
            plan = {'relativeRecruitment': False, 'opensDaysBefore': 28, 'closesDaysBefore': 7,
                    'materialDaysBefore': 10, 'reminderDaysBefore': 1}
            self.assertEqual(operate('/events/' + event['id'], mutation(event['version'], fields | {'planning': plan}), 'PATCH')[0], 200)
            app, _, _ = fixture.submit(event['id'])
            before = sql('SELECT * FROM lt_maintenance_status')
            status, monitor = operate('/monitor')
            self.assertEqual(status, 200)
            items = [item for item in monitor['items'] if item['eventId'] == event['id']]
            self.assertEqual([item['reason'] for item in items], ['material'])
            self.assertNotIn('representativeEmail', json.dumps(monitor))
            self.assertEqual(sql('SELECT * FROM lt_maintenance_status'), before)
            current = operate('/applications/' + app['id'])[1]
            self.assertEqual(operate('/applications/' + app['id'] + '/material', mutation(current['version'], {'materialUrl': current['materialUrl']}))[0], 200)
            self.assertFalse([item for item in operate('/monitor')[1]['items'] if item['eventId'] == event['id']])
            self.assertEqual(request('/api/lt/v1/operator/monitor')[0], 404)

    def test_withdrawal_and_vacancy_follow_current_state(self):
        """辞退依頼を表示し、確定後は空き枠と待機者がある場合だけ通知する

        Returns:
            戻り値なし
        """
        with Fixture() as fixture:
            event, _ = fixture.create(2)
            first, cookie, _ = fixture.submit(event['id'])
            second, _, _ = fixture.submit(event['id'])
            self.assertEqual(operate('/applications/' + first['id'] + '/approve', mutation(1, {'startsAt': event['startsAt'], 'expectedEventVersion': event['version'], 'expectedScheduleVersion': 1}))[0], 200)
            self.assertEqual(request('/api/lt/v1/applications/' + first['id'] + '/request-withdrawal', mutation(2), cookie)[0], 200)
            items = operate('/monitor')[1]['items']
            self.assertIn('withdrawal:' + first['id'], [item['key'] for item in items])
            sql("UPDATE lt_applications SET dto=json_set(dto,'$.waitlisted',json('true')) WHERE id='" + second['id'] + "'")
            self.assertEqual(operate('/applications/' + first['id'] + '/confirm-withdrawal', mutation(3))[0], 200)
            items = [item for item in operate('/monitor')[1]['items'] if item['eventId'] == event['id']]
            self.assertEqual([item['reason'] for item in items], ['vacancy'])
            sql("UPDATE lt_events SET state='cancelled' WHERE id='" + event['id'] + "'")
            self.assertFalse([item for item in operate('/monitor')[1]['items'] if item['eventId'] == event['id']])


if __name__ == '__main__':
    unittest.main()
