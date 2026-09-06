<?php
declare(strict_types=1);

// 公開診断URLを作らず、配置先のCLIで必要条件だけを確認する。鍵・設定パスは出力しない。
if (PHP_SAPI !== 'cli') { http_response_code(404); exit(1); }
$autoload = __DIR__ . '/../vendor/autoload.php';
if (is_file($autoload)) require_once $autoload;
$gd = extension_loaded('gd') ? gd_info() : [];
$memory = ini_get('memory_limit');
$checks = [
    'php82OrNewer' => PHP_VERSION_ID >= 80200,
    'fileinfo' => extension_loaded('fileinfo'),
    'gdJpegPngWebp' => ($gd['JPEG Support'] ?? false) && ($gd['PNG Support'] ?? false) && ($gd['WebP Support'] ?? false),
    'getId3' => class_exists('getID3'),
    'memory256MiBOrMore' => $memory === '-1' || (function_exists('ini_parse_quantity') && ini_parse_quantity($memory) >= 256 * 1024 * 1024),
];
foreach (['fopen', 'flock', 'rename', 'fsync', 'hash_file'] as $function) $checks[$function] = function_exists($function);
$passed = !in_array(false, $checks, true);
echo json_encode([
    'passed' => $passed,
    'phpVersion' => PHP_VERSION,
    'checks' => $checks,
    'cliLimits' => [
        'memory_limit' => $memory,
        'upload_max_filesize' => ini_get('upload_max_filesize'),
        'post_max_size' => ini_get('post_max_size'),
        'max_execution_time' => ini_get('max_execution_time'),
    ],
    'unverified' => ['Web PHP configuration may differ from CLI', 'HTTPS and Apache rewrite/headers', 'Private directories denied through all hostnames', 'Storage permissions, locking and atomic rename on target filesystem', '64 MiB raw PUT and host/WAF timeouts'],
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . PHP_EOL;
exit($passed ? 0 : 1);
