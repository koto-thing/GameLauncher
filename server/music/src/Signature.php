<?php
declare(strict_types=1);

/** @brief 版付き署名・対象・期限・nonceを検証する。 */
final class Signature {
    /** @brief Music専用鍵と私有nonceストアを受け取る。 @param Store $store 私有保存。 @param array $config 秘密を含む非公開設定。 */
    public function __construct(private Store $store, private array $config) {}
    /** @brief 署名したbase64url UTF-8 JSONを検証しnonceを原子的に消費する。 @param string $encoded エンベロープ。 @param string $signature 小文字hex HMAC。 @param string $method HTTP動詞。 @param string $path queryのない固定path。 @return array 検証済みエンベロープ。 */
    public function verify(string $encoded, string $signature, string $method, string $path): array {
        demand(strlen($encoded) <= 8192 && preg_match('/^[A-Za-z0-9_-]+$/D', $encoded) === 1, 401, 'Invalid signature envelope');
        try { $envelope = json_decode(base64_decode(strtr($encoded, '-_', '+/'), true), true, 32, JSON_THROW_ON_ERROR); }
        catch (Throwable) { throw new Failure(401, 'Invalid signature envelope'); }
        $key = $this->config['keys'][$envelope['keyId'] ?? ''] ?? '';
        demand(strlen($key) >= 32 && hash_equals(hash_hmac('sha256', "PandD-Music-v1\n$encoded", $key), $signature), 401, 'Invalid signature');
        demand(($envelope['protocolVersion'] ?? null) === 1 && ($envelope['audience'] ?? '') === 'pandd-music' && ($envelope['environment'] ?? '') === $this->config['environment'], 403, 'Invalid signature audience');
        demand($method === 'POST' && ($envelope['method'] ?? '') === $method && $path === $this->config['bridgePath'] && ($envelope['path'] ?? '') === $path, 403, 'Invalid signature path');
        $now = time();
        demand(is_int($envelope['issuedAt'] ?? null) && is_int($envelope['expiresAt'] ?? null) && $envelope['issuedAt'] <= $now + 5 && $envelope['expiresAt'] > $now && $envelope['expiresAt'] - $envelope['issuedAt'] <= 120 && $envelope['expiresAt'] > $envelope['issuedAt'], 401, 'Signature expired');
        musicId($envelope['nonce'] ?? null);
        musicId($envelope['operationId'] ?? null);
        if (($envelope['gameId'] ?? '') !== 'ads') musicId($envelope['gameId'] ?? null);
        demand(preg_match('/^[1-9][0-9]{0,15}$/D', $envelope['actorId'] ?? '') === 1, 400, 'Invalid actor');
        demand(in_array($envelope['action'] ?? '', ['upload', 'preview', 'publish', 'status'], true), 403, 'Invalid purpose');
        demand(is_int($envelope['expectedRevision'] ?? null) && $envelope['expectedRevision'] >= 0 && preg_match('/^[a-f0-9]{64}$/D', $envelope['payloadDigest'] ?? '') === 1, 400, 'Invalid content binding');
        if (in_array($envelope['action'], ['upload', 'preview'], true)) musicId($envelope['assetId'] ?? null);
        $this->store->locked('nonces', function () use ($envelope, $now): void {
            foreach (glob($this->store->root . '/nonces/*.json') as $file) {
                if (filemtime($file) < $now - 180 && !is_link($file)) unlink($file);
            }
            $file = $this->store->root . '/nonces/' . $envelope['nonce'] . '.json';
            demand(!file_exists($file), 409, 'Nonce already used');
            $this->store->atomicJson($file, ['expiresAt' => $envelope['expiresAt']]);
        });
        return $envelope;
    }
}
