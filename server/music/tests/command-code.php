<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/Failure.php';
require_once __DIR__ . '/../src/CommandCodes.php';
/** @brief assertの無効化に依存せず失敗を検出する。 */
function verify(bool $ok): void { if (!$ok) throw new RuntimeException('Command vector mismatch'); }
$vectors = json_decode(file_get_contents(__DIR__ . '/../../../contracts/music/command-code-vectors.json'), true, 32, JSON_THROW_ON_ERROR);
verify(CommandCodes::crc('123456789') === 0xf5b);
foreach ($vectors as $v) {
    verify(CommandCodes::decode('v1', $v['code']) === $v['id']);
    verify(CommandCodes::crc("PDM\x01" . substr(pack('N', $v['id']), 1)) === $v['crc']);
    for ($i = 0; $i < 12; $i++) foreach (str_split('UDRLABXY') as $c) {
        if ($c === $v['code'][$i]) continue;
        $changed = $v['code']; $changed[$i] = $c;
        try { CommandCodes::decode('v1', $changed); throw new RuntimeException('Accepted invalid substitution'); }
        catch (Failure $e) { verify($e->status === 400); }
    }
}
try { CommandCodes::decode('v2', $vectors[0]['code']); throw new RuntimeException('Accepted unknown version'); }
catch (Failure $e) { verify($e->status === 400); }
echo "PHP CRC vectors and 336 single-symbol substitutions passed\n";
