"""一時配置入口の固定本文・期限・LT専用パスをlocalhostで無送信検証する"""
from pathlib import Path
import base64
import hashlib
import json
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def main():
    """架空鍵とダミーPHPだけを一時領域へ配置し、Music領域不変を検証する"""
    php = shutil.which('php')
    assert php, 'PHP CLI required; no fallback'
    source = Path(__file__).resolve().parents[1] / 'relay'
    for name in ['install.template.php', 'public-entry.php']:
        subprocess.run([php, '-l', str(source / name)], check=True)
    with tempfile.TemporaryDirectory(prefix='lt-installer-') as temporary:
        root = Path(temporary)
        public = root / 'web' / 'pandd-music'
        public.mkdir(parents=True)
        music = root / 'pandd-music-private'
        music.mkdir()
        (music / 'untouched').write_text('fixture')
        bearer = 'a' * 64
        payload = dict(relay=base64.b64encode(b'<?php // fixture relay').decode(), cleanup=base64.b64encode(b'<?php // fixture cleanup').decode(), bearer=bearer, retention=False)
        body = json.dumps(payload).encode()
        template = (source / 'install.template.php').read_text(encoding='utf-8')
        installer = public / 'lt-installer.php'
        router = public / 'router.php'
        router.write_text("<?php $_SERVER['HTTPS']='on'; require __DIR__.'/lt-installer.php';", encoding='utf-8')

        def prepare(content=body, deadline=None, fresh=True):
            """本番と同じ固定ハッシュと短い期限を架空鍵で埋める"""
            value = template.replace('LT_INSTALL_DEADLINE = 0', 'LT_INSTALL_DEADLINE = ' + str(deadline or int(time.time()) + 300))
            value = value.replace("LT_INSTALL_BODY_SHA256 = ''", "LT_INSTALL_BODY_SHA256 = '" + hashlib.sha256(content).hexdigest() + "'")
            value = value.replace("LT_INSTALL_BEARER_SHA256 = ''", "LT_INSTALL_BEARER_SHA256 = '" + hashlib.sha256(bearer.encode()).hexdigest() + "'")
            value = value.replace('LT_INSTALL_FRESH = true', 'LT_INSTALL_FRESH = ' + str(fresh).lower())
            installer.write_text(value, encoding='utf-8')

        prepare()
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        process = subprocess.Popen([php, '-S', f'127.0.0.1:{port}', str(router)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        def request(content=body, auth=True, header='X-LT-Mail-Auth', credential=bearer):
            """ローカルfixtureだけへ要求し、応答を必ず消費する"""
            headers = {'Content-Type': 'application/json'}
            if auth:
                headers[header] = 'Bearer ' + credential
            req = urllib.request.Request(f'http://127.0.0.1:{port}/', data=content, headers=headers)
            try:
                response = urllib.request.urlopen(req, timeout=5)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status, json.load(response)

        try:
            for _ in range(100):
                assert process.poll() is None
                try:
                    if request(auth=False)[0] == 401:
                        break
                except OSError:
                    time.sleep(.05)
            else:
                raise AssertionError('Fixture not ready')
            private = root / 'pandd-lt-private'
            assert not private.exists()
            assert request(header='Authorization')[0] == 401 and not private.exists()
            assert request(credential='wrong-fixture')[0] == 401 and not private.exists()
            assert request(body + b' ')[0] == 400 and not private.exists()
            private.mkdir()
            (private / 'install.lock').write_text('collision')
            assert request()[0] == 409
            assert sorted(p.name for p in private.iterdir()) == ['install.lock']
            (private / 'install.lock').unlink()
            private.rmdir()
            assert request() == (200, {'installed': True})
            assert (private / 'relay.php').read_bytes() == b'<?php // fixture relay'
            assert (private / 'receipts').is_dir()
            assert request()[0] == 409
            prepare(fresh=False)
            assert request() == (200, {'installed': True})
            updated = json.dumps(payload | {'retention': True}).encode()
            prepare(updated, fresh=False)
            assert request(updated) == (200, {'installed': True})
            assert "'retention_enabled' => true" in (private / 'config.php').read_text()
            changed = json.dumps(payload | {'relay': base64.b64encode(b'<?php // changed').decode()}).encode()
            prepare(changed, fresh=False)
            assert request(changed)[0] == 409
            prepare(deadline=int(time.time()) - 1)
            assert request()[0] == 403
            assert (music / 'untouched').read_text() == 'fixture'
            assert sorted(p.name for p in public.iterdir()) == ['lt-installer.php', 'router.php']
            print('LT installer: auth/body hash/expiry/idempotency/code immutability/private destination/Music unchanged; mail calls 0')
        finally:
            process.terminate()
            process.wait(timeout=10)


if __name__ == '__main__':
    main()
