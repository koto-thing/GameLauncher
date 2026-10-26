"""架空 tail fixture のみで収集・照合を検証する。"""
import copy
import json
import unittest
from cpu_tail_parser import TailParser, match_event


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.event = {'event': {'request': {'url': 'https://example.invalid/api/lt/v1/events?lt_cpu_probe=fixture&lt_cpu_seq=1'}, 'response': {'status': 200}},
                      'scriptVersion': {'id': 'fixture-version'}, 'cpuTime': 4, 'wallTime': 40,
                      'logs': [{'message': [json.dumps({'ltCpuProbe': True, 'firstInIsolate': True, 'probe':'fixture','sequence':1})]}], 'eventTimestamp': 1}

    def test_pretty_array_ndjson_and_notices(self):
        for serialized in (json.dumps(self.event, indent=2), json.dumps([self.event], indent=2), json.dumps(self.event)+'\n'+json.dumps(self.event)):
            parser = TailParser()
            self.assertEqual(parser.feed('Connected to tail\n'), [])
            values = []
            for line in serialized.splitlines(True):
                values.extend(parser.feed(line))
            self.assertGreaterEqual(len(values), 1)
            self.assertEqual(match_event(values[0], 'fixture', 'fixture-version')['cpuTimeMs'], 4)

    def test_unrelated_request_never_inferred(self):
        self.assertIsNone(match_event(self.event, 'another', 'fixture-version'))
        event = copy.deepcopy(self.event)
        event['event']['request']['url'] = 'https://example.invalid/api/lt/v1/events'
        self.assertEqual(match_event(event, 'fixture', 'fixture-version')['sequence'], 1)

    def test_wrong_version_or_missing_metric_or_marker_fails(self):
        for field in ('scriptVersion', 'cpuTime', 'logs', 'eventTimestamp'):
            event = copy.deepcopy(self.event)
            del event[field]
            with self.assertRaises(ValueError):
                match_event(event, 'fixture', 'fixture-version')


if __name__ == '__main__':
    unittest.main()
