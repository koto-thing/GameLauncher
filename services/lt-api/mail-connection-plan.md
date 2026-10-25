# lt-mail API 接続の調査と保留境界

対象は既存ログイン確認メールと業務outbox。例外メール変更の仕様依存実装は含めない。実送信・秘密設定・本番操作は行わない。

## 承認待ちの操作

`git cherry-pick b8bd297b1655ce2c82e0ef0e9588de6f2ce2a8fd`、続いて`30c630e470b04258edba557a1b3871cb49bf5a36`を自分の隔離branchへ取り込む要求が、自動承認レビューで拒否された。別worktreeのservices/lt-mailへの変更取り込みについて直接の許可確認が必要との理由。コマンドは実行されていない。別経路でソースを複製することもしない。

読取で確認した差分範囲は前者がservices/lt-mailの10ファイル、後者が同relay/relay.phpの1ファイルだけ。API本体・共有契約・番号付きmigrationの変更は含まれない。取り込み対象と範囲を明示した承認が得られてから接続・検証へ進む。

## 接続上の具体的な調整点

1. API Cargoへlt-mailのpath依存（worker-runtime）を追加する。固定版の既存worker/serdeと一致するため新しい外部サービス依存は不要。
2. 既存lt_outboxはapplication_id NOT NULLであり、ログイン確認は申請に所属しない。架空のapplication IDを埋めず、申請通知と認証通知を区別できるoutbox構造を決める必要がある。token/session削除を開催回のメール一致に連動させない。
3. token作成・旧未使用リンク失効・確認outbox投入は同一D1 batch/transactionとする。認証用保存値はhash、送信用action_urlは私有payloadとして1時間以下の期限を持つ。fake_mailの取得口は送信完了したfake結果のみを読ませ、公開ルートやCLI/logへURLを出さない。
4. Envelope.expiresは秒、既存outbox/private_expiresはミリ秒。期限を超えないようfloor(ms/1000)で変換する。業務メールはmin(作成時刻+24h,固定保持期限)、確認メールはmin(token期限,作成時刻+1h)とし、NULL保持期限を無期限送信へ読み替えない。
5. lt_mail_modeは既定disabled。API側はDisabled/Fakeだけを選べる構成にし、HTTP/SMTPの秘密取得・設定・送信を追加しない。旧fake_dispatchが同じmode=fakeを検査するだけでは新engineと同時実行できてしまうため、旧実装を残して並走させず同じclaim/fenceを使う単一配送経路へ集約する。
6. lt-mail runtimeは現在Date::nowを直接使用する。APIの固定testclockと、lease/期限/再試行の時刻を揃える接続点が必要。通常構成には固定時計や外部から指定できるtransportを公開しない。
7. 提案SQLのlt_mail_jobsはlt_outbox(id)を参照し、expires短縮triggerを持つ。中止・通常終了の固定期限が全jobへ短縮され、期限到達時にenvelopeの宛先/linkも取得・再送不可となることをD1で確認する。retention担当へjob/envelope/認証outboxの所属一覧を渡す。
8. PHP安全追補はdisplay/log errorsを止め、mail例外を固定結果に変換する変更。PHP実行環境/秘密/実HTTP relayが未設定のままであることを維持する。

仮予約は0027〜0029。具体的な番号付きmigrationは取り込み承認後に確定し、retention担当の0030以降と競合させない。現時点では新migrationを作成・適用していない。

## 承認後の受入試験

actual local Worker+D1+内部RPCでdisabled不送信、fake成功、同時dispatchの二重送信抑制、Temporary再試行と上限、Permanent停止、Uncertain隔離、lease切れ、秒/ミリ秒境界、再発行した旧確認リンクの失効、終了/中止後の期限短縮、旧fake経路との排他、トークンのログ非出力を確認する。既存41件、cargo check/test/fmt、fresh migration、bundle3構成を再検証する。現段階のメール接続試験は未実施。
