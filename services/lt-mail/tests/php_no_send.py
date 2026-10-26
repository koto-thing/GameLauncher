"""PHPの構文と送信前の拒否経路だけを検証する。mail()へ到達しない"""
from pathlib import Path
import json, os, shutil, subprocess, tempfile

php = shutil.which('php')
if not php:
    raise SystemExit('PHP CLI required; no installation or fallback is performed')
relay = Path(__file__).resolve().parents[1] / 'relay/relay.php'
subprocess.run([php, '-l', str(relay)], check=True)
with tempfile.TemporaryDirectory(prefix='lt-php-no-send-') as folder:
    root = Path(folder)
    config = root / 'config.php'
    router = root / 'check.php'
    # 永続資格情報ではない架空fixture。入力が不正なので配送処理は呼ばれない
    config.write_text("<?php return ['enabled'=>true,'bearer'=>'" + 'fixture-'*8 + "'];", encoding='utf-8')
    for label, env, setup, expected in [
        ('disabled', {}, '', 'temporary'),
        ('non-https', {'LT_MAIL_PRIVATE_CONFIG':str(config)}, "$_SERVER['REQUEST_METHOD']='POST';", 'permanent'),
        ('unauthenticated', {'LT_MAIL_PRIVATE_CONFIG':str(config)}, "$_SERVER['REQUEST_METHOD']='POST';$_SERVER['HTTPS']='on';", 'permanent'),
        ('non-json', {'LT_MAIL_PRIVATE_CONFIG':str(config)}, "$_SERVER['REQUEST_METHOD']='POST';$_SERVER['HTTPS']='on';$_SERVER['HTTP_X_LT_MAIL_AUTH']='Bearer "+'fixture-'*8+"';$_SERVER['CONTENT_TYPE']='text/plain';", 'permanent'),
    ]:
        router.write_text('<?php '+setup+'require '+json.dumps(str(relay).replace('\\','/'))+';',encoding='utf-8')
        child = dict(os.environ)
        child.pop('LT_MAIL_PRIVATE_CONFIG', None)
        child.update(env)
        result = subprocess.run([php, str(router)], env=child, capture_output=True, text=True, check=True)
        assert json.loads(result.stdout) == {'result':expected}, label
        assert not result.stderr, label
        print(label+': refused before mail()', flush=True)

# 一時配置も同じPHP実行環境で無送信検証する
from php_install_test import main as verify_installer
verify_installer()
