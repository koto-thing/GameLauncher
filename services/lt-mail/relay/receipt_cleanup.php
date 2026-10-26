<?php
declare(strict_types=1);
namespace PandDLtMail;

/** @brief 送信と掃除を同じ非公開lockで直列化する */
function dispatch_lock(string $dir) {
    if (!is_dir($dir) || !is_writable($dir) || is_link($dir.'/dispatch.lock')) throw new \RuntimeException('Unavailable');
    $lock = fopen($dir.'/dispatch.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new \RuntimeException('Unavailable');
    return $lock;
}

/** @brief 元の期限に到達したreceiptだけを整理し、個人情報を返さない */
function cleanup_receipts(array $config, int $now): array {
    if (($config['retention_enabled'] ?? false) !== true) throw new \RuntimeException('Disabled');
    $dir = $config['private_dir'] ?? '';
    $lock = dispatch_lock($dir);
    try {
        $expired = [];
        // 不明なファイルや壊れたreceiptを見つけたら削除を始めない
        $names = scandir($dir);
        if ($names === false) throw new \RuntimeException('Unavailable');
        foreach ($names as $name) {
            if (in_array($name, ['.', '..', 'dispatch.lock', 'rate.json'], true)) continue;
            $path = $dir.'/'.$name;
            if (!preg_match('/^[a-f0-9]{64}\.json$/D', $name) || is_link($path) || !is_file($path)) throw new \RuntimeException('Invalid receipt');
            $value = json_decode(file_get_contents($path), true);
            if (!is_array($value) || count($value) !== 3 || !is_string($value['hash'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $value['hash']) || !in_array($value['state'] ?? '', ['accepted', 'uncertain'], true) || !is_int($value['expires'] ?? null)) throw new \RuntimeException('Invalid receipt');
            if ($value['expires'] <= $now) $expired[] = $path;
        }
        $ratePath = $dir.'/rate.json';
        if (is_link($ratePath)) throw new \RuntimeException('Invalid rate');
        $times = is_file($ratePath) ? json_decode(file_get_contents($ratePath), true) : [];
        if (!is_array($times) || !array_is_list($times)) throw new \RuntimeException('Invalid rate');
        foreach ($times as $time) if (!is_int($time)) throw new \RuntimeException('Invalid rate');
        $times = array_values(array_filter($times, fn($time) => $time > $now - 86400));
        // 一回の実行量を制限し、残りは次の定期処理で再選択する
        $deleted = 0;
        foreach (array_slice($expired, 0, 100) as $path) {
            if (!unlink($path)) throw new \RuntimeException('Cleanup incomplete');
            $deleted++;
        }
        if (file_put_contents($ratePath, json_encode($times), LOCK_EX) === false) throw new \RuntimeException('Cleanup incomplete');
        return ['result'=>'accepted', 'deleted'=>$deleted, 'more'=>count($expired)>$deleted];
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
