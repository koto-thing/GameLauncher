import copy
import json
import unittest
from operator_cpu_parser import select_event, correlate

ID = '00000000-0000-4000-8000-000000000001'
OTHER = '00000000-0000-4000-8000-000000000002'


class OperatorCollector(unittest.TestCase):
    def fixture(self, source, request_id=ID):
        if source == 'proxy':
            logs = [{'ltOperatorProxy':True,'requestId':request_id,'status':200,'dispatched':True}]
            event = {'request':{'url':'https://admin.example.invalid/api/lt/v1/operator/events/private-id?token=PRIVATE_TOKEN',
                                'method':'PATCH','headers':{'cookie':'PRIVATE_COOKIE'}},'response':{'status':200}}
        else:
            logs = [{'ltCpuProbe':True,'route':'operator-rpc','requestId':request_id,'firstInIsolate':False,'callsRust':True},
                    {'ltOperatorRpc':True,'requestId':request_id,'status':200}]
            event = {'rpcMethod':'operate'}
        return dict(logs=[{'message':[json.dumps(log)]} for log in logs], event=event,
                    scriptVersion={'id':source+'-version'},cpuTime=2,wallTime=30,eventTimestamp=1,outcome='ok')

    def selected(self, source, request_id=ID):
        return select_event(self.fixture(source,request_id),source,source+'-version')

    def test_exact_id_pair_never_persists_secrets_or_parameter_ids(self):
        result=correlate([self.selected('proxy')],[self.selected('rpc')])
        self.assertEqual(result[0]['requestId'],ID)
        self.assertEqual(result[0]['proxy']['routeTemplate'],'/api/lt/v1/operator/events/:id')
        self.assertNotIn('PRIVATE',json.dumps(result))
        self.assertNotIn('private-id',json.dumps(result))

    def test_same_route_time_and_status_do_not_join_different_ids(self):
        with self.assertRaises(ValueError):
            correlate([self.selected('proxy')],[self.selected('rpc',OTHER)])

    def test_duplicate_missing_or_orphan_is_rejected(self):
        p,r=self.selected('proxy'),self.selected('rpc')
        for parents,children in [([p,p],[r]),([p],[r,r]),([p],[]),([],[r])]:
            with self.assertRaises(ValueError):correlate(parents,children)

    def test_wrong_version_method_or_marker_id_is_rejected(self):
        with self.assertRaises(ValueError):select_event(self.fixture('rpc'),'rpc','wrong-version')
        event=self.fixture('rpc');event['event']['rpcMethod']='fetch'
        with self.assertRaises(ValueError):select_event(event,'rpc','rpc-version')
        event=self.fixture('rpc');event['logs'][1]['message']=[json.dumps({'ltOperatorRpc':True,'requestId':OTHER,'status':200})]
        with self.assertRaises(ValueError):select_event(event,'rpc','rpc-version')

    def test_pre_rpc_rejection_is_separate_not_missing_rpc(self):
        event=self.fixture('proxy');event['event']['response']['status']=403
        event['logs'][0]['message']=[json.dumps({'ltOperatorProxy':True,'requestId':ID,'status':403,'dispatched':False})]
        parent=select_event(event,'proxy','proxy-version')
        self.assertIsNone(correlate([parent],[])[0]['rpc'])
        with self.assertRaises(ValueError):correlate([parent],[self.selected('rpc')])

    def test_cpu_termination_is_retained_without_result_marker(self):
        event=self.fixture('rpc');event['logs']=event['logs'][:1];event['outcome']='exceededCpu';event['cpuTime']=40
        child=select_event(event,'rpc','rpc-version')
        parent=self.selected('proxy');parent['status']=503
        result=correlate([parent],[child])
        self.assertEqual(result[0]['rpc']['outcome'],'exceededCpu')
        self.assertFalse(result[0]['rpc']['resultMarkerPresent'])

    def test_ok_without_result_or_status_disagreement_fails(self):
        event=self.fixture('rpc');event['logs']=event['logs'][:1]
        with self.assertRaises(ValueError):select_event(event,'rpc','rpc-version')
        parent=self.selected('proxy');parent['status']=409
        with self.assertRaises(ValueError):correlate([parent],[self.selected('rpc')])

    def test_expected_manifest_does_not_accept_absent_ids(self):
        with self.assertRaises(ValueError):correlate([self.selected('proxy')],[self.selected('rpc')],[OTHER])


if __name__ == '__main__':unittest.main()
