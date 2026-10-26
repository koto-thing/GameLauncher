"""tail の JSON/配列/NDJSON を解析し、完全一致する要求だけを照合する。"""
import json
import urllib.parse


class TailParser:
    def __init__(self):
        self.buffer = ''
        self.notices = 0

    def feed(self, line):
        # JSON 外の CLI 案内は内容を保存しない。JSON 中のログ文字列は変更しない。
        if not self.buffer:
            stripped = line.lstrip()
            if not stripped.startswith(('{', '[')):
                self.notices += 1
                return []
        self.buffer += line
        values = []
        while self.buffer.strip():
            self.buffer = self.buffer.lstrip()
            try:
                value, end = json.JSONDecoder().raw_decode(self.buffer)
            except ValueError:
                break
            self.buffer = self.buffer[end:]
            members = value if isinstance(value, list) else [value]
            for member in members:
                if not isinstance(member, dict):
                    raise ValueError('Non-object tail event')
                values.append(member)
        return values


def match_event(value, probe, version):
    event = value.get('event') or {}
    request = event.get('request') or {}
    url = urllib.parse.urlsplit(request.get('url', ''))
    query = urllib.parse.parse_qs(url.query)
    phases = []
    for log in value.get('logs', []):
        for message in log.get('message', []):
            try:
                decoded = json.loads(message)
            except (ValueError, TypeError):
                continue
            if isinstance(decoded, dict) and decoded.get('ltCpuProbe') is True:
                phases.append(decoded)
    matching = [phase for phase in phases if phase.get('probe') == probe]
    query_matches = query.get('lt_cpu_probe') == [probe]
    if not matching and not query_matches:
        return None
    if len(phases) != 1 or len(matching) != 1:
        raise ValueError('Matching request lacks unique isolate marker')
    sequence = matching[0].get('sequence')
    if type(sequence) is not int or not 1 <= sequence <= 9:
        raise ValueError('Malformed matching request sequence')
    if query_matches and query.get('lt_cpu_seq') != [str(sequence)]:
        raise ValueError('Conflicting request identifiers')
    actual_version = (value.get('scriptVersion') or {}).get('id')
    if actual_version != version:
        raise ValueError('Matching request used unexpected version')
    if len(phases) != 1:
        raise ValueError('Matching request lacks unique isolate marker')
    if not isinstance(value.get('eventTimestamp'), (int, float)):
        raise ValueError('Matching request lacks event timestamp')
    cpu = value.get('cpuTime')
    wall = value.get('wallTime')
    if not isinstance(cpu, (int, float)) or not isinstance(wall, (int, float)):
        raise ValueError('Matching request lacks CPU/wall metrics')
    return dict(sequence=sequence, path=url.path,
                status=(event.get('response') or {}).get('status'),
                cpuTimeMs=cpu, wallTimeMs=wall, outcome=value.get('outcome'),
                version=actual_version, phase=phases[0], eventTimestamp=value.get('eventTimestamp'))
