<?php
declare(strict_types=1);

/** @brief document root外の固定領域だけでファイル・ロックを扱う。 */
final class Store {
    /** @brief 私有領域が公開ディレクトリ外であることを検証する。 @param string $root 私有領域。 @param string $public document root。 */
    public function __construct(public readonly string $root, string $public) {
        if (!is_dir($root)) mkdir($root, 0700, true);
        $resolved = realpath($root);
        $web = realpath($public);
        demand($resolved !== false && $web !== false && !is_link($root), 503, 'Private storage unavailable');
        demand(!str_starts_with(strtolower(str_replace('\\', '/', $resolved)) . '/', strtolower(str_replace('\\', '/', $web)) . '/'), 503, 'Storage must be outside document root');
        foreach (['assets', 'tmp', 'snapshots', 'nonces', 'locks'] as $directory) {
            if (!is_dir("$root/$directory")) mkdir("$root/$directory", 0700);
            demand(!is_link("$root/$directory"), 503, 'Invalid storage directory');
        }
    }
    /** @brief 安定したロックファイルで限定された変更を排他化する。 @param string $name 内部ロック名。 @param callable $work ロック中の処理。 @return mixed 処理結果。 */
    public function locked(string $name, callable $work): mixed {
        $path = "$this->root/locks/$name.lock";
        demand(!is_link($path), 503, 'Invalid lock');
        $lock = fopen($path, 'c+b');
        demand($lock !== false && flock($lock, LOCK_EX), 503, 'Lock unavailable');
        try { return $work(); } finally { flock($lock, LOCK_UN); fclose($lock); }
    }
    /** @brief 同じファイルシステム内の一時ファイルから参照を置換する。 @param string $path 内部保存先。 @param array $value JSON。 @return void */
    public function atomicJson(string $path, array $value): void {
        demand(!is_link($path), 503, 'Invalid storage entry');
        $temporary = tempnam(dirname($path), '.write-');
        try {
            $json = json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $handle = fopen($temporary, 'wb');
            demand($handle !== false, 503, 'Storage unavailable');
            try {
                demand(fwrite($handle, $json) === strlen($json) && fflush($handle), 503, 'Storage write failed');
                if (function_exists('fsync')) demand(fsync($handle), 503, 'Storage sync failed');
            } finally { fclose($handle); }
            demand(rename($temporary, $path), 503, 'Storage switch failed');
            chmod($path, 0600);
        } finally { if (is_file($temporary)) unlink($temporary); }
    }
    /** @brief 破損を初回未公開と混同せずJSONを読む。 @param string $path 内部保存先。 @return array 検証済みJSON。 */
    public function json(string $path): array {
        demand(is_file($path) && !is_link($path), 503, 'Publication unavailable');
        try { $value = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR); }
        catch (Throwable) { throw new Failure(503, 'Publication corrupt'); }
        demand(is_array($value), 503, 'Publication corrupt');
        return $value;
    }
    /** @brief 初回状態を明示初期化する。 @return void */
    public function initialize(): void {
        $this->locked('publication', function (): void {
            // initializedを先に記録し、current消失時に未公開へ巻き戻さない。
            if (is_file("$this->root/initialized")) return;
            demand(file_put_contents("$this->root/initialized", '1', LOCK_EX) === 1, 503, 'Initialization failed');
            $name = bin2hex(random_bytes(16));
            $this->atomicJson("$this->root/snapshots/$name.json", ['revision' => 0, 'games' => [], 'scopes' => [], 'receipts' => [], 'advertisement' => ['enabled' => false]]);
            $this->atomicJson("$this->root/current.json", ['snapshot' => $name]);
        });
    }
    /** @brief 1要求で1つの現在版を解決し、履歴へフォールバックしない。 @return array 現在の完全snapshot。 */
    public function current(): array {
        $reference = $this->json("$this->root/current.json");
        demand(is_string($reference['snapshot'] ?? null) && preg_match('/^[a-f0-9]{32}$/D', $reference['snapshot']) === 1, 503, 'Publication corrupt');
        $value = $this->json("$this->root/snapshots/{$reference['snapshot']}.json");
        demand(isset($value['revision'], $value['games'], $value['scopes'], $value['receipts'], $value['advertisement']), 503, 'Publication corrupt');
        return $value;
    }
    /** @brief 実行時間上限を越えて古い非現在snapshotを削除する。 @param string $currentName 現在snapshot名。 @return void */
    public function pruneSnapshots(string $currentName): void {
        demand(preg_match('/^[a-f0-9]{32}$/D', $currentName) === 1, 503, 'Invalid current snapshot');
        $threshold = time() - 300;
        foreach (glob($this->root . '/snapshots/*.json') as $file) {
            if (basename($file) !== "$currentName.json" && is_file($file) && !is_link($file) && filemtime($file) < $threshold) demand(unlink($file), 503, 'Snapshot cleanup failed');
        }
    }
}
