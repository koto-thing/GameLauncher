<?php
declare(strict_types=1);
namespace PandDLtMail;
use Throwable;
require_once __DIR__.'/receipt_cleanup.php';
// 既定は無効。設定はWeb公開領域外のファイルだけを読む
// 外部エラーの引数に宛先や確認URLを残さない
ini_set('display_errors', '0');
ini_set('zend.exception_ignore_args', '1');
set_error_handler(static function (): bool { return true; });
header('Content-Type: application/json');
header('Cache-Control: no-store');
function reply(int $status, string $result): never {
    http_response_code($status); echo json_encode(['result'=>$result]); exit;
}
$path = getenv('LT_MAIL_PRIVATE_CONFIG');
if (!$path || !is_file($path)) reply(503, 'temporary');
$c = require $path;
if (($c['enabled'] ?? false) !== true && ($c['retention_enabled'] ?? false) !== true) reply(503, 'temporary');
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || ($_SERVER['HTTPS'] ?? '') !== 'on') reply(403, 'permanent');
$auth = $_SERVER['HTTP_X_LT_MAIL_AUTH'] ?? '';
if (!is_string($c['bearer'] ?? null) || strlen($c['bearer']) < 32 || !hash_equals('Bearer '.$c['bearer'], $auth)) reply(401, 'permanent');
if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) reply(400, 'permanent');
$raw = file_get_contents('php://input', false, null, 0, 8193);
if ($raw === false || strlen($raw) > 8192) reply(400, 'permanent');
try { $v = json_decode($raw, true, 16, JSON_THROW_ON_ERROR); } catch (Throwable $e) { reply(400, 'permanent'); }
// 掃除は配送と独立した既定OFF gateで、固定命令だけを受け付ける
if ($v === ['operation'=>'cleanup']) {
    try { $result = cleanup_receipts($c, time()); }
    catch (Throwable $e) { reply(503, 'temporary'); }
    http_response_code(200); echo json_encode($result); exit;
}
if (($c['enabled'] ?? false) !== true) reply(503, 'temporary');
$keys = ['id','recipient','kind','expires','action_url'];
if (!is_array($v) || array_diff(array_keys($v),$keys) || array_diff($keys,array_keys($v))) reply(422,'permanent');
foreach (['id','recipient','kind'] as $key) if (!is_string($v[$key]) || $v[$key] === '' || strpbrk($v[$key],"\r\n") !== false) reply(422,'permanent');
if (strlen($v['id']) > 200 || !filter_var($v['recipient'], FILTER_VALIDATE_EMAIL) || !is_int($v['expires']) || $v['expires'] <= time()) reply(410,'permanent');
$kinds=['submitted','approved','returned','reapproved','rejected','withdrawalConfirmed','eventCancelled','emailConfirmation','emailChanged','materialReminder','scheduleChanged'];
if (!in_array($v['kind'],$kinds,true)) reply(422,'permanent');
// 件名・本文・From・返信先は呼出元から指定できない
$url = $v['action_url'];
if (!is_string($url) || strlen($url)>4096 || strpbrk($url,"\r\n")!==false) reply(422,'permanent');
$u=parse_url($url); $origin=$c['public_origin'] ?? '';
if (!$u || ($u['scheme'] ?? '')!=='https' || isset($u['user']) || isset($u['pass']) || isset($u['fragment']) || isset($u['port']) || 'https://'.($u['host'] ?? '')!==$origin || !in_array($u['path'] ?? '',['/applications','/auth/verify','/auth/email-change'],true)) reply(422,'permanent');
if ($v['kind']==='emailConfirmation' && (!in_array($u['path'] ?? '',['/auth/verify','/auth/email-change'],true) || $v['expires']>time()+3600)) reply(422,'permanent');
if ($v['kind']!=='emailConfirmation' && (($u['path'] ?? '')!=='/applications' || isset($u['query']))) reply(422,'permanent');
if (!filter_var($c['from'] ?? '',FILTER_VALIDATE_EMAIL) || strpbrk($c['from'],"\r\n")!==false) reply(503,'temporary');
$dir=$c['private_dir'] ?? '';
if (!is_dir($dir) || !is_writable($dir)) reply(503,'temporary');
// 全要求で同じ排他lockを取り、receiptと契約全体上限の予約を一体化する
try { $lock=dispatch_lock($dir); } catch (Throwable $e) { reply(503,'temporary'); }
$file=$dir.'/'.hash('sha256',$v['id']).'.json';
$hash=hash('sha256',$raw);
if (is_file($file)) {
 $r=json_decode(file_get_contents($file),true);
 if (($r['hash'] ?? '')!==$hash) reply(409,'permanent');
 reply(($r['state'] ?? '')==='accepted'?200:409,($r['state'] ?? '')==='accepted'?'accepted':'uncertain');
}
// rolling windowを保守的に80/h、800/dayへ抑える。他アプリの利用量は別途運用確認
$rateFile=$dir.'/rate.json';
$times=is_file($rateFile)?json_decode(file_get_contents($rateFile),true):[];
if (!is_array($times)) reply(503,'temporary');
$times=array_values(array_filter($times,fn($t)=>is_int($t) && $t>time()-86400));
if (count($times)>=800 || count(array_filter($times,fn($t)=>$t>time()-3600))>=80) reply(429,'temporary');
$times[]=time();
if (file_put_contents($rateFile,json_encode($times),LOCK_EX)===false || file_put_contents($file,json_encode(['hash'=>$hash,'state'=>'uncertain','expires'=>$v['expires']]),LOCK_EX)===false) reply(503,'temporary');
// 呼出前に結果不明receiptを保存。クラッシュ後の自動再送を防ぐ
if ($v['expires']<=time()) reply(410,'permanent');
$notice=match($v['kind']) {
 'materialReminder' => "資料の提出期限が近づいています。未提出の場合は資料URLを登録してください。提出済みの場合は運営の確認待ちです。\n",
 'scheduleChanged' => "開催日時または発表時刻が変更されました。本人申請画面で最新の時刻を確認してください。\n",
 default => "LT会からのお知らせです。\n",
};
$subject=$v['kind']==='emailConfirmation'?'LT会 メールアドレスの確認':'LT会からのお知らせ';
$subject='=?UTF-8?B?'.base64_encode($subject).'?=';
$body=$v['kind']==='emailConfirmation'?"LT会サイトのメールアドレス確認です。\n以下の確認リンクは1時間有効です。\n".$url."\n問い合わせ: panddmail@gmail.com\n":$notice."本人申請画面で状態を確認してください。\n".$url."\n問い合わせ: panddmail@gmail.com\n";
try {
 $ok=mail($v['recipient'],$subject,$body,['From'=>$c['from'],'Reply-To'=>'panddmail@gmail.com','Content-Type'=>'text/plain; charset=UTF-8']);
} catch (Throwable $e) { reply(409,'uncertain'); }
if (!$ok) reply(409,'uncertain');
if (file_put_contents($file,json_encode(['hash'=>$hash,'state'=>'accepted','expires'=>$v['expires']]),LOCK_EX)===false) reply(409,'uncertain');
reply(200,'accepted');
