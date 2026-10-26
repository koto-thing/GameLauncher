<?php
// LT設定と配送記録はWeb外へ配置し、Musicの設定を読み込まない
$ltPrivate = dirname(__DIR__, 2).'/pandd-lt-private';
if (basename(__DIR__)!=='pandd-music' || basename(dirname(__DIR__))!=='web' || !is_file($ltPrivate.'/relay.php')) {
    http_response_code(503);
    header('Content-Type: application/json');
    echo '{"result":"temporary"}';
    exit;
}
putenv('LT_MAIL_PRIVATE_CONFIG='.$ltPrivate.'/config.php');
require $ltPrivate.'/relay.php';
