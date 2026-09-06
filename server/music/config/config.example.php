<?php
// このファイルをdocument root外のlocal.phpへコピーし、実値をGitへ保存しない。
return [
    'environment' => 'production',
    'documentRoot' => '/absolute/path/to/music/public',
    'storageRoot' => '/absolute/private/path/to/music-data',
    'basePath' => '',
    'bridgePath' => '/bridge.php',
    'keys' => ['primary' => 'REPLACE_WITH_A_SEPARATE_RANDOM_SECRET_AT_LEAST_32_BYTES'],
    'contactUrl' => '',
];
