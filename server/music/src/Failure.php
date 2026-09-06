<?php
declare(strict_types=1);

/** @brief 内部パスや秘密をHTTPへ出さない業務例外。 */
final class Failure extends RuntimeException {
    /** @brief HTTP状態と公開用説明を保持する。 @param int $status HTTP状態。 @param string $message 公開してよい説明。 */
    public function __construct(public readonly int $status, string $message) { parent::__construct($message); }
}

/** @brief 不正な条件を安全なHTTP失敗へ変換する。 @param bool $condition 必須条件。 @param int $status HTTP状態。 @param string $message 公開説明。 @return void */
function demand(bool $condition, int $status, string $message): void {
    if (!$condition) throw new Failure($status, $message);
}

/** @brief パスに使えるサーバー発行UUIDだけを許可する。 @param mixed $value ID。 @return string 検証済みUUID。 */
function musicId(mixed $value): string {
    demand(is_string($value) && preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D', $value) === 1, 400, 'Invalid identifier');
    return $value;
}
