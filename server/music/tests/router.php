<?php
declare(strict_types=1);
// PHP組み込み開発サーバー専用。実配置ではpublic/.htaccessを使用する。
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$testConfig = require getenv('MUSIC_CONFIG');
$testBase = $testConfig['basePath'] ?? '';
if ($testBase !== '' && str_starts_with($path, $testBase . '/')) $path = substr($path, strlen($testBase));
if ($path === '/__test/audio.js') {
    header('Content-Type: text/javascript');
    readfile(__DIR__ . '/../../../apps/music/build/audio-harness.js');
    return true;
}
if ($path === '/bridge.php') { require __DIR__ . '/../public/bridge.php'; return true; }
if (str_starts_with($path, '/api/')) { require __DIR__ . '/../public/api.php'; return true; }
if (in_array($path, ['/', '/about', '/scan'], true) || preg_match('#^/(?:games|tracks)/[a-f0-9-]+$#D', $path)) {
    header('Content-Type: text/html; charset=utf-8');
    // サブディレクトリ試験では本番設定のCSPも実ヘッダーとしてブラウザーへ渡す。
    if ($testBase !== '' && preg_match('/Header always set Content-Security-Policy "([^"]+)"/', file_get_contents(__DIR__ . '/../public/.htaccess'), $csp)) header('Content-Security-Policy: ' . $csp[1]);
    readfile($_SERVER['DOCUMENT_ROOT'] . '/index.html');
    return true;
}
if (preg_match('#^/assets/[a-zA-Z0-9_.-]+\.(js|css)$#D', $path) || $path === '/pandd-logo.png') {
    if ($testBase === '') return false;
    $file = $_SERVER['DOCUMENT_ROOT'] . $path;
    if (is_file($file)) {
        header('Content-Type: ' . (str_ends_with($path, '.js') ? 'text/javascript' : (str_ends_with($path, '.css') ? 'text/css' : 'image/png')));
        readfile($file); return true;
    }
}
http_response_code(404);
header('Cache-Control: no-store');
echo 'Not found';
return true;
