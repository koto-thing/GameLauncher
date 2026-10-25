"""起動ログを固定した分類と既知識別子に限定して公開する"""
import re


def startup_diagnostics(text, code):
    """自由形式の例外本文・URL・値を返さず起動失敗を識別する"""
    categories = {
        'address_in_use': r'EADDRINUSE|address already in use',
        'binding_missing': r'could not find service|couldn.t resolve service|entrypoint.+does not exist',
        'runtime_crash': r'fatal error|segmentation fault|javascript heap out of memory|worker runtime.+crash',
        'connection_refused': r'ECONNREFUSED|connection refused',
        'module_missing': r'ERR_MODULE_NOT_FOUND|Cannot find module|Could not resolve',
        'build_failed': r'Build failed|build failure|Transform failed',
        'runtime_start_failed': r'runtime failed to start|ERR_RUNTIME_FAILURE',
        'registry_invalid': r'Unexpected end of JSON input|Expected property name or',
        'permission_denied': r'EACCES|EPERM|permission denied',
    }
    found = [name for name, pattern in categories.items() if re.search(pattern, text, re.I)]
    if code < 0 and 'runtime_crash' not in found:
        found.append('runtime_crash')
    # 一致した値ではなく固定の許可リスト要素だけを返す
    exceptions = ['TypeError', 'SyntaxError', 'ReferenceError', 'MiniflareCoreError', 'ParseError', 'UserError']
    error_codes = ['EADDRINUSE', 'ECONNREFUSED', 'EACCES', 'EPERM', 'ENOENT', 'ERR_MODULE_NOT_FOUND', 'ERR_RUNTIME_FAILURE', 'ERR_PARSE_ARGS_UNKNOWN_OPTION']
    modules = ['proxy.mjs', 'integration-bridge.mjs', 'entry.mjs', 'workerd', 'miniflare', 'wrangler']
    return {
        'classification': found or ['other'],
        'exceptionTypes': [name for name in exceptions if re.search(r'\b' + re.escape(name) + r'\b', text)],
        'errorCodes': [name for name in error_codes if re.search(r'\b' + re.escape(name) + r'\b', text)],
        'knownModules': [name for name in modules if re.search(r'\b' + re.escape(name) + r'\b', text)],
    }
