<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
// 初期版は受信一時ファイルだけを回収する。原本・下書き・操作・履歴・backupは触らない。
demand(PHP_SAPI === 'cli', 403, 'CLI only');
[$config, , $store] = musicServices();
$apply = in_array('--apply', $argv, true);
$ageSeconds = 86400;
$report = [];
foreach (glob($store->root . '/tmp/upload-*') as $file) {
    if (str_ends_with($file, '.lock') || is_link($file) || is_link($file . '.lock') || !is_file($file) || filemtime($file) >= time() - $ageSeconds) continue;
    $lease = fopen($file . '.lock', 'c+b');
    if (!$lease || !flock($lease, LOCK_EX | LOCK_NB)) { if ($lease) fclose($lease); continue; }
    try {
        $report[] = ['file' => basename($file), 'bytes' => filesize($file), 'action' => $apply ? 'removed' : 'candidate'];
        if ($apply) demand(unlink($file), 503, 'Temporary cleanup failed');
    } finally { flock($lease, LOCK_UN); fclose($lease); }
}
echo json_encode(['dryRun' => !$apply, 'minimumAgeSeconds' => $ageSeconds, 'files' => $report], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . PHP_EOL;
