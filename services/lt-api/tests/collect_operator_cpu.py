"""要求を送らず二つのtailを購読する。本文・認証値は保存せず、厳密に対応した計測だけを保存する。"""
import argparse
import datetime
import json
from pathlib import Path
import re
import subprocess
import threading
import time
from cpu_tail_parser import TailParser
from operator_cpu_parser import select_event, correlate


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--proxy-version', required=True)
    parser.add_argument('--rpc-version', required=True)
    parser.add_argument('--seconds', type=int, default=90)
    parser.add_argument('--expected-ids', type=Path)
    parser.add_argument('--output', type=Path, default=Path('.wrangler/operator-cpu-safe.json'))
    args = parser.parse_args()
    assert 5 <= args.seconds <= 300
    assert all(re.fullmatch(r'[a-f0-9-]{36}', v) for v in (args.proxy_version, args.rpc_version))
    records = {'proxy': [], 'rpc': []}
    errors, processes, threads = [], [], []

    def capture(process, source, version):
        decoder = TailParser()
        try:
            for line in process.stdout:
                for value in decoder.feed(line):
                    selected = select_event(value, source, version)
                    if selected:
                        records[source].append(selected)
            if decoder.buffer.strip():
                raise ValueError('Incomplete JSON tail event')
        except Exception as error:
            errors.append(source+': '+type(error).__name__)

    try:
        for source, name, version in [('proxy','pandd-deployment-control-plane',args.proxy_version),
                                      ('rpc','pandd-lt-api',args.rpc_version)]:
            process = subprocess.Popen(['node','node_modules/wrangler/bin/wrangler.js','tail',name,'--format','json'],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
            thread = threading.Thread(target=capture, args=(process,source,version), daemon=True)
            processes.append(process)
            threads.append(thread)
            thread.start()
        print('Tail listeners started; no requests are sent. Successful capture is checked from matching records.',flush=True)
        # 接続を断定せず、実際に受信した両側の記録だけで成立を判断する
        deadline = time.monotonic()+args.seconds
        while time.monotonic() < deadline and not errors:
            if any(process.poll() is not None for process in processes):
                errors.append('tail stopped')
                break
            time.sleep(.25)
    finally:
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        for thread in threads:
            thread.join(timeout=5)
    if errors:
        raise RuntimeError('Collector failed: '+','.join(errors))
    expected = json.loads(args.expected_ids.read_text(encoding='utf-8')) if args.expected_ids else None
    pairs = correlate(records['proxy'], records['rpc'], expected)
    report = dict(timeUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  proxyVersion=args.proxy_version, rpcVersion=args.rpc_version,
                  requestAttribution='server requestId only; no actor identity recorded', pairs=pairs,
                  requestsSentByCollector=0)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'paired':len(pairs),'output':str(args.output),'requestsSent':0}),flush=True)


if __name__ == '__main__':
    main()
