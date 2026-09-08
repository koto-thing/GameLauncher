<?php
declare(strict_types=1);

/** @brief 公開v1形式を検査する。CRCは認証・訂正の代わりにしない。 */
final class CommandCodes {
    private const ALPHABET = 'UDRLABXY';
    /** @brief バイト列からCRC-12/DECTを独立計算する。 */
    public static function crc(string $bytes): int {
        $crc = 0;
        foreach (unpack('C*', $bytes) as $byte) {
            $crc ^= $byte << 4;
            for ($i = 0; $i < 8; $i++) $crc = (($crc << 1) ^ (($crc & 0x800) ? 0x80f : 0)) & 0xfff;
        }
        return $crc;
    }
    /** @brief 署名本文の予約DTOも厳密な範囲と版で検証する。 */
    public static function assignment(mixed $value): array {
        demand(is_array($value) && ($value['version'] ?? null) === 1 && is_int($value['codeId'] ?? null) && $value['codeId'] >= 0 && $value['codeId'] <= 0xffffff, 400, 'Invalid command assignment');
        return ['version' => 1, 'codeId' => $value['codeId']];
    }
    /** @brief 長さ・記号・CRCが一致した場合だけIDを返す。 */
    public static function decode(string $version, string $code): int {
        demand($version === 'v1' && preg_match('/^[UDRLABXY]{12}$/D', $code) === 1, 400, 'Invalid command code');
        $digits = '';
        foreach (str_split($code) as $symbol) $digits .= (string)strpos(self::ALPHABET, $symbol);
        $id = intval(substr($digits, 0, 8), 8);
        $bytes = "PDM\x01" . substr(pack('N', $id), 1);
        demand(self::crc($bytes) === intval(substr($digits, 8), 8), 400, 'Invalid command code');
        return $id;
    }
    /** @brief 過去版・管理DBを探索せず現在snapshot内だけで公開曲を照会する。 */
    public static function resolve(array $snapshot, string $version, string $code): array {
        $id = self::decode($version, $code);
        foreach ($snapshot['games'] as $game) {
            foreach ($game['tracks'] as $track) {
                if (($track['commandCode']['version'] ?? null) === 1 && ($track['commandCode']['codeId'] ?? null) === $id) return ['trackId' => $track['id']];
            }
        }
        throw new Failure(404, 'Not found');
    }
    /** @brief 公開世代内の重複IDを拒否し、別曲への曖昧な誘導を防ぐ。 */
    public static function unique(array $games): void {
        $seen = [];
        foreach ($games as $game) foreach ($game['tracks'] as $track) {
            if (!isset($track['commandCode'])) continue;
            $value = self::assignment($track['commandCode']);
            demand(!isset($seen[$value['codeId']]), 400, 'Duplicate command assignment');
            $seen[$value['codeId']] = true;
        }
    }
}
