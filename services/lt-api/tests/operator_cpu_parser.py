"""サーバー生成requestIdで管理HTTPとRPCを照合し、許可した計測値だけを返す。"""
import json
import math
import re
import urllib.parse

UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$', re.I)


def route_template(path):
    prefix = '/api/lt/v1/operator/'
    if not path.startswith(prefix):
        raise ValueError('Unexpected proxy route')
    parts = path[len(prefix):].split('/')
    if parts == ['events']:
        return prefix+'events'
    if len(parts) in (2, 3) and parts[0] == 'events' and parts[1]:
        if len(parts) == 2 or parts[2] in ('copy', 'cancel', 'applications', 'timetable'):
            return prefix+'events/:id'+('/'+parts[2] if len(parts) == 3 else '')
    if len(parts) >= 2 and parts[0] == 'applications' and parts[1]:
        suffix = '/'.join(parts[2:])
        if suffix in ('', 'approve', 'return', 'reapprove', 'hold', 'reject', 'confirm-withdrawal',
                      'email-change', 'email-change/investigate', 'email-change/send-verification', 'email-change/confirm'):
            return prefix+'applications/:id'+('/'+suffix if suffix else '')
    return prefix+':unrecognized'


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def select_event(value, source, version):
    messages = []
    for log in value.get('logs', []):
        for message in log.get('message', []):
            try:
                parsed = json.loads(message)
            except (ValueError, TypeError):
                continue
            if isinstance(parsed, dict):
                messages.append(parsed)
    key = 'ltOperatorProxy' if source == 'proxy' else 'ltOperatorRpc'
    results = [m for m in messages if m.get(key) is True]
    starts = [m for m in messages if m.get('ltCpuProbe') is True and m.get('route') == 'operator-rpc']
    if not results and not (source == 'rpc' and starts):
        return None
    if value.get('scriptVersion', {}).get('id') != version:
        raise ValueError('Unexpected instrumented version')
    if len(results) > 1 or source == 'rpc' and len(starts) != 1:
        raise ValueError('Ambiguous invocation markers')
    outcome = value.get('outcome')
    if not results and outcome == 'ok':
        raise ValueError('Successful RPC lacks result marker')
    result = results[0] if results else starts[0]
    request_id = result.get('requestId')
    if not isinstance(request_id, str) or not UUID.fullmatch(request_id):
        raise ValueError('Invalid server requestId')
    if source == 'rpc' and starts[0].get('requestId') != request_id:
        raise ValueError('Conflicting start/result requestIds')
    for field in ('cpuTime', 'wallTime', 'eventTimestamp'):
        if not number(value.get(field)):
            raise ValueError('Missing invocation metrics')
    status = result.get('status') if results else None
    if status is not None and (type(status) is not int or not 100 <= status <= 599):
        raise ValueError('Invalid result status')
    selected = dict(source=source, requestId=request_id, version=version, status=status,
                    cpuTimeMs=value['cpuTime'], wallTimeMs=value['wallTime'], outcome=outcome,
                    eventTimestamp=value['eventTimestamp'], resultMarkerPresent=bool(results))
    event = value.get('event') or {}
    if source == 'proxy':
        request = event.get('request') or {}
        if request.get('method') not in ('GET', 'POST', 'PATCH', 'PUT') or type(result.get('dispatched')) is not bool:
            raise ValueError('Invalid proxy marker')
        if (event.get('response') or {}).get('status') != status:
            raise ValueError('Proxy HTTP/result status differs')
        selected.update(dispatched=result['dispatched'], method=request['method'],
                        routeTemplate=route_template(urllib.parse.urlsplit(request.get('url', '')).path))
    else:
        if event.get('rpcMethod') != 'operate':
            raise ValueError('Unexpected RPC method')
        phase = starts[0]
        selected['phase'] = {key: phase[key] for key in ('firstInIsolate', 'rustFirstInIsolate', 'callsRust',
                              'requestInModule', 'wasmModuleLoads', 'wasmInstanceId') if key in phase}
        marker = phase.get('moduleMarker')
        if isinstance(marker, str) and UUID.fullmatch(marker):
            selected['phase']['moduleMarker'] = marker
    return selected


def correlate(proxy, rpc, expected_ids=None):
    def indexed(records):
        result = {}
        for record in records:
            if record['requestId'] in result:
                raise ValueError('Duplicate requestId within one source')
            result[record['requestId']] = record
        return result
    parents, children = indexed(proxy), indexed(rpc)
    expected = set(parents) if expected_ids is None else set(expected_ids)
    if not expected or any(not isinstance(key, str) or not UUID.fullmatch(key) for key in expected):
        raise ValueError('No valid expected server requestIds')
    if not expected.issubset(parents):
        raise ValueError('Missing expected proxy invocation')
    if any(key not in parents for key in children):
        raise ValueError('Orphan RPC invocation; no time-based inference')
    pairs = []
    for key in sorted(expected):
        parent, child = parents[key], children.get(key)
        if parent['dispatched'] != (child is not None):
            raise ValueError('Missing RPC or unexpected RPC after proxy rejection')
        if child and child['outcome'] == 'ok' and parent['status'] != child['status']:
            raise ValueError('Proxy/RPC result status differs')
        pairs.append(dict(requestId=key, proxy=parent, rpc=child))
    return pairs
