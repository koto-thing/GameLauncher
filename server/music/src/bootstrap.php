<?php
declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/Failure.php';

/** @brief 公開領域外の設定からサービスを組み立てる。 @return array 設定・保存・素材・公開Use Case。 */
function musicServices(): array {
    $file = getenv('MUSIC_CONFIG') ?: __DIR__ . '/../config/local.php';
    demand(is_file($file), 503, 'Music server is not configured');
    $config = require $file;
    demand(is_array($config) && in_array($config['environment'] ?? '', ['local', 'staging', 'production'], true), 503, 'Invalid server configuration');
    $policy = json_decode(file_get_contents(__DIR__ . '/../config/policy.json'), true, 32, JSON_THROW_ON_ERROR);
    $store = new Store($config['storageRoot'], $config['documentRoot']);
    $assets = new Assets($store, $policy);
    $fault = $config['environment'] === 'local' ? ($config['fault'] ?? '') : '';
    return [$config, $policy, $store, $assets, new Publications($store, $assets, $policy, $fault)];
}

/** @brief API共通ヘッダーを付け、取り下げ判定前のキャッシュを禁止する。 @return void */
function musicHeaders(): void {
    header('Cache-Control: no-store, private, max-age=0');
    header('X-Content-Type-Options: nosniff');
    header('Cross-Origin-Resource-Policy: same-origin');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header('Content-Type: application/json; charset=utf-8');
}

/** @brief 安全なAPIエラー以外は内部情報を伏せる。 @param Throwable $failure 捕捉した失敗。 @return void */
function musicError(Throwable $failure): void {
    http_response_code($failure instanceof Failure ? $failure->status : 500);
    echo json_encode(['message' => $failure instanceof Failure ? $failure->getMessage() : 'Music service unavailable'], JSON_UNESCAPED_UNICODE);
}
