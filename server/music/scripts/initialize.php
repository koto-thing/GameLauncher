<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
// CLIだけに初期化を限定し、APIから壊れた公開状態を初期化しない。
if (PHP_SAPI !== 'cli') exit(1);
[, , $store] = musicServices();
$store->initialize();
echo "Private publication initialized\n";
