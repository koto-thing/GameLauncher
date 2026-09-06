<?php
declare(strict_types=1);
// PHP組み込み開発サーバー専用。実配置ではpublic/.htaccessを使用する。
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/__test/audio.js') {
    header('Content-Type: text/javascript');
    readfile(__DIR__ . '/../../../apps/music/build/audio-harness.js');
    return true;
}
if ($path === '/bridge.php') { require __DIR__ . '/../public/bridge.php'; return true; }
if (str_starts_with($path, '/api/')) { require __DIR__ . '/../public/api.php'; return true; }
if (in_array($path, ['/', '/about'], true) || preg_match('#^/(?:games|tracks)/[a-f0-9-]+$#D', $path)) {
    header('Content-Type: text/html; charset=utf-8');
    readfile($_SERVER['DOCUMENT_ROOT'] . '/index.html');
    return true;
}
if (preg_match('#^/assets/[a-zA-Z0-9_.-]+\.(js|css)$#D', $path) || $path === '/pandd-logo.png') return false;
http_response_code(404);
header('Cache-Control: no-store');
echo 'Not found';
return true;
