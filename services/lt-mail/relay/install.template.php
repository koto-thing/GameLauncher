<?php
// LT専用配置の一時入口。配備時に固定本文ハッシュと短い期限を埋め、配置後に撤去する
// 対象はLT専用ディレクトリのみ。任意パス・URL・コマンドを受け付けない
ini_set('display_errors', '0');
ini_set('zend.exception_ignore_args', '1');
set_error_handler(static function (): bool { return true; });
header('Content-Type: application/json');
header('Cache-Control: no-store');
const LT_INSTALL_DEADLINE = 0;
const LT_INSTALL_FRESH = true;
const LT_INSTALL_BODY_SHA256 = '';
const LT_INSTALL_BEARER_SHA256 = '';

/** @brief 秘密や絶対パスを返さず配置結果だけを返す */
function lt_install_reply(int $status, bool $installed): never {
    http_response_code($status);
    echo json_encode(['installed'=>$installed]);
    exit;
}

if (LT_INSTALL_DEADLINE <= time() || LT_INSTALL_DEADLINE > time()+1800 || ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || ($_SERVER['HTTPS'] ?? '') !== 'on') lt_install_reply(403, false);
$auth = $_SERVER['HTTP_X_LT_MAIL_AUTH'] ?? '';
if (!is_string($auth) || !str_starts_with($auth, 'Bearer ') || !hash_equals(LT_INSTALL_BEARER_SHA256, hash('sha256', substr($auth, 7)))) lt_install_reply(401, false);
$raw = file_get_contents('php://input', false, null, 0, 131073);
if (!is_string($raw) || strlen($raw)>131072 || !hash_equals(LT_INSTALL_BODY_SHA256, hash('sha256', $raw))) lt_install_reply(400, false);
try {
    $p = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
    if (!is_array($p) || array_keys($p)!==['relay','cleanup','bearer','retention'] || !is_string($p['bearer']) || strlen($p['bearer'])!==64 || !ctype_xdigit($p['bearer']) || !is_bool($p['retention']) || !hash_equals(LT_INSTALL_BEARER_SHA256, hash('sha256', $p['bearer']))) lt_install_reply(400, false);
    // 既存Music配備のWebルート構造だけを確認し、他アプリのファイルは読まない
    $web = dirname(__DIR__);
    if (basename(__DIR__)!=='pandd-music' || basename($web)!=='web' || is_link(__DIR__) || is_link($web)) lt_install_reply(409, false);
    $private = dirname($web).'/pandd-lt-private';
    if (is_link($private)) lt_install_reply(409, false);
    $config = ['enabled'=>true, 'retention_enabled'=>$p['retention'], 'bearer'=>$p['bearer'], 'from'=>'info@koto-thing.com', 'public_origin'=>'https://lt.koto-thing.com', 'private_dir'=>$private.'/receipts'];
    if (file_exists($private) && !is_dir($private)) lt_install_reply(409, false);
    if (is_dir($private)) {
        if (LT_INSTALL_FRESH) lt_install_reply(409, false);
        // 再要求は同一LT鍵・同一コードに限る。既存の別所有領域を上書きしない
        if (is_link($private.'/config.php') || !is_file($private.'/config.php')) lt_install_reply(409, false);
        $oldHash = hash_file('sha256', $private.'/config.php');
        $allowed = [];
        foreach ([false, true] as $retention) {
            $oldConfig = $config; $oldConfig['retention_enabled'] = $retention;
            $allowed[] = hash('sha256', '<?php return '.var_export($oldConfig, true).';');
        }
        if (!in_array($oldHash, $allowed, true)) lt_install_reply(409, false);
    } elseif (!mkdir($private, 0700)) lt_install_reply(503, false);
    if (is_link($private.'/install.lock')) lt_install_reply(409, false);
    $lock = fopen($private.'/install.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) lt_install_reply(503, false);
    foreach (['relay'=>'relay.php','cleanup'=>'receipt_cleanup.php'] as $key=>$name) {
        $code = base64_decode($p[$key], true);
        if (!is_string($code) || !str_starts_with($code, '<?php') || is_link($private.'/'.$name)) lt_install_reply(400, false);
        if (is_file($private.'/'.$name) && !hash_equals(hash('sha256', $code), hash_file('sha256', $private.'/'.$name))) lt_install_reply(409, false);
        if (!is_file($private.'/'.$name) && file_put_contents($private.'/'.$name, $code, LOCK_EX)!==strlen($code)) lt_install_reply(503, false);
        chmod($private.'/'.$name, 0600);
    }
    if (!is_dir($private.'/receipts') && !mkdir($private.'/receipts', 0700)) lt_install_reply(503, false);
    if (is_link($private.'/receipts') || is_link($private.'/config.php') || is_link($private.'/config.next.php')) lt_install_reply(409, false);
    $code = '<?php return '.var_export($config, true).';';
    if (file_put_contents($private.'/config.next.php', $code, LOCK_EX)!==strlen($code) || !chmod($private.'/config.next.php', 0600) || !rename($private.'/config.next.php', $private.'/config.php')) lt_install_reply(503, false);
    lt_install_reply(200, true);
} catch (Throwable $e) {
    lt_install_reply(503, false);
}
