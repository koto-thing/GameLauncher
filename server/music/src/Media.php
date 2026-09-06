<?php
declare(strict_types=1);

/** @brief 公開判定後のGET/HEAD/単一Rangeを全量バッファなしで送信する。 */
final class Media {
    /** @brief byte rangeを解決する。複数Rangeは416として明示拒否する。 @param string|null $header Rangeヘッダー。 @param int $size 実容量。 @return array|null [offset,length]または全体。 */
    public static function range(?string $header, int $size): ?array {
        if ($header === null) return null;
        demand(preg_match('/^bytes=(\d*)-(\d*)$/D', $header, $parts) === 1 && ($parts[1] !== '' || $parts[2] !== ''), 416, 'Unsupported byte range');
        if ($parts[1] === '') {
            $length = min((int)$parts[2], $size);
            demand($length > 0, 416, 'Invalid suffix range');
            return [$size - $length, $length];
        }
        $start = (int)$parts[1];
        $end = $parts[2] === '' ? $size - 1 : min((int)$parts[2], $size - 1);
        demand($start < $size && $end >= $start, 416, 'Range not satisfiable');
        return [$start, $end - $start + 1];
    }
    /** @brief 現在版で認可済みの素材を固定長のチャンクで送る。 @param Assets $assets 私有素材。 @param array $asset メタデータ。 @param string $method GETまたはHEAD。 @param string|null $rangeHeader 単一Range。 @return void */
    public static function send(Assets $assets, array $asset, string $method, ?string $rangeHeader): void {
        $size = $asset['bytes'];
        header('Accept-Ranges: bytes');
        header('Content-Type: ' . $asset['mime']);
        header('Content-Disposition: inline');
        try { $range = $method === 'HEAD' ? null : self::range($rangeHeader, $size); }
        catch (Failure $failure) {
            header("Content-Range: bytes */$size");
            header('Content-Length: 0');
            http_response_code($failure->status);
            return;
        }
        [$offset, $length] = $range ?? [0, $size];
        header('Content-Length: ' . $length);
        if ($range) {
            http_response_code(206);
            header('Content-Range: bytes ' . $offset . '-' . ($offset + $length - 1) . '/' . $size);
        }
        if ($method === 'HEAD') return;
        $handle = fopen($assets->path($asset['id']), 'rb');
        demand($handle !== false, 503, 'Media unavailable');
        try {
            fseek($handle, $offset);
            while ($length > 0 && !feof($handle) && !connection_aborted()) {
                $chunk = fread($handle, min(65536, $length));
                if ($chunk === false || $chunk === '') break;
                echo $chunk;
                $length -= strlen($chunk);
            }
        } finally { fclose($handle); }
    }
}
