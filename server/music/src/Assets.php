<?php
declare(strict_types=1);

/** @brief 非公開素材の受信・実体検証と不変保存を担当する。 */
final class Assets {
    /** @brief 私有保存と共通投稿制約を注入する。 @param Store $store 保存先。 @param array $policy 型付きTS側と共通の制約。 */
    public function __construct(private Store $store, private array $policy) {}
    /** @brief 検証済み素材と所属を確認する。 @param string $id 素材UUID。 @param string|null $gameId 必須所属、公開読取時はnull。 @return array メタデータ。 */
    public function get(string $id, ?string $gameId = null): array {
        musicId($id);
        $path = $this->store->root . "/assets/$id.json";
        demand(is_file($path), 404, 'Asset not found');
        $asset = $this->store->json($path);
        demand(($asset['id'] ?? '') === $id && ($asset['status'] ?? '') === 'verified' && (!$gameId || $asset['gameId'] === $gameId), 404, 'Asset not found');
        demand(is_file($this->path($id)) && !is_link($this->path($id)), 503, 'Asset unavailable');
        return $asset;
    }
    /** @brief 原文ファイル名を使わず私有固定パスを作る。 @param string $id 検証済みUUID。 @return string 内部パス。 */
    public function path(string $id): string { return $this->store->root . '/assets/' . musicId($id) . '.bin'; }
    /** @brief 同一ID・同一内容だけ再試行できるストリーム受信を行う。 @param array $envelope 認証済み拘束情報。 @param resource $input HTTP本文。 @return array PHPが検証したメタデータ。 */
    public function upload(array $envelope, $input): array {
        $id = musicId($envelope['assetId']);
        demand($envelope['gameId'] !== 'ads', 400, 'Asset requires a work');
        $kind = $envelope['kind'];
        demand(in_array($kind, ['audio', 'image'], true), 400, 'Invalid asset kind');
        $maximum = $this->policy['media'][$kind === 'audio' ? 'maxAudioFileBytes' : 'maxImageFileBytes'];
        demand(is_int($envelope['bytes']) && $envelope['bytes'] > 0 && $envelope['bytes'] <= $maximum, 413, 'Asset too large');
        $temporary = tempnam($this->store->root . '/tmp', 'upload-');
        // 受信中から確定まで共有ロックで残骸整理から保護する。
        $lease = fopen($temporary . '.lock', 'c+b');
        demand($lease !== false && flock($lease, LOCK_SH), 503, 'Upload lease unavailable');
        try {
            $output = fopen($temporary, 'wb');
            $hash = hash_init('sha256');
            $received = 0;
            try {
                while (!feof($input)) {
                    $chunk = fread($input, 65536);
                    demand($chunk !== false, 400, 'Upload interrupted');
                    $received += strlen($chunk);
                    demand($received <= $envelope['bytes'] && $received <= $maximum, 413, 'Asset too large');
                    hash_update($hash, $chunk);
                    demand(fwrite($output, $chunk) === strlen($chunk), 503, 'Upload storage failed');
                }
                fflush($output);
            } finally { fclose($output); }
            demand($received === $envelope['bytes'] && hash_equals($envelope['payloadDigest'], hash_final($hash)), 400, 'Upload length or digest mismatch');
            // 同じ素材に対する確定だけを直列化し、長い受信中は公開ロックを持たない。
            return $this->store->locked($id, function () use ($envelope, $temporary, $id, $kind, $received): array {
                $metadataPath = $this->store->root . "/assets/$id.json";
                if (is_file($metadataPath)) {
                    $existing = $this->get($id, $envelope['gameId']);
                    demand($existing['digest'] === $envelope['payloadDigest'] && $existing['uploadId'] === $envelope['operationId'] && $existing['kind'] === $kind && $existing['mime'] === $envelope['mime'], 409, 'Immutable asset conflict');
                    return $existing;
                }
                $metadata = $this->inspect($temporary, $kind);
                demand($metadata['mime'] === $envelope['mime'], 400, 'Declared media type mismatch');
                $asset = array_merge($metadata, ['id' => $id, 'gameId' => $envelope['gameId'], 'uploadId' => $envelope['operationId'], 'kind' => $kind, 'bytes' => $received, 'status' => 'verified', 'digest' => $envelope['payloadDigest']]);
                $destination = $this->path($id);
                if (file_exists($destination)) {
                    // ファイル確定直後の停止から復旧する。同じ内容以外は上書きしない。
                    demand(!is_link($destination) && hash_file('sha256', $destination) === $asset['digest'], 409, 'Immutable asset conflict');
                } else demand(rename($temporary, $destination), 503, 'Asset commit failed');
                chmod($destination, 0600);
                $this->store->atomicJson($metadataPath, $asset);
                return $asset;
            });
        } finally { if (is_file($temporary)) unlink($temporary); flock($lease, LOCK_UN); fclose($lease); unlink($temporary . '.lock'); }
    }
    /** @brief getID3とGDで拡張子に依存せず標準音源・静止画を検証する。 @param string $path 私有一時ファイル。 @param string $kind 用途。 @return array 実体メタデータ。 */
    private function inspect(string $path, string $kind): array {
        $metadata = ['durationSeconds' => null, 'sampleRateHz' => null, 'channels' => null, 'widthPixels' => null, 'heightPixels' => null];
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path);
        if ($kind === 'image') {
            $types = ['image/jpeg' => IMAGETYPE_JPEG, 'image/png' => IMAGETYPE_PNG, 'image/webp' => IMAGETYPE_WEBP];
            $dimensions = @getimagesize($path);
            demand(isset($types[$mime]) && $dimensions !== false && $dimensions[2] === $types[$mime] && min($dimensions[0], $dimensions[1]) > 0 && max($dimensions[0], $dimensions[1]) <= $this->policy['media']['maxImageEdgePixels'], 400, 'Invalid image format or dimensions');
            // 容量・寸法を検証してからGDを使い、壊れた画像を検証済みにしない。
            $image = match ($mime) { 'image/jpeg' => @imagecreatefromjpeg($path), 'image/png' => @imagecreatefrompng($path), 'image/webp' => @imagecreatefromwebp($path) };
            demand($image !== false, 400, 'Image decoding failed');
            imagedestroy($image);
            return array_merge($metadata, ['mime' => $mime, 'widthPixels' => $dimensions[0], 'heightPixels' => $dimensions[1]]);
        }
        demand(in_array($mime, ['audio/mpeg', 'audio/x-wav', 'audio/wav', 'audio/vnd.wave'], true), 400, 'Only MP3 and PCM WAV are supported');
        $parser = new getID3();
        $parser->option_tag_id3v1 = false;
        $parser->option_tag_id3v2 = false;
        $info = $parser->analyze($path);
        demand(empty($info['error']) && in_array($info['fileformat'] ?? '', ['mp3', 'wav'], true), 400, 'Invalid audio content');
        $audio = $info['audio'] ?? [];
        $wav = ($info['fileformat'] ?? '') === 'wav';
        demand(!$wav || (($audio['wformattag'] ?? 0) === 1 && in_array($audio['bits_per_sample'] ?? 0, [8, 16, 24, 32], true)), 400, 'Only PCM WAV is supported');
        $duration = $info['playtime_seconds'] ?? 0;
        demand(is_numeric($duration) && $duration > 0 && $duration <= $this->policy['media']['maxAudioDurationSeconds'] && ($audio['sample_rate'] ?? 0) > 0 && in_array($audio['channels'] ?? 0, [1, 2], true), 400, 'Invalid audio duration or channels');
        return array_merge($metadata, ['mime' => $wav ? 'audio/wav' : 'audio/mpeg', 'durationSeconds' => $duration, 'sampleRateHz' => $audio['sample_rate'], 'channels' => $audio['channels']]);
    }
}
