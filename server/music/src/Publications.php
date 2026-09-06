<?php
declare(strict_types=1);

/** @brief 公開参照とreceiptを同じ原子的な切替で確定する。 */
final class Publications {
    private const MAX_RECEIPTS = 1024;
    /** @brief 配信元と素材検証を注入する。 @param Store $store 私有保存。 @param Assets $assets 検証済み素材。 @param array $policy 共通制約。 @param string $fault ローカル障害試験限定。 */
    public function __construct(private Store $store, private Assets $assets, private array $policy, private string $fault = '') {}
    /** @brief 許可対象だけを最新snapshotへ適用し、他作品を保持する。 @param array $envelope 署名済み操作。 @param array $payload 不変の公開DTO。 @return array 反映済みreceipt。 */
    public function apply(array $envelope, array $payload): array {
        return $this->store->locked('publication', function () use ($envelope, $payload): array {
            $current = $this->store->current();
            $scope = $envelope['gameId'];
            $id = $envelope['operationId'];
            if (isset($current['receipts'][$id])) return $this->matching($current['receipts'][$id], $envelope);
            demand(($payload['protocolVersion'] ?? 0) === 1 && ($payload['scope'] ?? '') === $scope, 400, 'Publication target mismatch');
            demand(($current['scopes'][$scope] ?? 0) === $envelope['expectedRevision'], 409, 'Publication revision conflict');
            if ($scope === 'ads') {
                demand(($payload['game'] ?? null) === null, 403, 'Advertisement scope cannot change works');
                $ad = $payload['advertisement'] ?? [];
                demand(is_bool($ad['enabled'] ?? null), 400, 'Invalid advertisement');
                if ($ad['enabled']) {
                    demand($this->assets->get($ad['imageAssetId'])['kind'] === 'image' && preg_match('#^https://#', $ad['href'] ?? '') === 1 && ($ad['alt'] ?? '') !== '', 400, 'Invalid advertisement');
                    $current['advertisement'] = array_intersect_key($ad, array_flip(['enabled', 'imageAssetId', 'href', 'alt']));
                } else $current['advertisement'] = ['enabled' => false];
            } else {
                demand(!array_key_exists('advertisement', $payload), 403, 'Work scope cannot change advertisement');
                if ($payload['game'] === null) unset($current['games'][$scope]);
                else $current['games'][$scope] = $this->game($payload['game'], $scope);
            }
            $revision = $envelope['expectedRevision'] + 1;
            $receipt = ['operationId' => $id, 'scope' => $scope, 'payloadDigest' => $envelope['payloadDigest'], 'revision' => $revision];
            $current['scopes'][$scope] = $revision;
            $current['revision']++;
            // scopeごとの最新結果だけを残し、未確定D1の照合能力を保ったままledgerを有限化する。
            foreach ($current['receipts'] as $receiptId => $stored) {
                if (($stored['scope'] ?? null) === $scope) unset($current['receipts'][$receiptId]);
            }
            $current['receipts'][$id] = $receipt;
            if (count($current['receipts']) > self::MAX_RECEIPTS) {
                $current['receipts'] = array_slice($current['receipts'], -self::MAX_RECEIPTS, null, true);
            }
            $name = bin2hex(random_bytes(16));
            $snapshot = $this->store->root . "/snapshots/$name.json";
            $switched = false;
            try {
                $this->store->atomicJson($snapshot, $current);
                if ($this->fault === 'before-switch') throw new Failure(503, 'Injected before switch');
                $this->store->atomicJson($this->store->root . '/current.json', ['snapshot' => $name]);
                $switched = true;
            } finally {
                if (!$switched && is_file($snapshot) && !is_link($snapshot)) unlink($snapshot);
            }
            $this->store->pruneSnapshots($name);
            if ($this->fault === 'after-switch') throw new Failure(503, 'Injected after switch');
            return $receipt;
        });
    }
    /** @brief 同一操作の別内容・別対象転用を拒否する。 @param array $receipt 保存済み結果。 @param array $envelope 再要求。 @return array 保存済み結果。 */
    private function matching(array $receipt, array $envelope): array {
        demand($receipt['scope'] === $envelope['gameId'] && $receipt['payloadDigest'] === $envelope['payloadDigest'] && $receipt['revision'] === $envelope['expectedRevision'] + 1, 409, 'Operation content conflict');
        return $receipt;
    }
    /** @brief snapshotの存在だけでは成功にせず、現在版のledgerを調べる。 @param array $envelope 元操作を拘束した状態要求。 @return array|null 確定した場合だけreceipt。 */
    public function status(array $envelope): ?array {
        $current = $this->store->current();
        return isset($current['receipts'][$envelope['operationId']]) ? $this->matching($current['receipts'][$envelope['operationId']], $envelope) : null;
    }
    /** @brief DTOをallowlist化し作品を越えた素材や未検証音源を拒否する。 @param array $game 署名された作品DTO。 @param string $scope 対象作品。 @return array 公開可能なDTO。 */
    private function game(array $game, string $scope): array {
        demand(($game['id'] ?? '') === $scope && ($game['rightsConfirmed'] ?? false) === true && is_array($game['tracks'] ?? null), 400, 'Invalid published work');
        $result = array_intersect_key($game, array_flip(['id', 'title', 'description', 'imageAssetId', 'imageAlt', 'externalUrl', 'design']));
        $this->image($game['imageAssetId'] ?? null, $scope);
        $this->image($game['design']['backgroundAssetId'] ?? null, $scope);
        if (isset($game['design'])) $result['design'] = array_intersect_key($game['design'], array_flip(['backgroundColor', 'backgroundAssetId', 'backgroundMode']));
        $result['tracks'] = [];
        $ids = [];
        foreach ($game['tracks'] as $track) {
            $id = musicId($track['id'] ?? null);
            demand(($track['gameId'] ?? '') === $scope && !isset($ids[$id]) && ($track['rightsConfirmed'] ?? false) === true && count($track['credits'] ?? []) > 0, 400, 'Invalid published track');
            $ids[$id] = true;
            $audio = $this->assets->get($track['audioAssetId'], $scope);
            demand($audio['kind'] === 'audio', 400, 'Audio required');
            $this->image($track['imageAssetId'] ?? null, $scope);
            $loop = $track['loop'] ?? null;
            if ($loop !== null) demand(is_numeric($loop['startSeconds'] ?? null) && is_numeric($loop['endSeconds'] ?? null) && $loop['startSeconds'] >= 0 && $loop['endSeconds'] <= $audio['durationSeconds'] && $loop['endSeconds'] - $loop['startSeconds'] >= $this->policy['loop']['minimumLengthSeconds'], 400, 'Invalid loop');
            $public = array_intersect_key($track, array_flip(['id', 'gameId', 'title', 'position', 'comment', 'audioAssetId', 'imageAssetId', 'imageAlt']));
            $public['loop'] = $loop === null ? null : array_intersect_key($loop, array_flip(['startSeconds', 'endSeconds']));
            $public['credits'] = array_map(static fn(array $credit): array => array_intersect_key($credit, array_flip(['name', 'role'])), $track['credits']);
            $result['tracks'][] = array_merge($public, ['durationSeconds' => $audio['durationSeconds'], 'sampleRateHz' => $audio['sampleRateHz'], 'channels' => $audio['channels'], 'audioBytes' => $audio['bytes']]);
        }
        return $result;
    }
    /** @brief 任意画像の種類と所属を検証する。 @param mixed $id 画像IDまたはnull。 @param string $scope 所属作品。 @return void */
    private function image(mixed $id, string $scope): void {
        if ($id !== null) demand($this->assets->get(musicId($id), $scope)['kind'] === 'image', 400, 'Image required');
    }
    /** @brief 現在版の参照だけからmedia許可を判定する。 @param array $snapshot 要求内の現在版。 @param string $id 素材UUID。 @return bool 公開中か。 */
    public static function allows(array $snapshot, string $id): bool {
        if (($snapshot['advertisement']['enabled'] ?? false) && ($snapshot['advertisement']['imageAssetId'] ?? '') === $id) return true;
        foreach ($snapshot['games'] as $game) {
            if (($game['imageAssetId'] ?? '') === $id || ($game['design']['backgroundAssetId'] ?? '') === $id) return true;
            foreach ($game['tracks'] as $track) if ($track['audioAssetId'] === $id || ($track['imageAssetId'] ?? '') === $id) return true;
        }
        return false;
    }
}
