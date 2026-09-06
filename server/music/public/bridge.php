<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
musicHeaders();
try {
    [$config, $policy, $store, $assets, $publications] = musicServices();
    demand(($_SERVER['QUERY_STRING'] ?? '') === '', 400, 'Bridge query is not supported');
    $envelope = (new Signature($store, $config))->verify($_SERVER['HTTP_X_MUSIC_ENVELOPE'] ?? '', $_SERVER['HTTP_X_MUSIC_SIGNATURE'] ?? '', $_SERVER['REQUEST_METHOD'], parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
    if ($envelope['action'] === 'upload') {
        echo json_encode($assets->upload($envelope, fopen('php://input', 'rb')), JSON_THROW_ON_ERROR);
    } elseif ($envelope['action'] === 'preview') {
        $asset = $assets->get($envelope['assetId'], $envelope['gameId']);
        Media::send($assets, $asset, 'GET', null);
    } elseif ($envelope['action'] === 'status') {
        echo json_encode(['receipt' => $publications->status($envelope)], JSON_THROW_ON_ERROR);
    } else {
        $body = file_get_contents('php://input', false, null, 0, 1048577);
        demand(strlen($body) <= 1048576, 413, 'Publication too large');
        demand(hash_equals($envelope['payloadDigest'], hash('sha256', $body)), 400, 'Publication digest mismatch');
        $payload = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
        echo json_encode($publications->apply($envelope, $payload), JSON_THROW_ON_ERROR);
    }
} catch (Throwable $failure) { musicError($failure); }
