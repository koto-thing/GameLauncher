<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
// 復元時に公開を再開する前の読取検証。ファイルを書き換えない。
demand(PHP_SAPI === 'cli', 403, 'CLI only');
[, , $store, $assets] = musicServices();
$current = $store->current();
$count = 0;
foreach (glob($store->root . '/assets/*.json') as $file) {
    $id = basename($file, '.json');
    $asset = $assets->get($id);
    demand(hash_equals($asset['digest'], hash_file('sha256', $assets->path($id))) && filesize($assets->path($id)) === $asset['bytes'], 503, 'Asset integrity failure');
    $count++;
}
foreach ($current['games'] as $game) {
    foreach ([$game['imageAssetId'] ?? null, $game['design']['backgroundAssetId'] ?? null] as $id) if ($id !== null) $assets->get($id, $game['id']);
    foreach ($game['tracks'] as $track) {
        $assets->get($track['audioAssetId'], $game['id']);
        if ($track['imageAssetId'] !== null) $assets->get($track['imageAssetId'], $game['id']);
    }
}
if ($current['advertisement']['enabled']) $assets->get($current['advertisement']['imageAssetId']);
echo json_encode(['revision' => $current['revision'], 'assetsVerified' => $count, 'scopes' => $current['scopes'], 'receipts' => count($current['receipts'])], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . PHP_EOL;
