"""CI起動診断が機密や自由形式エラーを公開しないことを検証する"""
import json
import unittest
from fixture_diagnostics import startup_diagnostics


class StartupDiagnosticsTests(unittest.TestCase):
    """失敗は固定分類だけに限定する"""

    def test_unknown_text_is_not_exposed(self):
        """cookie・body・URL queryと未知の例外本文を返さない"""
        secret = 'synthetic-do-not-print'
        result = startup_diagnostics('Cookie: ' + secret + '\nbody=' + secret + '\nhttps://example.invalid/?token=' + secret, 1)
        self.assertEqual(result['classification'], ['other'])
        self.assertNotIn(secret, json.dumps(result))

    def test_known_setup_failure_keeps_only_static_identifiers(self):
        """module不足と例外型を識別し動的なpathや値は捨てる"""
        result = startup_diagnostics('TypeError ERR_MODULE_NOT_FOUND Cannot find module /private/synthetic-secret/proxy.mjs', 1)
        self.assertEqual(result['classification'], ['module_missing'])
        self.assertEqual(result['exceptionTypes'], ['TypeError'])
        self.assertEqual(result['errorCodes'], ['ERR_MODULE_NOT_FOUND'])
        self.assertEqual(result['knownModules'], ['proxy.mjs'])
        self.assertNotIn('synthetic-secret', json.dumps(result))

    def test_registry_and_runtime_failures_are_distinct(self):
        """registry parse・接続・runtimeの失敗分類を分ける"""
        self.assertEqual(startup_diagnostics('SyntaxError: Unexpected end of JSON input', 1)['classification'], ['registry_invalid'])
        self.assertEqual(startup_diagnostics('connect ECONNREFUSED', 1)['classification'], ['connection_refused'])
        self.assertEqual(startup_diagnostics('ERR_RUNTIME_FAILURE runtime failed to start', 1)['classification'], ['runtime_start_failed'])
        self.assertEqual(startup_diagnostics('', -9)['classification'], ['runtime_crash'])
