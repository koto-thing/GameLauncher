from pathlib import Path
import unittest


class CgiHeaderContract(unittest.TestCase):
    """CGI互換の専用ヘッダーだけで認証し、旧ヘッダーへの迂回を作らない"""

    def test_runtime_and_php_share_header(self):
        """Rust送信とPHP受信の名前・Bearer検証を固定する"""
        root = Path(__file__).resolve().parents[1]
        runtime = (root / 'src/runtime.rs').read_text(encoding='utf-8')
        self.assertIn('headers.set("X-LT-Mail-Auth", &format!("Bearer {bearer}"))?', runtime)
        self.assertNotIn('headers.set("Authorization"', runtime)
        for name in ['relay.php', 'install.template.php']:
            source = (root / 'relay' / name).read_text(encoding='utf-8')
            self.assertIn("$_SERVER['HTTP_X_LT_MAIL_AUTH'] ?? ''", source)
            self.assertNotIn('HTTP_AUTHORIZATION', source)
            self.assertIn('hash_equals(', source)
        entry = (root / 'relay/public-entry.php').read_text(encoding='utf-8')
        self.assertNotIn('HTTP_AUTHORIZATION', entry)

    def test_fresh_install_rejects_existing_directory(self):
        """新規配置はディレクトリ衝突を既存設定の読み取り前に拒否する"""
        root = Path(__file__).resolve().parents[1]
        source = (root / 'relay/install.template.php').read_text(encoding='utf-8')
        self.assertIn('const LT_INSTALL_FRESH = true;', source)
        self.assertLess(source.index('if (LT_INSTALL_FRESH)'), source.index('$oldHash ='))


if __name__ == '__main__':
    unittest.main()
