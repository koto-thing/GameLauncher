# 保持期限処理の運用境界

本人sessionは24時間、保持期限は日本時間で終了／中止から3暦月後の同日時（存在しない日は月末）で確定している。通常開催の公開アーカイブは保持し、中止回の旧公開情報も期限で削除する。

`LT_RETENTION_ENABLED` は既定 `false`。本人API・運営RPC・mail・maintenanceとは独立し、明示した場合だけscheduled内で動く。公開HTTP／運営RPCの削除APIはない。`LOCAL_AUTH`やtest featureを混ぜたproductionは許可しない。今回の変更は実装だけで、本番cronと削除gateは有効にしていない。

scheduledは未知schemaで止まり、期限到達済みの私有子表が残る開催を一件ずつ選ぶ。既存の固定anchor検査、候補固定、archive marker、D1 atomic batchを共用する。途中失敗で一部だけ確定させない。開催候補がなくても、後から失効した孤立認証・認証通知・配送payload・過去rate bucketを掃除する。テスト用の故障注入と`retention_test` exportは通常bundleに含めない。

PHPは `relay.php`（実配置名 `lt-mail.php`）と同じディレクトリへ `receipt_cleanup.php` も配置する。Web外設定の `retention_enabled` も既定 `false`。`private_dir`はreceipt専用にし、秘密設定ファイルはそのディレクトリの外へ置く。既存のHTTPS／POST／専用bearer認証を通した固定命令 `{"operation":"cleanup"}` だけを受け付ける。任意path・対象ID・期限を指定できず、メールの `enabled` がfalseでも独立して掃除できる。一般利用者のフォームや公開APIにはこの操作を提供しない。

receiptは配送IDのhashを名前にし、本文hash・状態・元の配送期限だけを保存する。宛先・確認URL・tokenは保存しない。送信と同じlockを保持し、全ファイルの形式を確認してから期限到達済みreceiptを一回最大100件削除する。未来receipt、未知file、symlink、壊れた記録を勝手に削除しない。unlinkや保存の失敗を成功扱いせず、件数以外を応答・ログへ出さない。rateの古い時刻も既存24時間窓に従い整理する。

再送防止は元の固定配送期限内で同じenvelopeに適用する。期限後は元リクエスト自体が拒否され、Workerは同じ配送IDの期限延長・再利用をしない。期限切れreceipt削除後に改変された認証済みpayloadを永久に識別する保証はしない。外部配送のexactly-onceや結果不明後の自動再送を約束しない。

検証は `tests/verify_retention_scheduled.py`（production featureのlocal Worker／専用架空D1）、既存retention runtimeの38＋10段階rollback、`services/lt-mail/tests/php_receipt_test.py`（localhost PHP／mail stub／独立processのlock競合）を使用する。PHP CLIがなければ成功扱いのfallbackをせず、CIで必須実行する。実メールや運用データを用いない。

本番有効化には別途の明示確認が必要。確認後に独立した両gateと定期実行、失敗監視・再試行を設定する。一般公開のread-onlyを先行できても、物理削除OFFのまま申請を受け付け「3か月で自動削除する完成版」とは案内しない。期限後の読取拒否だけでは物理削除要件の完了にはならない。
