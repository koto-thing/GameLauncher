<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
musicHeaders();
try {
    [$config, $policy, $store, $assets] = musicServices();
    $method = $_SERVER['REQUEST_METHOD'];
    demand(in_array($method, ['GET', 'HEAD'], true), 405, 'Read only');
    demand(!is_file($store->root . '/STOP'), 503, 'Publication temporarily stopped');
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $base = $config['basePath'] ?? '';
    demand(str_starts_with($path, $base . '/api/'), 404, 'Not found');
    $path = substr($path, strlen($base));
    // 公開版の確認にネットワークも管理Cookieも使用しない。
    $snapshot = $store->current();
    if (preg_match('#^/api/assets/([a-f0-9-]+)$#D', $path, $parts)) {
        $id = musicId($parts[1]);
        demand(Publications::allows($snapshot, $id), 404, 'Asset not found');
        Media::send($assets, $assets->get($id), $method, $_SERVER['HTTP_RANGE'] ?? null);
    } else {
        $value = match ($path) {
            '/api/public/catalogue' => array_values($snapshot['games']),
            '/api/public/ad' => $snapshot['advertisement'],
            '/api/public/config' => ['contactUrl' => $config['contactUrl'] ?? '', 'local' => $config['environment'] === 'local'],
            default => throw new Failure(404, 'Not found')
        };
        $json = json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        header('Content-Length: ' . strlen($json));
        if ($method !== 'HEAD') echo $json;
    }
} catch (Throwable $failure) { musicError($failure); }
